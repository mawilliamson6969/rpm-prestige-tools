/**
 * Maintenance Management System — subcontractor DB (Phase 2).
 *
 * Vendor database searchable by trade + zip coverage, with COI/W9 expiry
 * tracking and per-job rating history. Mounted in backend/index.js:
 *   GET    /maintenance/subcontractors               listSubcontractors
 *   POST   /maintenance/subcontractors               createSubcontractor
 *   GET    /maintenance/subcontractors/:id           getSubcontractor
 *   PUT    /maintenance/subcontractors/:id           updateSubcontractor
 *   DELETE /maintenance/subcontractors/:id           deleteSubcontractor  (perm)
 *   POST   /maintenance/subcontractors/:id/ratings   addRating
 *
 * COI-expiry SMS alerting lives in lib/maint-coi-alerts.js (daily cron).
 */

import { getPool } from "../lib/db.js";

/** Live-computed avg rating + count, joined into list/detail queries. */
const RATING_AGG = `
  LEFT JOIN (
    SELECT subcontractor_id,
           ROUND(AVG(rating)::numeric, 1) AS avg_rating,
           COUNT(*)                       AS rating_count
      FROM maint_subcontractor_ratings
     GROUP BY subcontractor_id
  ) r ON r.subcontractor_id = s.id
`;

function mapSub(row) {
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    trades: row.trades ?? [],
    zipCoverage: row.zip_coverage ?? [],
    coiExpiry: row.coi_expiry,
    w9OnFile: row.w9_on_file,
    notes: row.notes,
    avgRating: row.avg_rating != null ? Number(row.avg_rating) : null,
    ratingCount: row.rating_count != null ? Number(row.rating_count) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SANITIZE_ARRAY = (v) =>
  Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter(Boolean)
    : [];

export async function listSubcontractors(req, res) {
  try {
    const pool = getPool();
    const filters = ["s.archived_at IS NULL"];
    const params = [];

    // Text search across company + contact.
    if (req.query.q && String(req.query.q).trim()) {
      params.push(`%${String(req.query.q).trim().toLowerCase()}%`);
      filters.push(
        `(LOWER(s.company_name) LIKE $${params.length} OR LOWER(COALESCE(s.contact_name,'')) LIKE $${params.length})`
      );
    }
    // Trade membership (array contains).
    if (req.query.trade && String(req.query.trade).trim()) {
      params.push(String(req.query.trade).trim());
      filters.push(`$${params.length} = ANY (s.trades)`);
    }
    // Zip coverage membership (array contains).
    if (req.query.zip && String(req.query.zip).trim()) {
      params.push(String(req.query.zip).trim());
      filters.push(`$${params.length} = ANY (s.zip_coverage)`);
    }

    const where = `WHERE ${filters.join(" AND ")}`;
    const { rows } = await pool.query(
      `SELECT s.*, r.avg_rating, r.rating_count
         FROM maint_subcontractors s
         ${RATING_AGG}
         ${where}
         ORDER BY s.company_name ASC`,
      params
    );
    res.json({ subcontractors: rows.map(mapSub) });
  } catch (e) {
    console.error("listSubcontractors failed", e);
    res.status(500).json({ error: "Could not load subcontractors." });
  }
}

export async function getSubcontractor(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid subcontractor id." });
      return;
    }
    const { rows } = await pool.query(
      `SELECT s.*, r.avg_rating, r.rating_count
         FROM maint_subcontractors s
         ${RATING_AGG}
        WHERE s.id = $1 AND s.archived_at IS NULL`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Subcontractor not found." });
      return;
    }
    const { rows: ratings } = await pool.query(
      `SELECT sr.id, sr.job_id, sr.rating, sr.notes, sr.created_at,
              j.title AS job_title
         FROM maint_subcontractor_ratings sr
         LEFT JOIN maint_jobs j ON j.id = sr.job_id
        WHERE sr.subcontractor_id = $1
        ORDER BY sr.created_at DESC`,
      [id]
    );
    res.json({ subcontractor: mapSub(rows[0]), ratings });
  } catch (e) {
    console.error("getSubcontractor failed", e);
    res.status(500).json({ error: "Could not load subcontractor." });
  }
}

