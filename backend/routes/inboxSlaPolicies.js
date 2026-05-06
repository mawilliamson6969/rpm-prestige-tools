/**
 * Phase 3: SLA policies CRUD. Admin-only — RPM Prestige's roles model
 * already has owner/admin granted the synthetic 'all' permission, so the
 * existing requireAdminRole middleware does the gating at the mount.
 */

import { getPool } from "../lib/db.js";

const VALID_PRIORITIES = new Set(["emergency", "high", "normal", "low"]);
const VALID_CATEGORIES = new Set([
  "maintenance",
  "leasing",
  "accounting",
  "owner",
  "tenant",
  "vendor",
  "legal",
  "internal",
  "marketing",
  "other",
]);

function mapRow(r) {
  return {
    id: r.id,
    name: r.name,
    match_category: r.match_category ?? null,
    match_mailbox: r.match_mailbox ?? null,
    match_priority: r.match_priority ?? null,
    first_response_minutes: r.first_response_minutes,
    resolution_minutes: r.resolution_minutes ?? null,
    pause_on_statuses: Array.isArray(r.pause_on_statuses) ? r.pause_on_statuses : [],
    business_hours_only: r.business_hours_only === true,
    active: r.active !== false,
    priority_rank: r.priority_rank,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function validateCategory(c) {
  if (c == null || c === "") return null;
  if (!VALID_CATEGORIES.has(String(c))) {
    throw Object.assign(new Error("match_category is invalid."), { http: 400 });
  }
  return String(c);
}

function validatePriority(p) {
  if (p == null || p === "") return null;
  if (!VALID_PRIORITIES.has(String(p))) {
    throw Object.assign(new Error("match_priority is invalid."), { http: 400 });
  }
  return String(p);
}

function validateMinutes(m, label, allowNull = false) {
  if ((m == null || m === "") && allowNull) return null;
  const n = Number(m);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw Object.assign(new Error(`${label} must be a non-negative integer.`), { http: 400 });
  }
  return n;
}

function validatePauseStatuses(arr) {
  if (arr == null) return undefined;
  if (!Array.isArray(arr)) {
    throw Object.assign(new Error("pause_on_statuses must be an array of strings."), { http: 400 });
  }
  return arr.map((s) => String(s));
}

export async function getInboxSlaPolicies(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM sla_policies ORDER BY priority_rank ASC, id ASC`
    );
    res.json({ policies: rows.map(mapRow) });
  } catch (e) {
    console.error("[inbox] sla list", e);
    res.status(500).json({ error: "Could not load SLA policies." });
  }
}

export async function postInboxSlaPolicy(req, res) {
  try {
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    const matchCategory = validateCategory(body.match_category);
    const matchPriority = validatePriority(body.match_priority);
    const matchMailbox =
      typeof body.match_mailbox === "string" && body.match_mailbox.trim()
        ? body.match_mailbox.trim().toLowerCase()
        : null;
    const firstResponse = validateMinutes(body.first_response_minutes, "first_response_minutes");
    if (firstResponse <= 0) {
      res.status(400).json({ error: "first_response_minutes must be positive." });
      return;
    }
    const resolution = validateMinutes(body.resolution_minutes, "resolution_minutes", true);
    const paused = validatePauseStatuses(body.pause_on_statuses);
    const businessHoursOnly = body.business_hours_only === true;
    const active = body.active !== false;
    const priorityRank = validateMinutes(body.priority_rank ?? 100, "priority_rank");

    const pool = getPool();
    const cols = [
      "name",
      "match_category",
      "match_mailbox",
      "match_priority",
      "first_response_minutes",
      "resolution_minutes",
      "business_hours_only",
      "active",
      "priority_rank",
    ];
    const vals = [
      name,
      matchCategory,
      matchMailbox,
      matchPriority,
      firstResponse,
      resolution,
      businessHoursOnly,
      active,
      priorityRank,
    ];
    let placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    if (paused !== undefined) {
      cols.push("pause_on_statuses");
      vals.push(paused);
      placeholders += `, $${vals.length}::text[]`;
    }
    const { rows } = await pool.query(
      `INSERT INTO sla_policies (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.status(201).json({ policy: mapRow(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "A policy with that name already exists." });
      return;
    }
    console.error("[inbox] sla create", e);
    res.status(500).json({ error: "Could not create policy." });
  }
}

export async function patchInboxSlaPolicy(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid policy id." });
      return;
    }
    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;

    if (body.name !== undefined) {
      const v = String(body.name).trim();
      if (!v) {
        res.status(400).json({ error: "name cannot be empty." });
        return;
      }
      sets.push(`name = $${n++}`);
      vals.push(v);
    }
    if (body.match_category !== undefined) {
      sets.push(`match_category = $${n++}`);
      vals.push(validateCategory(body.match_category));
    }
    if (body.match_priority !== undefined) {
      sets.push(`match_priority = $${n++}`);
      vals.push(validatePriority(body.match_priority));
    }
    if (body.match_mailbox !== undefined) {
      const v =
        typeof body.match_mailbox === "string" && body.match_mailbox.trim()
          ? body.match_mailbox.trim().toLowerCase()
          : null;
      sets.push(`match_mailbox = $${n++}`);
      vals.push(v);
    }
    if (body.first_response_minutes !== undefined) {
      const m = validateMinutes(body.first_response_minutes, "first_response_minutes");
      if (m <= 0) {
        res.status(400).json({ error: "first_response_minutes must be positive." });
        return;
      }
      sets.push(`first_response_minutes = $${n++}`);
      vals.push(m);
    }
    if (body.resolution_minutes !== undefined) {
      sets.push(`resolution_minutes = $${n++}`);
      vals.push(validateMinutes(body.resolution_minutes, "resolution_minutes", true));
    }
    if (body.pause_on_statuses !== undefined) {
      const arr = validatePauseStatuses(body.pause_on_statuses);
      sets.push(`pause_on_statuses = $${n++}::text[]`);
      vals.push(arr);
    }
    if (body.business_hours_only !== undefined) {
      sets.push(`business_hours_only = $${n++}`);
      vals.push(body.business_hours_only === true);
    }
    if (body.active !== undefined) {
      sets.push(`active = $${n++}`);
      vals.push(body.active !== false);
    }
    if (body.priority_rank !== undefined) {
      sets.push(`priority_rank = $${n++}`);
      vals.push(validateMinutes(body.priority_rank, "priority_rank"));
    }
    if (!sets.length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE sla_policies SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Policy not found." });
      return;
    }
    res.json({ policy: mapRow(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "A policy with that name already exists." });
      return;
    }
    console.error("[inbox] sla patch", e);
    res.status(500).json({ error: "Could not update policy." });
  }
}

export async function deleteInboxSlaPolicy(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid policy id." });
      return;
    }
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM sla_policies WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Policy not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[inbox] sla delete", e);
    res.status(500).json({ error: "Could not delete policy." });
  }
}
