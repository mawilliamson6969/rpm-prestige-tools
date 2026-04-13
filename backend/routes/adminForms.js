import { getPool } from "../lib/db.js";

const OWNER_TERM = "owner-termination";

function parseIntQ(v, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildOwnerTerminationSummary(row) {
  const owner = `${row.owner_first_name ?? ""} ${row.owner_last_name ?? ""}`.trim();
  const loc = [row.city, row.state].filter(Boolean).join(", ");
  const parts = [owner, loc].filter(Boolean);
  return parts.join(" · ") || "Owner termination";
}

/** GET /admin/forms/types */
export async function getAdminFormTypes(req, res) {
  let pool;
  try {
    pool = getPool();
  } catch {
    return res.status(503).json({ error: "Database is not configured." });
  }
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM owner_termination_requests`);
    const count = rows[0]?.c ?? 0;
    res.json({
      types: [
        {
          type: OWNER_TERM,
          label: "Owner Termination Request",
          count,
        },
      ],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load form types." });
  }
}

/** GET /admin/forms/submissions */
export async function getAdminFormSubmissions(req, res) {
  let pool;
  try {
    pool = getPool();
  } catch {
    return res.status(503).json({ error: "Database is not configured." });
  }

  const formTypeRaw = typeof req.query.formType === "string" ? req.query.formType.trim() : "";
  if (formTypeRaw && formTypeRaw !== "all" && formTypeRaw !== OWNER_TERM) {
    res.status(400).json({ error: "Unsupported formType." });
    return;
  }

  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate.trim() : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate.trim() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const page = parseIntQ(req.query.page, 1);
  const perPage = Math.min(parseIntQ(req.query.perPage, 25), 100);

  const statuses = new Set(["pending", "retained", "in_progress", "completed", "cancelled"]);

  try {
    const conditions = [];
    const params = [];
    let n = 1;

    if (status && status !== "all" && statuses.has(status)) {
      conditions.push(`status = $${n++}`);
      params.push(status);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      conditions.push(`submitted_at::date >= $${n++}::date`);
      params.push(startDate);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      conditions.push(`submitted_at::date <= $${n++}::date`);
      params.push(endDate);
    }

    if (search) {
      const sn = n++;
      conditions.push(
        `(
          owner_first_name ILIKE $${sn} OR owner_last_name ILIKE $${sn}
          OR email ILIKE $${sn} OR street_address ILIKE $${sn}
          OR city ILIKE $${sn} OR CAST(id AS TEXT) ILIKE $${sn}
        )`
      );
      params.push(`%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM owner_termination_requests ${where}`,
      params
    );
    const total = countRows[0]?.c ?? 0;

    const offset = (page - 1) * perPage;
    const limIdx = n++;
    const offIdx = n++;
    const dataSql = `
      SELECT *
      FROM owner_termination_requests
      ${where}
      ORDER BY submitted_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
    `;
    const { rows } = await pool.query(dataSql, [...params, perPage, offset]);

    const submissions = rows.map((r) => ({
      id: r.id,
      formType: OWNER_TERM,
      submitterName: `${r.owner_first_name ?? ""} ${r.owner_last_name ?? ""}`.trim() || r.email,
      submittedAt: r.submitted_at,
      status: r.status,
      summary: buildOwnerTerminationSummary(r),
      raw: r,
    }));

    res.json({
      submissions,
      total,
      page,
      perPage,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load submissions." });
  }
}
