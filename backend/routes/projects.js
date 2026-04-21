import { getPool } from "../lib/db.js";

function mapProject(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status,
    priority: r.priority,
    category: r.category,
    color: r.color,
    icon: r.icon,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name ?? undefined,
    propertyName: r.property_name,
    propertyId: r.property_id,
    startDate: r.start_date,
    targetDate: r.target_date,
    completedAt: r.completed_at,
    budget: r.budget != null ? Number(r.budget) : null,
    spent: r.spent != null ? Number(r.spent) : 0,
    tags: r.tags ?? [],
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalTasks: r.total_tasks != null ? Number(r.total_tasks) : undefined,
    completedTasks: r.completed_tasks != null ? Number(r.completed_tasks) : undefined,
    totalMilestones: r.total_milestones != null ? Number(r.total_milestones) : undefined,
    completedMilestones: r.completed_milestones != null ? Number(r.completed_milestones) : undefined,
    memberCount: r.member_count != null ? Number(r.member_count) : undefined,
  };
}

function mapMilestone(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    dueDate: r.due_date,
    status: r.status,
    completedAt: r.completed_at,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}

function mapNote(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    title: r.title,
    content: r.content,
    isPinned: r.is_pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMember(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    displayName: r.display_name ?? undefined,
    username: r.username ?? undefined,
    role: r.role,
    addedAt: r.added_at,
  };
}

const PROJECT_LIST_SQL = `
  SELECT p.*, u.display_name AS owner_name,
    (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) AS total_tasks,
    (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS completed_tasks,
    (SELECT COUNT(*)::int FROM project_milestones m WHERE m.project_id = p.id) AS total_milestones,
    (SELECT COUNT(*)::int FROM project_milestones m WHERE m.project_id = p.id AND m.status = 'completed') AS completed_milestones,
    (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS member_count
  FROM projects p
  LEFT JOIN users u ON u.id = p.owner_user_id
`;

export async function getProjects(req, res) {
  try {
    const pool = getPool();
    const where = [];
    const params = [];
    let n = 1;
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    if (status && status !== "all") {
      where.push(`p.status = $${n++}`);
      params.push(status);
    }
    const owner = Number.parseInt(req.query.owner, 10);
    if (Number.isFinite(owner)) {
      where.push(`p.owner_user_id = $${n++}`);
      params.push(owner);
    }
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    if (category) {
      where.push(`p.category = $${n++}`);
      params.push(category);
    }
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
    if (tag) {
      where.push(`$${n++} = ANY(p.tags)`);
      params.push(tag);
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      where.push(`(p.name ILIKE $${n} OR p.description ILIKE $${n})`);
      params.push(`%${search}%`);
      n++;
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${PROJECT_LIST_SQL} ${clause}
       ORDER BY
         CASE WHEN p.status IN ('completed','canceled') THEN 1 ELSE 0 END ASC,
         p.target_date ASC NULLS LAST,
         p.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ projects: rows.map(mapProject) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load projects." });
  }
}

export async function getProject(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid project id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`${PROJECT_LIST_SQL} WHERE p.id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const { rows: milestones } = await pool.query(
      `SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
      [id]
    );
    const { rows: members } = await pool.query(
      `SELECT pm.*, u.display_name, u.username
       FROM project_members pm
       LEFT JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.role ASC, u.display_name ASC`,
      [id]
    );
    const { rows: notes } = await pool.query(
      `SELECT n.*, u.display_name AS user_name
       FROM project_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.project_id = $1
       ORDER BY n.is_pinned DESC, n.created_at DESC`,
      [id]
    );
    const { rows: tasks } = await pool.query(
      `SELECT t.*, u.display_name AS assigned_user_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_user_id
       WHERE t.project_id = $1
       ORDER BY
         CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
         t.due_date ASC NULLS LAST,
         t.created_at DESC`,
      [id]
    );
    const project = mapProject(rows[0]);
    const open = tasks.filter((t) => t.status !== "completed" && t.status !== "canceled").length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = tasks.filter(
      (t) =>
        t.status !== "completed" &&
        t.status !== "canceled" &&
        t.due_date &&
        new Date(t.due_date) < today
    ).length;
    const daysRemaining = project.targetDate
      ? Math.round(
          (new Date(project.targetDate).getTime() - today.getTime()) / 86400000
        )
      : null;
    res.json({
      project,
      milestones: milestones.map(mapMilestone),
      members: members.map(mapMember),
      notes: notes.map(mapNote),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date,
        assignedUserId: t.assigned_user_id,
        assignedUserName: t.assigned_user_name,
        completedAt: t.completed_at,
      })),
      stats: {
        totalTasks: tasks.length,
        openTasks: open,
        completedTasks: completed,
        overdueTasks: overdue,
        percentComplete:
          tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0,
        daysRemaining,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load project." });
  }
}

