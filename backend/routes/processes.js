import { getPool } from "../lib/db.js";
import {
  runAutomationForProcessLaunch,
  runAutomationForUnblockedSteps,
} from "../lib/process-automation.js";
import { evaluateConditions } from "../lib/condition-engine.js";
import { calculateDueDateAtLaunch, recalcDependentDueDates } from "../lib/due-dates.js";
import { bumpActivity } from "../lib/process-activity.js";

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
    lastActivityAt: r.last_activity_at ?? null,
    lastActivityType: r.last_activity_type ?? null,
    lastActivityBy: r.last_activity_by ?? null,
    archivedAt: r.archived_at ?? null,
    deletedAt: r.deleted_at ?? null,
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
  // Duplicate-prevention check (runs before the transaction so we can cleanly reject).
  try {
    const { checkDuplicate } = await import("./processBoardExtras.js");
    const dupCheck = await checkDuplicate(pool, templateId, {
      propertyName:
        typeof req.body?.propertyName === "string" ? req.body.propertyName.trim() : null,
      propertyId: Number.isFinite(Number.parseInt(req.body?.propertyId, 10))
        ? Number.parseInt(req.body.propertyId, 10)
        : null,
      contactName:
        typeof req.body?.contactName === "string" ? req.body.contactName.trim() : null,
      contactEmail:
        typeof req.body?.contactEmail === "string" ? req.body.contactEmail.trim() : null,
    });
    if (!dupCheck.allowed) {
      res.status(409).json({
        error: `Duplicate prevented by "${dupCheck.rule}" rule`,
        conflictId: dupCheck.conflictId,
      });
      return;
    }
  } catch (err) {
    console.warn("[duplicate-check] skipped:", err.message);
  }
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

    const firstTemplateStageId = tmplStages.length ? tmplStages[0].id : null;
    const { rows: procRows } = await client.query(
      `INSERT INTO processes
         (template_id, name, status, property_name, property_id, contact_name, contact_email,
          contact_phone, target_completion, notes, created_by, current_stage_id)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        firstTemplateStageId,
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
    setImmediate(async () => {
      try {
        runAutomationForProcessLaunch(processRow.id).catch((err) =>
          console.warn("[automation] launch failed:", err.message)
        );
        evaluateConditions(processRow.id, "process_launched", {}).catch(() => {});
        // Apply round-robin assignment if configured on the template.
        const assignmentRule = template.assignment_rule || "manual";
        if (assignmentRule === "round_robin" || assignmentRule === "specific_user") {
          const config = template.assignment_config || {};
          let assigneeId = null;
          if (assignmentRule === "specific_user" && config.userId) {
            assigneeId = Number(config.userId);
          } else if (
            assignmentRule === "round_robin" &&
            Array.isArray(config.userIds) &&
            config.userIds.length
          ) {
            const { pickRoundRobinUser } = await import("./processBoardExtras.js");
            assigneeId = await pickRoundRobinUser(pool, templateId, config.userIds.map(Number));
          }
          if (Number.isFinite(assigneeId)) {
            await pool.query(
              `UPDATE process_steps SET assigned_user_id = $1, updated_at = NOW()
               WHERE process_id = $2 AND assigned_user_id IS NULL`,
              [assigneeId, processRow.id]
            );
          }
        }
      } catch (err) {
        console.warn("[launch] post-commit tasks failed:", err.message);
      }
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
    // Fire step_completed conditions + recalc dependent due dates + stage advancement.
    setImmediate(async () => {
      try {
        await bumpActivity(step.process_id, {
          type: "step_completed",
          userId: req.user?.id,
        });
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
        // Board-level auto-advance: move processes.current_stage_id forward if the
        // current template stage is fully complete and has auto_advance=true.
        await recalcCurrentStage(step.process_id);
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

/**
 * Recompute the process's current_stage_id based on the lowest-order template stage
 * that still has incomplete steps. Returns { oldStageId, newStageId, advanced: bool, autoAdvance }.
 * Respects the auto_advance flag on the *current* stage — if false, doesn't advance past it.
 */
async function recalcCurrentStage(processId) {
  const pool = getPool();
  const { rows: proc } = await pool.query(
    `SELECT p.current_stage_id, p.template_id,
            cs.auto_advance AS current_auto_advance,
            cs.stage_order AS current_stage_order,
            cs.is_final AS current_is_final
     FROM processes p
     LEFT JOIN process_template_stages cs ON cs.id = p.current_stage_id
     WHERE p.id = $1`,
    [processId]
  );
  if (!proc.length) return { advanced: false };
  const { template_id, current_stage_id, current_auto_advance, current_stage_order, current_is_final } =
    proc[0];
  if (!template_id) return { advanced: false };

  // Are all steps of the current template stage done?
  if (current_stage_id) {
    const { rows: remaining } = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM process_steps s
       JOIN process_template_steps ts ON ts.id = s.template_step_id
       WHERE s.process_id = $1
         AND ts.stage_id = $2
         AND s.status NOT IN ('completed','skipped')`,
      [processId, current_stage_id]
    );
    if (remaining[0].c > 0) return { advanced: false, oldStageId: current_stage_id };
    // All steps in current stage done. Respect auto_advance.
    if (current_auto_advance === false) {
      return { advanced: false, oldStageId: current_stage_id, autoAdvance: false };
    }
  }

  // Find the lowest-order template stage with incomplete steps (or the first stage if none set yet).
  const { rows: nextStages } = await pool.query(
    `SELECT s.id, s.stage_order, s.is_final,
       (SELECT COUNT(*)::int FROM process_steps ps
          JOIN process_template_steps ts ON ts.id = ps.template_step_id
          WHERE ps.process_id = $1 AND ts.stage_id = s.id
            AND ps.status NOT IN ('completed','skipped')) AS open_steps
     FROM process_template_stages s
     WHERE s.template_id = $2
     ORDER BY s.stage_order ASC, s.id ASC`,
    [processId, template_id]
  );
  const nextStage = nextStages.find((s) => s.open_steps > 0) ?? nextStages[nextStages.length - 1];
  if (!nextStage) return { advanced: false };
  if (nextStage.id === current_stage_id) return { advanced: false, oldStageId: current_stage_id };

  await pool.query(
    `UPDATE processes SET
       current_stage_id = $1,
       status = CASE WHEN $2 THEN 'completed' ELSE status END,
       completed_at = CASE WHEN $2 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
       updated_at = NOW()
     WHERE id = $3`,
    [nextStage.id, nextStage.is_final && nextStage.open_steps === 0, processId]
  );
  return {
    advanced: true,
    oldStageId: current_stage_id,
    newStageId: nextStage.id,
    isFinal: nextStage.is_final && nextStage.open_steps === 0,
  };
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

