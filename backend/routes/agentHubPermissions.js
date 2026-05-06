/**
 * Phase 1 Agent Hub: permissions settings (owner/manager only).
 *
 * The Hub permissions table is the source of truth for who can do what.
 * Mike + Lori are seeded by the migration; this endpoint lets them grant/
 * revoke access for additional team members and (future) outreach VAs.
 *
 * Note: granting/revoking does NOT touch the global users.role — Hub access
 * is layered ON TOP of global auth. Removing a Hub permission row just
 * locks the user out of /agent-hub/*; their other access is unaffected.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapHubPermissions } from "../lib/agentHub/mappers.js";
import { vBool, vHubRole, vIntId } from "../lib/agentHub/validators.js";

export async function listAgentHubPermissions(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.*, u.username, u.display_name
         FROM agent_hub_user_permissions p
         JOIN users u ON u.id = p.user_id
        ORDER BY p.role DESC, LOWER(u.display_name) ASC`
    );
    // Also list users without a permission row, so settings UI can show them.
    const { rows: noAccess } = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.role
         FROM users u
         LEFT JOIN agent_hub_user_permissions p ON p.user_id = u.id
        WHERE u.active = TRUE
          AND p.user_id IS NULL
        ORDER BY LOWER(u.display_name) ASC`
    );
    res.json({
      permissions: rows.map(mapHubPermissions),
      users_without_access: noAccess,
    });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] permissions list", e);
    res.status(500).json({ error: "Could not load permissions." });
  }
}

export async function upsertAgentHubPermissions(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const userId = vIntId(req.params.user_id, "user_id");
    const body = req.body ?? {};

    // Disallow operating on yourself? Allow for owner, but block managers
    // from elevating themselves.
    if (userId === req.user.id && req.agentHubPerms.role === "manager" && body.role === "owner") {
      res.status(403).json({ error: "Managers cannot promote themselves to owner." });
      return;
    }

    const updates = {};
    if (body.role !== undefined) updates.role = vHubRole(body.role);
    for (const flag of [
      "can_view_personal_details",
      "can_change_tier",
      "can_mark_dnc",
      "can_export",
      "can_merge",
    ]) {
      if (body[flag] !== undefined) {
        updates[flag] = vBool(body[flag], { allowNull: false });
      }
    }
    if (body.assigned_agent_ids !== undefined) {
      if (body.assigned_agent_ids === null) {
        updates.assigned_agent_ids = null;
      } else if (Array.isArray(body.assigned_agent_ids)) {
        updates.assigned_agent_ids = body.assigned_agent_ids
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0);
      }
    }

    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT * FROM agent_hub_user_permissions WHERE user_id = $1`,
      [userId]
    );

    if (!existing.length) {
      // Insert with defaults for any fields not provided.
      const cols = ["user_id"];
      const vals = [userId];
      for (const k of Object.keys(updates)) {
        cols.push(k);
        vals.push(updates[k]);
      }
      const placeholders = cols.map((k, i) => {
        if (k === "assigned_agent_ids") return `$${i + 1}::int[]`;
        return `$${i + 1}`;
      });
      const { rows } = await pool.query(
        `INSERT INTO agent_hub_user_permissions (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        vals
      );
      await logAudit(req, {
        entity_type: "permissions",
        entity_id: userId,
        action: "permission_change",
        new_value: updates,
      });
      res.status(201).json({ permissions: mapHubPermissions(rows[0]) });
      return;
    }

    if (!Object.keys(updates).length) {
      res.json({ permissions: mapHubPermissions(existing[0]) });
      return;
    }

    const sets = [];
    const vals = [];
    let n = 1;
    for (const k of Object.keys(updates)) {
      if (k === "assigned_agent_ids") {
        sets.push(`${k} = $${n}::int[]`);
        vals.push(updates[k]);
      } else {
        sets.push(`${k} = $${n}`);
        vals.push(updates[k]);
      }
      n++;
    }
    vals.push(userId);
    const { rows } = await pool.query(
      `UPDATE agent_hub_user_permissions SET ${sets.join(", ")} WHERE user_id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "permissions", userId, existing[0], rows[0], Object.keys(updates));
    res.json({ permissions: mapHubPermissions(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] permissions upsert", e);
    res.status(500).json({ error: "Could not update permissions." });
  }
}

export async function revokeAgentHubAccess(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const userId = vIntId(req.params.user_id, "user_id");
    if (userId === req.user.id) {
      res.status(400).json({ error: "Cannot revoke your own access." });
      return;
    }
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM agent_hub_user_permissions WHERE user_id = $1`,
      [userId]
    );
    if (!rowCount) {
      res.status(404).json({ error: "User has no Hub access." });
      return;
    }
    await logAudit(req, {
      entity_type: "permissions",
      entity_id: userId,
      action: "delete",
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] permissions revoke", e);
    res.status(500).json({ error: "Could not revoke access." });
  }
}

// GET /agent-hub/permissions/me — used by the frontend to know what to show.
export async function getMyHubPermissions(req, res) {
  res.json({
    permissions: req.agentHubPerms
      ? {
          user_id: req.user.id,
          role: req.agentHubPerms.role,
          can_view_personal_details: req.agentHubPerms.can_view_personal_details === true,
          can_change_tier: req.agentHubPerms.can_change_tier === true,
          can_mark_dnc: req.agentHubPerms.can_mark_dnc === true,
          can_export: req.agentHubPerms.can_export === true,
          can_merge: req.agentHubPerms.can_merge === true,
          synthetic: req.agentHubPerms.synthetic === true,
        }
      : null,
  });
}
