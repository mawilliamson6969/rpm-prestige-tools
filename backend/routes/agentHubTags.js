/**
 * Phase 1 Agent Hub: tag CRUD + global tag list.
 *
 * Tags are case-sensitive in storage but compared case-insensitively for
 * dedupe and searching. The unique constraint is on (agent_id, tag) so
 * "VIP" and "vip" can both exist on the same agent (intentional — let users
 * decide their own canonicalization). The tag mgmt UI in /settings can
 * collapse case variants by global rename.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapTag } from "../lib/agentHub/mappers.js";
import { vIntId, vStringReq } from "../lib/agentHub/validators.js";

export async function listGlobalTags(req, res) {
  try {
    const pool = getPool();
    // Outreach role: filter to assigned agents only — counts of tags they
    // can't access would leak the existence of those agents.
    const allowed = allowedAgentIdsFor(req.agentHubPerms);
    const allowedClause = allowed ? `AND a.id = ANY($1::int[])` : "";
    const params = allowed ? [allowed] : [];
    const { rows } = await pool.query(
      `SELECT t.tag, COUNT(*)::int AS count
         FROM agent_hub_tags t
         JOIN agent_hub_agents a ON a.id = t.agent_id
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          ${allowedClause}
        GROUP BY t.tag
        ORDER BY count DESC, LOWER(t.tag) ASC`,
      params
    );
    res.json({ tags: rows.map((r) => ({ tag: r.tag, count: r.count })) });
  } catch (e) {
    console.error("[agent-hub] tags global list", e);
    res.status(500).json({ error: "Could not load tags." });
  }
}

export async function addAgentHubTag(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedIds && !allowedIds.includes(agentId)) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    const tag = vStringReq(req.body?.tag, "tag", { maxLen: 64 });
    const pool = getPool();
    try {
      const { rows } = await pool.query(
        `INSERT INTO agent_hub_tags (agent_id, tag, created_by)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [agentId, tag, req.user.id]
      );
      await logAudit(req, {
        entity_type: "tag",
        entity_id: rows[0].id,
        action: "create",
        new_value: { agent_id: agentId, tag },
      });
      res.status(201).json({ tag: mapTag(rows[0]) });
    } catch (e) {
      if (e.code === "23505") {
        // Already exists. Idempotent: return the existing row.
        const { rows } = await pool.query(
          `SELECT * FROM agent_hub_tags WHERE agent_id = $1 AND tag = $2`,
          [agentId, tag]
        );
        res.status(200).json({ tag: mapTag(rows[0]), idempotent: true });
        return;
      }
      if (e.code === "23503") {
        res.status(404).json({ error: "Agent not found." });
        return;
      }
      throw e;
    }
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] tag add", e);
    res.status(500).json({ error: "Could not add tag." });
  }
}

export async function removeAgentHubTag(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedIds && !allowedIds.includes(agentId)) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    const tag = vStringReq(req.params.tag, "tag", { maxLen: 64 });
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM agent_hub_tags WHERE agent_id = $1 AND tag = $2`,
      [agentId, tag]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Tag not found on this agent." });
      return;
    }
    await logAudit(req, {
      entity_type: "tag",
      entity_id: agentId,
      action: "delete",
      old_value: { agent_id: agentId, tag },
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] tag remove", e);
    res.status(500).json({ error: "Could not remove tag." });
  }
}

// Manager+: rename a tag globally.
export async function renameGlobalTag(req, res) {
  let client = null;
  try {
    assertManagerRole(req.agentHubPerms);
    const oldTag = vStringReq(req.body?.old_tag, "old_tag", { maxLen: 64 });
    const newTag = vStringReq(req.body?.new_tag, "new_tag", { maxLen: 64 });
    if (oldTag === newTag) {
      res.status(400).json({ error: "old_tag and new_tag are identical." });
      return;
    }
    const pool = getPool();
    // Use a single client so BEGIN/COMMIT run on the same connection.
    client = await pool.connect();
    await client.query("BEGIN");
    // Drop oldTag for any agent that already has newTag (avoids unique violation).
    await client.query(
      `DELETE FROM agent_hub_tags
        WHERE tag = $1
          AND agent_id IN (SELECT agent_id FROM agent_hub_tags WHERE tag = $2)`,
      [oldTag, newTag]
    );
    const { rowCount } = await client.query(
      `UPDATE agent_hub_tags SET tag = $1 WHERE tag = $2`,
      [newTag, oldTag]
    );
    await client.query("COMMIT");
    await logAudit(req, {
      entity_type: "tag",
      action: "update",
      field_name: "tag",
      old_value: oldTag,
      new_value: newTag,
      context: { affected: rowCount },
    });
    res.json({ ok: true, renamed: rowCount });
  } catch (e) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] tag rename", e);
    res.status(500).json({ error: "Could not rename tag." });
  } finally {
    if (client) client.release();
  }
}

// Manager+: delete a tag globally (removes from every agent).
export async function deleteGlobalTag(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const tag = vStringReq(req.params.tag, "tag", { maxLen: 64 });
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM agent_hub_tags WHERE tag = $1`, [tag]);
    await logAudit(req, {
      entity_type: "tag",
      action: "delete",
      old_value: { tag },
      context: { affected: rowCount },
    });
    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] tag global delete", e);
    res.status(500).json({ error: "Could not delete tag." });
  }
}
