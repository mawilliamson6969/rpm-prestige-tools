/**
 * AppFolio webhook processor (Phase 3.5).
 *
 * Every 15 seconds: claim unprocessed rows from appfolio.webhook_events
 * and turn them into work:
 *
 *   - Topics that map to a mirrored resource (Properties / Units /
 *     Tenants / Leases, tolerantly normalized) trigger ONE delta sync
 *     per resource per tick — a burst of 40 tenant webhooks coalesces
 *     into a single fetch. The sync's per-resource advisory lock makes
 *     concurrent/scheduled runs safe; when the lock is held the events
 *     stay unprocessed and the next tick retries (the lock clears in
 *     seconds).
 *   - Every processed event (mapped, work-order, or unknown topic)
 *     emits appfolio.webhook.<topic_snake_case> to the Prestige Connect
 *     bus with { topic, receivedAt, raw } and gets processed_at
 *     stamped. Unknown topics log a warning once per topic per process.
 *   - A delta-sync FAILURE (not lock contention) still emits + stamps:
 *     the doorbell's job is notification; the Phase 3 polling sync is
 *     the reconciliation layer and will catch the data up.
 *
 * Enabled only when APPFOLIO_WEBHOOK_TOKEN is set — without the token
 * the receiver 404s, so there is nothing to process.
 */

import { syncResource } from "./appfolio-db-sync.js";

const TICK_MS = 15_000;
const CLAIM_BATCH = 200;

// Lazy imports (see appfolio-db-sync.js for reasoning).
let _getPool = null;
async function resolvePool(injected) {
  if (injected) return injected;
  if (!_getPool) {
    const m = await import("../lib/db.js");
    _getPool = m.getPool;
  }
  return _getPool();
}
let _emitEvent = null;
async function resolveEmitter(injected) {
  if (injected) return injected;
  if (!_emitEvent) {
    const m = await import("../lib/eventBus.js");
    _emitEvent = m.emitEvent;
  }
  return _emitEvent;
}

/**
 * Topic → mirrored resource. Tolerant: case/space/underscore-insensitive,
 * singular or plural ("Tenants", "tenant", "TENANT_UPDATED" all reach
 * tenants… the last via prefix match on the normalized form).
 * Returns null for everything else (work orders, unknown topics).
 */
export function topicToResource(topic) {
  if (!topic) return null;
  const norm = String(topic).toLowerCase().replace(/[^a-z]/g, "");
  for (const [stem, resource] of [
    ["properties", "properties"],
    ["property", "properties"],
    ["units", "units"],
    ["unit", "units"],
    ["tenants", "tenants"],
    ["tenant", "tenants"],
    ["leases", "leases"],
    ["lease", "leases"],
  ]) {
    if (norm === stem || norm.startsWith(stem)) return resource;
  }
  return null;
}

/** "Work Orders" → work_orders; null/empty → "unknown". */
export function topicToEventSuffix(topic) {
  const snake = String(topic ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return snake || "unknown";
}

const warnedTopics = new Set();

/**
 * One tick, with injectable deps for the harness.
 * Returns { claimed, processed, deferred, syncedResources }.
 */
export async function processWebhookTick(opts = {}) {
  const pool = await resolvePool(opts.pool);
  const emit = await resolveEmitter(opts.emitEvent);
  const runDelta = opts.syncResource || syncResource;

  const { rows: events } = await pool.query(
    `SELECT id, received_at, topic, raw_payload
       FROM appfolio.webhook_events
      WHERE processed_at IS NULL
      ORDER BY received_at ASC
      LIMIT $1`,
    [CLAIM_BATCH]
  );
  if (!events.length) return { claimed: 0, processed: 0, deferred: 0, syncedResources: [] };

  // Coalesce: one delta per distinct resource per tick, regardless of
  // how many webhooks arrived for it.
  const byResource = new Map(); // resource -> events[]
  const passthrough = []; // no-fetch topics (work orders, unknown, ...)
  for (const ev of events) {
    const resource = topicToResource(ev.topic);
    if (resource) {
      if (!byResource.has(resource)) byResource.set(resource, []);
      byResource.get(resource).push(ev);
    } else {
      passthrough.push(ev);
    }
  }

  const toStamp = [];
  const deferredIds = [];
  const syncedResources = [];

  for (const [resource, group] of byResource) {
    try {
      const r = await runDelta(resource, { mode: "delta", pool, emitEvent: emit });
      if (r?.lockSkipped) {
        // Another sync holds the lock — leave the whole group for the
        // next tick rather than emitting ahead of the data.
        deferredIds.push(...group.map((e) => e.id));
        continue;
      }
      syncedResources.push(resource);
    } catch (err) {
      // Fetch failed: the polling layer reconciles; the doorbell still
      // rings. recordFailure inside syncResource already tracked it.
      console.error(
        `[appfolio-webhook] delta for ${resource} failed (events still emitted):`,
        err.message || err
      );
      syncedResources.push(`${resource} (sync failed)`);
    }
    toStamp.push(...group);
  }
  toStamp.push(...passthrough);

  for (const ev of toStamp) {
    if (topicToResource(ev.topic) === null && !warnedTopics.has(ev.topic ?? "(none)")) {
      warnedTopics.add(ev.topic ?? "(none)");
      console.warn(
        `[appfolio-webhook] topic ${ev.topic ? `"${ev.topic}"` : "(none — extraction failed)"} has no resource mapping; emitting + stamping only (logged once per topic).`
      );
    }
    await emit({
      type: `appfolio.webhook.${topicToEventSuffix(ev.topic)}`,
      source: "appfolio-webhook",
      payload: {
        topic: ev.topic ?? null,
        receivedAt: ev.received_at instanceof Date ? ev.received_at.toISOString() : ev.received_at,
        raw: ev.raw_payload ?? null,
      },
    });
  }

  if (toStamp.length) {
    await pool.query(
      `UPDATE appfolio.webhook_events SET processed_at = NOW() WHERE id = ANY($1::int[])`,
      [toStamp.map((e) => e.id)]
    );
  }

  return {
    claimed: events.length,
    processed: toStamp.length,
    deferred: deferredIds.length,
    syncedResources,
  };
}

let ticking = false;

/**
 * Wire the 15-second tick. Called once from index.js start(). Returns
 * true when started, false when disabled (after logging why).
 */
export function ensureAppfolioWebhookProcessing() {
  if (!process.env.APPFOLIO_WEBHOOK_TOKEN?.trim()) {
    console.log(
      "[appfolio-webhook] APPFOLIO_WEBHOOK_TOKEN not set — receiver 404s and the processor stays off."
    );
    return false;
  }
  setInterval(() => {
    if (ticking) return; // reentrancy guard: a slow tick must not stack
    ticking = true;
    processWebhookTick()
      .then((r) => {
        if (r.claimed > 0) {
          console.log(
            `[appfolio-webhook] tick: ${r.processed} processed, ${r.deferred} deferred${r.syncedResources.length ? ` | delta: ${r.syncedResources.join(", ")}` : ""}`
          );
        }
      })
      .catch((err) => console.error("[appfolio-webhook] tick failed:", err.message || err))
      .finally(() => {
        ticking = false;
      });
  }, TICK_MS);
  console.log(`[appfolio-webhook] processor scheduled every ${TICK_MS / 1000}s.`);
  return true;
}
