import { getPool } from "../lib/db.js";

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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
    res.json({ process: mapProcess(rows[0]), steps: steps.map(mapStep) });
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

    const idByTemplateStepId = new Map();
    for (const ts of tmplSteps) {
      const dueDate = new Date(startedAt);
      dueDate.setDate(dueDate.getDate() + (ts.due_days_offset || 0));
      const initialStatus = ts.depends_on_step ? "blocked" : "pending";
      const { rows: stepIns } = await client.query(
        `INSERT INTO process_steps
           (process_id, template_step_id, step_number, name, description, status,
            assigned_user_id, assigned_role, due_date, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10)
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
          dueDate.toISOString().slice(0, 10),
          null,
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
    const completedAt = status === "completed" ? new Date() : null;
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
    await client.query(
      `UPDATE process_steps SET status = 'pending', updated_at = NOW()
       WHERE depends_on_step_id = $1 AND status = 'blocked'`,
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
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not update step." });
  } finally {
    client.release();
  }
}

export async function putProcessStepComplete(req, res) {
  await completeOrSkipStep(req, res, "complete");
}

export async function putProcessStepSkip(req, res) {
  await completeOrSkipStep(req, res, "skip");
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
