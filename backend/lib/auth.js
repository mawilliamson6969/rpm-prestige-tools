import jwt from "jsonwebtoken";
import { getPool } from "./db.js";

export function getBearerToken(req) {
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}

function jwtSecret() {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) return null;
  return s;
}

export function signUserToken(user) {
  const secret = jwtSecret();
  if (!secret) {
    const err = new Error("JWT_SECRET is not configured.");
    err.code = "JWT_CONFIG";
    throw err;
  }
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      displayName: user.display_name ?? user.displayName,
    },
    secret,
    { expiresIn: "24h" }
  );
}

export function verifyUserToken(token) {
  const secret = jwtSecret();
  if (!secret) {
    const err = new Error("JWT_SECRET is not configured.");
    err.code = "JWT_CONFIG";
    throw err;
  }
  return jwt.verify(token, secret);
}

function verifyTokenAndAttachUser(req, res, token) {
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return false;
  }
  try {
    const payload = verifyUserToken(token);
    req.user = {
      id: Number(payload.sub),
      username: payload.username,
      role: payload.role,
      displayName: payload.displayName,
    };
    return true;
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
    return false;
  }
}

/**
 * Attaches req.user = { id, username, role, displayName } from JWT.
 * Rejects deactivated users so a revoked account stops being able to act on
 * its old token without waiting for the 24h JWT TTL.
 */
export async function requireAuth(req, res, next) {
  if (!verifyTokenAndAttachUser(req, res, getBearerToken(req))) return;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT active, role FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length || rows[0].active === false) {
      res.status(401).json({ error: "Account is inactive." });
      return;
    }
    // Trust the live DB row over the JWT for role — admins can change a role
    // mid-session and we want it to take effect on the next request.
    req.user.role = rows[0].role;
  } catch {
    // If the DB is unreachable we let the JWT-only check stand rather than
    // black-holing the whole API. Mutating endpoints will fail naturally.
  }
  next();
}

/**
 * Same as {@link requireAuth} but also accepts `?token=` (JWT) for routes the browser loads
 * without an Authorization header (e.g. HTML5 video, img src). Header wins when both are sent.
 */
export async function requireAuthOrQueryToken(req, res, next) {
  let token = getBearerToken(req);
  if (!token) {
    const q = req.query?.token;
    token = typeof q === "string" ? q.trim() : Array.isArray(q) && typeof q[0] === "string" ? q[0].trim() : "";
  }
  if (!verifyTokenAndAttachUser(req, res, token)) return;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT active, role FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length || rows[0].active === false) {
      res.status(401).json({ error: "Account is inactive." });
      return;
    }
    req.user.role = rows[0].role;
  } catch {
    // See requireAuth.
  }
  next();
}

/**
 * Legacy admin gate. Maps to the new permission model: admin/owner roles get
 * the synthetic 'all' permission, so any role with 'all' passes.
 */
export function requireAdminRole(req, res, next) {
  const role = req.user?.role;
  if (role !== "admin" && role !== "owner") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
}

/**
 * Permission-gated middleware. Resolves permission from the role_permissions
 * table at request time, so role/permission edits take effect immediately.
 *
 *   app.delete('/inbox/threads/:id', requireAuth, requirePermission('inbox.delete'), handler)
 */
export function requirePermission(perm) {
  if (!perm || typeof perm !== "string") {
    throw new Error("requirePermission(perm) requires a non-empty permission string.");
  }
  return async function requirePermissionMiddleware(req, res, next) {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT user_has_permission($1::int, $2::text) AS ok`,
        [userId, perm]
      );
      if (!rows[0]?.ok) {
        res.status(403).json({ error: "Forbidden.", missing: perm });
        return;
      }
      next();
    } catch (e) {
      console.error("requirePermission failed", e);
      res.status(500).json({ error: "Permission check failed." });
    }
  };
}

/** Loads permissions array for a user. */
export async function getUserPermissions(userId) {
  if (!Number.isFinite(userId)) return [];
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT DISTINCT rp.permission
       FROM users u
       JOIN role_permissions rp ON rp.role = u.role
       WHERE u.id = $1 AND u.active = TRUE`,
      [userId]
    );
    return rows.map((r) => r.permission);
  } catch {
    return [];
  }
}
