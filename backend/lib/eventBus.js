/**
 * Prestige Connect event bus — write side.
 *
 * Every source of events (webhook handlers + internal emitters from
 * routes/services) calls emitEvent(). Rows land in the `events` table
 * pending; the prestige-worker container polls and dispatches matching
 * automations.
 *
 * The (source, type, external_id) unique index makes webhook retries
 * idempotent. We swallow 23505 dedupe collisions silently.
 */

import { getPool } from "./db.js";

/**
 * Insert a pending event. Safe to call from any request handler —
 * returns the new event id, or null when a duplicate (source, type,
 * external_id) was skipped.
 *
 * Errors are logged but never thrown so an upstream business path
 * (form submission, card move) is never blocked by the event bus.
 */
export async function emitEvent({ type, source = "internal", payload = {}, externalId = null } = {}) {
  if (!type || typeof type !== "string") {
    console.warn("[eventBus] emitEvent called without a type — ignored");
    return null;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO events (type, source, payload, external_id)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (source, type, external_id)
         WHERE external_id IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [type, source, JSON.stringify(payload ?? {}), externalId]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error("[eventBus] emit failed:", err.message || err);
    return null;
  }
}
