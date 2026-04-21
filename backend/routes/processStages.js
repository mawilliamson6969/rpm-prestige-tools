import { getPool } from "../lib/db.js";

function mapStage(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    description: r.description,
    stageOrder: r.stage_order,
    color: r.color,
    icon: r.icon,
    isGate: r.is_gate,
    gateCondition: r.gate_condition,
    createdAt: r.created_at,
  };
}

export async function getTemplateStages(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_template_stages
       WHERE template_id = $1 ORDER BY stage_order ASC, id ASC`,
      [templateId]
    );
    res.json({ stages: rows.map(mapStage) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load stages." });
  }
}

export async function postTemplateStage(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isFinite(templateId) || !name) {
    res.status(400).json({ error: "template id and name required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: next } = await pool.query(
      `SELECT COALESCE(MAX(stage_order), -1) + 1 AS n FROM process_template_stages WHERE template_id = $1`,
      [templateId]
    );
    const { rows } = await pool.query(
      `INSERT INTO process_template_stages
         (template_id, name, description, stage_order, color, icon, is_gate)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        templateId,
        name,
        typeof req.body?.description === "string" ? req.body.description.trim() || null : null,
        Number.isFinite(Number.parseInt(req.body?.stageOrder, 10))
          ? Number.parseInt(req.body.stageOrder, 10)
          : next[0].n,
        typeof req.body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(req.body.color.trim())
          ? req.body.color.trim()
          : null,
        typeof req.body?.icon === "string" ? req.body.icon.trim() || null : null,
        req.body?.isGate === true,
      ]
    );
    res.status(201).json({ stage: mapStage(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create stage." });
  }
}

export async function putTemplateStage(req, res) {
  const id = Number.parseInt(req.params.stageId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid stage id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  const strs = [
    ["name", "name"],
    ["description", "description"],
    ["icon", "icon"],
  ];
  for (const [k, col] of strs) {
    if (typeof req.body?.[k] === "string") {
      sets.push(`${col} = $${n++}`);
      vals.push(req.body[k].trim() || null);
    }
  }
  if (typeof req.body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(req.body.color.trim())) {
    sets.push(`color = $${n++}`);
    vals.push(req.body.color.trim());
  }
  if (typeof req.body?.isGate === "boolean") {
    sets.push(`is_gate = $${n++}`);
    vals.push(req.body.isGate);
  }
  if (Number.isFinite(Number.parseInt(req.body?.stageOrder, 10))) {
    sets.push(`stage_order = $${n++}`);
    vals.push(Number.parseInt(req.body.stageOrder, 10));
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_template_stages SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Stage not found." });
      return;
    }
    res.json({ stage: mapStage(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update stage." });
  }
}

export async function deleteTemplateStage(req, res) {
  const id = Number.parseInt(req.params.stageId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid stage id." });
    return;
  }
  try {
    const pool = getPool();
    // Steps get stage_id nulled automatically via ON DELETE SET NULL.
    const { rowCount } = await pool.query(`DELETE FROM process_template_stages WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Stage not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete stage." });
  }
}

export async function putTemplateStagesReorder(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  const ids = Array.isArray(req.body?.stageIds) ? req.body.stageIds : null;
  if (!Number.isFinite(templateId) || !ids) {
    res.status(400).json({ error: "template id and stageIds required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const sid = Number.parseInt(ids[i], 10);
      if (!Number.isFinite(sid)) continue;
      await client.query(
        `UPDATE process_template_stages SET stage_order = $1 WHERE id = $2 AND template_id = $3`,
        [i, sid, templateId]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not reorder stages." });
  } finally {
    client.release();
  }
}

export async function putTemplateStepMoveToStage(req, res) {
  const stepId = Number.parseInt(req.params.stepId, 10);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }
  const stageId = req.body?.stageId === null ? null : Number.parseInt(req.body?.stageId, 10);
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE process_template_steps SET stage_id = $1 WHERE id = $2`,
      [Number.isFinite(stageId) ? stageId : null, stepId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not move step." });
  }
}

/* --- Conditions --- */

function mapCondition(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    description: r.description,
    triggerType: r.trigger_type,
    triggerConfig: r.trigger_config,
    actionType: r.action_type,
    actionConfig: r.action_config,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}

export async function getTemplateConditions(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_conditions WHERE template_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [templateId]
    );
    res.json({ conditions: rows.map(mapCondition) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load conditions." });
  }
}

export async function postTemplateCondition(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const triggerType = typeof req.body?.triggerType === "string" ? req.body.triggerType : "";
  const actionType = typeof req.body?.actionType === "string" ? req.body.actionType : "";
  if (!Number.isFinite(templateId) || !name || !triggerType || !actionType) {
    res.status(400).json({ error: "name, triggerType, and actionType required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO process_conditions
         (template_id, name, description, trigger_type, trigger_config,
          action_type, action_config, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)
       RETURNING *`,
      [
        templateId,
        name,
        typeof req.body?.description === "string" ? req.body.description.trim() || null : null,
        triggerType,
        JSON.stringify(req.body?.triggerConfig ?? {}),
        actionType,
        JSON.stringify(req.body?.actionConfig ?? {}),
        req.body?.isActive !== false,
        Number.isFinite(Number.parseInt(req.body?.sortOrder, 10))
          ? Number.parseInt(req.body.sortOrder, 10)
          : 0,
      ]
    );
    const { invalidateConditionCache } = await import("../lib/condition-engine.js");
    invalidateConditionCache(templateId);
    res.status(201).json({ condition: mapCondition(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create condition." });
  }
}

export async function putTemplateCondition(req, res) {
  const id = Number.parseInt(req.params.conditionId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid condition id." });
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
  if (typeof req.body?.triggerType === "string") {
    sets.push(`trigger_type = $${n++}`);
    vals.push(req.body.triggerType);
  }
  if (req.body?.triggerConfig !== undefined) {
    sets.push(`trigger_config = $${n++}::jsonb`);
    vals.push(JSON.stringify(req.body.triggerConfig));
  }
  if (typeof req.body?.actionType === "string") {
    sets.push(`action_type = $${n++}`);
    vals.push(req.body.actionType);
  }
  if (req.body?.actionConfig !== undefined) {
    sets.push(`action_config = $${n++}::jsonb`);
    vals.push(JSON.stringify(req.body.actionConfig));
  }
  if (typeof req.body?.isActive === "boolean") {
    sets.push(`is_active = $${n++}`);
    vals.push(req.body.isActive);
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_conditions SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Condition not found." });
      return;
    }
    const { invalidateConditionCache } = await import("../lib/condition-engine.js");
    invalidateConditionCache(rows[0].template_id);
    res.json({ condition: mapCondition(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update condition." });
  }
}

export async function deleteTemplateCondition(req, res) {
  const id = Number.parseInt(req.params.conditionId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid condition id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `DELETE FROM process_conditions WHERE id = $1 RETURNING template_id`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Condition not found." });
      return;
    }
    const { invalidateConditionCache } = await import("../lib/condition-engine.js");
    invalidateConditionCache(rows[0].template_id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete condition." });
  }
}

export async function getProcessConditionLog(req, res) {
  const processId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT l.*, c.name AS condition_name
       FROM process_condition_log l
       LEFT JOIN process_conditions c ON c.id = l.condition_id
       WHERE l.process_id = $1
       ORDER BY l.executed_at DESC
       LIMIT 100`,
      [processId]
    );
    res.json({
      entries: rows.map((r) => ({
        id: r.id,
        conditionId: r.condition_id,
        conditionName: r.condition_name,
        triggerType: r.trigger_type,
        actionType: r.action_type,
        result: r.result,
        details: r.details,
        executedAt: r.executed_at,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load condition log." });
  }
}
