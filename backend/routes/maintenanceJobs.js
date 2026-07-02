/**
 * Maintenance Management System — job/ticket CRUD (Phase 1).
 *
 * Standalone exported async handlers, mounted in backend/index.js:
 *   GET    /maintenance/jobs          getJobs   (list + filters)
 *   POST   /maintenance/jobs          postJob   (create)
 *   GET    /maintenance/jobs/:id      getJob    (single)
 *   PUT    /maintenance/jobs/:id      putJob    (update; emits status events)
 *   DELETE /maintenance/jobs/:id      deleteJob (soft-delete; permission-gated)
 *
 * Jobs JOIN the read-only appfolio.* mirror for property/unit display — we
 * store the AppFolio id (TEXT) and never duplicate property data.
 */

import { getPool } from "../lib/db.js";
import { emitEvent } from "../lib/eventBus.js";

const STATUSES = [
  "new",
  "triaged",
  "quoted",
  "scheduled",
  "in_progress",
  "complete",
  "invoiced",
];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const SOURCES = ["tenant_report", "inspection", "owner_request"];

/** SLA window per priority, in hours. Drives sla_due_at at creation. */
const SLA_HOURS = { urgent: 24, high: 72, normal: 168, low: 336 };

function mapJob(r) {
  return {
    id: r.id,
    propertyId: r.property_id,
    propertyName: r.property_name ?? undefined,
    propertyAddress: r.property_address ?? undefined,
    unitId: r.unit_id ?? null,
    unitName: r.unit_name ?? undefined,
    projectId: r.project_id ?? null,
    subcontractorId: r.subcontractor_id ?? null,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    source: r.source,
    slaDueAt: r.sla_due_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SELECT_JOB = `
  SELECT j.*,
         p.name     AS property_name,
         p.address1 AS property_address,
         u.name     AS unit_name
    FROM maint_jobs j
    JOIN appfolio.properties p ON p.id = j.property_id
    LEFT JOIN appfolio.units u ON u.id = j.unit_id
`;

/**
 * Property picker source. Reads the same appfolio.properties mirror the job
 * FK validates against, so a pickable property is always a valid property_id.
 * Active only: not hidden, still under management.
 */
export async function getProperties(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, address1, city, state
         FROM appfolio.properties
        WHERE hidden_at IS NULL AND management_end_date IS NULL
        ORDER BY name NULLS LAST, address1 NULLS LAST`
    );
    res.json({ properties: rows });
  } catch (e) {
    console.error("getProperties failed", e);
    res.status(500).json({ error: "Could not load properties." });
  }
}

/** Units for a given property, for the unit picker. */
export async function getPropertyUnits(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, address1
         FROM appfolio.units
        WHERE property_id = $1 AND hidden_at IS NULL
        ORDER BY name NULLS LAST`,
      [req.params.propertyId]
    );
    res.json({ units: rows });
  } catch (e) {
    console.error("getPropertyUnits failed", e);
    res.status(500).json({ error: "Could not load units." });
  }
}

export async function getJobs(req, res) {
  try {
    const pool = getPool();
    const filters = ["j.archived_at IS NULL"];
    const params = [];

    if (req.query.status) {
      if (!STATUSES.includes(req.query.status)) {
        res.status(400).json({ error: "Invalid status filter." });
        return;
      }
      params.push(req.query.status);
      filters.push(`j.status = $${params.length}`);
    }
    if (req.query.priority) {
      if (!PRIORITIES.includes(req.query.priority)) {
        res.status(400).json({ error: "Invalid priority filter." });
        return;
      }
      params.push(req.query.priority);
      filters.push(`j.priority = $${params.length}`);
    }
    if (req.query.property_id) {
      params.push(req.query.property_id);
      filters.push(`j.property_id = $${params.length}`);
    }

    const where = `WHERE ${filters.join(" AND ")}`;
    const { rows } = await pool.query(
      `${SELECT_JOB} ${where} ORDER BY j.created_at DESC`,
      params
    );
    res.json({ jobs: rows.map(mapJob) });
  } catch (e) {
    console.error("getJobs failed", e);
    res.status(500).json({ error: "Could not load maintenance jobs." });
  }
}

