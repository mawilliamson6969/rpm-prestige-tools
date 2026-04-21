import { getPool } from "../lib/db.js";

export async function getTaskDependencies(req, res) {
  const taskId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(taskId)) {
    res.status(400).json({ error: "Invalid task id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: deps } = await pool.query(
      `SELECT d.id, d.depends_on_task_id, d.dependency_type, t.title, t.status
       FROM task_dependencies d
       LEFT JOIN tasks t ON t.id = d.depends_on_task_id
       WHERE d.task_id = $1
       ORDER BY d.id ASC`,
      [taskId]
    );
    const { rows: dependents } = await pool.query(
      `SELECT d.id, d.task_id AS dependent_task_id, d.dependency_type, t.title, t.status
       FROM task_dependencies d
       LEFT JOIN tasks t ON t.id = d.task_id
       WHERE d.depends_on_task_id = $1
       ORDER BY d.id ASC`,
      [taskId]
    );
    res.json({
      dependencies: deps.map((r) => ({
        id: r.id,
        dependsOnTaskId: r.depends_on_task_id,
        dependencyType: r.dependency_type,
        title: r.title,
        status: r.status,
      })),
      dependents: dependents.map((r) => ({
        id: r.id,
        dependentTaskId: r.dependent_task_id,
        dependencyType: r.dependency_type,
        title: r.title,
        status: r.status,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load dependencies." });
  }
}

export async function postTaskDependency(req, res) {
  const taskId = Number.parseInt(req.params.id, 10);
  const dependsOn = Number.parseInt(req.body?.dependsOnTaskId, 10);
  const type = ["blocks", "related"].includes(req.body?.dependencyType)
    ? req.body.dependencyType
    : "blocks";
  if (!Number.isFinite(taskId) || !Number.isFinite(dependsOn) || taskId === dependsOn) {
    res.status(400).json({ error: "Invalid task id(s)." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, depends_on_task_id) DO UPDATE SET dependency_type = EXCLUDED.dependency_type`,
      [taskId, dependsOn, type]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add dependency." });
  }
}

export async function deleteTaskDependency(req, res) {
  const taskId = Number.parseInt(req.params.id, 10);
  const depId = Number.parseInt(req.params.dependencyId, 10);
  if (!Number.isFinite(taskId) || !Number.isFinite(depId)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM task_dependencies WHERE id = $1 AND task_id = $2`,
      [depId, taskId]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Dependency not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete dependency." });
  }
}

export async function getSubtasks(req, res) {
  const parentId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(parentId)) {
    res.status(400).json({ error: "Invalid task id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.assigned_user_id,
              u.display_name AS assigned_user_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_user_id
       WHERE t.parent_task_id = $1
       ORDER BY
         CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
         t.created_at ASC`,
      [parentId]
    );
    res.json({
      subtasks: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        dueDate: r.due_date,
        assignedUserId: r.assigned_user_id,
        assignedUserName: r.assigned_user_name,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load subtasks." });
  }
}
