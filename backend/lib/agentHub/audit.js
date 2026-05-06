/**
 * Agent Hub audit logger.
 *
 * Every write that mutates a Hub record should write one or more rows
 * to agent_hub_audit_log. We log per-field for updates so the audit
 * trail can show "Lori changed tier from warm to partner at 2026-01-04".
 *
 * Errors here are logged but do NOT fail the parent request — audit
 * is best-effort. (If we made it strict, an audit failure would block
 * legitimate work; we prefer a missing row over a blocked write.)
 */

import { getPool } from "../db.js";

function getRequestContext(req) {
  if (!req) return null;
  return {
    ip: req.ip || req.headers?.["x-forwarded-for"] || null,
    ua: req.headers?.["user-agent"] || null,
    method: req.method || null,
    path: req.originalUrl || req.url || null,
  };
}

/**
 * Log a single audit row.
 *
 * @param {object} req - Express req (for user_id and context). Pass null in
 *   non-request contexts (cron, scripts) and supply user_id explicitly.
 * @param {object} entry - { entity_type, entity_id, action, field_name?, old_value?, new_value? }
 */
export async function logAudit(req, entry) {
  try {
    const pool = getPool();
    const userId = req?.user?.id || entry.user_id || null;
    const context = entry.context || getRequestContext(req);
    await pool.query(
      `INSERT INTO agent_hub_audit_log
         (user_id, entity_type, entity_id, action, field_name, old_value, new_value, context)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
      [
        userId,
        entry.entity_type,
        entry.entity_id ?? null,
        entry.action,
        entry.field_name ?? null,
        entry.old_value === undefined ? null : JSON.stringify(entry.old_value),
        entry.new_value === undefined ? null : JSON.stringify(entry.new_value),
        context ? JSON.stringify(context) : null,
      ]
    );
  } catch (e) {
    console.error("[agent-hub] audit log write failed", { entry, error: e.message });
  }
}

/**
 * Log multiple field changes at once (one row per field).
 *
 * @param {object} req
 * @param {string} entityType
 * @param {number} entityId
 * @param {object} oldRow
 * @param {object} newRow
 * @param {string[]} fields - Subset of fields to compare. Empty = all fields in newRow.
 */
export async function logFieldDiff(req, entityType, entityId, oldRow, newRow, fields = null) {
  if (!oldRow || !newRow) return;
  const keys = fields && fields.length ? fields : Object.keys(newRow);
  const changes = [];
  for (const k of keys) {
    const ov = oldRow[k];
    const nv = newRow[k];
    // Treat null/undefined as equivalent
    if ((ov ?? null) === (nv ?? null)) continue;
    // Arrays / JSON: shallow JSON-string compare
    if (typeof ov === "object" || typeof nv === "object") {
      if (JSON.stringify(ov ?? null) === JSON.stringify(nv ?? null)) continue;
    }
    changes.push({ field_name: k, old_value: ov ?? null, new_value: nv ?? null });
  }
  if (!changes.length) return;
  // Best-effort: don't await each write to avoid serializing.
  await Promise.all(
    changes.map((c) =>
      logAudit(req, {
        entity_type: entityType,
        entity_id: entityId,
        action: "update",
        field_name: c.field_name,
        old_value: c.old_value,
        new_value: c.new_value,
      })
    )
  );
}