/**
 * Board view: stages + processes grouped by current_stage_id.
 * For any process missing current_stage_id, infer from the first incomplete stage
 * (via process_stages) or fall back to the template's first stage.
 */
export async function getProcessesBoard(req, res) {
  try {
    const pool = getPool();
    const templateId = Number.parseInt(req.query.templateId, 10);
    const assignee = Number.parseInt(req.query.assignee, 10);
    const priority = typeof req.query.priority === "string" ? req.query.priority.trim() : "";
    const statusFilter =
      typeof req.query.status === "string" ? req.query.status.trim() : "active";

    let stages = [];
    if (Number.isFinite(templateId)) {
      const { rows } = await pool.query(
        `SELECT * FROM process_template_stages
         WHERE template_id = $1 ORDER BY stage_order ASC, id ASC`,
        [templateId]
      );
      stages = rows.map((r) => ({
        id: r.id,
        templateId: r.template_id,
        name: r.name,
        color: r.color,
        textColor: r.text_color,
        stageOrder: r.stage_order,
        isFinal: r.is_final,
        autoAdvance: r.auto_advance,
      }));
    } else {
      // Unified generic-stage board
      stages = [
        { id: -1, name: "New", color: "#B5D4F4", textColor: "#042C53", stageOrder: 0, isFinal: false, autoAdvance: false, virtual: true },
        { id: -2, name: "In Progress", color: "#FAC775", textColor: "#412402", stageOrder: 1, isFinal: false, autoAdvance: false, virtual: true },
        { id: -3, name: "Waiting", color: "#CECBF6", textColor: "#26215C", stageOrder: 2, isFinal: false, autoAdvance: false, virtual: true },
        { id: -4, name: "Complete", color: "#C0DD97", textColor: "#173404", stageOrder: 3, isFinal: true, autoAdvance: false, virtual: true },
      ];
    }

    const whereParts = [];
    const params = [];
    let n = 1;
    // Exclude archived and deleted by default; explicit filter can include them.
    const includeArchived = req.query.archived === "true" || req.query.archived === "1";
    const includeDeleted = req.query.deleted === "true" || req.query.deleted === "1";
    if (!includeArchived) whereParts.push(`p.archived_at IS NULL`);
    else whereParts.push(`p.archived_at IS NOT NULL`);
    if (!includeDeleted) whereParts.push(`p.deleted_at IS NULL`);
    else whereParts.push(`p.deleted_at IS NOT NULL`);
    if (statusFilter && statusFilter !== "all") {
      whereParts.push(`p.status = $${n++}`);
      params.push(statusFilter);
    }
    if (Number.isFinite(templateId)) {
      whereParts.push(`p.template_id = $${n++}`);
      params.push(templateId);
    }
    if (priority) {
      // Processes don't have priority; look at property step-priority proxies — skip for now.
    }
    if (Number.isFinite(assignee)) {
      whereParts.push(
        `EXISTS (SELECT 1 FROM process_steps s WHERE s.process_id = p.id AND s.assigned_user_id = $${n++})`
      );
      params.push(assignee);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const { rows: procs } = await pool.query(
      `SELECT p.*,
         t.name AS template_name, t.icon AS template_icon, t.color AS template_color,
         t.aging_green_hours, t.aging_yellow_hours, t.card_badge_field,
         (SELECT COUNT(*)::int FROM process_steps s WHERE s.process_id = p.id) AS total_steps,
         (SELECT COUNT(*)::int FROM process_steps s WHERE s.process_id = p.id AND s.status IN ('completed','skipped')) AS completed_steps,
         (SELECT s.name FROM process_steps s WHERE s.process_id = p.id
            AND s.status NOT IN ('completed','skipped')
            ORDER BY s.step_number ASC LIMIT 1) AS current_step_name,
         cs.name AS current_stage_name,
         cs.color AS current_stage_color,
         cs.text_color AS current_stage_text_color,
         cs.is_final AS current_stage_is_final,
         cs.stage_order AS current_stage_order
       FROM processes p
       LEFT JOIN process_templates t ON t.id = p.template_id
       LEFT JOIN process_template_stages cs ON cs.id = p.current_stage_id
       ${where}
       ORDER BY p.board_position ASC, p.started_at DESC
       LIMIT 1000`,
      params
    );

    const bucketByStage = {};
    for (const st of stages) bucketByStage[st.id] = [];

    for (const p of procs) {
      const total = Number(p.total_steps) || 0;
      const done = Number(p.completed_steps) || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const overdue =
        p.target_completion &&
        new Date(p.target_completion) < today &&
        p.status === "active";
      const card = {
        id: p.id,
        title: p.name,
        propertyName: p.property_name,
        propertyId: p.property_id,
        contactName: p.contact_name,
        contactEmail: p.contact_email,
        contactPhone: p.contact_phone,
        templateId: p.template_id,
        templateName: p.template_name,
        templateIcon: p.template_icon,
        templateColor: p.template_color,
        status: p.status,
        currentStageId: p.current_stage_id,
        currentStageName: p.current_stage_name,
        currentStageColor: p.current_stage_color,
        currentStageTextColor: p.current_stage_text_color,
        currentStageIsFinal: p.current_stage_is_final,
        boardPosition: p.board_position,
        startedAt: p.started_at,
        targetCompletion: p.target_completion,
        completedAt: p.completed_at,
        totalSteps: total,
        completedSteps: done,
        progress: pct,
        currentStepName: p.current_step_name,
        overdue,
        lastActivityAt: p.last_activity_at,
        lastActivityType: p.last_activity_type,
        lastActivityBy: p.last_activity_by,
        agingGreenHours: Number(p.aging_green_hours ?? 48),
        agingYellowHours: Number(p.aging_yellow_hours ?? 96),
        cardBadgeField: p.card_badge_field || "due_date",
      };

      let stageKey;
      if (Number.isFinite(templateId)) {
        stageKey = p.current_stage_id ?? stages[0]?.id ?? null;
      } else {
        // Generic bucket
        if (p.status === "completed") stageKey = -4;
        else if (!p.current_stage_id) stageKey = -1;
        else if (p.current_stage_is_final) stageKey = -4;
        else if (
          p.current_stage_name &&
          /wait|pending|approval|response/i.test(p.current_stage_name)
        )
          stageKey = -3;
        else stageKey = -2;
      }
      if (bucketByStage[stageKey]) bucketByStage[stageKey].push(card);
      else if (stages[0]) bucketByStage[stages[0].id].push(card);
    }

    res.json({ stages, processes: bucketByStage });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load board." });
  }
}

/**
 * Move a process to a new stage. Auto-completes the process when moved to a final stage,
 * reopens it when moved off a final stage.
 */
export async function putProcessStage(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const stageId = req.body?.stageId === null ? null : Number.parseInt(req.body?.stageId, 10);
  const boardPos = Number.parseInt(req.body?.boardPosition, 10);
  if (!Number.isFinite(id) || (req.body?.stageId !== null && !Number.isFinite(stageId))) {
    res.status(400).json({ error: "Invalid id or stageId." });
    return;
  }
  try {
    const pool = getPool();
    let isFinal = false;
    if (Number.isFinite(stageId)) {
      const { rows } = await pool.query(
        `SELECT is_final FROM process_template_stages WHERE id = $1`,
        [stageId]
      );
      isFinal = rows[0]?.is_final ?? false;
    }
    const { rows } = await pool.query(
      `UPDATE processes SET
         current_stage_id = $1,
         board_position = COALESCE($2, board_position),
         status = CASE WHEN $3 THEN 'completed' ELSE CASE WHEN status = 'completed' THEN 'active' ELSE status END END,
         completed_at = CASE WHEN $3 THEN COALESCE(completed_at, NOW()) ELSE CASE WHEN status = 'completed' THEN NULL ELSE completed_at END END,
         last_activity_at = NOW(),
         last_activity_type = 'stage_changed',
         last_activity_by = $5,
         updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [
        Number.isFinite(stageId) ? stageId : null,
        Number.isFinite(boardPos) ? boardPos : null,
        isFinal,
        id,
        req.user?.id ?? null,
      ]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Process not found." });
      return;
    }
    res.json({ process: mapProcess(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not move process." });
  }
}

export async function putProcessBoardPosition(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const pos = Number.parseInt(req.body?.boardPosition, 10);
  if (!Number.isFinite(id) || !Number.isFinite(pos)) {
    res.status(400).json({ error: "Invalid id or position." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(`UPDATE processes SET board_position = $1, updated_at = NOW() WHERE id = $2`, [
      pos,
      id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update position." });
  }
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
