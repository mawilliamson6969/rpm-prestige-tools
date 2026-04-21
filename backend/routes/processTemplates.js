import { getPool } from "../lib/db.js";

function mapTemplate(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    icon: r.icon,
    color: r.color,
    estimatedDays: r.estimated_days,
    isActive: r.is_active,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    stepCount: r.step_count != null ? Number(r.step_count) : undefined,
  };
}

function mapTemplateStep(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    stepNumber: r.step_number,
    name: r.name,
    description: r.description,
    assignedRole: r.assigned_role,
    assignedUserId: r.assigned_user_id,
    dueDaysOffset: r.due_days_offset,
    dependsOnStep: r.depends_on_step,
    isRequired: r.is_required,
    autoAction: r.auto_action,
    autoActionConfig: r.auto_action_config,
    createdAt: r.created_at,
  };
}

export async function getTemplates(req, res) {
  try {
    const pool = getPool();
    const includeInactive =
      req.query.includeInactive === "1" || req.query.includeInactive === "true";
    const where = includeInactive ? "" : `WHERE t.is_active = true`;
    const { rows } = await pool.query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM process_template_steps s WHERE s.template_id = t.id) AS step_count
       FROM process_templates t
       ${where}
       ORDER BY t.category NULLS LAST, t.name ASC`
    );
    res.json({ templates: rows.map(mapTemplate) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load templates." });
  }
}

export async function getTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM process_templates WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Template not found." });
      return;
    }
    const { rows: steps } = await pool.query(
      `SELECT * FROM process_template_steps WHERE template_id = $1 ORDER BY step_number ASC`,
      [id]
    );
    res.json({ template: mapTemplate(rows[0]), steps: steps.map(mapTemplateStep) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load template." });
  }
}

export async function postTemplate(req, res) {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  const description =
    typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const category = typeof req.body?.category === "string" ? req.body.category.trim() : null;
  const icon = typeof req.body?.icon === "string" && req.body.icon.trim() ? req.body.icon.trim() : "📋";
  const color =
    typeof req.body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(req.body.color.trim())
      ? req.body.color.trim()
      : "#0098D0";
  const estimatedDays = Number.parseInt(req.body?.estimatedDays, 10);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO process_templates (name, description, category, icon, color, estimated_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        name,
        description || null,
        category,
        icon,
        color,
        Number.isFinite(estimatedDays) ? estimatedDays : 14,
        req.user.id,
      ]
    );
    res.status(201).json({ template: mapTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create template." });
  }
}

export async function putTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof req.body?.name === "string") {
    const v = req.body.name.trim();
    if (!v) {
      res.status(400).json({ error: "name cannot be empty." });
      return;
    }
    sets.push(`name = $${n++}`);
    vals.push(v);
  }
  if (typeof req.body?.description === "string") {
    sets.push(`description = $${n++}`);
    vals.push(req.body.description.trim() || null);
  }
  if (typeof req.body?.category === "string") {
    sets.push(`category = $${n++}`);
    vals.push(req.body.category.trim() || null);
  }
  if (typeof req.body?.icon === "string") {
    sets.push(`icon = $${n++}`);
    vals.push(req.body.icon.trim() || "📋");
  }
  if (typeof req.body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(req.body.color.trim())) {
    sets.push(`color = $${n++}`);
    vals.push(req.body.color.trim());
  }
  if (req.body?.estimatedDays !== undefined) {
    const d = Number.parseInt(req.body.estimatedDays, 10);
    if (Number.isFinite(d)) {
      sets.push(`estimated_days = $${n++}`);
      vals.push(d);
    }
  }
  if (typeof req.body?.isActive === "boolean") {
    sets.push(`is_active = $${n++}`);
    vals.push(req.body.isActive);
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
      `UPDATE process_templates SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Template not found." });
      return;
    }
    res.json({ template: mapTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update template." });
  }
}

export async function deleteTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_templates SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Template not found." });
      return;
    }
    res.json({ template: mapTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not archive template." });
  }
}

