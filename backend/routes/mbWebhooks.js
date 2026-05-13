/**
 * AppFolio webhook receiver (skeleton).
 *
 * Phase 1: log the envelope to mb_webhook_events, return 200 immediately
 * so AppFolio doesn't retry, then hand off to an async processor stub.
 *
 * TODO Phase 2:
 *   * Verify the X-JWS-Signature header against the public key once we
 *     install a JWS library. Until then we store the signature as-is so
 *     it can be verified retroactively.
 *   * Wire processWebhookEvent() to route by topic/event_type into the
 *     mirror-to-mb_items sync layer.
 *
 * Why log-first, process-async:
 *   AppFolio's webhook contract is "must 200 within ~5s or we retry."
 *   Doing any heavy work synchronously risks duplicate deliveries — the
 *   safe pattern is to take delivery first, work later.
 */

import { getPool } from "../lib/db.js";

function extractMeta(payload) {
  if (!payload || typeof payload !== "object") return { topic: null, event: null, resourceId: null };
  return {
    topic: payload.topic ?? payload.event_topic ?? null,
    event: payload.event_type ?? payload.event ?? payload.type ?? null,
    resourceId:
      payload.resource_id != null
        ? String(payload.resource_id)
        : payload.id != null
        ? String(payload.id)
        : null,
  };
}

export async function receiveAppfolioWebhook(req, res) {
  // Acknowledge immediately. Any failure during logging is investigated
  // later via metrics, not by making AppFolio retry.
  res.status(200).json({ ok: true });

  const payload = req.body ?? {};
  const signature = req.headers["x-jws-signature"] || req.headers["x-appfolio-signature"] || null;
  const { topic, event, resourceId } = extractMeta(payload);

  let eventId = null;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO mb_webhook_events
         (topic, event_type, resource_id, payload, signature)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       RETURNING id`,
      [
        topic,
        event,
        resourceId,
        JSON.stringify(payload),
        typeof signature === "string" ? signature.slice(0, 4096) : null,
      ]
    );
    eventId = rows[0].id;
  } catch (e) {
    console.error("[mb webhook] persist failed", e.message);
    return;
  }

  // Fire-and-forget the processor. It will mark processed_at on success
  // and process_error on failure.
  processWebhookEvent(eventId, { topic, event, resourceId, payload }).catch((e) => {
    console.error("[mb webhook] processor crashed", e);
  });
}

/**
 * Phase 1 stub. Phase 2 will:
 *   1. Verify the JWS signature.
 *   2. Look up the corresponding mb_items row (by appfolio_id +
 *      appfolio_resource_type) and merge in the changed fields.
 *   3. Append an item update of type 'appfolio_sync' summarizing the
 *      change.
 *   4. Mark processed_at, or process_error if anything failed.
 */
async function processWebhookEvent(eventId, _event) {
  if (!eventId) return;
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE mb_webhook_events
          SET processed_at = NOW(),
              process_error = 'phase1_stub: persisted only, not yet routed'
        WHERE id = $1`,
      [eventId]
    );
  } catch (e) {
    console.error("[mb webhook] stub marker failed", e.message);
  }
}
