import { getPool } from "../lib/db.js";

function mapTask(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    assignedUserId: r.assigned_user_id,
    assignedUserName: r.assigned_user_name ?? undefined,
    createdBy: r.created_by,
    propertyName: r.property_name,
    propertyId: r.property_id,
    contactName: r.contact_name,
    dueDate: r.due_date,
    dueTime: r.due_time,
    reminderAt: r.reminder_at,
    completedAt: r.completed_at,
    completedBy: r.completed_by,
    processStepId: r.process_step_id,
    processId: r.process_id ?? undefined,
    processName: r.process_name ?? undefined,
    projectId: r.project_id ?? undefined,
    projectName: r.project_name ?? undefined,
    projectColor: r.project_color ?? undefined,
    projectIcon: r.project_icon ?? undefined,
    category: r.category,
    tags: r.tags ?? [],
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapComment(r) {
  return {
    id: r.id,
    taskId: r.task_id,
    processStepId: r.process_step_id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    comment: r.comment,
    createdAt: r.created_at,
  };
}

const TASK_SELECT = `
  SELECT t.*,
         u.display_name AS assigned_user_name,
         ps.process_id AS process_id,
         p.name AS process_name,
         proj.name AS project_name,
         proj.color AS project_color,
         proj.icon AS project_icon
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assigned_user_id
  LEFT JOIN process_steps ps ON ps.id = t.process_step_id
  LEFT JOIN processes p ON p.id = ps.process_id
  LEFT JOIN projects proj ON proj.id = t.project_id
`;

export async function getTasks(req, res) {
  try {
    const pool = getPool();
    const whereParts = [];
    const params = [];
    let n = 1;
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    if (status && status !== "all") {
      whereParts.push(`t.status = $${n++}`);
      params.push(status);
    }
    let assignedTo = req.query.assignedTo;
    if (assignedTo === "currentUser") assignedTo = req.user.id;
    const assignedNum = Number.parseInt(assignedTo, 10);
    if (Number.isFinite(assignedNum)) {
      whereParts.push(`t.assigned_user_id = $${n++}`);
      params.push(assignedNum);
    }
    const priority = typeof req.query.priority === "string" ? req.query.priority.trim() : "";
    if (priority) {
      whereParts.push(`t.priority = $${n++}`);
      params.push(priority);
    }
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    if (category) {
      whereParts.push(`t.category = $${n++}`);
      params.push(category);
    }
    const projectId = Number.parseInt(req.query.projectId, 10);
    if (Number.isFinite(projectId)) {
      whereParts.push(`t.project_id = $${n++}`);
      params.push(projectId);
    }
    const dueFilter = typeof req.query.dueDate === "string" ? req.query.dueDate.trim() : "";
    if (dueFilter === "today") {
      whereParts.push(`t.due_date = CURRENT_DATE`);
    } else if (dueFilter === "week") {
      whereParts.push(`t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`);
    } else if (dueFilter === "overdue") {
      whereParts.push(`t.due_date < CURRENT_DATE AND t.status NOT IN ('completed','canceled')`);
    }
    if (req.query.overdue === "true" || req.query.overdue === "1") {
      whereParts.push(`t.due_date < CURRENT_DATE AND t.status NOT IN ('completed','canceled')`);
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      whereParts.push(`(t.title ILIKE $${n} OR t.description ILIKE $${n} OR t.property_name ILIKE $${n})`);
      params.push(`%${search}%`);
      n++;
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${TASK_SELECT} ${where}
       ORDER BY
         CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
         t.due_date ASC NULLS LAST,
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC,
         t.created_at DESC
       LIMIT 1000`,
      params
    );
    res.json({ tasks: rows.map(mapTask) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load tasks." });
  }
}

export async function getMyTasks(req, res) {
  req.query.assignedTo = "currentUser";
  return getTasks(req, res);
}

export async function getTask(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid task id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Task not found." });
      return;
    }
    const { rows: comments } = await pool.query(
      `SELECT c.*, u.display_name AS user_name
       FROM task_comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.task_id = $1 ORDER BY c.created_at ASC`,
      [id]
    );
    const { rows: attachments } = await pool.query(
      `SELECT * FROM task_attachments WHERE task_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    res.json({
      task: mapTask(rows[0]),
      comments: comments.map(mapComment),
      attachments,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load task." });
  }
}

export async function postTask(req, res) {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required." });
    return;
  }
  const priority = ["urgent", "high", "normal", "low"].includes(req.body?.priority)
    ? req.body.priority
    : "normal";
  const assignedUserId = Number.parseInt(req.body?.assignedUserId, 10);
  const propertyId = Number.parseInt(req.body?.propertyId, 10);
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  try {
    const pool = getPool();
    const projectIdParam = Number.parseInt(
      req.body?.projectId ?? req.params?.projectId,
      10
    );
    const { rows } = await pool.query(
      `INSERT INTO tasks
         (title, description, priority, assigned_user_id, created_by,
          property_name, property_id, contact_name, due_date, due_time,
          category, tags, notes, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        title,
        typeof req.body?.description === "string" ? req.body.description.trim() || null : null,
        priority,
        Number.isFinite(assignedUserId) ? assignedUserId : req.user.id,
        req.user.id,
        typeof req.body?.propertyName === "string" ? req.body.propertyName.trim() || null : null,
        Number.isFinite(propertyId) ? propertyId : null,
        typeof req.body?.contactName === "string" ? req.body.contactName.trim() || null : null,
        typeof req.body?.dueDate === "string" && req.body.dueDate.trim()
          ? req.body.dueDate.trim()
          : null,
        typeof req.body?.dueTime === "string" && req.body.dueTime.trim()
          ? req.body.dueTime.trim()
          : null,
        typeof req.body?.category === "string" ? req.body.category.trim() || null : null,
        tags,
        typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null,
        Number.isFinite(projectIdParam) ? projectIdParam : null,
      ]
    );
    const pool2 = pool;
    const { rows: full } = await pool2.query(`${TASK_SELECT} WHERE t.id = $1`, [rows[0].id]);
    res.status(201).json({ task: mapTask(full[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create task." });
  }
}

export async function putTask(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid task id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    sets.push(`title = $${n++}`);
    vals.push(req.body.title.trim());
  }
  if (typeof req.body?.description === "string") {
    sets.push(`description = $${n++}`);
    vals.push(req.body.description.trim() || null);
  }
  if (["urgent", "high", "normal", "low"].includes(req.body?.priority)) {
    sets.push(`priority = $${n++}`);
    vals.push(req.body.priority);
  }
  if (["pending", "in_progress", "completed", "canceled"].includes(req.body?.status)) {
    sets.push(`status = $${n++}`);
    vals.push(req.body.status);
    if (req.body.status === "completed") {
      sets.push(`completed_at = NOW()`);
      sets.push(`completed_by = $${n++}`);
      vals.push(req.user.id);
    } else {
      sets.push(`completed_at = NULL`);
      sets.push(`completed_by = NULL`);
    }
  }
  if (req.body?.assignedUserId !== undefined) {
    const v = Number.parseInt(req.body.assignedUserId, 10);
    sets.push(`assigned_user_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (typeof req.body?.propertyName === "string") {
    sets.push(`property_name = $${n++}`);
    vals.push(req.body.propertyName.trim() || null);
  }
  if (req.body?.propertyId !== undefined) {
    const v = Number.parseInt(req.body.propertyId, 10);
    sets.push(`property_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (typeof req.body?.contactName === "string") {
    sets.push(`contact_name = $${n++}`);
    vals.push(req.body.contactName.trim() || null);
  }
  if (typeof req.body?.dueDate === "string") {
    sets.push(`due_date = $${n++}`);
    vals.push(req.body.dueDate.trim() || null);
  }
  if (typeof req.body?.dueTime === "string") {
    sets.push(`due_time = $${n++}`);
    vals.push(req.body.dueTime.trim() || null);
  }
  if (typeof req.body?.category === "string") {
    sets.push(`category = $${n++}`);
    vals.push(req.body.category.trim() || null);
  }
  if (Array.isArray(req.body?.tags)) {
    sets.push(`tags = $${n++}`);
    vals.push(req.body.tags.map((t) => String(t).trim()).filter(Boolean));
  }
  if (typeof req.body?.notes === "string") {
    sets.push(`notes = $${n++}`);
    vals.push(req.body.notes.trim() || null);
  }
  if (req.body?.projectId !== undefined) {
    const v = Number.parseInt(req.body.projectId, 10);
    sets.push(`project_id = $${n++}`);
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
    await pool.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $${n}`, vals);
    const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Task not found." });
      return;
    }
    res.json({ task: mapTask(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update task." });
  }
}

export async function putTaskComplete(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid task id." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE tasks
       SET status = 'completed', completed_at = NOW(), completed_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [req.user.id, id]
    );
    const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Task not found." });
      return;
    }
    res.json({ task: mapTask(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not complete task." });
  }
}

export async function deleteTask(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid task id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM tasks WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Task not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete task." });
  }
}

export async function postTaskComment(req, res) {
  const taskId = Number.parseInt(req.params.id, 10);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!Number.isFinite(taskId) || !comment) {
    res.status(400).json({ error: "taskId and comment are required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO task_comments (task_id, user_id, comment) VALUES ($1, $2, $3) RETURNING *`,
      [taskId, req.user.id, comment]
    );
    res.status(201).json({ comment: mapComment(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add comment." });
  }
}

export async function getTasksDashboard(req, res) {
  try {
    const pool = getPool();
    const uid = req.user.id;
    const { rows: myRow } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status NOT IN ('completed','canceled'))::int AS open_count,
         COUNT(*) FILTER (WHERE status NOT IN ('completed','canceled') AND due_date < CURRENT_DATE)::int AS overdue_count,
         COUNT(*) FILTER (WHERE status NOT IN ('completed','canceled') AND due_date = CURRENT_DATE)::int AS due_today_count,
         COUNT(*) FILTER (WHERE status NOT IN ('completed','canceled') AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days')::int AS due_week_count
       FROM tasks WHERE assigned_user_id = $1`,
      [uid]
    );
    const { rows: teamRows } = await pool.query(
      `SELECT u.id, u.display_name,
         COUNT(t.id) FILTER (WHERE t.status NOT IN ('completed','canceled'))::int AS open_count,
         COUNT(t.id) FILTER (WHERE t.status NOT IN ('completed','canceled') AND t.due_date < CURRENT_DATE)::int AS overdue_count,
         COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.completed_at >= DATE_TRUNC('week', CURRENT_DATE))::int AS completed_week
       FROM users u
       LEFT JOIN tasks t ON t.assigned_user_id = u.id
       GROUP BY u.id, u.display_name
       ORDER BY u.display_name ASC`
    );
    const { rows: processes } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count
       FROM processes`
    );
    const { rows: byTemplate } = await pool.query(
      `SELECT t.id, t.name, t.icon, t.color, COUNT(p.id)::int AS count
       FROM process_templates t
       LEFT JOIN processes p ON p.template_id = t.id AND p.status = 'active'
       WHERE t.is_active = true
       GROUP BY t.id, t.name, t.icon, t.color
       ORDER BY count DESC, t.name ASC
       LIMIT 10`
    );
    const { rows: activity } = await pool.query(
      `SELECT 'task_completed' AS kind, t.id, t.title AS label, t.completed_at AS at, u.display_name AS actor
       FROM tasks t LEFT JOIN users u ON u.id = t.completed_by
       WHERE t.completed_at IS NOT NULL
       UNION ALL
       SELECT 'step_completed' AS kind, s.id, s.name AS label, s.completed_at AS at, u.display_name AS actor
       FROM process_steps s LEFT JOIN users u ON u.id = s.completed_by
       WHERE s.completed_at IS NOT NULL
       ORDER BY at DESC NULLS LAST
       LIMIT 20`
    );
    res.json({
      me: myRow[0] || { open_count: 0, overdue_count: 0, due_today_count: 0, due_week_count: 0 },
      team: teamRows,
      processes: {
        active: processes[0]?.active_count ?? 0,
        completed: processes[0]?.completed_count ?? 0,
        byTemplate,
      },
      activity,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load dashboard." });
  }
}