export async function postProject(req, res) {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  const description = typeof req.body?.description === "string" ? req.body.description.trim() || null : null;
  const category = typeof req.body?.category === "string" ? req.body.category.trim() || null : null;
  const icon = typeof req.body?.icon === "string" && req.body.icon.trim() ? req.body.icon.trim() : "📁";
  const color =
    typeof req.body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(req.body.color.trim())
      ? req.body.color.trim()
      : "#0098D0";
  const ownerUserId = Number.parseInt(req.body?.ownerUserId, 10);
  const propertyId = Number.parseInt(req.body?.propertyId, 10);
  const propertyName = typeof req.body?.propertyName === "string" ? req.body.propertyName.trim() || null : null;
  const startDate = typeof req.body?.startDate === "string" ? req.body.startDate.trim() || null : null;
  const targetDate = typeof req.body?.targetDate === "string" ? req.body.targetDate.trim() || null : null;
  const budget = Number.isFinite(Number.parseFloat(req.body?.budget))
    ? Number.parseFloat(req.body.budget)
    : null;
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null;
  const memberIds = Array.isArray(req.body?.memberUserIds)
    ? req.body.memberUserIds.map((n) => Number.parseInt(n, 10)).filter((n) => Number.isFinite(n))
    : [];
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO projects
         (name, description, category, color, icon, owner_user_id, property_name, property_id,
          start_date, target_date, budget, tags, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        name,
        description,
        category,
        color,
        icon,
        Number.isFinite(ownerUserId) ? ownerUserId : req.user.id,
        propertyName,
        Number.isFinite(propertyId) ? propertyId : null,
        startDate,
        targetDate,
        budget,
        tags,
        notes,
        req.user.id,
      ]
    );
    const project = rows[0];
    // Owner always added as member with 'owner' role.
    const ownerId = project.owner_user_id;
    const memberSet = new Set(memberIds);
    if (ownerId) memberSet.add(ownerId);
    for (const uid of memberSet) {
      await client.query(
        `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [project.id, uid, uid === ownerId ? "owner" : "member"]
      );
    }
    await client.query("COMMIT");
    const { rows: full } = await pool.query(`${PROJECT_LIST_SQL} WHERE p.id = $1`, [project.id]);
    res.status(201).json({ project: mapProject(full[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not create project." });
  } finally {
    client.release();
  }
}

export async function putProject(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid project id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  const strs = [
    ["name", "name"],
    ["description", "description"],
    ["category", "category"],
    ["icon", "icon"],
    ["priority", "priority"],
    ["propertyName", "property_name"],
    ["notes", "notes"],
  ];
  for (const [key, col] of strs) {
    if (typeof req.body?.[key] === "string") {
      sets.push(`${col} = $${n++}`);
      vals.push(req.body[key].trim() || null);
    }
  }
  if (
    typeof req.body?.color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(req.body.color.trim())
  ) {
    sets.push(`color = $${n++}`);
    vals.push(req.body.color.trim());
  }
  if (req.body?.ownerUserId !== undefined) {
    const v = Number.parseInt(req.body.ownerUserId, 10);
    sets.push(`owner_user_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (req.body?.propertyId !== undefined) {
    const v = Number.parseInt(req.body.propertyId, 10);
    sets.push(`property_id = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (typeof req.body?.startDate === "string") {
    sets.push(`start_date = $${n++}`);
    vals.push(req.body.startDate.trim() || null);
  }
  if (typeof req.body?.targetDate === "string") {
    sets.push(`target_date = $${n++}`);
    vals.push(req.body.targetDate.trim() || null);
  }
  if (req.body?.budget !== undefined) {
    const v = Number.parseFloat(req.body.budget);
    sets.push(`budget = $${n++}`);
    vals.push(Number.isFinite(v) ? v : null);
  }
  if (Array.isArray(req.body?.tags)) {
    sets.push(`tags = $${n++}`);
    vals.push(req.body.tags.map((t) => String(t).trim()).filter(Boolean));
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE projects SET ${sets.join(", ")} WHERE id = $${n}`,
      vals
    );
    if (!rowCount) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const { rows: full } = await pool.query(`${PROJECT_LIST_SQL} WHERE p.id = $1`, [id]);
    res.json({ project: mapProject(full[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update project." });
  }
}

export async function putProjectStatus(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const status = typeof req.body?.status === "string" ? req.body.status.trim() : "";
  if (!Number.isFinite(id) || !["active", "on_hold", "completed", "canceled"].includes(status)) {
    res.status(400).json({ error: "Invalid project id or status." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE projects
       SET status = $1,
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2`,
      [status, id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const { rows: full } = await pool.query(`${PROJECT_LIST_SQL} WHERE p.id = $1`, [id]);
    res.json({ project: mapProject(full[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update project status." });
  }
}

export async function deleteProject(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid project id." });
    return;
  }
  try {
    const pool = getPool();
    const hard = req.query.hard === "true" || req.query.hard === "1";
    if (hard && req.user.role === "admin") {
      const { rowCount } = await pool.query(`DELETE FROM projects WHERE id = $1`, [id]);
      if (!rowCount) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      res.json({ ok: true });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE projects SET status = 'canceled', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete project." });
  }
}

/* Milestones */

export async function getProjectMilestones(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid project id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
      [id]
    );
    res.json({ milestones: rows.map(mapMilestone) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load milestones." });
  }
}

export async function postProjectMilestone(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isFinite(id) || !name) {
    res.status(400).json({ error: "project id and name are required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: next } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM project_milestones WHERE project_id = $1`,
      [id]
    );
    const sortOrder = Number.isFinite(Number.parseInt(req.body?.sortOrder, 10))
      ? Number.parseInt(req.body.sortOrder, 10)
      : next[0].next;
    const { rows } = await pool.query(
      `INSERT INTO project_milestones (project_id, name, description, due_date, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        id,
        name,
        typeof req.body?.description === "string" ? req.body.description.trim() || null : null,
        typeof req.body?.dueDate === "string" && req.body.dueDate.trim()
          ? req.body.dueDate.trim()
          : null,
        sortOrder,
      ]
    );
    res.status(201).json({ milestone: mapMilestone(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add milestone." });
  }
}

export async function putProjectMilestone(req, res) {
  const id = Number.parseInt(req.params.milestoneId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid milestone id." });
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
  if (typeof req.body?.dueDate === "string") {
    sets.push(`due_date = $${n++}`);
    vals.push(req.body.dueDate.trim() || null);
  }
  if (["pending", "in_progress", "completed"].includes(req.body?.status)) {
    sets.push(`status = $${n++}`);
    vals.push(req.body.status);
    if (req.body.status === "completed") {
      sets.push(`completed_at = NOW()`);
    } else {
      sets.push(`completed_at = NULL`);
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
      `UPDATE project_milestones SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Milestone not found." });
      return;
    }
    res.json({ milestone: mapMilestone(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update milestone." });
  }
}

export async function putProjectMilestoneComplete(req, res) {
  const id = Number.parseInt(req.params.milestoneId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid milestone id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE project_milestones
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Milestone not found." });
      return;
    }
    res.json({ milestone: mapMilestone(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not complete milestone." });
  }
}

export async function deleteProjectMilestone(req, res) {
  const id = Number.parseInt(req.params.milestoneId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid milestone id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM project_milestones WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Milestone not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete milestone." });
  }
}

export async function putProjectMilestonesReorder(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const ids = Array.isArray(req.body?.milestoneIds) ? req.body.milestoneIds : null;
  if (!Number.isFinite(id) || !ids) {
    res.status(400).json({ error: "project id and milestoneIds required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const mid = Number.parseInt(ids[i], 10);
      if (!Number.isFinite(mid)) continue;
      await client.query(
        `UPDATE project_milestones SET sort_order = $1 WHERE id = $2 AND project_id = $3`,
        [i, mid, id]
      );
    }
    await client.query("COMMIT");
    const { rows } = await pool.query(
      `SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
      [id]
    );
    res.json({ milestones: rows.map(mapMilestone) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not reorder milestones." });
  } finally {
    client.release();
  }
}

/* Notes */

export async function getProjectNotes(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid project id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT n.*, u.display_name AS user_name
       FROM project_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.project_id = $1
       ORDER BY n.is_pinned DESC, n.created_at DESC`,
      [id]
    );
    res.json({ notes: rows.map(mapNote) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load notes." });
  }
}

export async function postProjectNote(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!Number.isFinite(id) || !content) {
    res.status(400).json({ error: "project id and content required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO project_notes (project_id, user_id, title, content)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        id,
        req.user.id,
        typeof req.body?.title === "string" ? req.body.title.trim() || null : null,
        content,
      ]
    );
    const { rows: full } = await pool.query(
      `SELECT n.*, u.display_name AS user_name
       FROM project_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.id = $1`,
      [rows[0].id]
    );
    res.status(201).json({ note: mapNote(full[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add note." });
  }
}

export async function putProjectNote(req, res) {
  const id = Number.parseInt(req.params.noteId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid note id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof req.body?.title === "string") {
    sets.push(`title = $${n++}`);
    vals.push(req.body.title.trim() || null);
  }
  if (typeof req.body?.content === "string" && req.body.content.trim()) {
    sets.push(`content = $${n++}`);
    vals.push(req.body.content.trim());
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
      `UPDATE project_notes SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Note not found." });
      return;
    }
    res.json({ note: mapNote(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update note." });
  }
}

export async function putProjectNotePin(req, res) {
  const id = Number.parseInt(req.params.noteId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid note id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE project_notes SET is_pinned = NOT is_pinned, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Note not found." });
      return;
    }
    res.json({ note: mapNote(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not toggle pin." });
  }
}

export async function deleteProjectNote(req, res) {
  const id = Number.parseInt(req.params.noteId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid note id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM project_notes WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Note not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete note." });
  }
}

/* Members */

export async function getProjectMembers(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid project id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT pm.*, u.display_name, u.username
       FROM project_members pm
       LEFT JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.role ASC, u.display_name ASC`,
      [id]
    );
    res.json({ members: rows.map(mapMember) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load members." });
  }
}

export async function postProjectMember(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const userId = Number.parseInt(req.body?.userId, 10);
  const role = ["owner", "member", "viewer"].includes(req.body?.role) ? req.body.role : "member";
  if (!Number.isFinite(id) || !Number.isFinite(userId)) {
    res.status(400).json({ error: "project id and userId required." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [id, userId, role]
    );
    const { rows } = await pool.query(
      `SELECT pm.*, u.display_name, u.username
       FROM project_members pm
       LEFT JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 AND pm.user_id = $2`,
      [id, userId]
    );
    res.status(201).json({ member: mapMember(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add member." });
  }
}

export async function deleteProjectMember(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isFinite(id) || !Number.isFinite(userId)) {
    res.status(400).json({ error: "project id and userId required." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Member not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not remove member." });
  }
}

/* Dashboard */

export async function getProjectsDashboard(_req, res) {
  try {
    const pool = getPool();
    const { rows: counts } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'on_hold')::int AS on_hold,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'active' AND target_date < CURRENT_DATE)::int AS overdue
       FROM projects`
    );
    const { rows: byCategory } = await pool.query(
      `SELECT COALESCE(category, 'Uncategorized') AS category, COUNT(*)::int AS count
       FROM projects WHERE status = 'active'
       GROUP BY COALESCE(category, 'Uncategorized')
       ORDER BY count DESC`
    );
    const { rows: byOwner } = await pool.query(
      `SELECT u.id, u.display_name,
         COUNT(p.id) FILTER (WHERE p.status = 'active')::int AS active,
         COUNT(p.id) FILTER (WHERE p.status = 'completed')::int AS completed
       FROM users u
       LEFT JOIN projects p ON p.owner_user_id = u.id
       GROUP BY u.id, u.display_name
       ORDER BY active DESC, u.display_name ASC`
    );
    const { rows: taskStats } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE t.project_id IS NOT NULL)::int AS total,
         COUNT(*) FILTER (WHERE t.project_id IS NOT NULL AND t.status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE t.project_id IS NOT NULL AND t.status NOT IN ('completed','canceled') AND t.due_date < CURRENT_DATE)::int AS overdue
       FROM tasks t`
    );
    const { rows: upcomingMilestones } = await pool.query(
      `SELECT m.id, m.name, m.due_date, p.id AS project_id, p.name AS project_name, p.color AS project_color
       FROM project_milestones m
       JOIN projects p ON p.id = m.project_id
       WHERE m.status != 'completed' AND m.due_date IS NOT NULL
         AND m.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
       ORDER BY m.due_date ASC
       LIMIT 20`
    );
    res.json({
      counts: counts[0] || { active: 0, on_hold: 0, completed: 0, overdue: 0 },
      byCategory,
      byOwner,
      taskStats: taskStats[0] || { total: 0, completed: 0, overdue: 0 },
      upcomingMilestones,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load dashboard." });
  }
}
