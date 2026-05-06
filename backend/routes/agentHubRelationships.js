/**
 * Phase 1 Agent Hub: agent-to-agent relationships.
 *
 * Directed: agent_a is the subject, agent_b is the object.
 * - Symmetric types (team, spouse, friend, competitor): a single row covers both.
 * - Asymmetric types (mentor / mentee): direction matters. Use 'mentor' to say
 *   A mentors B; the reverse query exposes that as "B has mentor A".
 *
 * The list endpoint always returns rows where THIS agent is on either side,
 * so the UI can render both sides without making two queries.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor } from "../lib/agentHub/permissions.js";
import { mapRelationship } from "../lib/agentHub/mappers.js";
import { vIntId, vRelationshipType, vStringOpt } from "../lib/agentHub/validators.js";

export async function listAgentHubRelationships(req, res) {
  try {
    const id = vIntId(req.params.id, "agent id");
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedIds && !allowedIds.includes(id)) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
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
    res.json({ relationships: rows.map(mapRelationship) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] relationships list", e);
    res.status(500).json({ error: "Could not load relationships." });
  }
}

export async function createAgentHubRelationship(req, res) {
  try {
    const agentAId = vIntId(req.params.id, "agent_a_id");
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedIds && !allowedIds.includes(agentAId)) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    const body = req.body ?? {};
    const agentBId = vIntId(body.agent_b_id, "agent_b_id");
    if (agentAId === agentBId) {
      res.status(400).json({ error: "An agent cannot have a relationship with themselves." });
      return;
    }
    const relationshipType = vRelationshipType(body.relationship_type);
    const notes = vStringOpt(body.notes, { maxLen: 1000 });

    const pool = getPool();
    const { rows: bRows } = await pool.query(
      `SELECT id, status FROM agent_hub_agents WHERE id = $1`,
      [agentBId]
    );
    if (!bRows.length || bRows[0].status === "deleted") {
      res.status(400).json({ error: "agent_b does not exist or is deleted." });
      return;
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO agent_hub_relationships
           (agent_a_id, agent_b_id, relationship_type, notes, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [agentAId, agentBId, relationshipType, notes, req.user.id]
      );
      await logAudit(req, {
        entity_type: "relationship",
        entity_id: rows[0].id,
        action: "create",
        new_value: { agent_a_id: agentAId, agent_b_id: agentBId, relationship_type: relationshipType },
      });
      res.status(201).json({ relationship: mapRelationship(rows[0]) });
    } catch (e) {
      if (e.code === "23505") {
        // Already exists; idempotent
        const { rows } = await pool.query(
          `SELECT * FROM agent_hub_relationships
            WHERE agent_a_id = $1 AND agent_b_id = $2 AND relationship_type = $3`,
          [agentAId, agentBId, relationshipType]
        );
        res.status(200).json({ relationship: mapRelationship(rows[0]), idempotent: true });
        return;
      }
      throw e;
    }
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] relationship create", e);
    res.status(500).json({ error: "Could not create relationship." });
  }
}

export async function deleteAgentHubRelationship(req, res) {
  try {
    const id = vIntId(req.params.id, "relationship id");
    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT * FROM agent_hub_relationships WHERE id = $1`,
      [id]
    );
    if (!existing.length) {
      res.status(404).json({ error: "Relationship not found." });
      return;
    }
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (
      allowedIds &&
      !allowedIds.includes(existing[0].agent_a_id) &&
      !allowedIds.includes(existing[0].agent_b_id)
    ) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    await pool.query(`DELETE FROM agent_hub_relationships WHERE id = $1`, [id]);
    await logAudit(req, {
      entity_type: "relationship",
      entity_id: id,
      action: "delete",
      old_value: existing[0],
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] relationship delete", e);
    res.status(500).json({ error: "Could not delete relationship." });
  }
}
