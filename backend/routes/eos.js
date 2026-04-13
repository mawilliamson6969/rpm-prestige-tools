import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../lib/db.js";

const SCORECARD_AI_MODEL = "claude-sonnet-4-20250514";

function anthropicForScorecard() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set.");
    err.code = "NO_AI_KEY";
    throw err;
  }
  return new Anthropic({ apiKey: key });
}

function ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s) {
  if (!s || typeof s !== "string") return null;
  const t = Date.parse(s.slice(0, 10));
  return Number.isNaN(t) ? null : t;
}

/** Monday of the week containing `d` (local date semantics). */
export function mondayOfDate(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function firstOfMonthContaining(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

export function meetsGoal(value, goal, direction) {
  const v = Number(value);
  const g = Number(goal);
  if (Number.isNaN(v) || Number.isNaN(g)) return null;
  if (direction === "above") return v >= g;
  if (direction === "below") return v <= g;
  return Math.abs(v - g) < 1e-9;
}

function mapUserRow(r) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    email: r.email ?? null,
  };
}

function mapMetricRow(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    ownerUserId: r.owner_user_id,
    ownerDisplayName: r.owner_display_name,
    frequency: r.frequency,
    goalValue: r.goal_value != null ? Number(r.goal_value) : null,
    goalDirection: r.goal_direction,
    unit: r.unit,
    displayOrder: r.display_order,
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export async function getEosTeamUsers(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, username, display_name, role, email FROM users ORDER BY lower(display_name)`
    );
    res.json({ users: rows.map(mapUserRow) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load team users." });
  }
}

/** GET /eos/scorecard/metrics */
export async function getScorecardMetrics(req, res) {
  try {
    const pool = getPool();
    const all = req.query.all === "1" && req.user.role === "admin";
    const activeClause = all ? "" : "WHERE m.is_active = true";
    const { rows } = await pool.query(
      `SELECT m.*, u.display_name AS owner_display_name,
        (SELECT row_to_json(sq) FROM (
           SELECT e.id, e.value, e.week_of, e.month_of, e.notes, e.entered_by, e.entered_at,
             eu.display_name AS entered_by_name
           FROM scorecard_entries e
           LEFT JOIN users eu ON eu.id = e.entered_by
           WHERE e.metric_id = m.id
           ORDER BY e.entered_at DESC
           LIMIT 1
         ) sq) AS latest_entry
       FROM scorecard_metrics m
       JOIN users u ON u.id = m.owner_user_id
       ${activeClause}
       ORDER BY m.display_order ASC, m.id ASC`
    );
    const metrics = rows.map((r) => {
      const base = mapMetricRow(r);
      return { ...base, latestEntry: r.latest_entry };
    });
    res.json({ metrics });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load scorecard metrics." });
  }
}

/** POST /eos/scorecard/metrics */
export async function postScorecardMetric(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const b = req.body ?? {};
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const ownerUserId = Number(b.ownerUserId);
  const frequency = b.frequency;
  const goalValue = Number(b.goalValue);
  const goalDirection = b.goalDirection;
  const unit = b.unit;
  const displayOrder = b.displayOrder != null ? Number(b.displayOrder) : 0;
  const description = typeof b.description === "string" ? b.description.trim() || null : null;

  if (!name) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  if (!Number.isFinite(ownerUserId)) {
    res.status(400).json({ error: "ownerUserId is required." });
    return;
  }
  if (frequency !== "weekly" && frequency !== "monthly") {
    res.status(400).json({ error: "frequency must be weekly or monthly." });
    return;
  }
  if (!Number.isFinite(goalValue)) {
    res.status(400).json({ error: "goalValue is required." });
    return;
  }
  if (!["above", "below", "exact"].includes(goalDirection)) {
    res.status(400).json({ error: "goalDirection invalid." });
    return;
  }
  if (!["number", "currency", "percentage", "days"].includes(unit)) {
    res.status(400).json({ error: "unit invalid." });
    return;
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO scorecard_metrics
        (name, description, owner_user_id, frequency, goal_value, goal_direction, unit, display_order, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
       RETURNING *, (SELECT display_name FROM users WHERE id = owner_user_id) AS owner_display_name`,
      [name, description, ownerUserId, frequency, goalValue, goalDirection, unit, displayOrder, req.user.id]
    );
    res.status(201).json({ metric: { ...mapMetricRow(rows[0]), latestEntry: null } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create metric." });
  }
}

/** PUT /eos/scorecard/metrics/:id */
export async function putScorecardMetric(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const b = req.body ?? {};
  const fields = [];
  const vals = [];
  let n = 1;
  const set = (col, val) => {
    fields.push(`${col} = $${n++}`);
    vals.push(val);
  };

  if (typeof b.name === "string") set("name", b.name.trim());
  if (b.description !== undefined)
    set("description", typeof b.description === "string" ? b.description.trim() || null : null);
  if (b.ownerUserId != null) {
    const oid = Number(b.ownerUserId);
    if (!Number.isFinite(oid)) {
      res.status(400).json({ error: "ownerUserId invalid." });
      return;
    }
    set("owner_user_id", oid);
  }
  if (b.frequency === "weekly" || b.frequency === "monthly") set("frequency", b.frequency);
  if (b.goalValue != null) set("goal_value", Number(b.goalValue));
  if (["above", "below", "exact"].includes(b.goalDirection)) set("goal_direction", b.goalDirection);
  if (["number", "currency", "percentage", "days"].includes(b.unit)) set("unit", b.unit);
  if (b.displayOrder != null) set("display_order", Number(b.displayOrder));
  if (typeof b.isActive === "boolean") set("is_active", b.isActive);

  if (fields.length === 0) {
    res.status(400).json({ error: "No fields to update." });
    return;
  }

  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE scorecard_metrics m SET ${fields.join(", ")}
       WHERE m.id = $${n}
       RETURNING m.*, (SELECT display_name FROM users WHERE id = m.owner_user_id) AS owner_display_name`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Metric not found." });
      return;
    }
    res.json({ metric: mapMetricRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update metric." });
  }
}

/** DELETE /eos/scorecard/metrics/:id — soft delete */
export async function deleteScorecardMetric(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`UPDATE scorecard_metrics SET is_active = false WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Metric not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not archive metric." });
  }
}