export async function postTemplateDuplicate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: src } = await client.query(`SELECT * FROM process_templates WHERE id = $1`, [id]);
    if (!src.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Template not found." });
      return;
    }
    const s = src[0];
    const { rows: copied } = await client.query(
      `INSERT INTO process_templates (name, description, category, icon, color, estimated_days, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING *`,
      [`${s.name} (copy)`, s.description, s.category, s.icon, s.color, s.estimated_days, req.user.id]
    );
    const newId = copied[0].id;
    await client.query(
      `INSERT INTO process_template_steps
         (template_id, step_number, name, description, assigned_role, assigned_user_id,
          due_days_offset, depends_on_step, is_required, auto_action, auto_action_config)
       SELECT $1, step_number, name, description, assigned_role, assigned_user_id,
              due_days_offset, depends_on_step, is_required, auto_action, auto_action_config
       FROM process_template_steps
       WHERE template_id = $2`,
      [newId, id]
    );
    await client.query("COMMIT");
    res.status(201).json({ template: mapTemplate(copied[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not duplicate template." });
  } finally {
    client.release();
  }
}

export async function getTemplateSteps(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_template_steps WHERE template_id = $1 ORDER BY step_number ASC`,
      [id]
    );
    res.json({ steps: rows.map(mapTemplateStep) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load template steps." });
  }
}

export async function postTemplateStep(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: nextRow } = await pool.query(
      `SELECT COALESCE(MAX(step_number), 0) + 1 AS next FROM process_template_steps WHERE template_id = $1`,
      [templateId]
    );
    const stepNumber = Number.isFinite(Number.parseInt(req.body?.stepNumber, 10))
      ? Number.parseInt(req.body.stepNumber, 10)
      : nextRow[0].next;
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() : null;
    const assignedRole =
      typeof req.body?.assignedRole === "string" ? req.body.assignedRole.trim() : null;
    const assignedUserId = Number.isFinite(Number.parseInt(req.body?.assignedUserId, 10))
      ? Number.parseInt(req.body.assignedUserId, 10)
      : null;
    const dueDaysOffset = Number.isFinite(Number.parseInt(req.body?.dueDaysOffset, 10))
      ? Number.parseInt(req.body.dueDaysOffset, 10)
      : 0;
    const dependsOnStep = Number.isFinite(Number.parseInt(req.body?.dependsOnStep, 10))
      ? Number.parseInt(req.body.dependsOnStep, 10)
      : null;
    const isRequired = req.body?.isRequired === false ? false : true;
    const { rows } = await pool.query(
      `INSERT INTO process_template_steps
         (template_id, step_number, name, description, assigned_role, assigned_user_id,
          due_days_offset, depends_on_step, is_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        templateId,
        stepNumber,
        name,
        description || null,
        assignedRole || null,
        assignedUserId,
        dueDaysOffset,
        dependsOnStep,
        isRequired,
      ]
    );
    res.status(201).json({ step: mapTemplateStep(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create step." });
  }
}

export async function postTemplateStepTestAutomation(req, res) {
  const id = Number.parseInt(req.params.stepId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.*, t.name AS template_name
       FROM process_template_steps s
       JOIN process_templates t ON t.id = s.template_id
       WHERE s.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Step not found." });
      return;
    }
    const step = rows[0];
    if (!step.auto_action) {
      res.json({ ok: false, error: "no automation configured" });
      return;
    }
    const { replaceTemplateVars } = await import("../lib/process-automation.js");
    // Use dummy process data for the dry-run preview.
    const dummyProcess = {
      id: 0,
      name: step.template_name,
      property_name: "123 Example St",
      contact_name: "Jane Doe",
      contact_email: "jane@example.com",
      contact_phone: "555-0100",
      started_at: new Date().toISOString(),
      target_completion: null,
    };
    const config = step.auto_action_config || {};
    const resolved = {};
    for (const [k, v] of Object.entries(config)) {
      resolved[k] = typeof v === "string" ? replaceTemplateVars(v, dummyProcess) : v;
    }
    res.json({
      ok: true,
      dryRun: true,
      action: step.auto_action,
      resolvedConfig: resolved,
      sampleVariables: dummyProcess,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not test automation." });
  }
}

export async function putTemplateStep(req, res) {
  const id = Number.parseInt(req.params.stepId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  const fields = [
    ["name", "name", (v) => (typeof v === "string" && v.trim() ? v.trim() : null)],
    ["description", "description", (v) => (typeof v === "string" ? v.trim() || null : undefined)],
    ["assignedRole", "assigned_role", (v) => (typeof v === "string" ? v.trim() || null : undefined)],
    [
      "assignedUserId",
      "assigned_user_id",
      (v) => (v === null ? null : Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : undefined),
    ],
    [
      "dueDaysOffset",
      "due_days_offset",
      (v) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : undefined),
    ],
    [
      "dependsOnStep",
      "depends_on_step",
      (v) => (v === null ? null : Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : undefined),
    ],
    ["isRequired", "is_required", (v) => (typeof v === "boolean" ? v : undefined)],
    [
      "stepNumber",
      "step_number",
      (v) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : undefined),
    ],
    [
      "autoAction",
      "auto_action",
      (v) => (v === null || v === "" ? null : typeof v === "string" ? v.trim() : undefined),
    ],
    [
      "autoActionConfig",
      "auto_action_config",
      (v) => (v === null ? null : typeof v === "object" ? v : undefined),
    ],
  ];
  for (const [key, col, parse] of fields) {
    if (req.body?.[key] !== undefined) {
      const v = parse(req.body[key]);
      if (v !== undefined) {
        sets.push(`${col} = $${n++}`);
        vals.push(v);
      }
    }
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_template_steps SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Step not found." });
      return;
    }
    res.json({ step: mapTemplateStep(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update step." });
  }
}

export async function deleteTemplateStep(req, res) {
  const id = Number.parseInt(req.params.stepId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `DELETE FROM process_template_steps WHERE id = $1 RETURNING template_id, step_number`,
      [id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Step not found." });
      return;
    }
    const { template_id, step_number } = rows[0];
    await client.query(
      `UPDATE process_template_steps SET step_number = step_number - 1
       WHERE template_id = $1 AND step_number > $2`,
      [template_id, step_number]
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not delete step." });
  } finally {
    client.release();
  }
}

export async function putTemplateStepsReorder(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  const ids = Array.isArray(req.body?.stepIds) ? req.body.stepIds : null;
  if (!ids) {
    res.status(400).json({ error: "stepIds array is required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const stepId = Number.parseInt(ids[i], 10);
      if (!Number.isFinite(stepId)) continue;
      await client.query(
        `UPDATE process_template_steps SET step_number = $1 WHERE id = $2 AND template_id = $3`,
        [i + 1, stepId, templateId]
      );
    }
    await client.query("COMMIT");
    const { rows } = await pool.query(
      `SELECT * FROM process_template_steps WHERE template_id = $1 ORDER BY step_number ASC`,
      [templateId]
    );
    res.json({ steps: rows.map(mapTemplateStep) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not reorder steps." });
  } finally {
    client.release();
  }
}
