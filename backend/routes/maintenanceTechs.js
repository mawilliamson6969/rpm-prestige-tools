/**
 * Maintenance Management System — tech management + scheduling (Phase 3).
 *
 * Mounted in backend/index.js:
 *   Roster
 *     GET    /maintenance/techs                 listTechs
 *     POST   /maintenance/techs                 createTech
 *     GET    /maintenance/techs/:id             getTech
 *     PUT    /maintenance/techs/:id             updateTech
 *     DELETE /maintenance/techs/:id             deleteTech            (perm)
 *   Scheduling (maint_tech_assignments)
 *     GET    /maintenance/assignments           listAssignments       (?from&to&tech_id&job_id)
 *     POST   /maintenance/assignments           createAssignment
 *     PUT    /maintenance/assignments/:id       updateAssignment
 *     DELETE /maintenance/assignments/:id       deleteAssignment
 *   Billing rollup (suggest-only preview — nothing posts to AppFolio)
 *     GET    /maintenance/jobs/:id/labor        getJobLabor
 *
 * hours_logged × tech.hourly_rate is a computed preview; AppFolio write-back
 * is Phase 4 and always draft/preview-before-post per the platform principle.
 */

import { getPool } from "../lib/db.js";
import { emitEvent } from "../lib/eventBus.js";
import { MAINT_EVENT } from "../lib/maint-events.js";

const SANITIZE_ARRAY = (v) =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/* ------------------------------------------------------------------ techs */

function mapTech(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    tradeSkills: r.trade_skills ?? [],
    hourlyRate: r.hourly_rate != null ? Number(r.hourly_rate) : null,
    userId: r.user_id ?? null,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listTechs(req, res) {
  try {
    const pool = getPool();
    const filters = ["archived_at IS NULL"];
    const params = [];
    // Default to active only unless ?active=all.
    if (req.query.active !== "all") filters.push("is_active = TRUE");
    if (req.query.skill && String(req.query.skill).trim()) {
      params.push(String(req.query.skill).trim());
      filters.push(`$${params.length} = ANY (trade_skills)`);
    }
    const { rows } = await pool.query(
      `SELECT * FROM maint_techs
        WHERE ${filters.join(" AND ")}
        ORDER BY name ASC`,
      params
    );
    res.json({ techs: rows.map(mapTech) });
  } catch (e) {
    console.error("listTechs failed", e);
    res.status(500).json({ error: "Could not load techs." });
  }
}

export async function getTech(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid tech id." });
      return;
    }
    const { rows } = await pool.query(
      `SELECT * FROM maint_techs WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Tech not found." });
      return;
    }
    res.json({ tech: mapTech(rows[0]) });
  } catch (e) {
    console.error("getTech failed", e);
    res.status(500).json({ error: "Could not load tech." });
  }
}

export async function createTech(req, res) {
  try {
    const pool = getPool();
    const b = req.body ?? {};
    if (!b.name || !String(b.name).trim()) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    if (b.hourlyRate != null && !(Number(b.hourlyRate) >= 0)) {
      res.status(400).json({ error: "hourlyRate must be a non-negative number." });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO maint_techs
         (name, email, phone, trade_skills, hourly_rate, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        String(b.name).trim(),
        b.email?.trim() || null,
        b.phone?.trim() || null,
        SANITIZE_ARRAY(b.tradeSkills),
        b.hourlyRate != null ? Number(b.hourlyRate) : null,
        b.isActive !== false,
        req.user?.id ?? null,
      ]
    );
    res.status(201).json({ tech: mapTech(rows[0]) });
  } catch (e) {
    console.error("createTech failed", e);
    res.status(500).json({ error: "Could not create tech." });
  }
}

export async function updateTech(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid tech id." });
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
    if (b.email !== undefined) setField("email", b.email?.trim() || null);
    if (b.phone !== undefined) setField("phone", b.phone?.trim() || null);
    if (b.tradeSkills !== undefined) setField("trade_skills", SANITIZE_ARRAY(b.tradeSkills));
    if (b.hourlyRate !== undefined) {
      if (b.hourlyRate != null && !(Number(b.hourlyRate) >= 0)) {
        res.status(400).json({ error: "hourlyRate must be a non-negative number." });
        return;
      }
      setField("hourly_rate", b.hourlyRate != null ? Number(b.hourlyRate) : null);
    }
    if (b.isActive !== undefined) setField("is_active", b.isActive === true);

    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields provided." });
      return;
    }
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE maint_techs SET ${sets.join(", ")}
        WHERE id = $${params.length} AND archived_at IS NULL
        RETURNING *`,
      params
    );
    if (!rows.length) {
      res.status(404).json({ error: "Tech not found." });
      return;
    }
    res.json({ tech: mapTech(rows[0]) });
  } catch (e) {
    console.error("updateTech failed", e);
    res.status(500).json({ error: "Could not update tech." });
  }
}

