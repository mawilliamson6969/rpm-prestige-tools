/**
 * Phase 1 Agent Hub: brokerages CRUD.
 *
 * Mounted under /agent-hub/brokerages with requireAuth + requireAgentHubAccess.
 * Mutations require manager+ role (assertManagerRole).
 *
 * Soft-delete: brokerages with linked agents cannot be hard-deleted; the
 * route returns 409 with a list of agent IDs and the caller must reassign
 * before retrying. Setting active=false is the soft-disable path.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapBrokerage } from "../lib/agentHub/mappers.js";
import { vIntId, vStringReq, vStringOpt, vZip } from "../lib/agentHub/validators.js";

export async function listAgentHubBrokerages(req, res) {
  try {
    const pool = getPool();
    const includeInactive = req.query.include_inactive === "true";
    const where = includeInactive ? "" : "WHERE b.active = TRUE";
    const { rows } = await pool.query(
      `SELECT b.*,
              (SELECT COUNT(*)::int
                 FROM agent_hub_agents a
                WHERE a.brokerage_id = b.id
                  AND a.status != 'deleted'
                  AND a.merged_into_agent_id IS NULL) AS agent_count
         FROM agent_hub_brokerages b
         ${where}
        ORDER BY LOWER(b.name) ASC, b.id ASC`
    );
    res.json({ brokerages: rows.map(mapBrokerage) });
  } catch (e) {
    console.error("[agent-hub] brokerages list", e);
    res.status(500).json({ error: "Could not load brokerages." });
  }
}

export async function getAgentHubBrokerage(req, res) {
  try {
    const id = vIntId(req.params.id, "brokerage id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT b.*,
              (SELECT COUNT(*)::int
                 FROM agent_hub_agents a
                WHERE a.brokerage_id = b.id
                  AND a.status != 'deleted'
                  AND a.merged_into_agent_id IS NULL) AS agent_count
         FROM agent_hub_brokerages b
        WHERE b.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Brokerage not found." });
      return;
    }
    // Also return the agents at this brokerage (lite payload).
    const { rows: agents } = await pool.query(
      `SELECT id, full_name, tier, status, last_interaction_date
         FROM agent_hub_agents
        WHERE brokerage_id = $1 AND status != 'deleted' AND merged_into_agent_id IS NULL
        ORDER BY last_interaction_date DESC NULLS LAST, full_name ASC`,
      [id]
    );
    res.json({ brokerage: mapBrokerage(rows[0]), agents });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] brokerage get", e);
    res.status(500).json({ error: "Could not load brokerage." });
  }
}

export async function createAgentHubBrokerage(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const body = req.body ?? {};
    const name = vStringReq(body.name, "name", { maxLen: 200 });
    const address_1 = vStringOpt(body.address_1);
    const address_2 = vStringOpt(body.address_2);
    const city = vStringOpt(body.city, { maxLen: 100 });
    const state = vStringOpt(body.state, { maxLen: 50 });
    const zip = body.zip ? vZip(body.zip) : null;
    const phone = vStringOpt(body.phone, { maxLen: 50 });
    const website = vStringOpt(body.website, { maxLen: 500 });
    const mls_office_id = vStringOpt(body.mls_office_id, { maxLen: 100 });
    const notes = vStringOpt(body.notes, { maxLen: 5000 });

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_brokerages
         (name, address_1, address_2, city, state, zip, phone, website,
          mls_office_id, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *`,
      [
        name,
        address_1,
        address_2,
        city,
        state,
        zip,
        phone,
        website,
        mls_office_id,
        notes,
        req.user.id,
      ]
    );
    await logAudit(req, {
      entity_type: "brokerage",
      entity_id: rows[0].id,
      action: "create",
      new_value: { name, city },
    });
    res.status(201).json({ brokerage: mapBrokerage(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "A brokerage with that name already exists in this city." });
      return;
    }
    console.error("[agent-hub] brokerage create", e);
    res.status(500).json({ error: "Could not create brokerage." });
  }
}

export async function updateAgentHubBrokerage(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "brokerage id");
    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;

    const allowed = {
      name: (v) => vStringReq(v, "name", { maxLen: 200 }),
      address_1: (v) => vStringOpt(v),
      address_2: (v) => vStringOpt(v),
      city: (v) => vStringOpt(v, { maxLen: 100 }),
      state: (v) => vStringOpt(v, { maxLen: 50 }),
      zip: (v) => (v ? vZip(v) : null),
      phone: (v) => vStringOpt(v, { maxLen: 50 }),
      website: (v) => vStringOpt(v, { maxLen: 500 }),
      mls_office_id: (v) => vStringOpt(v, { maxLen: 100 }),
      notes: (v) => vStringOpt(v, { maxLen: 5000 }),
      active: (v) => (v === true || v === false ? v : null),
    };

    const updates = {};
    for (const [k, fn] of Object.entries(allowed)) {
      if (body[k] !== undefined) {
        const val = fn(body[k]);
        sets.push(`${k} = $${n++}`);
        vals.push(val);
        updates[k] = val;
      }
    }
    if (!sets.length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(id);

    const pool = getPool();
    const { rows: oldRows } = await pool.query(
      `SELECT * FROM agent_hub_brokerages WHERE id = $1`,
      [id]
    );
    if (!oldRows.length) {
      res.status(404).json({ error: "Brokerage not found." });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE agent_hub_brokerages SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "brokerage", id, oldRows[0], rows[0], Object.keys(updates));
    res.json({ brokerage: mapBrokerage(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "A brokerage with that name already exists in this city." });
      return;
    }
    console.error("[agent-hub] brokerage update", e);
    res.status(500).json({ error: "Could not update brokerage." });
  }
}

export async function deleteAgentHubBrokerage(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "brokerage id");
    const pool = getPool();
    const { rows: linked } = await pool.query(
      `SELECT id, full_name FROM agent_hub_agents
        WHERE brokerage_id = $1 AND status != 'deleted' AND merged_into_agent_id IS NULL
        LIMIT 50`,
      [id]
    );
    if (linked.length) {
      res.status(409).json({
        error:
          "Brokerage has linked agents. Reassign them first, or set active=false instead of deleting.",
        linked_agent_count: linked.length,
        linked_agents: linked.map((r) => ({ id: r.id, full_name: r.full_name })),
      });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE agent_hub_brokerages SET active = FALSE, updated_by = $2 WHERE id = $1`,
      [id, req.user.id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Brokerage not found." });
      return;
    }
    await logAudit(req, {
      entity_type: "brokerage",
      entity_id: id,
      action: "delete",
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] brokerage delete", e);
    res.status(500).json({ error: "Could not delete brokerage." });
  }
}
