import { getPool } from "../db.js";

const ORDER = { read: 1, reply: 2, admin: 3 };

/**
 * @param {import("pg").Pool} pool
 * @param {number} userId
 * @returns {Promise<number[]>}
 */
export async function getAllowedConnectionIds(pool, userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ip.connection_id AS id
     FROM inbox_permissions ip
     JOIN email_connections ec ON ec.id = ip.connection_id AND ec.is_active = true
     WHERE ip.user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.id);
}

/**
 * @param {import("pg").Pool} pool
 * @param {number} userId
 * @param {number} connectionId
 * @returns {Promise<"read"|"reply"|"admin"|null>}
 */
export async function getUserPermissionOnConnection(pool, userId, connectionId) {
  const { rows } = await pool.query(
    `SELECT ip.permission
     FROM inbox_permissions ip
     JOIN email_connections ec ON ec.id = ip.connection_id AND ec.is_active = true
     WHERE ip.user_id = $1 AND ip.connection_id = $2`,
    [userId, connectionId]
  );
  const p = rows[0]?.permission;
  if (p === "read" || p === "reply" || p === "admin") return p;
  return null;
}

export function permissionAtLeast(have, need) {
  if (!have || !need) return false;
  return (ORDER[have] || 0) >= (ORDER[need] || 0);
}

/**
 * @param {import("pg").Pool} pool
 * @param {number} userId
 * @param {number} connectionId
 */
export async function assertInboxAdminOnConnection(pool, userId, connectionId) {
  const p = await getUserPermissionOnConnection(pool, userId, connectionId);
  if (p !== "admin") {
    const err = new Error("Admin permission on this mailbox is required.");
    err.code = "FORBIDDEN";
    throw err;
  }
}
