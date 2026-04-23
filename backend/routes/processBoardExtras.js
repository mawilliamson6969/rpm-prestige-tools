import { getPool } from "../lib/db.js";
import { bumpActivity } from "../lib/process-activity.js";

/* ---------------- Archive / Recycle Bin ---------------- */

export async function putProcessArchive(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE processes SET archived_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Process not found." });
    await bumpActivity(id, { type: "archived", userId: req.user?.id });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not archive." });
  }
}

export async function putProcessUnarchive(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(`UPDATE processes SET archived_at = NULL, updated_at = NOW() WHERE id = $1`, [id]);
    await bumpActivity(id, { type: "unarchived", userId: req.user?.id });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not unarchive." });
  }
}

export async function putProcessSoftDelete(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(`UPDATE processes SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete." });
  }
}

export async function putProcessRestore(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(`UPDATE processes SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not restore." });
  }
}

export async function purgeExpiredRecycleBin() {
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM processes WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'`
    );
    if (rowCount > 0) console.log(`[recycle-bin] purged ${rowCount} expired processes`);
    return rowCount;
  } catch (err) {
    console.warn("[recycle-bin] purge failed:", err.message);
    return 0;
  }
}

/* ---------------- Bulk Actions ---------------- */

function parseIds(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => Number.parseInt(v, 10)).filter((n) => Number.isFinite(n));
}

