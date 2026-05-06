/**
 * Phase 2: properties CRUD.
 *
 * A property always belongs to an owner. Soft-delete refused if the
 * property is currently under_management OR has active referrals.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapProperty } from "../lib/agentHub/mappers.js";
import {
  vIntId,
  vIntOpt,
  vNumOpt,
  vPropertyStatus,
  vPropertyType,
  vStringOpt,
  vStringReq,
  vZip,
} from "../lib/agentHub/validators.js";

const ALLOWED_FIELDS = {
  address_1: (v) => vStringReq(v, "address_1", { maxLen: 200 }),
  address_2: (v) => vStringOpt(v, { maxLen: 200 }),
  city: (v) => vStringReq(v, "city", { maxLen: 100 }),
  state: (v) => vStringReq(v, "state", { maxLen: 50 }),
  zip: (v) => vZip(v, { allowNull: false }),
  property_type: (v) => (v == null || v === "" ? null : vPropertyType(v)),
  bedrooms: (v) => vNumOpt(v, "bedrooms", { min: 0 }),
  bathrooms: (v) => vNumOpt(v, "bathrooms", { min: 0 }),
  square_feet: (v) => vIntOpt(v, "square_feet", { min: 1 }),
  year_built: (v) => vIntOpt(v, "year_built", { min: 1800, max: 2200 }),
  notes: (v) => vStringOpt(v, { maxLen: 50000 }),
  external_appfolio_property_id: (v) => vStringOpt(v, { maxLen: 100 }),
};

export async function listProperties(req, res) {
  try {
    const pool = getPool();
    const filters = [`p.status != 'deleted'`];
    const params = [];
    let pIdx = 1;
    if (req.query.owner_id) {
      filters.push(`p.owner_id = $${pIdx++}`);
      params.push(Number(req.query.owner_id));
    }
    if (req.query.status) {
      filters.push(`p.status = $${pIdx++}`);
      params.push(String(req.query.status));
    }
    if (req.query.zip) {
      filters.push(`p.zip = $${pIdx++}`);
      params.push(String(req.query.zip));
    }
    if (req.query.property_type) {
      filters.push(`p.property_type = $${pIdx++}`);
      params.push(String(req.query.property_type));
    }
    if (req.query.search) {
      const q = String(req.query.search).trim();
      if (q) {
        filters.push(`(p.address_1 ILIKE $${pIdx} OR p.city ILIKE $${pIdx})`);
        params.push(`%${q}%`);
        pIdx++;
      }
    }
    const allowedAgentIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedAgentIds) {
      // Property visibility for outreach: only properties where the owner
      // was sourced by one of the user's assigned agents.
      filters.push(`p.owner_id IN (
        SELECT id FROM agent_hub_owners WHERE source_agent_id = ANY($${pIdx++}::int[])
      )`);
      params.push(allowedAgentIds);
    }

    const where = `WHERE ${filters.join(" AND ")}`;
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agent_hub_properties p ${where}`,
      params
    );
    const { rows } = await pool.query(
      `SELECT p.*, o.full_name AS owner_name
         FROM agent_hub_properties p
         JOIN agent_hub_owners o ON o.id = p.owner_id
         ${where}
        ORDER BY p.created_at DESC, p.id ASC
        LIMIT $${pIdx++} OFFSET $${pIdx++}`,
      [...params, perPage, offset]
    );
    res.json({ properties: rows.map(mapProperty), total: countRows[0].total, page, per_page: perPage });
  } catch (e) {
    console.error("[agent-hub] properties list", e);
    res.status(500).json({ error: "Could not load properties." });
  }
}

export async function getProperty(req, res) {
  try {
    const id = vIntId(req.params.id, "property id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.*, o.full_name AS owner_name
         FROM agent_hub_properties p
         JOIN agent_hub_owners o ON o.id = p.owner_id
        WHERE p.id = $1 AND p.status != 'deleted'`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Property not found." });
      return;
    }
    const property = rows[0];

    // Referral history (every referral on this property, including completed/lost)
    const { rows: referrals } = await pool.query(
      `SELECT r.*, ag.full_name AS agent_name, ag.tier AS agent_tier
         FROM agent_hub_referrals r
         JOIN agent_hub_agents ag ON ag.id = r.agent_id
        WHERE r.property_id = $1
        ORDER BY r.created_at DESC`,
      [id]
    );

    // Revenue summary (last 12 months)
    const { rows: revenue } = await pool.query(
      `SELECT rt.*
         FROM agent_hub_revenue_tracking rt
         JOIN agent_hub_referrals r ON r.id = rt.referral_id
        WHERE r.property_id = $1 AND rt.deleted_at IS NULL
        ORDER BY rt.month DESC
        LIMIT 12`,
      [id]
    );

    res.json({ property: mapProperty(property), referrals, revenue });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] property get", e);
    res.status(500).json({ error: "Could not load property." });
  }
}

export async function createProperty(req, res) {
  try {
    const body = req.body ?? {};
    const ownerId = vIntId(body.owner_id, "owner_id");
    const updates = { owner_id: ownerId };
    for (const [k, fn] of Object.entries(ALLOWED_FIELDS)) {
      if (body[k] !== undefined) updates[k] = fn(body[k]);
    }
    if (!updates.address_1 || !updates.city || !updates.state || !updates.zip) {
      res.status(400).json({ error: "address_1, city, state, and zip are required." });
      return;
    }
    const pool = getPool();
    const { rows: ownerRows } = await pool.query(
      `SELECT id, status FROM agent_hub_owners WHERE id = $1`,
      [ownerId]
    );
    if (!ownerRows.length || ownerRows[0].status === "deleted") {
      res.status(400).json({ error: "Owner does not exist." });
      return;
    }

    const cols = Object.keys(updates);
    const vals = cols.map((k) => updates[k]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    cols.push("created_by", "updated_by");
    placeholders.push(`$${vals.length + 1}`, `$${vals.length + 1}`);
    vals.push(req.user.id);

    const { rows } = await pool.query(
      `INSERT INTO agent_hub_properties (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      vals
    );
    await logAudit(req, {
      entity_type: "property",
      entity_id: rows[0].id,
      action: "create",
      new_value: { address_1: rows[0].address_1, owner_id: ownerId },
    });
    res.status(201).json({ property: mapProperty(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] property create", e);
    res.status(500).json({ error: "Could not create property." });
  }
}

export async function updateProperty(req, res) {
  try {
    const id = vIntId(req.params.id, "property id");
    const body = req.body ?? {};
    const updates = {};
    for (const [k, fn] of Object.entries(ALLOWED_FIELDS)) {
      if (body[k] !== undefined) updates[k] = fn(body[k]);
    }
    if (body.status !== undefined) {
      assertManagerRole(req.agentHubPerms);
      const s = vPropertyStatus(body.status, { allowNull: false });
      if (s === "deleted") {
        res.status(400).json({ error: "Use DELETE to soft-delete a property." });
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
      `SELECT * FROM agent_hub_properties WHERE id = $1`,
      [id]
    );
    if (!oldRows.length || oldRows[0].status === "deleted") {
      res.status(404).json({ error: "Property not found." });
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
      `UPDATE agent_hub_properties SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "property", id, oldRows[0], rows[0], Object.keys(updates));
    res.json({ property: mapProperty(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] property update", e);
    res.status(500).json({ error: "Could not update property." });
  }
}

export async function deleteProperty(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "property id");
    const pool = getPool();
    const { rows: blockers } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM agent_hub_referrals r
            WHERE r.property_id = $1
              AND r.stage NOT IN ('lost','declined')) AS active_referrals,
         (SELECT status FROM agent_hub_properties WHERE id = $1) AS current_status`,
      [id]
    );
    if (blockers[0].active_referrals > 0 || blockers[0].current_status === "under_management") {
      res.status(409).json({
        error: "Property is under management or has active referrals.",
        active_referrals: blockers[0].active_referrals,
        current_status: blockers[0].current_status,
      });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE agent_hub_properties SET status = 'deleted', updated_by = $2
        WHERE id = $1 AND status != 'deleted'`,
      [id, req.user.id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Property not found or already deleted." });
      return;
    }
    await logAudit(req, { entity_type: "property", entity_id: id, action: "delete" });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] property delete", e);
    res.status(500).json({ error: "Could not delete property." });
  }
}
