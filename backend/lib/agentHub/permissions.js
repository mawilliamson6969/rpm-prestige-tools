/**
 * Agent Hub permission middleware.
 *
 * The Hub has its own permission layer ON TOP of the global JWT auth.
 * A user with a valid JWT but no row in agent_hub_user_permissions has
 * NO Hub access (not even read). Owners (req.user.role === 'owner' or
 * 'admin') are auto-granted everything if a row is missing.
 *
 * Routes mount with:
 *   requireAuth, requireAgentHubAccess, [requirePermission(flag)], handler
 *
 * Server-side enforcement is the source of truth. Frontend gating is
 * UX only — never trust client-side flags.
 */

import { getPool } from "../db.js";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/**
 * Loads the user's Hub permissions row and attaches to req.agentHubPerms.
 * Returns 403 if no row exists (and user is not a global admin/owner).
 */
export async function requireAgentHubAccess(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT user_id, role,
              can_view_personal_details, can_change_tier, can_mark_dnc,
              can_export, can_merge, assigned_agent_ids
         FROM agent_hub_user_permissions
        WHERE user_id = $1`,
      [req.user.id]
    );
    if (rows.length) {
      req.agentHubPerms = rows[0];
      next();
      return;
    }
    // No row. Auto-grant for global owner/admin so they're never locked out.
    if (ADMIN_ROLES.has(req.user.role)) {
      req.agentHubPerms = {
        user_id: req.user.id,
        role: "owner",
        can_view_personal_details: true,
        can_change_tier: true,
        can_mark_dnc: true,
        can_export: true,
        can_merge: true,
        assigned_agent_ids: null,
        synthetic: true,
      };
      next();
      return;
    }
    res.status(403).json({ error: "No Agent Hub access. Ask Mike or Lori to grant access." });
  } catch (e) {
    console.error("[agent-hub] permission check", e);
    res.status(500).json({ error: "Permission check failed." });
  }
}

/**
 * Returns a middleware that enforces a specific permission flag.
 * Usage: requirePermission('can_change_tier')
 */
export function requirePermission(flag) {
  return function (req, res, next) {
    const perms = req.agentHubPerms;
    if (!perms) {
      res.status(500).json({ error: "Permission middleware misconfigured (missing requireAgentHubAccess)." });
      return;
    }
    if (perms[flag] === true) {
      next();
      return;
    }
    res.status(403).json({ error: `Missing permission: ${flag}.` });
  };
}

/**
 * Owner/manager-only gate. Used for the settings page and bulk ops
 * that aren't covered by a single can_* flag.
 */
export function requireManagerRole(req, res, next) {
  const perms = req.agentHubPerms;
  if (!perms) {
    res.status(500).json({ error: "Permission middleware misconfigured." });
    return;
  }
  if (perms.role === "owner" || perms.role === "manager") {
    next();
    return;
  }
  res.status(403).json({ error: "Manager or owner role required." });
}

/**
 * For 'outreach' role: filter agent IDs the user is allowed to see.
 * Returns an array of allowed agent IDs, or null = unrestricted.
 */
export function allowedAgentIdsFor(perms) {
  if (!perms) return [];
  if (perms.role === "outreach") {
    return Array.isArray(perms.assigned_agent_ids) ? perms.assigned_agent_ids : [];
  }
  return null;
}

/**
 * Helper: throw a 403 if the perms row does not have the flag.
 * Use inside route handlers for fine-grained checks within a single endpoint.
 */
export function assertPermission(perms, flag) {
  if (!perms || perms[flag] !== true) {
    throw Object.assign(new Error(`Missing permission: ${flag}.`), { http: 403 });
  }
}

/**
 * Helper: assert user is owner/manager.
 */
export function assertManagerRole(perms) {
  if (!perms || (perms.role !== "owner" && perms.role !== "manager")) {
    throw Object.assign(new Error("Manager or owner role required."), { http: 403 });
  }
}