export async function getJob(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid job id." });
      return;
    }
    const { rows } = await pool.query(
      `${SELECT_JOB} WHERE j.id = $1 AND j.archived_at IS NULL`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    const { rows: photos } = await pool.query(
      `SELECT id, filename, content_type, size_bytes, storage_kind, created_at
         FROM maint_job_photos WHERE job_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    res.json({ job: mapJob(rows[0]), photos });
  } catch (e) {
    console.error("getJob failed", e);
    res.status(500).json({ error: "Could not load maintenance job." });
  }
}

export async function postJob(req, res) {
  try {
    const pool = getPool();
    const {
      propertyId,
      unitId = null,
      title,
      description = null,
      priority = "normal",
      source = null,
      projectId = null,
      subcontractorId = null,
    } = req.body ?? {};

    if (!propertyId || typeof propertyId !== "string") {
      res.status(400).json({ error: "propertyId is required." });
      return;
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required." });
      return;
    }
    if (!PRIORITIES.includes(priority)) {
      res.status(400).json({ error: "Invalid priority." });
      return;
    }
    if (source != null && !SOURCES.includes(source)) {
      res.status(400).json({ error: "Invalid source." });
      return;
    }

    // AppFolio is the system of record — reject a property id we don't mirror.
    const { rows: propRows } = await pool.query(
      `SELECT 1 FROM appfolio.properties WHERE id = $1`,
      [propertyId]
    );
    if (!propRows.length) {
      res.status(400).json({ error: "Unknown AppFolio property." });
      return;
    }

    const slaHours = SLA_HOURS[priority];
    const { rows } = await pool.query(
      `INSERT INTO maint_jobs
         (property_id, unit_id, project_id, subcontractor_id, title, description,
          priority, source, sla_due_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9 || ' hours')::interval, $10)
       RETURNING id`,
      [
        propertyId,
        unitId,
        projectId,
        subcontractorId,
        title.trim(),
        description,
        priority,
        source,
        String(slaHours),
        req.user?.id ?? null,
      ]
    );

    const { rows: full } = await pool.query(
      `${SELECT_JOB} WHERE j.id = $1`,
      [rows[0].id]
    );
    const job = mapJob(full[0]);

    await emitEvent({
      type: "maintenance.job_created",
      source: "internal",
      payload: {
        job_id: job.id,
        property_id: job.propertyId,
        priority: job.priority,
        source: job.source,
      },
      externalId: `maintenance_job_created:${job.id}`,
    });

    res.status(201).json({ job });
  } catch (e) {
    console.error("postJob failed", e);
    res.status(500).json({ error: "Could not create maintenance job." });
  }
}

export async function putJob(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid job id." });
      return;
    }

    const { rows: existingRows } = await pool.query(
      `SELECT * FROM maint_jobs WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!existingRows.length) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    const existing = existingRows[0];
    const body = req.body ?? {};

    // Build a partial update from only the fields present in the body.
    const sets = [];
    const params = [];
    const setField = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (body.title !== undefined) {
      if (!body.title || !String(body.title).trim()) {
        res.status(400).json({ error: "title cannot be empty." });
        return;
      }
      setField("title", String(body.title).trim());
    }
    if (body.description !== undefined) setField("description", body.description);
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) {
        res.status(400).json({ error: "Invalid status." });
        return;
      }
      setField("status", body.status);
    }
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority)) {
        res.status(400).json({ error: "Invalid priority." });
        return;
      }
      setField("priority", body.priority);
    }
    if (body.source !== undefined) {
      if (body.source != null && !SOURCES.includes(body.source)) {
        res.status(400).json({ error: "Invalid source." });
        return;
      }
      setField("source", body.source);
    }
    if (body.unitId !== undefined) setField("unit_id", body.unitId);
    if (body.projectId !== undefined) setField("project_id", body.projectId);
    if (body.subcontractorId !== undefined)
      setField("subcontractor_id", body.subcontractorId);

    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields provided." });
      return;
    }

    sets.push(`updated_at = NOW()`);
    params.push(id);
    await pool.query(
      `UPDATE maint_jobs SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );

    const { rows: full } = await pool.query(`${SELECT_JOB} WHERE j.id = $1`, [id]);
    const job = mapJob(full[0]);

    // Emit a Prestige Connect event when the status pipeline advances, so
    // downstream automations (custom-event triggers on "maintenance.*") fire.
    if (body.status !== undefined && body.status !== existing.status) {
      await emitEvent({
        type: "maintenance.status_changed",
        source: "internal",
        payload: {
          job_id: job.id,
          property_id: job.propertyId,
          from_status: existing.status,
          to_status: job.status,
          priority: job.priority,
        },
        externalId: `maintenance_status:${job.id}:${job.status}`,
      });
    }

    res.json({ job });
  } catch (e) {
    console.error("putJob failed", e);
    res.status(500).json({ error: "Could not update maintenance job." });
  }
}

export async function deleteJob(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid job id." });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE maint_jobs SET archived_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteJob failed", e);
    res.status(500).json({ error: "Could not delete maintenance job." });
  }
}
