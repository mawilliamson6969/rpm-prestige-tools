/**
 * Phase 1 Agent Hub: agents CRUD + soft-delete + merge.
 *
 * Aggressive dedup. license_number is the global unique key (partial unique
 * index in DB). On create/update we:
 *   1. Reject if license_number collides with a non-deleted, non-merged record.
 *   2. Warn (don't block) on email collision.
 *   3. Warn (don't block) on (full_name, brokerage_name) collision.
 *
 * Soft-delete: status='deleted'. Preserves referential integrity for the
 * Phase 2 referral history. Rows stay in the DB; the partial unique index
 * on license_number excludes them so the same license can be re-added if
 * the record was deleted.
 *
 * Merge: combines activities, tags, relationships, personal_details from
 * `loser` into `winner`. Loser is marked merged_into_agent_id and status
 * stays whatever it was (typically 'active' before the merge). Idempotent:
 * re-running on an already-merged loser is a no-op.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { mapAgent } from "../lib/agentHub/mappers.js";
import { allowedAgentIdsFor, assertManagerRole, assertPermission } from "../lib/agentHub/permissions.js";
import { clearAgentHubDashboardCache } from "./agentHubDashboard.js";
import {
  vChannel,
  vDate,
  vEmail,
  vIntId,
  vIntOpt,
  vLicense,
  vNiche,
  vNumOpt,
  vPhone,
  vSource,
  vStatus,
  vStringOpt,
  vStringReq,
  vTier,
  vTimestamp,
  vUrl,
  vZip,
  vZipArray,
} from "../lib/agentHub/validators.js";

const ALLOWED_FIELDS = {
  full_name: (v) => vStringReq(v, "full_name", { maxLen: 200 }),
  first_name: (v) => vStringOpt(v, { maxLen: 100 }),
  last_name: (v) => vStringOpt(v, { maxLen: 100 }),
  preferred_name: (v) => vStringOpt(v, { maxLen: 100 }),
  pronouns: (v) => vStringOpt(v, { maxLen: 50 }),
  photo_url: (v) => (v == null || v === "" ? null : vUrl(v)),
  license_number: (v) => (v == null || v === "" ? null : vLicense(v)),
  license_state: (v) => (v == null || v === "" ? "TX" : vStringOpt(v, { maxLen: 4 }) ?? "TX"),
  license_status: (v) => vStringOpt(v, { maxLen: 50 }),
  license_expiration: (v) => (v == null || v === "" ? null : vDate(v, "license_expiration")),
  mls_id: (v) => vStringOpt(v, { maxLen: 100 }),
  years_licensed: (v) => vIntOpt(v, "years_licensed", { min: 0, max: 100 }),
  brokerage_id: (v) => (v == null || v === "" ? null : vIntId(v, "brokerage_id")),
  brokerage_name: (v) => vStringOpt(v, { maxLen: 200 }),
  title: (v) => vStringOpt(v, { maxLen: 100 }),
  team_name: (v) => vStringOpt(v, { maxLen: 200 }),
  niche: (v) => (v == null || v === "" ? null : vNiche(v)),
  target_zips: (v) => vZipArray(v),
  average_price_point: (v) => vNumOpt(v, "average_price_point", { min: 0 }),
  annual_volume: (v) => vNumOpt(v, "annual_volume", { min: 0 }),
  referral_fee_split: (v) => vNumOpt(v, "referral_fee_split", { min: 0 }),
  email: (v) => (v == null || v === "" ? null : vEmail(v)),
  phone_mobile: (v) => (v == null || v === "" ? null : vPhone(v)),
  phone_office: (v) => (v == null || v === "" ? null : vPhone(v)),
  mailing_address_1: (v) => vStringOpt(v, { maxLen: 200 }),
  mailing_address_2: (v) => vStringOpt(v, { maxLen: 200 }),
  city: (v) => vStringOpt(v, { maxLen: 100 }),
  state: (v) => vStringOpt(v, { maxLen: 50 }),
  zip: (v) => (v == null || v === "" ? null : vZip(v)),
  preferred_channel: (v) => (v == null || v === "" ? null : vChannel(v)),
  preferred_contact_time: (v) => vStringOpt(v, { maxLen: 100 }),
  linkedin_url: (v) => (v == null || v === "" ? null : vUrl(v)),
  facebook_url: (v) => (v == null || v === "" ? null : vUrl(v)),
  instagram_handle: (v) => vStringOpt(v, { maxLen: 100 }),
  personal_website: (v) => (v == null || v === "" ? null : vUrl(v)),
  har_profile_url: (v) => (v == null || v === "" ? null : vUrl(v)),
  source: (v) => (v == null || v === "" ? null : vSource(v)),
  source_detail: (v) => vStringOpt(v, { maxLen: 200 }),
  first_contact_date: (v) => (v == null || v === "" ? null : vDate(v, "first_contact_date")),
  relationship_owner_user_id: (v) =>
    v == null || v === "" ? null : vIntId(v, "relationship_owner_user_id"),
  notes: (v) => vStringOpt(v, { maxLen: 50000 }),
};

// Tier and DNC are gated separately — caller must have permission.
const GATED_FIELDS = {
  tier: { perm: "can_change_tier", validate: (v) => vTier(v, { allowNull: false }) },
  do_not_contact: { perm: "can_mark_dnc", validate: (v) => v === true },
  status: { perm: null, validate: (v) => vStatus(v, { allowNull: false }) },
};

// Consent fields auto-set the corresponding *_at timestamp when toggled true.
function applyConsentTimestamps(updates) {
  if (updates.consent_to_email === true && updates.consent_to_email_at == null) {
    updates.consent_to_email_at = new Date().toISOString();
  }
  if (updates.consent_to_email === false) {
    updates.consent_to_email_at = null;
  }
  if (updates.consent_to_sms === true && updates.consent_to_sms_at == null) {
    updates.consent_to_sms_at = new Date().toISOString();
  }
  if (updates.consent_to_sms === false) {
    updates.consent_to_sms_at = null;
  }
}

// DNC firewall: set do_not_contact=true ALSO sets status='dnc' and unsubscribed_at.
function applyDncCascade(updates) {
  if (updates.do_not_contact === true) {
    updates.status = "dnc";
    updates.unsubscribed_at = new Date().toISOString();
  }
}

// If brokerage_id is being set, denormalize brokerage_name from the brokerages table.
async function resolveBrokerageName(pool, brokerageId) {
  if (brokerageId == null) return null;
  const { rows } = await pool.query(
    `SELECT name FROM agent_hub_brokerages WHERE id = $1`,
    [brokerageId]
  );
  if (!rows.length) {
    throw Object.assign(new Error("brokerage_id does not exist."), { http: 400 });
  }
  return rows[0].name;
}

function deriveNameParts(input) {
  const out = {};
  if (input.full_name && (!input.first_name || !input.last_name)) {
    const parts = input.full_name.trim().split(/\s+/);
    if (parts.length >= 2 && !input.first_name) {
      out.first_name = parts[0];
    }
    if (parts.length >= 2 && !input.last_name) {
      out.last_name = parts.slice(-1)[0];
    }
  }
  return out;
}

// ============================================================
// LIST
// ============================================================
export async function listAgentHubAgents(req, res) {
  try {
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedIds && allowedIds.length === 0 && req.agentHubPerms.role === "outreach") {
      // Outreach role with no assignments sees nothing.
      res.json({ agents: [], total: 0, page: 1, per_page: 50 });
      return;
    }

    const pool = getPool();
    const filters = [];
    const params = [];
    let p = 1;

    filters.push(`a.status != 'deleted'`);
    filters.push(`a.merged_into_agent_id IS NULL`);

    if (req.query.tier) {
      filters.push(`a.tier = $${p++}`);
      params.push(String(req.query.tier));
    }
    if (req.query.status) {
      filters.push(`a.status = $${p++}`);
      params.push(String(req.query.status));
    }
    if (req.query.brokerage_id) {
      filters.push(`a.brokerage_id = $${p++}`);
      params.push(Number(req.query.brokerage_id));
    }
    if (req.query.niche) {
      filters.push(`a.niche = $${p++}`);
      params.push(String(req.query.niche));
    }
    if (req.query.target_zip) {
      filters.push(`$${p++} = ANY(a.target_zips)`);
      params.push(String(req.query.target_zip));
    }
    if (req.query.tag) {
      filters.push(
        `EXISTS (SELECT 1 FROM agent_hub_tags t WHERE t.agent_id = a.id AND LOWER(t.tag) = LOWER($${p++}))`
      );
      params.push(String(req.query.tag));
    }
    if (req.query.relationship_owner_user_id) {
      filters.push(`a.relationship_owner_user_id = $${p++}`);
      params.push(Number(req.query.relationship_owner_user_id));
    }
    if (req.query.last_interaction_before) {
      filters.push(`(a.last_interaction_date IS NULL OR a.last_interaction_date < $${p++}::timestamptz)`);
      params.push(String(req.query.last_interaction_before));
    }
    if (req.query.last_interaction_after) {
      filters.push(`a.last_interaction_date >= $${p++}::timestamptz`);
      params.push(String(req.query.last_interaction_after));
    }
    if (req.query.search) {
      const q = String(req.query.search).trim();
      if (q) {
        filters.push(
          `(a.full_name ILIKE $${p} OR a.brokerage_name ILIKE $${p} OR a.email ILIKE $${p} OR a.license_number ILIKE $${p})`
        );
        params.push(`%${q}%`);
        p++;
      }
    }
    if (allowedIds) {
      filters.push(`a.id = ANY($${p++}::int[])`);
      params.push(allowedIds);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const sortMap = {
      name: `LOWER(a.full_name) ASC`,
      tier: `CASE a.tier WHEN 'vip' THEN 0 WHEN 'partner' THEN 1 WHEN 'warm' THEN 2 WHEN 'prospect' THEN 3 WHEN 'cold' THEN 4 WHEN 'dormant' THEN 5 END ASC`,
      brokerage: `LOWER(COALESCE(a.brokerage_name,'')) ASC`,
      last_interaction: `a.last_interaction_date DESC NULLS LAST`,
      created_at: `a.created_at DESC`,
    };
    const sortKey = sortMap[String(req.query.sort || "last_interaction")] || sortMap.last_interaction;

    const perPage = Math.min(Math.max(Number(req.query.per_page) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agent_hub_agents a ${where}`,
      params
    );
    const total = countRows[0].total;

    const limitParams = [...params, perPage, offset];
    const { rows } = await pool.query(
      `SELECT a.*,
              (SELECT array_agg(t.tag ORDER BY t.tag)
                 FROM agent_hub_tags t WHERE t.agent_id = a.id) AS tag_list
         FROM agent_hub_agents a
         ${where}
         ORDER BY ${sortKey}, a.id ASC
         LIMIT $${p++} OFFSET $${p++}`,
      limitParams
    );
    res.json({
      agents: rows.map((r) => ({ ...mapAgent(r), tags: r.tag_list || [] })),
      total,
      page,
      per_page: perPage,
    });
  } catch (e) {
    console.error("[agent-hub] agents list", e);
    res.status(500).json({ error: "Could not load agents." });
  }
}

// ============================================================
// GET ONE
// ============================================================
export async function getAgentHubAgent(req, res) {
  try {
    const id = vIntId(req.params.id, "agent id");
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedIds && !allowedIds.includes(id)) {
      res.status(403).json({ error: "Not authorized to view this agent." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_agents WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const agent = rows[0];
    // Soft-deleted agents are hidden by default. Owner/manager can pass
    // ?include_deleted=true to view (for audit/forensic use).
    const includeDeleted = req.query.include_deleted === "true";
    const isManager = req.agentHubPerms?.role === "owner" || req.agentHubPerms?.role === "manager";
    if (agent.status === "deleted" && !(includeDeleted && isManager)) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    if (agent.merged_into_agent_id != null) {
      res.status(410).json({
        error: "Agent was merged.",
        merged_into: agent.merged_into_agent_id,
      });
      return;
    }

    // Tags
    const { rows: tagRows } = await pool.query(
      `SELECT id, tag, created_at, created_by FROM agent_hub_tags
        WHERE agent_id = $1 ORDER BY tag ASC`,
      [id]
    );

    // Relationships (directional: this agent on either side)
    const { rows: relRows } = await pool.query(
      `SELECT r.*,
              a.full_name AS agent_a_name,
              b.full_name AS agent_b_name
         FROM agent_hub_relationships r
         JOIN agent_hub_agents a ON a.id = r.agent_a_id
         JOIN agent_hub_agents b ON b.id = r.agent_b_id
        WHERE r.agent_a_id = $1 OR r.agent_b_id = $1
        ORDER BY r.created_at DESC`,
      [id]
    );

    // Recent activities (last 50, with attachments aggregated).
    // EXPLICIT column list on att to avoid leaking disk_basename via json_agg(att.*).
    const { rows: actRows } = await pool.query(
      `SELECT a.*,
              COALESCE(json_agg(json_build_object(
                'id', att.id,
                'activity_id', att.activity_id,
                'filename', att.filename,
                'file_url', att.file_url,
                'file_type', att.file_type,
                'file_size_bytes', att.file_size_bytes,
                'uploaded_at', att.uploaded_at,
                'uploaded_by', att.uploaded_by
              ) ORDER BY att.uploaded_at)
              FILTER (WHERE att.id IS NOT NULL), '[]'::json) AS attachments
         FROM agent_hub_activities a
         LEFT JOIN agent_hub_activity_attachments att ON att.activity_id = a.id
        WHERE a.agent_id = $1 AND a.deleted_at IS NULL
        GROUP BY a.id
        ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT 50`,
      [id]
    );

    res.json({
      agent: mapAgent(agent),
      tags: tagRows.map((t) => ({ id: t.id, tag: t.tag, created_at: t.created_at })),
      relationships: relRows,
      activities: actRows,
    });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] agent get", e);
    res.status(500).json({ error: "Could not load agent." });
  }
}

// ============================================================
// CREATE
// ============================================================
export async function createAgentHubAgent(req, res) {
  try {
    const body = req.body ?? {};
    const updates = {};

    // Validate ungated fields
    for (const [k, fn] of Object.entries(ALLOWED_FIELDS)) {
      if (body[k] !== undefined) {
        updates[k] = fn(body[k]);
      }
    }
    // Required: full_name
    if (!updates.full_name) {
      res.status(400).json({ error: "full_name is required." });
      return;
    }

    // Gated fields (tier, status, do_not_contact)
    if (body.tier !== undefined) {
      assertPermission(req.agentHubPerms, "can_change_tier");
      updates.tier = GATED_FIELDS.tier.validate(body.tier);
    }
    if (body.status !== undefined) {
      updates.status = GATED_FIELDS.status.validate(body.status);
    }
    if (body.do_not_contact === true) {
      assertPermission(req.agentHubPerms, "can_mark_dnc");
      updates.do_not_contact = true;
    }

    // Consent flags
    if (body.consent_to_email !== undefined) {
      updates.consent_to_email = body.consent_to_email === true;
    }
    if (body.consent_to_sms !== undefined) {
      updates.consent_to_sms = body.consent_to_sms === true;
    }

    applyConsentTimestamps(updates);
    applyDncCascade(updates);

    // Derive first/last name from full_name if not provided.
    Object.assign(updates, deriveNameParts(updates));

    const pool = getPool();
    if (updates.brokerage_id != null) {
      updates.brokerage_name = await resolveBrokerageName(pool, updates.brokerage_id);
    }

    // Build INSERT
    const cols = Object.keys(updates);
    const vals = cols.map((k) => updates[k]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    cols.push("created_by", "updated_by");
    placeholders.push(`$${vals.length + 1}`, `$${vals.length + 1}`);
    vals.push(req.user.id);

    let inserted;
    try {
      const { rows } = await pool.query(
        `INSERT INTO agent_hub_agents (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        vals
      );
      inserted = rows[0];
    } catch (e) {
      if (e.code === "23505") {
        // license_number collision
        res.status(409).json({
          error: "An agent with that license_number already exists.",
          code: "DUPLICATE_LICENSE",
        });
        return;
      }
      throw e;
    }

    await logAudit(req, {
      entity_type: "agent",
      entity_id: inserted.id,
      action: "create",
      new_value: { full_name: inserted.full_name, license_number: inserted.license_number },
    });
    clearAgentHubDashboardCache();

    // Optional: scan for soft-duplicates and surface as warnings (no block).
    const warnings = await collectDuplicateWarnings(pool, inserted);

    res.status(201).json({ agent: mapAgent(inserted), duplicate_warnings: warnings });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] agent create", e);
    res.status(500).json({ error: "Could not create agent." });
  }
}

async function collectDuplicateWarnings(pool, agent) {
  const warnings = [];
  if (agent.email) {
    const { rows } = await pool.query(
      `SELECT id, full_name, brokerage_name FROM agent_hub_agents
        WHERE LOWER(email) = LOWER($1) AND id != $2 AND status != 'deleted' AND merged_into_agent_id IS NULL
        LIMIT 5`,
      [agent.email, agent.id]
    );
    if (rows.length) warnings.push({ kind: "email_match", matches: rows });
  }
  if (agent.full_name && agent.brokerage_name) {
    const { rows } = await pool.query(
      `SELECT id, full_name, brokerage_name FROM agent_hub_agents
        WHERE LOWER(full_name) = LOWER($1) AND LOWER(COALESCE(brokerage_name,'')) = LOWER($2)
              AND id != $3 AND status != 'deleted' AND merged_into_agent_id IS NULL
        LIMIT 5`,
      [agent.full_name, agent.brokerage_name, agent.id]
    );
    if (rows.length) warnings.push({ kind: "name_brokerage_match", matches: rows });
  }
  return warnings;
}

// ============================================================
// UPDATE
// ============================================================
export async function updateAgentHubAgent(req, res) {
  try {
    const id = vIntId(req.params.id, "agent id");
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedIds && !allowedIds.includes(id)) {
      res.status(403).json({ error: "Not authorized to update this agent." });
      return;
    }

    const body = req.body ?? {};
    const updates = {};

    for (const [k, fn] of Object.entries(ALLOWED_FIELDS)) {
      if (body[k] !== undefined) {
        updates[k] = fn(body[k]);
      }
    }
    if (body.tier !== undefined) {
      assertPermission(req.agentHubPerms, "can_change_tier");
      updates.tier = GATED_FIELDS.tier.validate(body.tier);
    }
    if (body.status !== undefined) {
      updates.status = GATED_FIELDS.status.validate(body.status);
    }
    if (body.do_not_contact !== undefined) {
      if (body.do_not_contact === true) {
        assertPermission(req.agentHubPerms, "can_mark_dnc");
        updates.do_not_contact = true;
      } else if (body.do_not_contact === false) {
        // Un-DNC requires manager+ and an explicit status change to active.
        assertManagerRole(req.agentHubPerms);
        updates.do_not_contact = false;
        if (updates.status === undefined) {
          updates.status = "active";
        }
      }
    }
    if (body.consent_to_email !== undefined) {
      updates.consent_to_email = body.consent_to_email === true;
    }
    if (body.consent_to_sms !== undefined) {
      updates.consent_to_sms = body.consent_to_sms === true;
    }

    applyConsentTimestamps(updates);
    applyDncCascade(updates);

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }

    const pool = getPool();
    if (updates.brokerage_id !== undefined && updates.brokerage_id != null) {
      updates.brokerage_name = await resolveBrokerageName(pool, updates.brokerage_id);
    } else if (updates.brokerage_id === null) {
      updates.brokerage_name = null;
    }

    const { rows: oldRows } = await pool.query(
      `SELECT * FROM agent_hub_agents WHERE id = $1`,
      [id]
    );
    if (!oldRows.length) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    if (oldRows[0].status === "deleted") {
      res.status(409).json({ error: "Cannot update a deleted agent. Restore it first." });
      return;
    }

    const cols = Object.keys(updates);
    const sets = cols.map((k, i) => `${k} = $${i + 1}`);
    const vals = cols.map((k) => updates[k]);
    vals.push(req.user.id);
    sets.push(`updated_by = $${vals.length}`);
    vals.push(id);

    let updated;
    try {
      const { rows } = await pool.query(
        `UPDATE agent_hub_agents SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      updated = rows[0];
    } catch (e) {
      if (e.code === "23505") {
        res.status(409).json({
          error: "An agent with that license_number already exists.",
          code: "DUPLICATE_LICENSE",
        });
        return;
      }
      throw e;
    }

    await logFieldDiff(req, "agent", id, oldRows[0], updated, Object.keys(updates));
    clearAgentHubDashboardCache();

    res.json({ agent: mapAgent(updated) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] agent update", e);
    res.status(500).json({ error: "Could not update agent." });
  }
}

// ============================================================
// SOFT DELETE
// ============================================================
export async function deleteAgentHubAgent(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "agent id");
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_agents
          SET status = 'deleted',
              do_not_contact = TRUE,
              unsubscribed_at = COALESCE(unsubscribed_at, NOW()),
              updated_by = $2
        WHERE id = $1
          AND status != 'deleted'
        RETURNING id`,
      [id, req.user.id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Agent not found or already deleted." });
      return;
    }
    await logAudit(req, {
      entity_type: "agent",
      entity_id: id,
      action: "delete",
    });
    clearAgentHubDashboardCache();
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] agent delete", e);
    res.status(500).json({ error: "Could not delete agent." });
  }
}

// ============================================================
// MERGE
// ============================================================
// POST /agent-hub/agents/:id/merge/:other_id
// `id` = winner (kept), `other_id` = loser (marked merged_into_agent_id).
// Idempotent: if loser is already merged into winner, returns 200 OK.
export async function mergeAgentHubAgents(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    assertPermission(req.agentHubPerms, "can_merge");
    const winnerId = vIntId(req.params.id, "winner id");
    const loserId = vIntId(req.params.other_id, "loser id");
    if (winnerId === loserId) {
      res.status(400).json({ error: "Cannot merge an agent with itself." });
      return;
    }
    await client.query("BEGIN");

    const { rows: winnerRows } = await client.query(
      `SELECT * FROM agent_hub_agents WHERE id = $1 FOR UPDATE`,
      [winnerId]
    );
    const { rows: loserRows } = await client.query(
      `SELECT * FROM agent_hub_agents WHERE id = $1 FOR UPDATE`,
      [loserId]
    );
    if (!winnerRows.length || !loserRows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "One or both agents not found." });
      return;
    }
    const winner = winnerRows[0];
    const loser = loserRows[0];
    if (winner.status === "deleted") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Winner is deleted. Restore it first." });
      return;
    }
    if (loser.merged_into_agent_id === winnerId) {
      await client.query("ROLLBACK");
      res.json({ ok: true, idempotent: true, winner: mapAgent(winner) });
      return;
    }
    if (loser.merged_into_agent_id != null && loser.merged_into_agent_id !== winnerId) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "Loser is already merged into a different agent.",
        merged_into: loser.merged_into_agent_id,
      });
      return;
    }

    // Move activities (idempotent — repeat won't reassign already-moved rows).
    await client.query(
      `UPDATE agent_hub_activities SET agent_id = $1 WHERE agent_id = $2`,
      [winnerId, loserId]
    );

    // Move tags. Skip duplicates via NOT EXISTS.
    await client.query(
      `INSERT INTO agent_hub_tags (agent_id, tag, created_at, created_by)
       SELECT $1, t.tag, t.created_at, t.created_by
         FROM agent_hub_tags t
        WHERE t.agent_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM agent_hub_tags x WHERE x.agent_id = $1 AND x.tag = t.tag
          )`,
      [winnerId, loserId]
    );
    await client.query(`DELETE FROM agent_hub_tags WHERE agent_id = $1`, [loserId]);

    // Move relationships. Avoid creating self-relationships post-merge.
    await client.query(
      `UPDATE agent_hub_relationships
          SET agent_a_id = CASE WHEN agent_a_id = $2 THEN $1 ELSE agent_a_id END,
              agent_b_id = CASE WHEN agent_b_id = $2 THEN $1 ELSE agent_b_id END
        WHERE (agent_a_id = $2 OR agent_b_id = $2)`,
      [winnerId, loserId]
    );
    await client.query(
      `DELETE FROM agent_hub_relationships WHERE agent_a_id = agent_b_id`
    );

    // Move personal_details. Winner-wins on conflict.
    await client.query(
      `INSERT INTO agent_hub_personal_details
         (agent_id, birthday_month, birthday_day, birthday_year,
          spouse_name, spouse_birthday_month, spouse_birthday_day,
          anniversary_date, children, pets, alma_mater, graduation_year,
          hometown, hobbies, food_preferences, gift_preferences,
          religious_observances, important_dates, personal_notes,
          last_updated_at, updated_by)
       SELECT $1, birthday_month, birthday_day, birthday_year,
              spouse_name, spouse_birthday_month, spouse_birthday_day,
              anniversary_date, children, pets, alma_mater, graduation_year,
              hometown, hobbies, food_preferences, gift_preferences,
              religious_observances, important_dates, personal_notes,
              NOW(), $3
         FROM agent_hub_personal_details
        WHERE agent_id = $2
       ON CONFLICT (agent_id) DO NOTHING`,
      [winnerId, loserId, req.user.id]
    );
    await client.query(
      `DELETE FROM agent_hub_personal_details WHERE agent_id = $1`,
      [loserId]
    );

    // Mark loser merged.
    await client.query(
      `UPDATE agent_hub_agents
          SET merged_into_agent_id = $1,
              merged_at = NOW(),
              merged_by = $2,
              updated_by = $2
        WHERE id = $3`,
      [winnerId, req.user.id, loserId]
    );

    // Touch winner so updated_at reflects the merge.
    const { rows: refreshed } = await client.query(
      `UPDATE agent_hub_agents SET updated_at = NOW(), updated_by = $1 WHERE id = $2 RETURNING *`,
      [req.user.id, winnerId]
    );

    await client.query("COMMIT");

    await logAudit(req, {
      entity_type: "agent",
      entity_id: winnerId,
      action: "merge",
      new_value: { merged_loser_id: loserId, loser_name: loser.full_name },
    });
    await logAudit(req, {
      entity_type: "agent",
      entity_id: loserId,
      action: "merge",
      new_value: { merged_into_winner_id: winnerId, winner_name: winner.full_name },
    });

    res.json({ ok: true, winner: mapAgent(refreshed[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] agent merge", e);
    res.status(500).json({ error: "Could not merge agents." });
  } finally {
    client.release();
  }
}
