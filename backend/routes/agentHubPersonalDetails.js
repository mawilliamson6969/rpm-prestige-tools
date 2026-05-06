/**
 * Phase 1 Agent Hub: personal details (gated).
 *
 * This is the most sensitive table in the Hub: spouse names, kids' birthdays,
 * religious observances, etc. Strict gating:
 *   * GET requires can_view_personal_details = TRUE.
 *   * PUT requires can_view_personal_details = TRUE (no separate write flag —
 *     if you can read, you can edit. The audit log captures who changed what.)
 *   * Owner-mode VIP rows: VIP agents' personal_details are owner-only,
 *     even from managers. (Mike specifically asked for this in his memory
 *     about VIP relationships being owner-only.)
 *
 * Listed under /agent-hub/agents/:id/personal so the URL signals the
 * isolation. The data is NEVER joined into the general agent endpoint.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { assertPermission } from "../lib/agentHub/permissions.js";
import { mapPersonalDetails } from "../lib/agentHub/mappers.js";
import {
  vDate,
  vIntId,
  vIntOpt,
  vStringOpt,
} from "../lib/agentHub/validators.js";

async function loadAgentForPersonalGate(pool, agentId) {
  const { rows } = await pool.query(
    `SELECT id, full_name, tier, status FROM agent_hub_agents WHERE id = $1`,
    [agentId]
  );
  return rows[0] || null;
}

function assertVipOwnerOnly(agent, perms) {
  if (agent.tier === "vip" && perms.role !== "owner") {
    throw Object.assign(new Error("VIP personal details are owner-only."), { http: 403 });
  }
}

const PD_FIELDS = {
  birthday_month: (v) => vIntOpt(v, "birthday_month", { min: 1, max: 12 }),
  birthday_day: (v) => vIntOpt(v, "birthday_day", { min: 1, max: 31 }),
  birthday_year: (v) => vIntOpt(v, "birthday_year", { min: 1900, max: new Date().getFullYear() }),
  spouse_name: (v) => vStringOpt(v, { maxLen: 200 }),
  spouse_birthday_month: (v) => vIntOpt(v, "spouse_birthday_month", { min: 1, max: 12 }),
  spouse_birthday_day: (v) => vIntOpt(v, "spouse_birthday_day", { min: 1, max: 31 }),
  anniversary_date: (v) => (v == null || v === "" ? null : vDate(v, "anniversary_date")),
  alma_mater: (v) => vStringOpt(v, { maxLen: 200 }),
  graduation_year: (v) => vIntOpt(v, "graduation_year", { min: 1900, max: new Date().getFullYear() }),
  hometown: (v) => vStringOpt(v, { maxLen: 200 }),
  hobbies: (v) => vStringOpt(v, { maxLen: 5000 }),
  food_preferences: (v) => vStringOpt(v, { maxLen: 5000 }),
  gift_preferences: (v) => vStringOpt(v, { maxLen: 5000 }),
  religious_observances: (v) => vStringOpt(v, { maxLen: 5000 }),
  personal_notes: (v) => vStringOpt(v, { maxLen: 50000 }),
};

const JSONB_FIELDS = ["children", "pets", "important_dates"];

function validateJsonbArray(v, label) {
  if (v == null) return null;
  if (!Array.isArray(v)) {
    throw Object.assign(new Error(`${label} must be an array.`), { http: 400 });
  }
  if (v.length > 50) {
    throw Object.assign(new Error(`${label} too long (max 50 entries).`), { http: 400 });
  }
  // Sanitize: each entry must be a plain object, no nested HTML/scripts.
  return v.map((entry) => {
    if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
      throw Object.assign(new Error(`${label} entries must be objects.`), { http: 400 });
    }
    return entry;
  });
}

export async function getAgentHubPersonalDetails(req, res) {
  try {
    assertPermission(req.agentHubPerms, "can_view_personal_details");
    const agentId = vIntId(req.params.id, "agent id");
    const pool = getPool();
    const agent = await loadAgentForPersonalGate(pool, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    assertVipOwnerOnly(agent, req.agentHubPerms);

    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_personal_details WHERE agent_id = $1`,
      [agentId]
    );
    if (!rows.length) {
      // Return an empty shell rather than 404 — the form can be filled in.
      res.json({ personal: { agent_id: agentId, children: [], pets: [], important_dates: [] } });
      return;
    }
    res.json({ personal: mapPersonalDetails(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] personal get", e);
    res.status(500).json({ error: "Could not load personal details." });
  }
}

export async function upsertAgentHubPersonalDetails(req, res) {
  try {
    assertPermission(req.agentHubPerms, "can_view_personal_details");
    const agentId = vIntId(req.params.id, "agent id");
    const pool = getPool();
    const agent = await loadAgentForPersonalGate(pool, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    if (agent.status === "deleted") {
      res.status(409).json({ error: "Cannot update personal details for a deleted agent." });
      return;
    }
    assertVipOwnerOnly(agent, req.agentHubPerms);

    const body = req.body ?? {};
    const updates = {};
    for (const [k, fn] of Object.entries(PD_FIELDS)) {
      if (body[k] !== undefined) updates[k] = fn(body[k]);
    }
    for (const k of JSONB_FIELDS) {
      if (body[k] !== undefined) updates[k] = validateJsonbArray(body[k], k);
    }

    const { rows: existing } = await pool.query(
      `SELECT * FROM agent_hub_personal_details WHERE agent_id = $1`,
      [agentId]
    );
    const oldRow = existing[0] || null;

    if (!oldRow) {
      const cols = ["agent_id", ...Object.keys(updates), "updated_by"];
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const vals = [agentId];
      for (const k of Object.keys(updates)) {
        if (JSONB_FIELDS.includes(k)) {
          vals.push(JSON.stringify(updates[k]));
        } else {
          vals.push(updates[k]);
        }
      }
      vals.push(req.user.id);
      // Adjust placeholders for jsonb casts
      const placeholdersWithCasts = cols.map((k, i) => {
        if (JSONB_FIELDS.includes(k)) return `$${i + 1}::jsonb`;
        return `$${i + 1}`;
      });
      const { rows } = await pool.query(
        `INSERT INTO agent_hub_personal_details (${cols.join(", ")})
         VALUES (${placeholdersWithCasts.join(", ")})
         RETURNING *`,
        vals
      );
      await logAudit(req, {
        entity_type: "personal_details",
        entity_id: agentId,
        action: "create",
      });
      res.json({ personal: mapPersonalDetails(rows[0]) });
      return;
    }

    // UPDATE existing
    if (!Object.keys(updates).length) {
      res.json({ personal: mapPersonalDetails(oldRow) });
      return;
    }
    const sets = [];
    const vals = [];
    let n = 1;
    for (const k of Object.keys(updates)) {
      if (JSONB_FIELDS.includes(k)) {
        sets.push(`${k} = $${n}::jsonb`);
        vals.push(JSON.stringify(updates[k]));
      } else {
        sets.push(`${k} = $${n}`);
        vals.push(updates[k]);
      }
      n++;
    }
    sets.push(`last_updated_at = NOW()`);
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(agentId);
    const { rows } = await pool.query(
      `UPDATE agent_hub_personal_details SET ${sets.join(", ")} WHERE agent_id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "personal_details", agentId, oldRow, rows[0], Object.keys(updates));
    res.json({ personal: mapPersonalDetails(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] personal upsert", e);
    res.status(500).json({ error: "Could not save personal details." });
  }
}
