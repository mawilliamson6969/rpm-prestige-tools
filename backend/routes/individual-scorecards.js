import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../lib/db.js";
import { mondayOfDate, meetsGoal } from "./eos.js";

const AI_MODEL = "claude-sonnet-4-20250514";

function anthropic() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) { const e = new Error("ANTHROPIC_API_KEY is not set."); e.code = "NO_AI_KEY"; throw e; }
  return new Anthropic({ apiKey: key });
}

function ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function parseYmd(s) {
  if (!s || typeof s !== "string") return null;
  const t = Date.parse(s.slice(0, 10));
  return Number.isNaN(t) ? null : t;
}

function firstOfMonth(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

function mapMetric(r) {
  return {
    id: r.id,
    scorecardId: r.scorecard_id,
    name: r.name,
    description: r.description,
    frequency: r.frequency,
    goalValue: r.goal_value != null ? Number(r.goal_value) : null,
    goalDirection: r.goal_direction,
    unit: r.unit,
    displayOrder: r.display_order,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

/** Check user can access scorecard (admin or owner) */
async function assertAccess(pool, userId, role, scorecardId) {
  const { rows } = await pool.query(
    `SELECT id, owner_user_id, status FROM individual_scorecards WHERE id = $1`,
    [scorecardId]
  );
  if (!rows.length) return null;
  if (role === "admin" || rows[0].owner_user_id === userId) return rows[0];
  return null;
}

function canEdit(userRole, userId, scorecardOwnerId) {
  return userRole === "admin" || userId === scorecardOwnerId;
}

/* ======================== TEMPLATES ======================== */
const TEMPLATES = {
  leasing: {
    label: "Leasing Specialist",
    metrics: [
      { name: "New Leads Contacted", frequency: "weekly", goal_value: 15, goal_direction: "above", unit: "number" },
      { name: "Showings Conducted", frequency: "weekly", goal_value: 8, goal_direction: "above", unit: "number" },
      { name: "Applications Received", frequency: "weekly", goal_value: 3, goal_direction: "above", unit: "number" },
      { name: "Leases Signed", frequency: "weekly", goal_value: 2, goal_direction: "above", unit: "number" },
      { name: "Vacancy Days Avg", frequency: "weekly", goal_value: 21, goal_direction: "below", unit: "days" },
      { name: "Lead Response Time (hours)", frequency: "weekly", goal_value: 2, goal_direction: "below", unit: "number" },
    ],
  },
  maintenance: {
    label: "Maintenance Coordinator",
    metrics: [
      { name: "Work Orders Received", frequency: "weekly", goal_value: 20, goal_direction: "below", unit: "number" },
      { name: "Work Orders Completed", frequency: "weekly", goal_value: 15, goal_direction: "above", unit: "number" },
      { name: "Avg Days to Complete", frequency: "weekly", goal_value: 5, goal_direction: "below", unit: "days" },
      { name: "Emergency Response Time (hours)", frequency: "weekly", goal_value: 4, goal_direction: "below", unit: "number" },
      { name: "Vendor Dispatch Rate", frequency: "weekly", goal_value: 90, goal_direction: "above", unit: "percentage" },
      { name: "Tenant Satisfaction Score", frequency: "weekly", goal_value: 4, goal_direction: "above", unit: "number" },
    ],
  },
  "client-success": {
    label: "Client Success Manager",
    metrics: [
      { name: "Owner Calls Made", frequency: "weekly", goal_value: 10, goal_direction: "above", unit: "number" },
      { name: "Owner Emails Responded (within 24h)", frequency: "weekly", goal_value: 95, goal_direction: "above", unit: "percentage" },
      { name: "Lease Renewals Processed", frequency: "weekly", goal_value: 3, goal_direction: "above", unit: "number" },
      { name: "Termination Notices Received", frequency: "weekly", goal_value: 1, goal_direction: "below", unit: "number" },
      { name: "Delinquent Accounts Managed", frequency: "weekly", goal_value: 5, goal_direction: "below", unit: "number" },
      { name: "Owner NPS Score", frequency: "monthly", goal_value: 8, goal_direction: "above", unit: "number" },
    ],
  },
  "biz-dev": {
    label: "Business Development",
    metrics: [
      { name: "Owner Leads Generated", frequency: "weekly", goal_value: 5, goal_direction: "above", unit: "number" },
      { name: "Consultations Scheduled", frequency: "weekly", goal_value: 3, goal_direction: "above", unit: "number" },
      { name: "PMAs Signed", frequency: "weekly", goal_value: 1, goal_direction: "above", unit: "number" },
      { name: "New Doors Added", frequency: "weekly", goal_value: 3, goal_direction: "above", unit: "number" },
      { name: "Realtor Contacts Made", frequency: "weekly", goal_value: 5, goal_direction: "above", unit: "number" },
      { name: "Proposals Sent", frequency: "weekly", goal_value: 3, goal_direction: "above", unit: "number" },
    ],
  },
  operations: {
    label: "Operations",
    metrics: [
      { name: "Inbox Tickets Resolved", frequency: "weekly", goal_value: 20, goal_direction: "above", unit: "number" },
      { name: "SLA Compliance Rate", frequency: "weekly", goal_value: 90, goal_direction: "above", unit: "percentage" },
      { name: "Tasks Completed", frequency: "weekly", goal_value: 15, goal_direction: "above", unit: "number" },
      { name: "Processes Closed in LeadSimple", frequency: "weekly", goal_value: 10, goal_direction: "above", unit: "number" },
      { name: "Data Entry Accuracy", frequency: "weekly", goal_value: 98, goal_direction: "above", unit: "percentage" },
      { name: "Team Training Hours", frequency: "monthly", goal_value: 4, goal_direction: "above", unit: "number" },
    ],
  },
};

/* ======================== SCORECARD CRUD ======================== */

export async function getIndividualScorecards(req, res) {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === "admin";
    let sql = `SELECT s.*, u.display_name AS owner_display_name,
        (SELECT COUNT(*)::int FROM individual_scorecard_metrics m WHERE m.scorecard_id = s.id AND m.is_active = true) AS metric_count,
        (SELECT MAX(e.updated_at) FROM individual_scorecard_entries e
         JOIN individual_scorecard_metrics m2 ON m2.id = e.metric_id
         WHERE m2.scorecard_id = s.id) AS last_entry_at
       FROM individual_scorecards s
       JOIN users u ON u.id = s.owner_user_id
       WHERE s.status = 'active'`;
    const params = [];
    if (!isAdmin) {
      sql += ` AND s.owner_user_id = $1`;
      params.push(req.user.id);
    }
    sql += ` ORDER BY s.updated_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json({ scorecards: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ownerUserId: r.owner_user_id,
      ownerDisplayName: r.owner_display_name,
      status: r.status,
      metricCount: r.metric_count,
      lastEntryAt: r.last_entry_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load individual scorecards." });
  }
}

export async function getIndividualScorecard(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const pool = getPool();
    const sc = await assertAccess(pool, req.user.id, req.user.role, id);
    if (!sc) { res.status(404).json({ error: "Scorecard not found." }); return; }
    const { rows } = await pool.query(
      `SELECT s.*, u.display_name AS owner_display_name
       FROM individual_scorecards s JOIN users u ON u.id = s.owner_user_id WHERE s.id = $1`, [id]
    );
    res.json({ scorecard: {
      id: rows[0].id, name: rows[0].name, description: rows[0].description,
      ownerUserId: rows[0].owner_user_id, ownerDisplayName: rows[0].owner_display_name,
      status: rows[0].status, createdAt: rows[0].created_at, updatedAt: rows[0].updated_at,
    } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load scorecard." });
  }
}

export async function postIndividualScorecard(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const b = req.body ?? {};
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() || null : null;
  const ownerUserId = Number(b.ownerUserId);
  const templateId = typeof b.templateId === "string" ? b.templateId.trim() : "";
  if (!name) { res.status(400).json({ error: "name is required." }); return; }
  if (!Number.isFinite(ownerUserId)) { res.status(400).json({ error: "ownerUserId is required." }); return; }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO individual_scorecards (name, description, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`, [name, description, ownerUserId, req.user.id]
    );
    const sc = rows[0];
    if (templateId && TEMPLATES[templateId]) {
      const tpl = TEMPLATES[templateId];
      for (const [i, m] of tpl.metrics.entries()) {
        await pool.query(
          `INSERT INTO individual_scorecard_metrics (scorecard_id, name, frequency, goal_value, goal_direction, unit, display_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [sc.id, m.name, m.frequency, m.goal_value, m.goal_direction, m.unit, i]
        );
      }
    }
    res.status(201).json({ scorecard: { id: sc.id, name: sc.name, description: sc.description, ownerUserId: sc.owner_user_id } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create scorecard." });
  }
}

export async function putIndividualScorecard(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  const b = req.body ?? {};
  const fields = []; const vals = []; let n = 1;
  const set = (col, val) => { fields.push(`${col} = $${n++}`); vals.push(val); };
  if (typeof b.name === "string") set("name", b.name.trim());
  if (b.description !== undefined) set("description", typeof b.description === "string" ? b.description.trim() || null : null);
  if (b.ownerUserId != null) set("owner_user_id", Number(b.ownerUserId));
  if (fields.length === 0) { res.status(400).json({ error: "No fields to update." }); return; }
  set("updated_at", new Date());
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE individual_scorecards SET ${fields.join(", ")} WHERE id = $${n} AND status = 'active' RETURNING *`, vals
    );
    if (!rows.length) { res.status(404).json({ error: "Scorecard not found." }); return; }
    res.json({ scorecard: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update scorecard." });
  }
}

export async function deleteIndividualScorecard(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE individual_scorecards SET status = 'archived', updated_at = NOW() WHERE id = $1 AND status = 'active'`, [id]
    );
    if (!rowCount) { res.status(404).json({ error: "Scorecard not found." }); return; }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not archive scorecard." });
  }
}

export async function postDuplicateScorecard(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const newOwnerUserId = Number(b.newOwnerUserId);
  const newName = typeof b.newName === "string" ? b.newName.trim() : "";
  if (!Number.isFinite(id) || !Number.isFinite(newOwnerUserId) || !newName) {
    res.status(400).json({ error: "newOwnerUserId and newName are required." }); return;
  }
  try {
    const pool = getPool();
    const { rows: orig } = await pool.query(`SELECT * FROM individual_scorecards WHERE id = $1`, [id]);
    if (!orig.length) { res.status(404).json({ error: "Source scorecard not found." }); return; }
    const { rows: sc } = await pool.query(
      `INSERT INTO individual_scorecards (name, description, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`, [newName, orig[0].description, newOwnerUserId, req.user.id]
    );
    const newId = sc[0].id;
    const { rows: metrics } = await pool.query(
      `SELECT * FROM individual_scorecard_metrics WHERE scorecard_id = $1 AND is_active = true ORDER BY display_order`, [id]
    );
    for (const m of metrics) {
      await pool.query(
        `INSERT INTO individual_scorecard_metrics (scorecard_id, name, description, frequency, goal_value, goal_direction, unit, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newId, m.name, m.description, m.frequency, m.goal_value, m.goal_direction, m.unit, m.display_order]
      );
    }
    res.status(201).json({ scorecard: sc[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not duplicate scorecard." });
  }
}

export function getTemplates(req, res) {
  const list = [{ id: "blank", label: "Blank Scorecard", metrics: [] }];
  for (const [id, t] of Object.entries(TEMPLATES)) {
    list.push({ id, label: t.label, metrics: t.metrics.map((m) => m.name) });
  }
  res.json({ templates: list });
}

/* ======================== METRICS CRUD ======================== */

export async function getIndividualScorecardMetrics(req, res) {
  const scId = Number(req.params.id);
  if (!Number.isFinite(scId)) { res.status(400).json({ error: "Invalid scorecard id." }); return; }
  try {
    const pool = getPool();
    const sc = await assertAccess(pool, req.user.id, req.user.role, scId);
    if (!sc) { res.status(404).json({ error: "Scorecard not found." }); return; }
    const includeArchived = req.query.includeArchived === "true" && req.user.role === "admin";
    const where = includeArchived ? "" : "AND m.is_active = true";
    const { rows } = await pool.query(
      `SELECT m.* FROM individual_scorecard_metrics m WHERE m.scorecard_id = $1 ${where} ORDER BY m.display_order ASC, m.id ASC`, [scId]
    );
    res.json({ metrics: rows.map(mapMetric) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load metrics." });
  }
}

export async function postIndividualScorecardMetric(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const scId = Number(req.params.id);
  const b = req.body ?? {};
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const frequency = b.frequency === "monthly" ? "monthly" : "weekly";
  const goalValue = Number(b.goalValue);
  const goalDirection = ["above", "below", "exact"].includes(b.goalDirection) ? b.goalDirection : "above";
  const unit = ["number", "currency", "percentage", "days"].includes(b.unit) ? b.unit : "number";
  const description = typeof b.description === "string" ? b.description.trim() || null : null;
  if (!name) { res.status(400).json({ error: "name is required." }); return; }
  if (!Number.isFinite(goalValue)) { res.status(400).json({ error: "goalValue is required." }); return; }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO individual_scorecard_metrics (scorecard_id, name, description, frequency, goal_value, goal_direction, unit, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM individual_scorecard_metrics WHERE scorecard_id = $1))
       RETURNING *`, [scId, name, description, frequency, goalValue, goalDirection, unit]
    );
    res.status(201).json({ metric: mapMetric(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create metric." });
  }
}

export async function putIndividualScorecardMetric(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const metricId = Number(req.params.metricId);
  if (!Number.isFinite(metricId)) { res.status(400).json({ error: "Invalid metric id." }); return; }
  const b = req.body ?? {};
  const fields = []; const vals = []; let n = 1;
  const set = (col, val) => { fields.push(`${col} = $${n++}`); vals.push(val); };
  if (typeof b.name === "string") set("name", b.name.trim());
  if (b.description !== undefined) set("description", typeof b.description === "string" ? b.description.trim() || null : null);
  if (b.frequency === "weekly" || b.frequency === "monthly") set("frequency", b.frequency);
  if (b.goalValue != null) set("goal_value", Number(b.goalValue));
  if (["above", "below", "exact"].includes(b.goalDirection)) set("goal_direction", b.goalDirection);
  if (["number", "currency", "percentage", "days"].includes(b.unit)) set("unit", b.unit);
  if (b.displayOrder != null) set("display_order", Number(b.displayOrder));
  if (typeof b.isActive === "boolean") set("is_active", b.isActive);
  if (fields.length === 0) { res.status(400).json({ error: "No fields to update." }); return; }
  vals.push(metricId);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE individual_scorecard_metrics SET ${fields.join(", ")} WHERE id = $${n} RETURNING *`, vals
    );
    if (!rows.length) { res.status(404).json({ error: "Metric not found." }); return; }
    res.json({ metric: mapMetric(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update metric." });
  }
}

/** PUT /eos/individual-scorecards/:id/metrics/reorder — accepts { metricIds: [id1, id2, ...] } */
export async function putIndividualScorecardMetricsReorder(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const scId = Number(req.params.id);
  if (!Number.isFinite(scId)) { res.status(400).json({ error: "Invalid scorecard id." }); return; }
  const raw = req.body?.metricIds;
  const ids = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isFinite(n)) : [];
  if (!ids.length) { res.status(400).json({ error: "metricIds (non-empty array) is required." }); return; }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `UPDATE individual_scorecard_metrics SET display_order = $1 WHERE id = $2 AND scorecard_id = $3`,
        [i, ids[i], scId]
      );
    }
    await client.query("COMMIT");
    const { rows } = await pool.query(
      `SELECT * FROM individual_scorecard_metrics WHERE scorecard_id = $1 ORDER BY display_order ASC, id ASC`,
      [scId]
    );
    res.json({ metrics: rows.map(mapMetric) });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error(e);
    res.status(500).json({ error: "Could not reorder metrics." });
  } finally {
    client.release();
  }
}

export async function deleteIndividualScorecardMetric(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const metricId = Number(req.params.metricId);
  if (!Number.isFinite(metricId)) { res.status(400).json({ error: "Invalid metric id." }); return; }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE individual_scorecard_metrics SET is_active = false WHERE id = $1`, [metricId]
    );
    if (!rowCount) { res.status(404).json({ error: "Metric not found." }); return; }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not archive metric." });
  }
}

export async function deleteIndividualScorecardMetricPermanent(req, res) {
  if (req.user.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }
  const metricId = Number(req.params.metricId);
  if (!Number.isFinite(metricId)) { res.status(400).json({ error: "Invalid metric id." }); return; }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM individual_scorecard_metrics WHERE id = $1`, [metricId]);
    if (!rowCount) { res.status(404).json({ error: "Metric not found." }); return; }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete metric." });
  }
}

/* ======================== ENTRIES ======================== */

export async function putIndividualScorecardEntry(req, res) {
  const b = req.body ?? {};
  const metricId = Number(b.metricId);
  const value = Number(b.value);
  const weekStart = b.weekStart;
  const notes = typeof b.notes === "string" ? b.notes.trim() || null : null;
  if (!Number.isFinite(metricId) || !Number.isFinite(value) || !weekStart) {
    res.status(400).json({ error: "metricId, value, and weekStart are required." }); return;
  }
  try {
    const pool = getPool();
    const { rows: mrows } = await pool.query(
      `SELECT m.*, s.owner_user_id FROM individual_scorecard_metrics m
       JOIN individual_scorecards s ON s.id = m.scorecard_id
       WHERE m.id = $1 AND m.is_active = true`, [metricId]
    );
    if (!mrows.length) { res.status(404).json({ error: "Metric not found or inactive." }); return; }
    if (!canEdit(req.user.role, req.user.id, mrows[0].owner_user_id)) {
      res.status(403).json({ error: "Only the scorecard owner or an admin can enter data." }); return;
    }
    const freq = mrows[0].frequency;
    let normalizedDate;
    if (freq === "monthly") {
      normalizedDate = ymd(firstOfMonth(new Date(weekStart)));
    } else {
      normalizedDate = ymd(mondayOfDate(new Date(weekStart)));
    }
    const { rows: up } = await pool.query(
      `UPDATE individual_scorecard_entries SET value = $1, notes = $2, updated_by = $3, updated_at = NOW()
       WHERE metric_id = $4 AND week_start = $5::date RETURNING *`,
      [value, notes, req.user.id, metricId, normalizedDate]
    );
    if (up.length) { res.json({ entry: up[0] }); return; }
    const { rows: ins } = await pool.query(
      `INSERT INTO individual_scorecard_entries (metric_id, week_start, value, notes, updated_by)
       VALUES ($1, $2::date, $3, $4, $5) RETURNING *`,
      [metricId, normalizedDate, value, notes, req.user.id]
    );
    res.status(201).json({ entry: ins[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save entry." });
  }
}

/* ======================== REPORT ======================== */

export async function getIndividualScorecardReport(req, res) {
  const scId = Number(req.params.id);
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  const frequency = req.query.frequency === "monthly" ? "monthly" : "weekly";
  if (!Number.isFinite(scId)) { res.status(400).json({ error: "Invalid scorecard id." }); return; }
  if (!startDate || !endDate) { res.status(400).json({ error: "startDate and endDate are required." }); return; }
  const t0 = parseYmd(startDate); const t1 = parseYmd(endDate);
  if (t0 == null || t1 == null || t0 > t1) { res.status(400).json({ error: "Invalid date range." }); return; }
  try {
    const pool = getPool();
    const sc = await assertAccess(pool, req.user.id, req.user.role, scId);
    if (!sc) { res.status(404).json({ error: "Scorecard not found." }); return; }
    const { rows: metrics } = await pool.query(
      `SELECT * FROM individual_scorecard_metrics WHERE scorecard_id = $1 AND is_active = true AND frequency = $2
       ORDER BY display_order ASC, id ASC`, [scId, frequency]
    );
    const metricIds = metrics.map((m) => m.id);

    const periods = [];
    if (frequency === "weekly") {
      let cur = mondayOfDate(new Date(startDate));
      const end = mondayOfDate(new Date(endDate));
      while (cur <= end) {
        const key = ymd(cur);
        periods.push({ key, date: key, label: `${cur.getMonth() + 1}/${cur.getDate()}` });
        cur = new Date(cur); cur.setDate(cur.getDate() + 7);
      }
    } else {
      let cur = firstOfMonth(new Date(startDate));
      const endM = firstOfMonth(new Date(endDate));
      while (cur <= endM) {
        const key = ymd(cur);
        periods.push({ key, date: key, label: cur.toLocaleString("en-US", { month: "short", year: "numeric" }) });
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    }

    let entries = [];
    if (metricIds.length && periods.length) {
      const { rows: erows } = await pool.query(
        `SELECT e.*, u.display_name AS updated_by_name FROM individual_scorecard_entries e
         LEFT JOIN users u ON u.id = e.updated_by
         WHERE e.metric_id = ANY($1::int[]) AND e.week_start >= $2::date AND e.week_start <= $3::date`,
        [metricIds, startDate, endDate]
      );
      entries = erows;
    }

    const cells = {};
    for (const m of metrics) {
      cells[m.id] = {};
      for (const p of periods) {
        const e = entries.find((x) => x.metric_id === m.id && ymd(x.week_start) === p.key);
        if (e && e.value != null) {
          const ok = meetsGoal(Number(e.value), Number(m.goal_value), m.goal_direction);
          cells[m.id][p.key] = {
            entryId: e.id, value: Number(e.value), notes: e.notes, meetsGoal: ok,
            enteredBy: e.updated_by, enteredByName: e.updated_by_name,
          };
        } else {
          cells[m.id][p.key] = null;
        }
      }
    }

    res.json({ frequency, startDate, endDate, metrics: metrics.map(mapMetric), periods, cells });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not build report." });
  }
}

/* ======================== AI ANALYZE ======================== */

export async function postIndividualScorecardAiAnalyze(req, res) {
  const scId = Number(req.params.id);
  const metricId = Number(req.body?.metricId);
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!Number.isFinite(scId) || !Number.isFinite(metricId) || !question) {
    res.status(400).json({ error: "metricId and question are required." }); return;
  }
  try {
    const pool = getPool();
    const sc = await assertAccess(pool, req.user.id, req.user.role, scId);
    if (!sc) { res.status(404).json({ error: "Scorecard not found." }); return; }
    const { rows: mrows } = await pool.query(
      `SELECT * FROM individual_scorecard_metrics WHERE id = $1 AND scorecard_id = $2 AND is_active = true`, [metricId, scId]
    );
    if (!mrows.length) { res.status(404).json({ error: "Metric not found." }); return; }
    const m = mrows[0];
    const end = new Date();
    let start;
    if (m.frequency === "monthly") {
      const endM = firstOfMonth(end);
      start = new Date(endM.getFullYear(), endM.getMonth() - 5, 1);
    } else {
      const endW = mondayOfDate(end);
      start = new Date(endW); start.setDate(start.getDate() - 13 * 7);
    }
    const { rows: entries } = await pool.query(
      `SELECT week_start, value FROM individual_scorecard_entries
       WHERE metric_id = $1 AND week_start >= $2::date AND week_start <= $3::date
       ORDER BY week_start ASC`, [metricId, ymd(start), ymd(end)]
    );
    const withValues = entries.filter((e) => e.value != null);
    const goal = Number(m.goal_value);
    let hits = 0;
    const lines = [];
    for (const e of withValues) {
      const v = Number(e.value);
      const ok = meetsGoal(v, goal, m.goal_direction);
      if (ok) hits++;
      lines.push(`${ymd(e.week_start)}: ${v}${ok ? " (goal met)" : " (off goal)"}`);
    }
    let trend = "stable";
    if (withValues.length >= 4) {
      const mid = Math.floor(withValues.length / 2);
      const avg = (arr) => arr.reduce((s, e) => s + Number(e.value), 0) / arr.length;
      const a1 = avg(withValues.slice(0, mid));
      const a2 = avg(withValues.slice(mid));
      if (a2 > a1 * 1.03) trend = "improving";
      else if (a2 < a1 * 0.97) trend = "declining";
    }
    const { rows: scRow } = await pool.query(
      `SELECT s.name, u.display_name AS owner_name FROM individual_scorecards s JOIN users u ON u.id = s.owner_user_id WHERE s.id = $1`, [scId]
    );
    const system = `You are analyzing an individual EOS Scorecard metric for RPM Prestige, a property management company in Houston, TX.`;
    const userBlock = `Scorecard: ${scRow[0]?.name ?? "—"} (Owner: ${scRow[0]?.owner_name ?? "—"})
Metric: ${m.name}
Goal: ${m.goal_value} (${m.goal_direction})
Frequency: ${m.frequency}

Recent data points:
${lines.length ? lines.join("\n") : "(no values in this window)"}

${m.frequency === "weekly" ? "Weeks" : "Months"} hitting goal: ${hits} of ${withValues.length}
Current trend: ${trend}

The user asks: "${question}"

Provide specific, actionable advice based on the data. Reference actual numbers. Keep your response concise (2-3 paragraphs).`;

    const client = anthropic();
    const msg = await client.messages.create({
      model: AI_MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: userBlock }],
    });
    const block = msg.content?.[0];
    res.json({ analysis: block?.type === "text" ? block.text?.trim() ?? "" : "" });
  } catch (e) {
    if (e?.code === "NO_AI_KEY") { res.status(503).json({ error: "AI not configured." }); return; }
    console.error(e);
    res.status(500).json({ error: "Could not analyze metric." });
  }
}