export async function createSubcontractor(req, res) {
  try {
    const pool = getPool();
    const b = req.body ?? {};
    if (!b.companyName || !String(b.companyName).trim()) {
      res.status(400).json({ error: "companyName is required." });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO maint_subcontractors
         (company_name, contact_name, email, phone, trades, zip_coverage,
          coi_expiry, w9_on_file, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        String(b.companyName).trim(),
        b.contactName?.trim() || null,
        b.email?.trim() || null,
        b.phone?.trim() || null,
        SANITIZE_ARRAY(b.trades),
        SANITIZE_ARRAY(b.zipCoverage),
        b.coiExpiry || null,
        b.w9OnFile === true,
        b.notes?.trim() || null,
        req.user?.id ?? null,
      ]
    );
    const { rows: full } = await pool.query(
      `SELECT s.*, r.avg_rating, r.rating_count
         FROM maint_subcontractors s ${RATING_AGG} WHERE s.id = $1`,
      [rows[0].id]
    );
    res.status(201).json({ subcontractor: mapSub(full[0]) });
  } catch (e) {
    console.error("createSubcontractor failed", e);
    res.status(500).json({ error: "Could not create subcontractor." });
  }
}

export async function updateSubcontractor(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid subcontractor id." });
      return;
    }
    const b = req.body ?? {};
    const sets = [];
    const params = [];
    const setField = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (b.companyName !== undefined) {
      if (!String(b.companyName).trim()) {
        res.status(400).json({ error: "companyName cannot be empty." });
        return;
      }
      setField("company_name", String(b.companyName).trim());
    }
    if (b.contactName !== undefined) setField("contact_name", b.contactName?.trim() || null);
    if (b.email !== undefined) setField("email", b.email?.trim() || null);
    if (b.phone !== undefined) setField("phone", b.phone?.trim() || null);
    if (b.trades !== undefined) setField("trades", SANITIZE_ARRAY(b.trades));
    if (b.zipCoverage !== undefined) setField("zip_coverage", SANITIZE_ARRAY(b.zipCoverage));
    if (b.w9OnFile !== undefined) setField("w9_on_file", b.w9OnFile === true);
    if (b.notes !== undefined) setField("notes", b.notes?.trim() || null);
    if (b.coiExpiry !== undefined) {
      setField("coi_expiry", b.coiExpiry || null);
      // A new/extended COI resets the alert marker so the cron can warn again
      // when the fresh expiry re-enters the alert window.
      sets.push(`coi_alerted_at = NULL`);
    }

    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields provided." });
      return;
    }

    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rowCount } = await pool.query(
      `UPDATE maint_subcontractors SET ${sets.join(", ")}
        WHERE id = $${params.length} AND archived_at IS NULL`,
      params
    );
    if (!rowCount) {
      res.status(404).json({ error: "Subcontractor not found." });
      return;
    }
    const { rows: full } = await pool.query(
      `SELECT s.*, r.avg_rating, r.rating_count
         FROM maint_subcontractors s ${RATING_AGG} WHERE s.id = $1`,
      [id]
    );
    res.json({ subcontractor: mapSub(full[0]) });
  } catch (e) {
    console.error("updateSubcontractor failed", e);
    res.status(500).json({ error: "Could not update subcontractor." });
  }
}

export async function deleteSubcontractor(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid subcontractor id." });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE maint_subcontractors SET archived_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Subcontractor not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteSubcontractor failed", e);
    res.status(500).json({ error: "Could not delete subcontractor." });
  }
}

export async function addRating(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid subcontractor id." });
      return;
    }
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: "rating must be an integer 1–5." });
      return;
    }
    const jobId = req.body?.jobId != null ? Number(req.body.jobId) : null;
    if (jobId != null && !Number.isInteger(jobId)) {
      res.status(400).json({ error: "Invalid jobId." });
      return;
    }

    // Guard against rating a missing/archived subcontractor.
    const { rows: exists } = await pool.query(
      `SELECT 1 FROM maint_subcontractors WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!exists.length) {
      res.status(404).json({ error: "Subcontractor not found." });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO maint_subcontractor_ratings
         (subcontractor_id, job_id, rating, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, job_id, rating, notes, created_at`,
      [id, jobId, rating, req.body?.notes?.trim() || null, req.user?.id ?? null]
    );
    res.status(201).json({ rating: rows[0] });
  } catch (e) {
    console.error("addRating failed", e);
    res.status(500).json({ error: "Could not add rating." });
  }
}