/** GET /eos/scorecard/entries */
export async function getScorecardEntries(req, res) {
  const metricId = Number(req.query.metricId);
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  if (!Number.isFinite(metricId) || !startDate || !endDate) {
    res.status(400).json({ error: "metricId, startDate, and endDate are required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: mrows } = await pool.query(`SELECT frequency FROM scorecard_metrics WHERE id = $1`, [metricId]);
    if (!mrows.length) {
      res.status(404).json({ error: "Metric not found." });
      return;
    }
    const freq = mrows[0].frequency;
    const col = freq === "weekly" ? "week_of" : "month_of";
    const { rows } = await pool.query(
      `SELECT e.*, u.display_name AS entered_by_name
       FROM scorecard_entries e
       JOIN users u ON u.id = e.entered_by
       WHERE e.metric_id = $1 AND e.${col} >= $2::date AND e.${col} <= $3::date
       ORDER BY e.${col} ASC`,
      [metricId, startDate, endDate]
    );
    res.json({
      entries: rows.map((r) => ({
        id: r.id,
        metricId: r.metric_id,
        value: r.value != null ? Number(r.value) : null,
        weekOf: r.week_of,
        monthOf: r.month_of,
        notes: r.notes,
        enteredBy: r.entered_by,
        enteredByName: r.entered_by_name,
        enteredAt: r.entered_at,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load entries." });
  }
}

/** POST /eos/scorecard/entries */
export async function postScorecardEntry(req, res) {
  const b = req.body ?? {};
  const metricId = Number(b.metricId);
  const value = Number(b.value);
  const notes = typeof b.notes === "string" ? b.notes.trim() || null : null;
  if (!Number.isFinite(metricId) || !Number.isFinite(value)) {
    res.status(400).json({ error: "metricId and value are required." });
    return;
  }
  let weekOf = b.weekOf ?? null;
  let monthOf = b.monthOf ?? null;
  try {
    const pool = getPool();
    const { rows: mrows } = await pool.query(
      `SELECT frequency, goal_value, goal_direction FROM scorecard_metrics WHERE id = $1 AND is_active = true`,
      [metricId]
    );
    if (!mrows.length) {
      res.status(404).json({ error: "Metric not found or inactive." });
      return;
    }
    const freq = mrows[0].frequency;
    if (freq === "weekly") {
      if (!weekOf) {
        res.status(400).json({ error: "weekOf is required for weekly metrics." });
        return;
      }
      weekOf = ymd(mondayOfDate(new Date(weekOf)));
      monthOf = null;
    } else {
      if (!monthOf) {
        res.status(400).json({ error: "monthOf is required for monthly metrics." });
        return;
      }
      const fd = firstOfMonthContaining(new Date(monthOf));
      monthOf = ymd(fd);
      weekOf = null;
    }

    const col = freq === "weekly" ? "week_of" : "month_of";
    const periodVal = freq === "weekly" ? weekOf : monthOf;
    const { rows: up } = await pool.query(
      `UPDATE scorecard_entries SET value = $1, notes = $2, entered_by = $3, entered_at = NOW()
       WHERE metric_id = $4 AND ${col} = $5::date
       RETURNING *`,
      [value, notes ?? null, req.user.id, metricId, periodVal]
    );
    if (up.length) {
      res.status(200).json({ entry: up[0] });
      return;
    }
    const { rows: ins } = await pool.query(
      `INSERT INTO scorecard_entries (metric_id, value, week_of, month_of, notes, entered_by)
       VALUES ($1, $2, $3::date, $4::date, $5, $6)
       RETURNING *`,
      [metricId, value, weekOf, monthOf, notes ?? null, req.user.id]
    );
    res.status(201).json({ entry: ins[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save entry." });
  }
}

/** PUT /eos/scorecard/entries/:id */
export async function putScorecardEntry(req, res) {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const updates = [];
    const vals = [];
    let n = 1;
    if (b.value != null) {
      updates.push(`value = $${n++}`);
      vals.push(Number(b.value));
    }
    if (b.notes !== undefined) {
      updates.push(`notes = $${n++}`);
      vals.push(typeof b.notes === "string" ? b.notes.trim() || null : null);
    }
    if (!updates.length) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE scorecard_entries SET ${updates.join(", ")}, entered_by = $${n++}, entered_at = NOW() WHERE id = $${n} RETURNING *`,
      [...vals, req.user.id, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Entry not found." });
      return;
    }
    res.json({ entry: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update entry." });
  }
}

/** DELETE /eos/scorecard/entries/:id */
export async function deleteScorecardEntry(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const id = Number(req.params.id);
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM scorecard_entries WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete entry." });
  }
}

/** GET /eos/scorecard/report */
export async function getScorecardReport(req, res) {
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  const frequency = req.query.frequency === "monthly" ? "monthly" : "weekly";
  const ownerUserId = req.query.ownerUserId ? Number(req.query.ownerUserId) : null;

  if (!startDate || !endDate) {
    res.status(400).json({ error: "startDate and endDate are required." });
    return;
  }
  const t0 = parseYmd(startDate);
  const t1 = parseYmd(endDate);
  if (t0 == null || t1 == null || t0 > t1) {
    res.status(400).json({ error: "Invalid date range." });
    return;
  }

  try {
    const pool = getPool();
    let mq = `SELECT m.*, u.display_name AS owner_display_name
      FROM scorecard_metrics m
      JOIN users u ON u.id = m.owner_user_id
      WHERE m.is_active = true AND m.frequency = $1`;
    const params = [frequency];
    if (ownerUserId && Number.isFinite(ownerUserId)) {
      mq += ` AND m.owner_user_id = $2`;
      params.push(ownerUserId);
    }
    mq += ` ORDER BY m.display_order ASC, m.id ASC`;
    const { rows: metrics } = await pool.query(mq, params);
    const metricIds = metrics.map((m) => m.id);

    const periods = [];
    if (frequency === "weekly") {
      let cur = mondayOfDate(new Date(startDate));
      const end = mondayOfDate(new Date(endDate));
      while (cur <= end) {
        const key = ymd(cur);
        periods.push({
          key,
          date: key,
          label: `${cur.getMonth() + 1}/${cur.getDate()}`,
        });
        cur = new Date(cur);
        cur.setDate(cur.getDate() + 7);
      }
    } else {
      let cur = firstOfMonthContaining(new Date(startDate));
      const endM = firstOfMonthContaining(new Date(endDate));
      while (cur <= endM) {
        const key = ymd(cur);
        periods.push({
          key,
          date: key,
          label: cur.toLocaleString("en-US", { month: "short", year: "numeric" }),
        });
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    }

    let entries = [];
    if (metricIds.length && periods.length) {
      const { rows: erows } = await pool.query(
        `SELECT e.*, u.display_name AS entered_by_name
         FROM scorecard_entries e
         LEFT JOIN users u ON u.id = e.entered_by
         WHERE e.metric_id = ANY($1::int[])
           AND (
             (e.week_of IS NOT NULL AND e.week_of >= $2::date AND e.week_of <= $3::date)
             OR (e.month_of IS NOT NULL AND e.month_of >= $2::date AND e.month_of <= $3::date)
           )`,
        [metricIds, startDate, endDate]
      );
      entries = erows;
    }

    const cells = {};
    for (const m of metrics) {
      cells[m.id] = {};
      for (const p of periods) {
        const periodKey = frequency === "weekly" ? p.key : p.key;
        const e = entries.find(
          (x) =>
            x.metric_id === m.id &&
            (frequency === "weekly" ? x.week_of && ymd(x.week_of) === periodKey : x.month_of && ymd(x.month_of) === periodKey)
        );
        if (e) {
          const ok = meetsGoal(e.value, m.goal_value, m.goal_direction);
          cells[m.id][periodKey] = {
            entryId: e.id,
            value: Number(e.value),
            notes: e.notes,
            meetsGoal: ok,
            enteredBy: e.entered_by,
            enteredByName: e.entered_by_name,
          };
        } else {
          cells[m.id][periodKey] = null;
        }
      }
    }

    res.json({
      frequency,
      startDate,
      endDate,
      metrics: metrics.map((r) => mapMetricRow(r)),
      periods,
      cells,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not build scorecard report." });
  }
}

function mapRock(r, milestones = []) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    ownerUserId: r.owner_user_id,
    ownerDisplayName: r.owner_display_name,
    quarter: r.quarter,
    status: r.status,
    dueDate: r.due_date,
    completedAt: r.completed_at,
    displayOrder: r.display_order,
    createdAt: r.created_at,
    milestones,
  };
}

/** GET /eos/rocks */
export async function getRocks(req, res) {
  const quarter = typeof req.query.quarter === "string" ? req.query.quarter.trim() : "";
  const ownerUserId = req.query.ownerUserId ? Number(req.query.ownerUserId) : null;
  if (!quarter) {
    res.status(400).json({ error: "quarter is required." });
    return;
  }
  try {
    const pool = getPool();
    let q = `SELECT r.*, u.display_name AS owner_display_name
      FROM rocks r JOIN users u ON u.id = r.owner_user_id
      WHERE r.quarter = $1`;
    const params = [quarter];
    if (ownerUserId && Number.isFinite(ownerUserId)) {
      q += ` AND r.owner_user_id = $2`;
      params.push(ownerUserId);
    }
    q += ` ORDER BY r.display_order ASC, r.id ASC`;
    const { rows: rocks } = await pool.query(q, params);
    const ids = rocks.map((r) => r.id);
    let milestonesByRock = {};
    if (ids.length) {
      const { rows: ms } = await pool.query(
        `SELECT * FROM rock_milestones WHERE rock_id = ANY($1::int[]) ORDER BY display_order ASC, id ASC`,
        [ids]
      );
      milestonesByRock = ms.reduce((acc, m) => {
        (acc[m.rock_id] = acc[m.rock_id] || []).push({
          id: m.id,
          rockId: m.rock_id,
          title: m.title,
          isCompleted: m.is_completed,
          completedAt: m.completed_at,
          dueDate: m.due_date,
          displayOrder: m.display_order,
        });
        return acc;
      }, {});
    }
    const out = rocks.map((r) => mapRock(r, milestonesByRock[r.id] || []));
    const onTrack = out.filter((x) => x.status === "on_track").length;
    res.json({ rocks: out, summary: { total: out.length, onTrack } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load rocks." });
  }
}

/** POST /eos/rocks */
export async function postRock(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const b = req.body ?? {};
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  const ownerUserId = Number(b.ownerUserId);
  const quarter = typeof b.quarter === "string" ? b.quarter.trim() : "";
  const dueDate = typeof b.dueDate === "string" ? b.dueDate.slice(0, 10) : "";
  const milestones = Array.isArray(b.milestones) ? b.milestones : [];

  if (!title || !quarter || !dueDate || !Number.isFinite(ownerUserId)) {
    res.status(400).json({ error: "title, quarter, dueDate, and ownerUserId are required." });
    return;
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO rocks (title, description, owner_user_id, quarter, status, due_date, display_order, created_by)
       VALUES ($1, $2, $3, $4, 'on_track', $5::date,
         (SELECT COALESCE(MAX(display_order), -1) + 1 FROM rocks WHERE quarter = $4), $6)
       RETURNING *, (SELECT display_name FROM users WHERE id = owner_user_id) AS owner_display_name`,
      [title, description, ownerUserId, quarter, dueDate, req.user.id]
    );
    const rock = rows[0];
    const ms = [];
    for (const [i, mt] of milestones.entries()) {
      const t = typeof mt === "string" ? mt.trim() : typeof mt?.title === "string" ? mt.title.trim() : "";
      if (!t) continue;
      const ins = await pool.query(
        `INSERT INTO rock_milestones (rock_id, title, display_order) VALUES ($1, $2, $3) RETURNING *`,
        [rock.id, t, i]
      );
      ms.push(ins.rows[0]);
    }
    res.status(201).json({
      rock: mapRock(
        rock,
        ms.map((m) => ({
          id: m.id,
          rockId: m.rock_id,
          title: m.title,
          isCompleted: m.is_completed,
          completedAt: m.completed_at,
          dueDate: m.due_date,
          displayOrder: m.display_order,
        }))
      ),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create rock." });
  }
}

/** PUT /eos/rocks/:id */
export async function putRock(req, res) {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const fields = [];
  const vals = [];
  let n = 1;
  const set = (col, val) => {
    fields.push(`${col} = $${n++}`);
    vals.push(val);
  };
  if (typeof b.title === "string") set("title", b.title.trim());
  if (typeof b.description === "string") set("description", b.description.trim());
  if (b.ownerUserId != null) set("owner_user_id", Number(b.ownerUserId));
  if (typeof b.quarter === "string") set("quarter", b.quarter.trim());
  if (typeof b.dueDate === "string") set("due_date", b.dueDate.slice(0, 10));
  if (["on_track", "off_track", "completed", "dropped"].includes(b.status)) {
    set("status", b.status);
    set("completed_at", b.status === "completed" ? new Date() : null);
  }
  if (b.displayOrder != null) set("display_order", Number(b.displayOrder));

  if (!fields.length) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE rocks r SET ${fields.join(", ")}
       WHERE r.id = $${n}
       RETURNING r.*, (SELECT display_name FROM users WHERE id = r.owner_user_id) AS owner_display_name`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Rock not found." });
      return;
    }
    const { rows: ms } = await pool.query(
      `SELECT * FROM rock_milestones WHERE rock_id = $1 ORDER BY display_order ASC`,
      [id]
    );
    res.json({
      rock: mapRock(
        rows[0],
        ms.map((m) => ({
          id: m.id,
          rockId: m.rock_id,
          title: m.title,
          isCompleted: m.is_completed,
          completedAt: m.completed_at,
          dueDate: m.due_date,
          displayOrder: m.display_order,
        }))
      ),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update rock." });
  }
}

/** DELETE /eos/rocks/:id */
export async function deleteRock(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const id = Number(req.params.id);
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM rocks WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete rock." });
  }
}

/** POST /eos/rocks/:id/milestones */
export async function postRockMilestone(req, res) {
  const rockId = Number(req.params.id);
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!Number.isFinite(rockId) || !title) {
    res.status(400).json({ error: "title required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: o } = await pool.query(
      `SELECT COALESCE(MAX(display_order), -1) + 1 AS n FROM rock_milestones WHERE rock_id = $1`,
      [rockId]
    );
    const { rows } = await pool.query(
      `INSERT INTO rock_milestones (rock_id, title, display_order) VALUES ($1, $2, $3) RETURNING *`,
      [rockId, title, o[0].n]
    );
    res.status(201).json({ milestone: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add milestone." });
  }
}

/** PUT /eos/rocks/:id/milestones/:milestoneId */
export async function putRockMilestone(req, res) {
  const rockId = Number(req.params.id);
  const mid = Number(req.params.milestoneId);
  const b = req.body ?? {};
  if (!Number.isFinite(rockId) || !Number.isFinite(mid)) {
    res.status(400).json({ error: "Invalid ids." });
    return;
  }
  try {
    const pool = getPool();
    const updates = [];
    const vals = [];
    let n = 1;
    if (typeof b.title === "string") {
      updates.push(`title = $${n++}`);
      vals.push(b.title.trim());
    }
    if (typeof b.isCompleted === "boolean") {
      updates.push(`is_completed = $${n++}`);
      vals.push(b.isCompleted);
      updates.push(`completed_at = $${n++}`);
      vals.push(b.isCompleted ? new Date() : null);
    }
    if (b.dueDate !== undefined) {
      updates.push(`due_date = $${n++}`);
      vals.push(b.dueDate ? String(b.dueDate).slice(0, 10) : null);
    }
    if (b.displayOrder != null) {
      updates.push(`display_order = $${n++}`);
      vals.push(Number(b.displayOrder));
    }
    if (!updates.length) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    vals.push(mid, rockId);
    const { rows } = await pool.query(
      `UPDATE rock_milestones SET ${updates.join(", ")} WHERE id = $${n++} AND rock_id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Milestone not found." });
      return;
    }
    res.json({ milestone: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update milestone." });
  }
}

/** DELETE /eos/rocks/:id/milestones/:milestoneId */
export async function deleteRockMilestone(req, res) {
  const rockId = Number(req.params.id);
  const mid = Number(req.params.milestoneId);
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM rock_milestones WHERE id = $1 AND rock_id = $2`, [mid, rockId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete milestone." });
  }
}

/** POST /eos/rocks/:id/updates */
export async function postRockUpdate(req, res) {
  const rockId = Number(req.params.id);
  const text = typeof req.body?.updateText === "string" ? req.body.updateText.trim() : "";
  const status = req.body?.status;
  if (!Number.isFinite(rockId) || !text) {
    res.status(400).json({ error: "updateText required." });
    return;
  }
  if (status !== "on_track" && status !== "off_track") {
    res.status(400).json({ error: "status must be on_track or off_track." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO rock_updates (rock_id, update_text, status, updated_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [rockId, text, status, req.user.id]
    );
    res.status(201).json({ update: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save update." });
  }
}

/** GET /eos/rocks/:id/updates */
export async function getRockUpdates(req, res) {
  const rockId = Number(req.params.id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT ru.*, u.display_name AS updated_by_name
       FROM rock_updates ru
       JOIN users u ON u.id = ru.updated_by
       WHERE ru.rock_id = $1
       ORDER BY ru.updated_at DESC`,
      [rockId]
    );
    res.json({
      updates: rows.map((r) => ({
        id: r.id,
        rockId: r.rock_id,
        updateText: r.update_text,
        status: r.status,
        updatedBy: r.updated_by,
        updatedByName: r.updated_by_name,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load updates." });
  }
}

/** GET /eos/l10/meetings */
export async function getL10Meetings(req, res) {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT m.*, u.display_name AS created_by_name
       FROM l10_meetings m
       JOIN users u ON u.id = m.created_by
       ORDER BY m.meeting_date DESC, m.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ meetings: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load meetings." });
  }
}

/** POST /eos/l10/meetings */
export async function postL10Meeting(req, res) {
  const raw = req.body?.meetingDate;
  const meetingDate =
    typeof raw === "string" && raw
      ? raw.slice(0, 10)
      : ymd(new Date());
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO l10_meetings (meeting_date, status, created_by) VALUES ($1::date, 'scheduled', $2) RETURNING *`,
      [meetingDate, req.user.id]
    );
    res.status(201).json({ meeting: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create meeting." });
  }
}

/** GET /eos/l10/meetings/:id */
export async function getL10Meeting(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: m } = await pool.query(
      `SELECT m.*, u.display_name AS created_by_name FROM l10_meetings m
       JOIN users u ON u.id = m.created_by WHERE m.id = $1`,
      [id]
    );
    if (!m.length) {
      res.status(404).json({ error: "Meeting not found." });
      return;
    }
    const { rows: ratings } = await pool.query(
      `SELECT r.*, u.display_name FROM l10_meeting_ratings r JOIN users u ON u.id = r.user_id WHERE meeting_id = $1`,
      [id]
    );
    res.json({ meeting: m[0], ratings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load meeting." });
  }
}

/** PUT /eos/l10/meetings/:id */
export async function putL10Meeting(req, res) {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const fields = [];
  const vals = [];
  let n = 1;
  const setText = (col, key) => {
    if (b[key] !== undefined) {
      fields.push(`${col} = $${n++}`);
      vals.push(typeof b[key] === "string" ? b[key] : null);
    }
  };
  setText("segue_notes", "segueNotes");
  setText("scorecard_notes", "scorecardNotes");
  setText("rock_review_notes", "rockReviewNotes");
  setText("headlines", "headlines");
  setText("ids_notes", "idsNotes");
  setText("conclude_notes", "concludeNotes");
  if (typeof b.meetingDate === "string") {
    fields.push(`meeting_date = $${n++}`);
    vals.push(b.meetingDate.slice(0, 10));
  }
  if (["scheduled", "in_progress", "completed"].includes(b.status)) {
    fields.push(`status = $${n++}`);
    vals.push(b.status);
  }
  if (b.startedAt !== undefined) {
    fields.push(`started_at = $${n++}`);
    vals.push(b.startedAt ? new Date(b.startedAt) : null);
  }
  if (b.endedAt !== undefined) {
    fields.push(`ended_at = $${n++}`);
    vals.push(b.endedAt ? new Date(b.endedAt) : null);
  }
  if (!fields.length) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(`UPDATE l10_meetings SET ${fields.join(", ")} WHERE id = $${n} RETURNING *`, vals);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ meeting: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update meeting." });
  }
}

/** PUT /eos/l10/meetings/:id/ratings */
export async function putL10MeetingRatings(req, res) {
  const id = Number(req.params.id);
  const ratings = req.body?.ratings;
  if (!Number.isFinite(id) || !Array.isArray(ratings)) {
    res.status(400).json({ error: "ratings array required." });
    return;
  }
  try {
    const pool = getPool();
    for (const r of ratings) {
      const uid = Number(r.userId);
      const rating = Number(r.rating);
      if (!Number.isFinite(uid) || !Number.isFinite(rating) || rating < 1 || rating > 10) continue;
      await pool.query(
        `INSERT INTO l10_meeting_ratings (meeting_id, user_id, rating) VALUES ($1, $2, $3)
         ON CONFLICT (meeting_id, user_id) DO UPDATE SET rating = EXCLUDED.rating`,
        [id, uid, rating]
      );
    }
    const { rows } = await pool.query(`SELECT * FROM l10_meeting_ratings WHERE meeting_id = $1`, [id]);
    res.json({ ratings: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save ratings." });
  }
}

/** GET /eos/l10/todos */
export async function getL10Todos(req, res) {
  const status = req.query.status;
  try {
    const pool = getPool();
    let q = `SELECT t.*, u.display_name AS owner_name FROM l10_todos t
      JOIN users u ON u.id = t.owner_user_id`;
    const params = [];
    if (status === "open") {
      q += ` WHERE t.is_completed = false`;
    }
    q += ` ORDER BY t.due_date ASC, t.id ASC`;
    const { rows } = await pool.query(q, params);
    res.json({ todos: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load todos." });
  }
}

/** POST /eos/l10/todos */
export async function postL10Todo(req, res) {
  const b = req.body ?? {};
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const ownerUserId = Number(b.ownerUserId);
  const dueDate = typeof b.dueDate === "string" ? b.dueDate.slice(0, 10) : "";
  const meetingId = b.meetingId != null ? Number(b.meetingId) : null;
  if (!title || !Number.isFinite(ownerUserId) || !dueDate) {
    res.status(400).json({ error: "title, ownerUserId, dueDate required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO l10_todos (meeting_id, title, owner_user_id, due_date)
       VALUES ($1, $2, $3, $4::date) RETURNING *`,
      [Number.isFinite(meetingId) ? meetingId : null, title, ownerUserId, dueDate]
    );
    res.status(201).json({ todo: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create todo." });
  }
}

/** PUT /eos/l10/todos/:id */
export async function putL10Todo(req, res) {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const fields = [];
  const vals = [];
  let n = 1;
  if (typeof b.title === "string") {
    fields.push(`title = $${n++}`);
    vals.push(b.title.trim());
  }
  if (b.ownerUserId != null) {
    fields.push(`owner_user_id = $${n++}`);
    vals.push(Number(b.ownerUserId));
  }
  if (typeof b.dueDate === "string") {
    fields.push(`due_date = $${n++}`);
    vals.push(b.dueDate.slice(0, 10));
  }
  if (typeof b.isCompleted === "boolean") {
    fields.push(`is_completed = $${n++}`);
    vals.push(b.isCompleted);
    fields.push(`completed_at = $${n++}`);
    vals.push(b.isCompleted ? new Date() : null);
  }
  if (b.meetingId !== undefined) {
    fields.push(`meeting_id = $${n++}`);
    vals.push(b.meetingId != null ? Number(b.meetingId) : null);
  }
  if (!fields.length) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(`UPDATE l10_todos SET ${fields.join(", ")} WHERE id = $${n} RETURNING *`, vals);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ todo: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update todo." });
  }
}

/** DELETE /eos/l10/todos/:id */
export async function deleteL10Todo(req, res) {
  const id = Number(req.params.id);
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM l10_todos WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete todo." });
  }
}

/** GET /eos/l10/issues */
export async function getL10Issues(req, res) {
  const status = req.query.status;
  try {
    const pool = getPool();
    let q = `SELECT i.*, u.display_name AS raised_by_name FROM l10_issues i
      JOIN users u ON u.id = i.raised_by`;
    const params = [];
    if (status === "open") {
      q += ` WHERE i.status IN ('open', 'in_discussion')`;
    }
    q += ` ORDER BY i.priority ASC, i.created_at ASC`;
    const { rows } = await pool.query(q, params);
    res.json({ issues: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load issues." });
  }
}

/** POST /eos/l10/issues */
export async function postL10Issue(req, res) {
  const b = req.body ?? {};
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() || null : null;
  const priority = [1, 2, 3].includes(Number(b.priority)) ? Number(b.priority) : 2;
  const meetingId = b.meetingId != null ? Number(b.meetingId) : null;
  if (!title) {
    res.status(400).json({ error: "title required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO l10_issues (title, description, raised_by, priority, status, meeting_id)
       VALUES ($1, $2, $3, $4, 'open', $5) RETURNING *`,
      [title, description, req.user.id, priority, Number.isFinite(meetingId) ? meetingId : null]
    );
    res.status(201).json({ issue: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create issue." });
  }
}

/** PUT /eos/l10/issues/:id */
export async function putL10Issue(req, res) {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const fields = [];
  const vals = [];
  let n = 1;
  if (typeof b.title === "string") {
    fields.push(`title = $${n++}`);
    vals.push(b.title.trim());
  }
  if (b.description !== undefined) {
    fields.push(`description = $${n++}`);
    vals.push(typeof b.description === "string" ? b.description : null);
  }
  if (b.discussionNotes !== undefined) {
    fields.push(`discussion_notes = $${n++}`);
    vals.push(typeof b.discussionNotes === "string" ? b.discussionNotes : null);
  }
  if ([1, 2, 3].includes(Number(b.priority))) {
    fields.push(`priority = $${n++}`);
    vals.push(Number(b.priority));
  }
  if (["open", "in_discussion", "resolved", "tabled"].includes(b.status)) {
    fields.push(`status = $${n++}`);
    vals.push(b.status);
    if (b.status === "resolved") {
      fields.push(`resolved_at = $${n++}`);
      vals.push(new Date());
    }
  }
  if (b.resolution !== undefined) {
    fields.push(`resolution = $${n++}`);
    vals.push(typeof b.resolution === "string" ? b.resolution : null);
  }
  if (b.meetingId !== undefined) {
    fields.push(`meeting_id = $${n++}`);
    vals.push(b.meetingId != null ? Number(b.meetingId) : null);
  }
  if (!fields.length) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(`UPDATE l10_issues SET ${fields.join(", ")} WHERE id = $${n} RETURNING *`, vals);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ issue: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update issue." });
  }
}

/** POST /eos/l10/issues/reorder */
export async function postL10IssuesReorder(req, res) {
  const ids = req.body?.orderedIds;
  if (!Array.isArray(ids) || !ids.length) {
    res.status(400).json({ error: "orderedIds required." });
    return;
  }
  try {
    const pool = getPool();
    for (let i = 0; i < ids.length; i++) {
      const priority = Math.min(i + 1, 3);
      const idNum = Number(ids[i]);
      if (!Number.isFinite(idNum)) continue;
      await pool.query(`UPDATE l10_issues SET priority = $1 WHERE id = $2`, [priority, idNum]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not reorder issues." });
  }
}

/** DELETE /eos/l10/issues/:id */
export async function deleteL10Issue(req, res) {
  const id = Number(req.params.id);
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM l10_issues WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete issue." });
  }
}

/** POST /eos/scorecard/ai-analyze — authenticated users */
export async function postScorecardAiAnalyze(req, res) {
  const metricId = Number(req.body?.metricId);
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!Number.isFinite(metricId) || !question) {
    res.status(400).json({ error: "metricId and question are required." });
    return;
  }

  try {
    const pool = getPool();
    const { rows: mrows } = await pool.query(
      `SELECT m.*, u.display_name AS owner_display_name
       FROM scorecard_metrics m
       JOIN users u ON u.id = m.owner_user_id
       WHERE m.id = $1 AND m.is_active = true`,
      [metricId]
    );
    if (!mrows.length) {
      res.status(404).json({ error: "Metric not found." });
      return;
    }
    const m = mrows[0];
    const freq = m.frequency === "monthly" ? "monthly" : "weekly";

    const end = new Date();
    let start;
    let endBound;
    if (freq === "weekly") {
      endBound = mondayOfDate(end);
      start = new Date(endBound);
      start.setDate(start.getDate() - 13 * 7);
    } else {
      endBound = firstOfMonthContaining(end);
      start = new Date(endBound.getFullYear(), endBound.getMonth() - 5, 1);
    }
    const startDate = ymd(start);
    const endDate = ymd(endBound);

    const { rows: entries } = await pool.query(
      `SELECT week_of, month_of, value, entered_at
       FROM scorecard_entries
       WHERE metric_id = $1
         AND (
           (week_of IS NOT NULL AND week_of >= $2::date AND week_of <= $3::date)
           OR (month_of IS NOT NULL AND month_of >= $2::date AND month_of <= $3::date)
         )
       ORDER BY COALESCE(week_of, month_of) ASC`,
      [metricId, startDate, endDate]
    );

    const withValues = entries.filter((e) => e.value != null && !Number.isNaN(Number(e.value)));
    const goal = Number(m.goal_value);
    const direction = m.goal_direction;
    let hits = 0;
    const lines = [];
    for (const e of withValues) {
      const d = freq === "weekly" ? ymd(e.week_of) : ymd(e.month_of);
      const v = Number(e.value);
      const ok = meetsGoal(v, goal, direction);
      if (ok) hits += 1;
      lines.push(`${d}: ${v}${ok ? " (goal met)" : " (off goal)"}`);
    }
    const y = withValues.length;
    let trend = "stable";
    if (withValues.length >= 4) {
      const mid = Math.floor(withValues.length / 2);
      const first = withValues.slice(0, mid);
      const second = withValues.slice(mid);
      const avg = (arr) => arr.reduce((s, e) => s + Number(e.value), 0) / arr.length;
      const a1 = avg(first);
      const a2 = avg(second);
      if (a2 > a1 * 1.03) trend = "improving";
      else if (a2 < a1 * 0.97) trend = "declining";
    }

    const system = `You are analyzing an EOS Scorecard metric for RPM Prestige, a property management company in Houston, TX.`;
    const userBlock = `Metric: ${m.name}
Goal: ${m.goal_value} (${direction})
Frequency: ${freq}
Owner: ${m.owner_display_name ?? "—"}

Recent data points:
${lines.length ? lines.join("\n") : "(no values in this window)"}

${freq === "weekly" ? "Weeks" : "Months"} hitting goal: ${hits} of ${y}
Current trend: ${trend}

The user asks: "${question}"

Provide specific, actionable advice based on the data. Reference actual numbers from the data points. If the metric is off-track, suggest concrete steps to improve it. Keep your response concise (2-3 paragraphs).`;

    const client = anthropicForScorecard();
    const msg = await client.messages.create({
      model: SCORECARD_AI_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: userBlock }],
    });
    const block = msg.content?.[0];
    const analysis = block?.type === "text" ? (block.text?.trim() ?? "") : "";
    res.json({ analysis });
  } catch (e) {
    if (e?.code === "NO_AI_KEY") {
      res.status(503).json({ error: "AI is not configured (missing ANTHROPIC_API_KEY)." });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not analyze metric." });
  }
}