export async function putProcessBulkStage(req, res) {
  const ids = parseIds(req.body?.processIds);
  const stageId = Number.parseInt(req.body?.stageId, 10);
  if (!ids.length || !Number.isFinite(stageId)) {
    res.status(400).json({ error: "processIds and stageId required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT is_final FROM process_template_stages WHERE id = $1`,
      [stageId]
    );
    const isFinal = rows[0]?.is_final ?? false;
    await pool.query(
      `UPDATE processes SET
         current_stage_id = $1,
         status = CASE WHEN $2 THEN 'completed' ELSE CASE WHEN status = 'completed' THEN 'active' ELSE status END END,
         completed_at = CASE WHEN $2 THEN COALESCE(completed_at, NOW()) ELSE CASE WHEN status = 'completed' THEN NULL ELSE completed_at END END,
         last_activity_at = NOW(),
         last_activity_type = 'stage_changed',
         last_activity_by = $3,
         updated_at = NOW()
       WHERE id = ANY($4::int[])`,
      [stageId, isFinal, req.user?.id ?? null, ids]
    );
    res.json({ ok: true, updated: ids.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not bulk move." });
  }
}

export async function putProcessBulkAssign(req, res) {
  const ids = parseIds(req.body?.processIds);
  const userId = Number.parseInt(req.body?.userId, 10);
  if (!ids.length || !Number.isFinite(userId)) {
    res.status(400).json({ error: "processIds and userId required." });
    return;
  }
  try {
    const pool = getPool();
    // Processes don't have a direct assignee field; set all pending/in_progress steps' assignee.
    await pool.query(
      `UPDATE process_steps SET assigned_user_id = $1, updated_at = NOW()
       WHERE process_id = ANY($2::int[]) AND status IN ('pending','in_progress','blocked')`,
      [userId, ids]
    );
    await pool.query(
      `UPDATE processes SET last_activity_at = NOW(), last_activity_type = 'reassigned',
                          last_activity_by = $1, updated_at = NOW()
       WHERE id = ANY($2::int[])`,
      [req.user?.id ?? null, ids]
    );
    res.json({ ok: true, updated: ids.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not bulk assign." });
  }
}

export async function putProcessBulkArchive(req, res) {
  const ids = parseIds(req.body?.processIds);
  if (!ids.length) {
    res.status(400).json({ error: "processIds required." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE processes SET archived_at = NOW(), updated_at = NOW() WHERE id = ANY($1::int[])`,
      [ids]
    );
    res.json({ ok: true, archived: ids.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not bulk archive." });
  }
}

export async function deleteProcessesBulk(req, res) {
  const ids = parseIds(req.body?.processIds);
  if (!ids.length) {
    res.status(400).json({ error: "processIds required." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE processes SET deleted_at = NOW(), updated_at = NOW() WHERE id = ANY($1::int[])`,
      [ids]
    );
    res.json({ ok: true, deleted: ids.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not bulk delete." });
  }
}

/* ---------------- Task Templates ---------------- */

function mapTaskTemplate(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    templateId: r.template_id,
    defaultAssigneeUserId: r.default_assignee_user_id,
    isSequential: r.is_sequential,
    isActive: r.is_active,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    itemCount: r.item_count != null ? Number(r.item_count) : undefined,
  };
}

function mapTaskTemplateItem(r) {
  return {
    id: r.id,
    taskTemplateId: r.task_template_id,
    title: r.title,
    description: r.description,
    taskType: r.task_type,
    taskConfig: r.task_config,
    priority: r.priority,
    dueDateConfig: r.due_date_config,
    assigneeOverrideUserId: r.assignee_override_user_id,
    stageId: r.stage_id,
    sortOrder: r.sort_order,
  };
}

export async function getTaskTemplates(req, res) {
  try {
    const pool = getPool();
    const templateId = Number.parseInt(req.query.templateId, 10);
    const whereParts = ["is_active = true"];
    const params = [];
    let n = 1;
    if (Number.isFinite(templateId)) {
      whereParts.push(`(template_id = $${n++} OR template_id IS NULL)`);
      params.push(templateId);
    }
    const { rows } = await pool.query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM task_template_items WHERE task_template_id = t.id) AS item_count
       FROM task_templates t
       WHERE ${whereParts.join(" AND ")}
       ORDER BY t.name ASC`,
      params
    );
    res.json({ templates: rows.map(mapTaskTemplate) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load task templates." });
  }
}

export async function getTaskTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM task_templates WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    const { rows: items } = await pool.query(
      `SELECT * FROM task_template_items WHERE task_template_id = $1 ORDER BY sort_order ASC, id ASC`,
      [id]
    );
    res.json({
      template: mapTaskTemplate(rows[0]),
      items: items.map(mapTaskTemplateItem),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load." });
  }
}

export async function postTaskTemplate(req, res) {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO task_templates
         (name, description, template_id, default_assignee_user_id, is_sequential, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        name,
        typeof req.body?.description === "string" ? req.body.description.trim() || null : null,
        Number.isFinite(Number.parseInt(req.body?.templateId, 10))
          ? Number.parseInt(req.body.templateId, 10)
          : null,
        Number.isFinite(Number.parseInt(req.body?.defaultAssigneeUserId, 10))
          ? Number.parseInt(req.body.defaultAssigneeUserId, 10)
          : null,
        req.body?.isSequential === true,
        req.user?.id ?? null,
      ]
    );
    res.status(201).json({ template: mapTaskTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create." });
  }
}

export async function putTaskTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
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
  if (typeof req.body?.isSequential === "boolean") {
    sets.push(`is_sequential = $${n++}`);
    vals.push(req.body.isSequential);
  }
  if (typeof req.body?.isActive === "boolean") {
    sets.push(`is_active = $${n++}`);
    vals.push(req.body.isActive);
  }
  if (req.body?.defaultAssigneeUserId !== undefined) {
    const v = Number.parseInt(req.body.defaultAssigneeUserId, 10);
    sets.push(`default_assignee_user_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
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
      `UPDATE task_templates SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ template: mapTaskTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update." });
  }
}

export async function deleteTaskTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE task_templates SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete." });
  }
}

export async function postTaskTemplateItem(req, res) {
  const taskTemplateId = Number.parseInt(req.params.id, 10);
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!Number.isFinite(taskTemplateId) || !title) {
    res.status(400).json({ error: "template id and title required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: next } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM task_template_items WHERE task_template_id = $1`,
      [taskTemplateId]
    );
    const { rows } = await pool.query(
      `INSERT INTO task_template_items
         (task_template_id, title, description, task_type, task_config, priority,
          due_date_config, assignee_override_user_id, stage_id, sort_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10)
       RETURNING *`,
      [
        taskTemplateId,
        title,
        typeof req.body?.description === "string" ? req.body.description.trim() || null : null,
        ["todo", "email", "sms", "call"].includes(req.body?.taskType) ? req.body.taskType : "todo",
        JSON.stringify(req.body?.taskConfig ?? {}),
        ["asap", "high", "medium", "low"].includes(req.body?.priority) ? req.body.priority : "medium",
        JSON.stringify(req.body?.dueDateConfig ?? {}),
        Number.isFinite(Number.parseInt(req.body?.assigneeOverrideUserId, 10))
          ? Number.parseInt(req.body.assigneeOverrideUserId, 10)
          : null,
        Number.isFinite(Number.parseInt(req.body?.stageId, 10))
          ? Number.parseInt(req.body.stageId, 10)
          : null,
        next[0].n,
      ]
    );
    res.status(201).json({ item: mapTaskTemplateItem(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add item." });
  }
}

export async function putTaskTemplateItem(req, res) {
  const id = Number.parseInt(req.params.itemId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  const strMap = [
    ["title", "title"],
    ["description", "description"],
    ["taskType", "task_type"],
    ["priority", "priority"],
  ];
  for (const [key, col] of strMap) {
    if (typeof req.body?.[key] === "string") {
      sets.push(`${col} = $${n++}`);
      vals.push(req.body[key].trim() || null);
    }
  }
  if (req.body?.taskConfig !== undefined) {
    sets.push(`task_config = $${n++}::jsonb`);
    vals.push(JSON.stringify(req.body.taskConfig));
  }
  if (req.body?.dueDateConfig !== undefined) {
    sets.push(`due_date_config = $${n++}::jsonb`);
    vals.push(JSON.stringify(req.body.dueDateConfig));
  }
  if (req.body?.assigneeOverrideUserId !== undefined) {
    const v = Number.parseInt(req.body.assigneeOverrideUserId, 10);
    sets.push(`assignee_override_user_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (req.body?.stageId !== undefined) {
    const v = Number.parseInt(req.body.stageId, 10);
    sets.push(`stage_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (Number.isFinite(Number.parseInt(req.body?.sortOrder, 10))) {
    sets.push(`sort_order = $${n++}`);
    vals.push(Number.parseInt(req.body.sortOrder, 10));
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields." });
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE task_template_items SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ item: mapTaskTemplateItem(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update." });
  }
}

export async function deleteTaskTemplateItem(req, res) {
  const id = Number.parseInt(req.params.itemId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM task_template_items WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete." });
  }
}

/**
 * Load a task template onto a specific process — creates new process_steps.
 */
export async function postLoadTaskTemplate(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  const taskTemplateId = Number.parseInt(req.params.taskTemplateId, 10);
  if (!Number.isFinite(processId) || !Number.isFinite(taskTemplateId)) {
    res.status(400).json({ error: "Invalid ids." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: proc } = await client.query(
      `SELECT p.*, ts.id AS current_stage FROM processes p
       LEFT JOIN process_template_stages ts ON ts.id = p.current_stage_id
       WHERE p.id = $1`,
      [processId]
    );
    if (!proc.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Process not found." });
    }
    const processRow = proc[0];
    const { rows: items } = await client.query(
      `SELECT * FROM task_template_items WHERE task_template_id = $1 ORDER BY sort_order ASC, id ASC`,
      [taskTemplateId]
    );
    const { rows: nextStep } = await client.query(
      `SELECT COALESCE(MAX(step_number), 0) + 1 AS n FROM process_steps WHERE process_id = $1`,
      [processId]
    );
    let stepNum = nextStep[0].n;
    const started = new Date(processRow.started_at);
    const createdStepIds = [];
    for (const it of items) {
      const cfg = it.due_date_config || {};
      let dueDate = null;
      if (cfg.type === "offset_from_start" || cfg.type === "when_fired") {
        const d = new Date();
        d.setDate(d.getDate() + (Number(cfg.days) || 0));
        dueDate = d.toISOString().slice(0, 10);
      } else if (cfg.type === "fixed_date" && typeof cfg.date === "string") {
        dueDate = cfg.date;
      }
      const { rows: ins } = await client.query(
        `INSERT INTO process_steps
           (process_id, step_number, name, description, status, assigned_user_id,
            due_date, task_type, task_config, priority)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6::date, $7, $8::jsonb, $9)
         RETURNING id`,
        [
          processId,
          stepNum++,
          it.title,
          it.description,
          it.assignee_override_user_id ?? null,
          dueDate,
          it.task_type,
          JSON.stringify(it.task_config ?? {}),
          it.priority,
        ]
      );
      createdStepIds.push(ins[0].id);
    }
    await client.query("COMMIT");
    res.json({ ok: true, createdStepIds });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not load template." });
  } finally {
    client.release();
  }
}

/* ---------------- Assignment round-robin + duplicate prevention ---------------- */

/**
 * Pick the next user for a round-robin rule. Config: { userIds: [1,3,4] }
 * Returns userId or null.
 */
export async function pickRoundRobinUser(pool, templateId, userIds) {
  if (!Array.isArray(userIds) || !userIds.length) return null;
  const { rows } = await pool.query(
    `SELECT last_assigned_user_id FROM assignment_round_robin WHERE template_id = $1`,
    [templateId]
  );
  const last = rows[0]?.last_assigned_user_id;
  const idx = last ? userIds.indexOf(last) : -1;
  const next = userIds[(idx + 1) % userIds.length];
  await pool.query(
    `INSERT INTO assignment_round_robin (template_id, last_assigned_user_id, assignment_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (template_id) DO UPDATE SET
       last_assigned_user_id = EXCLUDED.last_assigned_user_id,
       assignment_count = assignment_round_robin.assignment_count + 1,
       updated_at = NOW()`,
    [templateId, next]
  ).catch(() => {
    /* no unique constraint → swallow */
  });
  return next;
}

/**
 * Check duplicate rule on launch. Returns {allowed: bool, conflictId?}
 */
export async function checkDuplicate(pool, templateId, { propertyName, propertyId, contactName, contactEmail }) {
  const { rows: tpl } = await pool.query(
    `SELECT duplication_rule FROM process_templates WHERE id = $1`,
    [templateId]
  );
  const rule = tpl[0]?.duplication_rule ?? "none";
  if (rule === "none") return { allowed: true };
  const whereParts = [
    `template_id = $1`,
    `status = 'active'`,
    `archived_at IS NULL`,
    `deleted_at IS NULL`,
  ];
  const params = [templateId];
  let n = 2;
  if (rule === "one_per_property" || rule === "one_per_property_contact") {
    if (Number.isFinite(propertyId)) {
      whereParts.push(`property_id = $${n++}`);
      params.push(propertyId);
    } else if (propertyName) {
      whereParts.push(`LOWER(property_name) = LOWER($${n++})`);
      params.push(propertyName);
    } else {
      return { allowed: true };
    }
  }
  if (rule === "one_per_contact" || rule === "one_per_property_contact") {
    if (contactEmail) {
      whereParts.push(`LOWER(contact_email) = LOWER($${n++})`);
      params.push(contactEmail);
    } else if (contactName) {
      whereParts.push(`LOWER(contact_name) = LOWER($${n++})`);
      params.push(contactName);
    } else if (rule === "one_per_contact") {
      return { allowed: true };
    }
  }
  const { rows: conflicts } = await pool.query(
    `SELECT id FROM processes WHERE ${whereParts.join(" AND ")} LIMIT 1`,
    params
  );
  if (conflicts.length) return { allowed: false, conflictId: conflicts[0].id, rule };
  return { allowed: true };
}

/* ---------------- My Tasks ---------------- */

/**
 * All tasks for current user across ALL process boards (and optional standalone tasks).
 */
export async function getMyTasksAll(req, res) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Auth required." });
  try {
    const pool = getPool();
    // Process steps assigned to me (task-like steps)
    const { rows: steps } = await pool.query(
      `SELECT
         s.id AS step_id,
         s.name AS title,
         s.description,
         s.status,
         s.priority,
         s.task_type,
         s.due_date,
         s.process_id,
         p.name AS process_name,
         p.property_name,
         t.name AS template_name,
         t.icon AS template_icon,
         t.color AS template_color
       FROM process_steps s
       JOIN processes p ON p.id = s.process_id
       LEFT JOIN process_templates t ON t.id = p.template_id
       WHERE s.assigned_user_id = $1
         AND p.archived_at IS NULL AND p.deleted_at IS NULL
         AND p.status = 'active'
       ORDER BY
         CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END,
         s.due_date ASC NULLS LAST,
         CASE s.priority WHEN 'asap' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         s.created_at DESC
       LIMIT 500`,
      [userId]
    );
    res.json({
      tasks: steps.map((r) => ({
        kind: "process_step",
        id: r.step_id,
        title: r.title,
        description: r.description,
        status: r.status,
        priority: r.priority,
        taskType: r.task_type || "todo",
        dueDate: r.due_date,
        processId: r.process_id,
        processName: r.process_name,
        propertyName: r.property_name,
        templateName: r.template_name,
        templateIcon: r.template_icon,
        templateColor: r.template_color,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load tasks." });
  }
}
