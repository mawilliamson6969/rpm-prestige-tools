/**
 * Maintenance Management System — make-ready / multi-task projects (Phase 5).
 *
 * A project is a parent container of child jobs (maint_jobs.project_id) with an
 * optional checklist driven by the EXISTING process engine — we do not build a
 * new checklist engine. The frontend spawns a process via POST /processes
 * (reusing turnover/make-ready templates) and links the returned process id
 * here through PUT /maintenance/projects/:id { processId }. This route then
 * surfaces that process's step progress.
 *
 * maint_projects shipped in 047 (no Phase 5 migration). Mounted in
 * backend/index.js under /maintenance/projects.
 *
 * Note: processes.property_id is a legacy INTEGER, while maint_projects and the
 * AppFolio mirror key on TEXT ids — so a spawned process is linked by
 * propertyName, not id (handled in the frontend call to POST /processes).
 */

import { getPool } from "../lib/db.js";
import { emitEvent } from "../lib/eventBus.js";
import { MAINT_EVENT } from "../lib/maint-events.js";

function mapProject(r) {
  const total = r.total_steps != null ? Number(r.total_steps) : 0;
  const done = r.completed_steps != null ? Number(r.completed_steps) : 0;
  return {
    id: r.id,
    name: r.name,
    propertyId: r.property_id ?? null,
    propertyName: r.property_name ?? undefined,
    unitId: r.unit_id ?? null,
    unitName: r.unit_name ?? undefined,
    status: r.status,
    processId: r.process_id ?? null,
    processName: r.process_name ?? null,
    processStatus: r.process_status ?? null,
    totalSteps: total,
    completedSteps: done,
    jobCount: r.job_count != null ? Number(r.job_count) : 0,
    targetCompletion: r.target_completion,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Header + property/unit names + linked-process summary + child-job count +
// process step progress. property_id/unit_id/process_id are all nullable, so
// every join is a LEFT JOIN.
const SELECT_PROJECT = `
  SELECT pr.*,
         ap.name AS property_name,
         u.name  AS unit_name,
         proc.name   AS process_name,
         proc.status AS process_status,
         COALESCE(cj.job_count, 0)       AS job_count,
         COALESCE(ps.total_steps, 0)     AS total_steps,
         COALESCE(ps.completed_steps, 0) AS completed_steps
    FROM maint_projects pr
    LEFT JOIN appfolio.properties ap ON ap.id = pr.property_id
    LEFT JOIN appfolio.units u ON u.id = pr.unit_id
    LEFT JOIN processes proc ON proc.id = pr.process_id
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS job_count
        FROM maint_jobs WHERE archived_at IS NULL GROUP BY project_id
    ) cj ON cj.project_id = pr.id
    LEFT JOIN (
      SELECT process_id,
             COUNT(*) AS total_steps,
             COUNT(*) FILTER (WHERE status = 'complete') AS completed_steps
        FROM process_steps GROUP BY process_id
    ) ps ON ps.process_id = pr.process_id
`;

const STATUSES = ["active", "on_hold", "complete", "cancelled"];

async function loadProjectRow(pool, id) {
  const { rows } = await pool.query(
    `${SELECT_PROJECT} WHERE pr.id = $1 AND pr.archived_at IS NULL`,
    [id]
  );
  return rows[0] || null;
}

export async function listProjects(req, res) {
  try {
    const pool = getPool();
    const filters = ["pr.archived_at IS NULL"];
    const params = [];
    if (req.query.status) {
      if (!STATUSES.includes(req.query.status)) {
        res.status(400).json({ error: "Invalid status filter." });
        return;
      }
      params.push(req.query.status);
      filters.push(`pr.status = $${params.length}`);
    }
    if (req.query.property_id) {
      params.push(req.query.property_id);
      filters.push(`pr.property_id = $${params.length}`);
    }
    const { rows } = await pool.query(
      `${SELECT_PROJECT} WHERE ${filters.join(" AND ")} ORDER BY pr.created_at DESC`,
      params
    );
    res.json({ projects: rows.map(mapProject) });
  } catch (e) {
    console.error("listProjects failed", e);
    res.status(500).json({ error: "Could not load projects." });
  }
}

export async function getProject(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid project id." });
      return;
    }
    const row = await loadProjectRow(pool, id);
    if (!row) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const { rows: jobs } = await pool.query(
      `SELECT id, title, status, priority FROM maint_jobs
        WHERE project_id = $1 AND archived_at IS NULL
        ORDER BY created_at ASC`,
      [id]
    );
    res.json({ project: mapProject(row), jobs });
  } catch (e) {
    console.error("getProject failed", e);
    res.status(500).json({ error: "Could not load project." });
  }
}