export async function deleteTech(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid tech id." });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE maint_techs SET archived_at = NOW(), updated_at = NOW(), is_active = FALSE
        WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Tech not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteTech failed", e);
    res.status(500).json({ error: "Could not delete tech." });
  }
}

/* ------------------------------------------------------------ assignments */

function mapAssignment(r) {
  const rate = r.hourly_rate != null ? Number(r.hourly_rate) : null;
  const hours = r.hours_logged != null ? Number(r.hours_logged) : 0;
  return {
    id: r.id,
    jobId: r.job_id,
    jobTitle: r.job_title ?? undefined,
    propertyName: r.property_name ?? undefined,
    techId: r.tech_id,
    techName: r.tech_name ?? undefined,
    hourlyRate: rate,
    scheduledStart: r.scheduled_start,
    scheduledEnd: r.scheduled_end,
    hoursLogged: hours,
    lineCost: rate != null ? Math.round(rate * hours * 100) / 100 : null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SELECT_ASSIGNMENT = `
  SELECT a.*,
         t.name        AS tech_name,
         t.hourly_rate AS hourly_rate,
         j.title       AS job_title,
         p.name        AS property_name
    FROM maint_tech_assignments a
    JOIN maint_techs t ON t.id = a.tech_id
    JOIN maint_jobs  j ON j.id = a.job_id
    JOIN appfolio.properties p ON p.id = j.property_id
`;

export async function listAssignments(req, res) {
  try {
    const pool = getPool();
    const filters = [];
    const params = [];
    // Window on scheduled_start; if a job has an assignment with no start it is
    // excluded from the calendar (it hasn't been scheduled yet).
    if (req.query.from) {
      params.push(req.query.from);
      filters.push(`a.scheduled_start >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      filters.push(`a.scheduled_start < $${params.length}`);
    }
    if (req.query.tech_id) {
      params.push(Number(req.query.tech_id));
      filters.push(`a.tech_id = $${params.length}`);
    }
    if (req.query.job_id) {
      params.push(Number(req.query.job_id));
      filters.push(`a.job_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${SELECT_ASSIGNMENT} ${where} ORDER BY a.scheduled_start ASC NULLS LAST, a.id ASC`,
      params
    );
    res.json({ assignments: rows.map(mapAssignment) });
  } catch (e) {
    console.error("listAssignments failed", e);
    res.status(500).json({ error: "Could not load assignments." });
  }
}

export async function createAssignment(req, res) {
  try {
    const pool = getPool();
    const b = req.body ?? {};
    const jobId = Number(b.jobId);
    const techId = Number(b.techId);
    if (!Number.isInteger(jobId) || !Number.isInteger(techId)) {
      res.status(400).json({ error: "jobId and techId are required." });
      return;
    }
    if (b.scheduledStart && b.scheduledEnd && new Date(b.scheduledEnd) < new Date(b.scheduledStart)) {
      res.status(400).json({ error: "scheduledEnd must be after scheduledStart." });
      return;
    }

    // Validate both FKs are live (clearer errors than a raw FK violation).
    const { rows: job } = await pool.query(
      `SELECT 1 FROM maint_jobs WHERE id = $1 AND archived_at IS NULL`,
      [jobId]
    );
    if (!job.length) {
      res.status(400).json({ error: "Unknown job." });
      return;
    }
    const { rows: tech } = await pool.query(
      `SELECT 1 FROM maint_techs WHERE id = $1 AND archived_at IS NULL`,
      [techId]
    );
    if (!tech.length) {
      res.status(400).json({ error: "Unknown tech." });
      return;
    }

    const { rows: ins } = await pool.query(
      `INSERT INTO maint_tech_assignments
         (job_id, tech_id, scheduled_start, scheduled_end, hours_logged, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        jobId,
        techId,
        b.scheduledStart || null,
        b.scheduledEnd || null,
        b.hoursLogged != null ? Number(b.hoursLogged) : 0,
        b.notes?.trim() || null,
        req.user?.id ?? null,
      ]
    );
    const { rows } = await pool.query(`${SELECT_ASSIGNMENT} WHERE a.id = $1`, [ins[0].id]);
    const assignment = mapAssignment(rows[0]);

    await emitEvent({
      type: MAINT_EVENT.TECH_ASSIGNED,
      source: "internal",
      payload: {
        assignment_id: assignment.id,
        job_id: assignment.jobId,
        tech_id: assignment.techId,
        scheduled_start: assignment.scheduledStart,
      },
      externalId: `maintenance_assignment:${assignment.id}`,
    });

    res.status(201).json({ assignment });
  } catch (e) {
    console.error("createAssignment failed", e);
    res.status(500).json({ error: "Could not create assignment." });
  }
}

export async function updateAssignment(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid assignment id." });
      return;
    }
    const b = req.body ?? {};
    const sets = [];
    const params = [];
    const setField = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (b.scheduledStart !== undefined) setField("scheduled_start", b.scheduledStart || null);
    if (b.scheduledEnd !== undefined) setField("scheduled_end", b.scheduledEnd || null);
    if (b.hoursLogged !== undefined) {
      if (b.hoursLogged != null && !(Number(b.hoursLogged) >= 0)) {
        res.status(400).json({ error: "hoursLogged must be a non-negative number." });
        return;
      }
      setField("hours_logged", b.hoursLogged != null ? Number(b.hoursLogged) : 0);
    }
    if (b.notes !== undefined) setField("notes", b.notes?.trim() || null);

    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields provided." });
      return;
    }
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rowCount } = await pool.query(
      `UPDATE maint_tech_assignments SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );
    if (!rowCount) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    const { rows } = await pool.query(`${SELECT_ASSIGNMENT} WHERE a.id = $1`, [id]);
    res.json({ assignment: mapAssignment(rows[0]) });
  } catch (e) {
    console.error("updateAssignment failed", e);
    res.status(500).json({ error: "Could not update assignment." });
  }
}

export async function deleteAssignment(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid assignment id." });
      return;
    }
    const { rowCount } = await pool.query(
      `DELETE FROM maint_tech_assignments WHERE id = $1`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteAssignment failed", e);
    res.status(500).json({ error: "Could not delete assignment." });
  }
}

/* --------------------------------------------------------- billing rollup */

/**
 * Suggest-only labor rollup for a job: every tech assignment with its
 * hours × rate line cost and a total. Nothing is posted to AppFolio — this
 * is a preview the coordinator reviews before a Phase 4 bill draft.
 */
export async function getJobLabor(req, res) {
  try {
    const pool = getPool();
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId)) {
      res.status(400).json({ error: "Invalid job id." });
      return;
    }
    const { rows } = await pool.query(
      `${SELECT_ASSIGNMENT} WHERE a.job_id = $1 ORDER BY a.scheduled_start ASC NULLS LAST`,
      [jobId]
    );
    const lines = rows.map(mapAssignment);
    const totalHours = lines.reduce((s, l) => s + (l.hoursLogged || 0), 0);
    const totalCost = lines.reduce((s, l) => s + (l.lineCost || 0), 0);
    res.json({
      jobId,
      lines,
      totalHours: Math.round(totalHours * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      suggestOnly: true,
    });
  } catch (e) {
    console.error("getJobLabor failed", e);
    res.status(500).json({ error: "Could not load labor rollup." });
  }
}
