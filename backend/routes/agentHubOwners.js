/**
 * Phase 2: owners CRUD.
 *
 * Owners are property owners referred to RPM Prestige. The first agent
 * who refers an owner gets credit (source_agent_id is set on owner
 * creation by the referrals route, NOT by this route — preserving
 * "first referral wins" even if the owner is later edited).
 *
 * Soft-delete (status='deleted') refused if the owner has active
 * referrals or under-management properties — the spec wants explicit
 * cleanup before deletion.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapOwner } from "../lib/agentHub/mappers.js";
import {
  vEmail,
  vIntId,
  vIntOpt,
  vOwnerStatus,
  vPhone,
  vStringOpt,
  vStringReq,
  vZip,
} from "../lib/agentHub/validators.js";

const ALLOWED_FIELDS = {
  full_name: (v) => vStringReq(v, "full_name", { maxLen: 200 }),
  first_name: (v) => vStringOpt(v, { maxLen: 100 }),
  last_name: (v) => vStringOpt(v, { maxLen: 100 }),
  email: (v) => (v == null || v === "" ? null : vEmail(v)),
  phone_mobile: (v) => (v == null || v === "" ? null : vPhone(v)),
  phone_office: (v) => (v == null || v === "" ? null : vPhone(v)),
  mailing_address_1: (v) => vStringOpt(v, { maxLen: 200 }),
  mailing_address_2: (v) => vStringOpt(v, { maxLen: 200 }),
  city: (v) => vStringOpt(v, { maxLen: 100 }),
  state: (v) => vStringOpt(v, { maxLen: 50 }),
  zip: (v) => (v == null || v === "" ? null : vZip(v)),
  is_company: (v) => v === true,
  company_name: (v) => vStringOpt(v, { maxLen: 200 }),
  notes: (v) => vStringOpt(v, { maxLen: 50000 }),
  external_appfolio_id: (v) => vStringOpt(v, { maxLen: 100 }),
};

export async function listOwners(req, res) {
  try {
    const pool = getPool();
    const filters = [`o.status != 'deleted'`];
    const params = [];
    let p = 1;

    if (req.query.status) {
      filters.push(`o.status = $${p++}`);
      params.push(String(req.query.status));
    }
    if (req.query.source_agent_id) {
      filters.push(`o.source_agent_id = $${p++}`);
      params.push(Number(req.query.source_agent_id));
    }
    if (req.query.search) {
      const q = String(req.query.search).trim();
      if (q) {
        filters.push(`(o.full_name ILIKE $${p} OR o.email ILIKE $${p} OR o.company_name ILIKE $${p})`);
        params.push(`%${q}%`);
        p++;
      }
    }
    if (req.query.has_active_referrals === "true") {
      filters.push(`EXISTS (
        SELECT 1 FROM agent_hub_referrals r
         WHERE r.owner_id = o.id AND r.stage NOT IN ('lost','declined','active_management')
      )`);
    }

    // Outreach role restricts visibility by source agent.
    const allowedAgentIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedAgentIds) {
      filters.push(`o.source_agent_id = ANY($${p++}::int[])`);
      params.push(allowedAgentIds);
    }

    const where = `WHERE ${filters.join(" AND ")}`;
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agent_hub_owners o ${where}`,
      params
    );
    const total = countRows[0].total;

    const { rows } = await pool.query(
      `SELECT o.*,
              ag.full_name AS source_agent_name,
              (SELECT COUNT(*)::int FROM agent_hub_properties p
                WHERE p.owner_id = o.id AND p.status != 'deleted') AS property_count,
              (SELECT COUNT(*)::int FROM agent_hub_referrals r
                WHERE r.owner_id = o.id
                  AND r.stage NOT IN ('lost','declined','active_management')) AS active_referral_count
         FROM agent_hub_owners o
         LEFT JOIN agent_hub_agents ag ON ag.id = o.source_agent_id
         ${where}
        ORDER BY o.created_at DESC, o.id ASC
        LIMIT $${p++} OFFSET $${p++}`,
      [...params, perPage, offset]
    );
    res.json({ owners: rows.map(mapOwner), total, page, per_page: perPage });
  } catch (e) {
    console.error("[agent-hub] owners list", e);
    res.status(500).json({ error: "Could not load owners." });
  }
}

export async function getOwner(req, res) {
  try {
    const id = vIntId(req.params.id, "owner id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT o.*, ag.full_name AS source_agent_name
         FROM agent_hub_owners o
         LEFT JOIN agent_hub_agents ag ON ag.id = o.source_agent_id
        WHERE o.id = $1 AND o.status != 'deleted'`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Owner not found." });
      return;
    }
    const owner = rows[0];

    const allowedAgentIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedAgentIds && (owner.source_agent_id == null || !allowedAgentIds.includes(owner.source_agent_id))) {
      res.status(403).json({ error: "Not authorized to view this owner." });
      return;
    }

    const { rows: properties } = await pool.query(
      `SELECT * FROM agent_hub_properties
        WHERE owner_id = $1 AND status != 'deleted'
        ORDER BY created_at DESC`,
      [id]
    );

    const { rows: referrals } = await pool.query(
      `SELECT r.*,
              ag.full_name AS agent_name,
              ag.tier AS agent_tier,
              p.address_1 AS property_address,
              p.city AS property_city
         FROM agent_hub_referrals r
         JOIN agent_hub_agents ag ON ag.id = r.agent_id
         LEFT JOIN agent_hub_properties p ON p.id = r.property_id
        WHERE r.owner_id = $1
        ORDER BY r.created_at DESC`,
      [id]
    );

    res.json({
      owner: mapOwner(owner),
      properties,
      referrals,
    });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] owner get", e);
    res.status(500).json({ error: "Could not load owner." });
  }
}

export async function createOwner(req, res) {
  try {
    const body = req.body ?? {};
    const updates = {};
    for (const [k, fn] of Object.entries(ALLOWED_FIELDS)) {
      if (body[k] !== undefined) updates[k] = fn(body[k]);
    }
    if (!updates.full_name) {
      res.status(400).json({ error: "full_name is required." });
      return;
    }
    if (body.source_agent_id !== undefined) {
      updates.source_agent_id = vIntOpt(body.source_agent_id, "source_agent_id", { min: 1 });
      if (updates.source_agent_id != null) {
        updates.first_referral_date = new Date().toISOString().slice(0, 10);
      }
    }
    const cols = Object.keys(updates);
    const vals = cols.map((k) => updates[k]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    cols.push("created_by", "updated_by");
    placeholders.push(`$${vals.length + 1}`, `$${vals.length + 1}`);
    vals.push(req.user.id);

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_owners (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      vals
    );
    await logAudit(req, {
      entity_type: "owner",
      entity_id: rows[0].id,
      action: "create",
      new_value: { full_name: rows[0].full_name, email: rows[0].email },
    });
    res.status(201).json({ owner: mapOwner(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] owner create", e);
    res.status(500).json({ error: "Could not create owner." });
  }
}

export async function updateOwner(req, res) {
  try {
    const id = vIntId(req.params.id, "owner id");
    const body = req.body ?? {};
    const updates = {};
    for (const [k, fn] of Object.entries(ALLOWED_FIELDS)) {
      if (body[k] !== undefined) updates[k] = fn(body[k]);
    }
    // status changes are gated to manager+ (excludes set-to-deleted; that
    // goes through DELETE).
    if (body.status !== undefined) {
      assertManagerRole(req.agentHubPerms);
      const s = vOwnerStatus(body.status, { allowNull: false });
      if (s === "deleted") {
        res.status(400).json({ error: "Use DELETE to soft-delete an owner." });
        return;
      }
      updates.status = s;
    }
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    const pool = getPool();
    const { rows: oldRows } = await pool.query(
      `SELECT * FROM agent_hub_owners WHERE id = $1`,
      [id]
    );
    if (!oldRows.length || oldRows[0].status === "deleted") {
      res.status(404).json({ error: "Owner not found." });
      return;
    }
    const sets = [];
    const vals = [];
    let n = 1;
    for (const k of Object.keys(updates)) {
      sets.push(`${k} = $${n++}`);
      vals.push(updates[k]);
    }
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE agent_hub_owners SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "owner", id, oldRows[0], rows[0], Object.keys(updates));
    res.json({ owner: mapOwner(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] owner update", e);
    res.status(500).json({ error: "Could not update owner." });
  }
}

export async function deleteOwner(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "owner id");
    const pool = getPool();
    // Refuse if active referrals or under-management properties exist.
    const { rows: blockers } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM agent_hub_referrals r
            WHERE r.owner_id = $1
              AND r.stage NOT IN ('lost','declined')) AS active_referrals,
         (SELECT COUNT(*)::int FROM agent_hub_properties p
            WHERE p.owner_id = $1 AND p.status = 'under_management') AS under_management`,
      [id]
    );
    if (blockers[0].active_referrals > 0 || blockers[0].under_management > 0) {
      res.status(409).json({
        error: "Owner has active referrals or under-management properties. Resolve those first.",
        active_referrals: blockers[0].active_referrals,
        under_management_properties: blockers[0].under_management,
      });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE agent_hub_owners SET status = 'deleted', updated_by = $2
        WHERE id = $1 AND status != 'deleted'`,
      [id, req.user.id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Owner not found or already deleted." });
      return;
    }
    await logAudit(req, { entity_type: "owner", entity_id: id, action: "delete" });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] owner delete", e);
    res.status(500).json({ error: "Could not delete owner." });
  }
}