export async function createProject(req, res) {
  try {
    const pool = getPool();
    const b = req.body ?? {};
    if (!b.name || !String(b.name).trim()) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    if (b.propertyId) {
      const { rows } = await pool.query(
        `SELECT 1 FROM appfolio.properties WHERE id = $1`,
        [b.propertyId]
      );
      if (!rows.length) {
        res.status(400).json({ error: "Unknown AppFolio property." });
        return;
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO maint_projects
         (name, property_id, unit_id, target_completion, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        String(b.name).trim(),
        b.propertyId || null,
        b.unitId || null,
        b.targetCompletion || null,
        b.notes?.trim() || null,
        req.user?.id ?? null,
      ]
    );
    const row = await loadProjectRow(pool, rows[0].id);
    const project = mapProject(row);

    await emitEvent({
      type: MAINT_EVENT.PROJECT_CREATED,
      source: "internal",
      payload: { project_id: project.id, property_id: project.propertyId, name: project.name },
      externalId: `maintenance_project_created:${project.id}`,
    });

    res.status(201).json({ project });
  } catch (e) {
    console.error("createProject failed", e);
    res.status(500).json({ error: "Could not create project." });
  }
}

export async function updateProject(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid project id." });
      return;
    }
    const b = req.body ?? {};
    const sets = [];
    const params = [];
    const setField = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (b.name !== undefined) {
      if (!String(b.name).trim()) {
        res.status(400).json({ error: "name cannot be empty." });
        return;
      }
      setField("name", String(b.name).trim());
    }
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) {
        res.status(400).json({ error: "Invalid status." });
        return;
      }
      setField("status", b.status);
    }
    if (b.unitId !== undefined) setField("unit_id", b.unitId || null);
    if (b.targetCompletion !== undefined) setField("target_completion", b.targetCompletion || null);
    if (b.notes !== undefined) setField("notes", b.notes?.trim() || null);
    if (b.processId !== undefined) {
      // Link a spawned process (validated) or clear the link.
      if (b.processId != null) {
        const pid = Number(b.processId);
        if (!Number.isInteger(pid)) {
          res.status(400).json({ error: "Invalid processId." });
          return;
        }
        const { rows } = await pool.query(`SELECT 1 FROM processes WHERE id = $1`, [pid]);
        if (!rows.length) {
          res.status(400).json({ error: "Unknown process." });
          return;
        }
        setField("process_id", pid);
      } else {
        setField("process_id", null);
      }
    }

    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields provided." });
      return;
    }
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rowCount } = await pool.query(
      `UPDATE maint_projects SET ${sets.join(", ")}
        WHERE id = $${params.length} AND archived_at IS NULL`,
      params
    );
    if (!rowCount) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const row = await loadProjectRow(pool, id);
    res.json({ project: mapProject(row) });
  } catch (e) {
    console.error("updateProject failed", e);
    res.status(500).json({ error: "Could not update project." });
  }
}

export async function deleteProject(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid project id." });
      return;
    }
    // Detach child jobs (keep them; just unlink from the project) then archive.
    await pool.query(
      `UPDATE maint_jobs SET project_id = NULL, updated_at = NOW() WHERE project_id = $1`,
      [id]
    );
    const { rowCount } = await pool.query(
      `UPDATE maint_projects SET archived_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteProject failed", e);
    res.status(500).json({ error: "Could not delete project." });
  }
}
