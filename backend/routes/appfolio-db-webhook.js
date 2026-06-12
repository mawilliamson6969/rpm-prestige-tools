/**
 * AppFolio Database API webhook receiver (Phase 3.5).
 *
 * POST /webhooks/appfolio-db/:token
 *
 * Doorbell model: this endpoint does the absolute minimum — validate the
 * URL token, store the raw payload in appfolio.webhook_events (dedupe on
 * the best available key), 200. Total handler time is milliseconds; all
 * real work happens in services/appfolio-webhook-processor.js on a
 * 15-second tick. Payload fields are never trusted for anything beyond
 * topic extraction and the raw audit record.
 *
 * Auth: shared token in the URL path, compared (constant-time) against
 * APPFOLIO_WEBHOOK_TOKEN. Unset env or wrong token both 404 — the
 * endpoint should be indistinguishable from a missing route to anyone
 * without the token. Signature verification is a follow-up once
 * AppFolio's signing scheme is known.
 *
 * Distinct from routes' receiveMbAppfolioWebhook (/webhooks/appfolio),
 * which belongs to the older mb_* work-order flow and is untouched.
 */

import crypto from "node:crypto";

// Lazy pool import so the core stays loadable in offline harnesses.
let _getPool = null;
async function resolvePool(injected) {
  if (injected) return injected;
  if (!_getPool) {
    const m = await import("../lib/db.js");
    _getPool = m.getPool;
  }
  return _getPool();
}

const MAX_BODY_BYTES = 100 * 1024; // reject anything bigger — webhooks are small

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Tolerant topic extraction. AppFolio's delivery format is unknown until
 * the first real webhook arrives, so check the shapes providers commonly
 * use. Returns null when nothing matches — the event is still stored.
 */
export function extractTopic(body, headers = {}) {
  if (body && typeof body === "object") {
    const candidates = [
      body.topic,
      body.Topic,
      body.event_type,
      body.eventType,
      body.EventType,
      body.event,
      body.Event,
      body.type,
      body.Type,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
  }
  const headerTopic =
    headers["x-appfolio-topic"] ||
    headers["x-appfolio-event"] ||
    headers["x-webhook-topic"];
  if (typeof headerTopic === "string" && headerTopic.trim()) return headerTopic.trim();
  return null;
}

/** Provider event id when present; null otherwise. */
function extractProviderEventId(body) {
  if (!body || typeof body !== "object") return null;
  const candidates = [
    body.event_id,
    body.eventId,
    body.EventId,
    body.delivery_id,
    body.deliveryId,
    body.DeliveryId,
    body.webhook_id,
    body.WebhookId,
    body.id,
    body.Id,
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c).trim()) return String(c).trim();
  }
  return null;
}

/**
 * Dedupe key: provider event id when the payload has one, else
 * sha256(topic + payload + minute bucket) — close-together identical
 * retries collapse, while a legitimately repeated topic later on
 * doesn't.
 */
export function buildDedupeKey(topic, body, receivedAtMs) {
  const providerId = extractProviderEventId(body);
  if (providerId) return `id:${providerId}`;
  const minuteBucket = Math.floor(receivedAtMs / 60_000);
  const hash = crypto
    .createHash("sha256")
    .update(`${topic ?? ""}|${JSON.stringify(body ?? null)}|${minuteBucket}`)
    .digest("hex");
  return `hash:${hash}`;
}

/**
 * Transport-agnostic core (the harness drives this directly).
 * Returns { status, body } for the wrapper to send.
 */
export async function handleAppfolioDbWebhook({
  paramToken,
  body,
  headers = {},
  contentLength = null,
  pool: injectedPool,
  nowMs = Date.now(),
}) {
  const expected = process.env.APPFOLIO_WEBHOOK_TOKEN?.trim();
  // Unset env = endpoint doesn't exist. Wrong token = same answer, so
  // probing can't distinguish the two.
  if (!expected) return { status: 404, body: { error: "Not found" } };
  if (!paramToken || !constantTimeEqual(paramToken, expected)) {
    return { status: 404, body: { error: "Not found" } };
  }

  const declared = Number(contentLength);
  const serialized = JSON.stringify(body ?? null);
  if (
    (Number.isFinite(declared) && declared > MAX_BODY_BYTES) ||
    serialized.length > MAX_BODY_BYTES
  ) {
    return { status: 413, body: { error: "Payload too large" } };
  }

  const topic = extractTopic(body, headers);
  const dedupeKey = buildDedupeKey(topic, body, nowMs);

  const pool = await resolvePool(injectedPool);
  await pool.query(
    `INSERT INTO appfolio.webhook_events (topic, raw_payload, dedupe_key)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [topic, serialized, dedupeKey]
  );

  // 200 whether stored or deduped — either way the provider should stop
  // retrying.
  return { status: 200, body: { ok: true } };
}

/** Express handler. */
export async function receiveAppfolioDbWebhook(req, res) {
  try {
    const result = await handleAppfolioDbWebhook({
      paramToken: req.params?.token,
      body: req.body,
      headers: req.headers || {},
      contentLength: req.headers?.["content-length"] ?? null,
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    // Storage failure: 500 so AppFolio retries later — the dedupe key
    // makes the retry safe.
    console.error("[appfolio-webhook] receive failed:", err.message || err);
    res.status(500).json({ error: "Internal error" });
  }
}
