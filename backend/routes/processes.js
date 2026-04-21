import { getPool } from "../lib/db.js";
import {
  runAutomationForProcessLaunch,
  runAutomationForUnblockedSteps,
} from "../lib/process-automation.js";
import { evaluateConditions } from "../lib/condition-engine.js";
import { calculateDueDateAtLaunch, recalcDependentDueDates } from "../lib/due-dates.js";

function mapProcess(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    status: r.status,
    propertyName: r.property_name,
    propertyId: r.property_id,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    startedAt: r.started_at,
    targetCompletion: r.target_completion,
    completedAt: r.completed_at,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    templateName: r.template_name ?? undefined,
    templateIcon: r.template_icon ?? undefined,
    templateColor: r.template_color ?? undefined,
    totalSteps: r.total_steps != null ? Number(r.total_steps) : undefined,
    completedSteps: r.completed_steps != null ? Number(r.completed_steps) : undefined,
    currentStepName: r.current_step_name ?? undefined,
  };
}

function mapStep(r) {
  return {
    id: r.id,
    processId: r.process_id,
    templateStepId: r.template_step_id,
    stepNumber: r.step_number,
    name: r.name,
    description: r.description,
    status: r.status,
    assignedUserId: r.assigned_user_id,
    assignedUserName: r.assigned_user_name ?? undefined,
    assignedRole: r.assigned_role,
    dueDate: r.due_date,
    completedAt: r.completed_at,
    completedBy: r.completed_by,
    completedByName: r.completed_by_name ?? undefined,
    dependsOnStepId: r.depends_on_step_id,
    notes: r.notes,
    autoAction: r.auto_action,
    autoActionConfig: r.auto_action_config,
    automationStatus: r.automation_status,
    automationError: r.automation_error,
    stageId: r.stage_id ?? null,
    dueDateType: r.due_date_type ?? null,
    dueDateConfig: r.due_date_config ?? null,
    instructions: r.instructions ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapProcessStage(r) {
  return {
    id: r.id,
    processId: r.process_id,
    templateStageId: r.template_stage_id,
    name: r.name,
    stageOrder: r.stage_order,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    color: r.color ?? null,
    icon: r.icon ?? null,
    isGate: r.is_gate ?? false,
  };
}

const PROCESS_LIST_SQL = `
  SELECT p.*,
    t.name AS template_name, t.icon AS template_icon, t.color AS template_color,
    (SELECT COUNT(*)::int FROM process_steps s WHERE s.process_id = p.id) AS total_steps,
    (SELECT COUNT(*)::int FROM process_steps s WHERE s.process_id = p.id AND s.status IN ('completed','skipped')) AS completed_steps,
    (SELECT s.name FROM process_steps s
       WHERE s.process_id = p.id AND s.status NOT IN ('completed','skipped')
       ORDER BY s.step_number ASC LIMIT 1) AS current_step_name
  FROM processes p
  LEFT JOIN process_templates t ON t.id = p.template_id
`;

export async function getProcesses(req, res) {
  try {
    const pool = getPool();
    const whereParts = [];
    const params = [];
    let n = 1;
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    if (status && status !== "all") {
      whereParts.push(`p.status = $${n++}`);
      params.push(status);
    }
    const assignedTo = Number.parseInt(req.query.assignedTo, 10);
    if (Number.isFinite(assignedTo)) {
      whereParts.push(
        `EXISTS (SELECT 1 FROM process_steps s WHERE s.process_id = p.id AND s.assigned_user_id = $${n++})`
      );
      params.push(assignedTo);
    }
    const templateId = Number.parseInt(req.query.template, 10);
    if (Number.isFinite(templateId)) {
      whereParts.push(`p.template_id = $${n++}`);
      params.push(templateId);
    }
    const propertyId = Number.parseInt(req.query.property, 10);
    if (Number.isFinite(propertyId)) {
      whereParts.push(`p.property_id = $${n++}`);
      params.push(propertyId);
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      whereParts.push(
        `(p.name ILIKE $${n} OR p.property_name ILIKE $${n} OR p.contact_name ILIKE $${n})`
      );
      params.push(`%${search}%`);
      n++;
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${PROCESS_LIST_SQL} ${where} ORDER BY p.started_at DESC LIMIT 500`,
      params
    );
    res.json({ processes: rows.map(mapProcess) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load processes." });
  }
}

export async function getProcess(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`${PROCESS_LIST_SQL} WHERE p.id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Process not found." });
      return;
    }
    const { rows: steps } = await pool.query(
      `SELECT s.*, u.display_name AS assigned_user_name, cu.display_name AS completed_by_name
       FROM process_steps s
       LEFT JOIN users u ON u.id = s.assigned_user_id
       LEFT JOIN users cu ON cu.id = s.completed_by
       WHERE s.process_id = $1
       ORDER BY s.step_number ASC`,
      [id]
    );
    const { rows: stages } = await pool.query(
      `SELECT ps.*, ts.color, ts.icon, ts.is_gate
       FROM process_stages ps
       LEFT JOIN process_template_stages ts ON ts.id = ps.template_stage_id
       WHERE ps.process_id = $1
       ORDER BY ps.stage_order ASC, ps.id ASC`,
      [id]
    );
    res.json({
      process: mapProcess(rows[0]),
      steps: steps.map(mapStep),
      stages: stages.map(mapProcessStage),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load process." });
  }
}

export async function postProcess(req, res) {
  const templateId = Number.parseInt(req.body?.templateId, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "templateId is required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: tmpl } = await client.query(
      `SELECT * FROM process_templates WHERE id = $1 AND is_active = true`,
      [templateId]
    );
    if (!tmpl.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Template not found." });
      return;
    }
    const template = tmpl[0];
    const { rows: tmplStages } = await client.query(
      `SELECT * FROM process_template_stages WHERE template_id = $1 ORDER BY stage_order ASC, id ASC`,
      [templateId]
    );
    const { rows: tmplSteps } = await client.query(
      `SELECT * FROM process_template_steps WHERE template_id = $1 ORDER BY step_number ASC`,
      [templateId]
    );

    const propertyName =
      typeof req.body?.propertyName === "string" ? req.body.propertyName.trim() : null;
    const propertyId = Number.isFinite(Number.parseInt(req.body?.propertyId, 10))
      ? Number.parseInt(req.body.propertyId, 10)
      : null;
    const contactName =
      typeof req.body?.contactName === "string" ? req.body.contactName.trim() : null;
    const contactEmail =
      typeof req.body?.contactEmail === "string" ? req.body.contactEmail.trim() : null;
    const contactPhone =
      typeof req.body?.contactPhone === "string" ? req.body.contactPhone.trim() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : null;
    const target =
      typeof req.body?.targetCompletion === "string" && req.body.targetCompletion.trim()
        ? req.body.targetCompletion.trim()
        : null;

    const processName = propertyName ? `${template.name}: ${propertyName}` : template.name;

    const { rows: procRows } = await client.query(
      `INSERT INTO processes
         (template_id, name, status, property_name, property_id, contact_name, contact_email,
          contact_phone, target_completion, notes, created_by)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        templateId,
        processName,
        propertyName || null,
        propertyId,
        contactName || null,
        contactEmail || null,
        contactPhone || null,
        target,
        notes || null,
        req.user.id,
      ]
    );
    const processRow = procRows[0];
    const startedAt = new Date(processRow.started_at);

    // Create process_stages from template stages
    const stageIdByTemplateStageId = new Map();
    for (const [idx, ts] of tmplStages.entries()) {
      const { rows: stageIns } = await client.query(
        `INSERT INTO process_stages
           (process_id, template_stage_id, name, stage_order, status, started_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          processRow.id,
          ts.id,
          ts.name,
          ts.stage_order ?? idx,
          idx === 0 ? "active" : "pending",
          idx === 0 ? new Date() : null,
        ]
      );
      stageIdByTemplateStageId.set(ts.id, stageIns[0].id);
    }

    const idByTemplateStepId = new Map();
    for (const ts of tmplSteps) {
      const computedDue =
        calculateDueDateAtLaunch(ts.due_date_type, ts.due_date_config, { startedAt }) ??
        // Fallback to legacy offset behavior
        (() => {
          const d = new Date(startedAt);
          d.setDate(d.getDate() + (ts.due_days_offset || 0));
          return d.toISOString().slice(0, 10);
        })();
      const initialStatus = ts.depends_on_step ? "blocked" : "pending";
      const processStageId = ts.stage_id
        ? stageIdByTemplateStageId.get(ts.stage_id) || null
        : null;
      const { rows: stepIns } = await client.query(
        `INSERT INTO process_steps
           (process_id, template_step_id, step_number, name, description, status,
            assigned_user_id, assigned_role, due_date, notes, auto_action, auto_action_config,
            stage_id, due_date_type, due_date_config, instructions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13, $14, $15::jsonb, $16)
         RETURNING id`,
        [
          processRow.id,
          ts.id,
          ts.step_number,
          ts.name,
          ts.description,
          initialStatus,
          ts.assigned_user_id,
          ts.assigned_role,
          computedDue,
          null,
          ts.auto_action,
          ts.auto_action_config,
          processStageId,
          ts.due_date_type || "offset_from_start",
          JSON.stringify(ts.due_date_config ?? {}),
          ts.instructions || null,
        ]
      );
      idByTemplateStepId.set(ts.step_number, stepIns[0].id);
    }
    // Wire up depends_on_step_id references.
    for (const ts of tmplSteps) {
      if (ts.depends_on_step) {
        const dependsId = idByTemplateStepId.get(ts.depends_on_step);
        const stepId = idByTemplateStepId.get(ts.step_number);
        if (dependsId && stepId) {
          await client.query(
            `UPDATE process_steps SET depends_on_step_id = $1 WHERE id = $2`,
            [dependsId, stepId]
          );
        }
      }
    }
    await client.query("COMMIT");

    const { rows: finalRows } = await pool.query(`${PROCESS_LIST_SQL} WHERE p.id = $1`, [
      processRow.id,
    ]);
    const { rows: steps } = await pool.query(
      `SELECT s.*, u.display_name AS assigned_user_name, cu.display_name AS completed_by_name
       FROM process_steps s
       LEFT JOIN users u ON u.id = s.assigned_user_id
       LEFT JOIN users cu ON cu.id = s.completed_by
       WHERE s.process_id = $1 ORDER BY s.step_number ASC`,
      [processRow.id]
    );
    res.status(201).json({ process: mapProcess(finalRows[0]), steps: steps.map(mapStep) });
    setImmediate(() => {
      runAutomationForProcessLaunch(processRow.id).catch((err) =>
        console.warn("[automation] launch failed:", err.message)
      );
      evaluateConditions(processRow.id, "process_launched", {}).catch(() => {});
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not launch process." });
  } finally {
    client.release();
  }
}

export async function putProcess(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  const strings = [
    ["name", "name"],
    ["propertyName", "property_name"],
    ["contactName", "contact_name"],
    ["contactEmail", "contact_email"],
    ["contactPhone", "contact_phone"],
    ["notes", "notes"],
  ];
  for (const [key, col] of strings) {
    if (typeof req.body?.[key] === "string") {
      sets.push(`${col} = $${n++}`);
      vals.push(req.body[key].trim() || null);
    }
  }
  if (req.body?.propertyId !== undefined) {
    const v = Number.parseInt(req.body.propertyId, 10);
    sets.push(`property_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (typeof req.body?.targetCompletion === "string") {
    sets.push(`target_completion = $${n++}`);
    vals.push(req.body.targetCompletion.trim() || null);
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE processes SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Process not found." });
      return;
    }
    res.json({ process: mapProcess(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update process." });
  }
}

export async function putProcessStatus(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  const status = typeof req.body?.status === "string" ? req.body.status.trim() : "";
  if (!["active", "paused", "completed", "canceled"].includes(status)) {
    res.status(400).json({ error: "Invalid status." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: before } = await pool.query(`SELECT status FROM processes WHERE id = $1`, [id]);
    const fromStatus = before[0]?.status ?? null;
    const { rows } = await pool.query(
      `UPDATE processes
       SET status = $1,
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Process not found." });
      return;
    }
    res.json({ process: mapProcess(rows[0]) });
    setImmediate(() =>
      evaluateConditions(id, "process_status_changed", {
        fromStatus,
        toStatus: status,
      }).catch(() => {})
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update process status." });
  }
}

export async function deleteProcess(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM processes WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Process not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete process." });
  }
}

export async function putProcessStep(req, res) {
  const id = Number.parseInt(req.params.stepId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof req.body?.name === "string" && req.body.name.trim()) {
    sets.push(`name = $${n++}`);
    vals.push(req.body.name.trim());
  }
  if (typeof req.body?.description === "string") {
    sets.push(`description = $${n++}`);
    vals.push(req.body.description.trim() || null);
  }
  if (typeof req.body?.status === "string") {
    const v = req.body.status.trim();
    if (["pending", "in_progress", "completed", "skipped", "blocked"].includes(v)) {
      sets.push(`status = $${n++}`);
      vals.push(v);
    }
  }
  if (req.body?.assignedUserId !== undefined) {
    const v = Number.parseInt(req.body.assignedUserId, 10);
    sets.push(`assigned_user_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (typeof req.body?.notes === "string") {
    sets.push(`notes = $${n++}`);
    vals.push(req.body.notes.trim() || null);
  }
  if (typeof req.body?.dueDate === "string") {
    sets.push(`due_date = $${n++}`);
    vals.push(req.body.dueDate.trim() || null);
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_steps SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Step not found." });
      return;
    }
    res.json({ step: mapStep(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update step." });
  }
}

async function completeOrSkipStep(req, res, kind) {
  const id = Number.parseInt(req.params.stepId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const status = kind === "skip" ? "skipped" : "completed";
    const { rows } = await client.query(
      `UPDATE process_steps
       SET status = $1, completed_at = NOW(), completed_by = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, req.user.id, id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Step not found." });
      return;
    }
    const step = rows[0];
    // Unblock any step that depends on this one.
    const { rows: unblocked } = await client.query(
      `UPDATE process_steps SET status = 'pending', updated_at = NOW()
       WHERE depends_on_step_id = $1 AND status = 'blocked'
       RETURNING id`,
      [id]
    );
    // Check if process is now complete.
    const { rows: remaining } = await client.query(
      `SELECT COUNT(*)::int AS c FROM process_steps
       WHERE process_id = $1 AND status NOT IN ('completed','skipped')`,
      [step.process_id]
    );
    if (remaining[0].c === 0) {
      await client.query(
        `UPDATE processes SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [step.process_id]
      );
    }
    await client.query("COMMIT");
    res.json({ step: mapStep(step) });
    const unblockedIds = unblocked.map((r) => r.id);
    if (unblockedIds.length) {
      setImmediate(() => {
        runAutomationForUnblockedSteps(unblockedIds).catch((err) =>
          console.warn("[automation] unblock failed:", err.message)
        );
      });
    }
    // Fire step_completed conditions + recalc dependent due dates + maybe complete a stage.
    setImmediate(async () => {
      try {
        await evaluateConditions(step.process_id, "step_completed", {
          templateStepId: step.template_step_id,
          stepName: step.name,
        });
        await recalcDependentDueDates({
          processId: step.process_id,
          completedStepId: step.id,
          completedStepTemplateId: step.template_step_id,
        });
        await checkAndCompleteStage(step.process_id, step.stage_id);
      } catch (err) {
        console.warn("[process] post-complete tasks failed:", err.message);
      }
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not update step." });
  } finally {
    client.release();
  }
}

async function checkAndCompleteStage(processId, stageId) {
  if (!stageId) return;
  const pool = getPool();
  const { rows: remaining } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM process_steps
     WHERE stage_id = $1 AND status NOT IN ('completed','skipped')`,
    [stageId]
  );
  if (remaining[0].c > 0) return;
  const { rows: stage } = await pool.query(
    `UPDATE process_stages
     SET status = 'completed', completed_at = NOW()
     WHERE id = $1 AND status <> 'completed'
     RETURNING *`,
    [stageId]
  );
  if (!stage.length) return;
  // Activate next stage.
  await pool.query(
    `UPDATE process_stages
     SET status = 'active', started_at = COALESCE(started_at, NOW())
     WHERE process_id = $1 AND status = 'pending'
       AND stage_order = (
         SELECT MIN(stage_order) FROM process_stages
         WHERE process_id = $1 AND status = 'pending'
       )`,
    [processId]
  );
  // Fire stage_completed conditions.
  setImmediate(() => {
    evaluateConditions(processId, "stage_completed", {
      templateStageId: stage[0].template_stage_id,
      stageName: stage[0].name,
    }).catch(() => {});
    recalcDependentDueDates({
      processId,
      completedStageId: stage[0].id,
      completedStageTemplateId: stage[0].template_stage_id,
    }).catch(() => {});
  });
}

export async function putProcessStepComplete(req, res) {
  await completeOrSkipStep(req, res, "complete");
}

export async function putProcessStepSkip(req, res) {
  await completeOrSkipStep(req, res, "skip");
}

export async function getProcessesDashboard(_req, res) {
  try {
    const pool = getPool();
    const { rows: byTemplate } = await pool.query(
      `SELECT t.id, t.name, t.icon, t.color, t.category,
         COUNT(p.id) FILTER (WHERE p.status = 'active')::int AS active_count,
         COUNT(p.id) FILTER (WHERE p.status = 'completed')::int AS completed_count,
         COUNT(p.id) FILTER (WHERE p.status = 'active' AND p.target_completion < CURRENT_DATE)::int AS overdue_count,
         AVG(
           EXTRACT(EPOCH FROM (p.completed_at - p.started_at)) / 86400
         ) FILTER (WHERE p.status = 'completed') AS avg_days
       FROM process_templates t
       LEFT JOIN processes p ON p.template_id = t.id
       WHERE t.is_active = true
       GROUP BY t.id, t.name, t.icon, t.color, t.category
       ORDER BY active_count DESC, t.name ASC`
    );
    res.json({
      byTemplate: byTemplate.map((r) => ({
        templateId: r.id,
        name: r.name,
        icon: r.icon,
        color: r.color,
        category: r.category,
        activeCount: Number(r.active_count) || 0,
        completedCount: Number(r.completed_count) || 0,
        overdueCount: Number(r.overdue_count) || 0,
        avgDays: r.avg_days !== null ? Math.round(Number(r.avg_days)) : null,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load dashboard." });
  }
}

export async function postProcessStepAutomationRetry(req, res) {
  const stepId = Number.parseInt(req.params.stepId, 10);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }
  try {
    const pool = getPool();
    // Clear the automation_status so executeStepAutomation will run it again.
    await pool.query(
      `UPDATE process_steps SET automation_status = NULL, automation_error = NULL WHERE id = $1`,
      [stepId]
    );
    const { executeStepAutomation } = await import("../lib/process-automation.js");
    const result = await executeStepAutomation(stepId);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Could not retry automation." });
  }
}

export async function getProcessStepActivity(req, res) {
  const stepId = Number.parseInt(req.params.stepId, 10);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT c.id, c.user_id, c.comment, c.created_at, u.display_name AS user_name
       FROM task_comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.process_step_id = $1
       ORDER BY c.created_at ASC`,
      [stepId]
    );
    res.json({ comments: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load activity." });
  }
}

export async function postProcessStepComment(req, res) {
  const stepId = Number.parseInt(req.params.stepId, 10);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!Number.isFinite(stepId) || !comment) {
    res.status(400).json({ error: "stepId and comment are required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO task_comments (process_step_id, user_id, comment)
       VALUES ($1, $2, $3) RETURNING *`,
      [stepId, req.user.id, comment]
    );
    res.status(201).json({ comment: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add comment." });
  }
}
