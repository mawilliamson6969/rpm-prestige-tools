/**
 * AppFolio Database API → local mirror tables (Phase 2 engine, Phase 3
 * scheduling semantics).
 *
 * Pulls properties / units / tenants / leases through
 * services/appfolio-db-api.js (which owns auth, rate limiting, and retry)
 * and upserts each record into its appfolio.* mirror table
 * (migrations 043–045).
 *
 * Request shape (Phase 3): EVERY list request carries
 * filters[LastUpdatedAtFrom]. The v0 list endpoints for properties /
 * units / tenants require at least one filter (confirmed live — the
 * cause of the first backfill's 400s); /leases doesn't, but gets the
 * same filter for uniformity. Full runs use the epoch; delta runs use
 * the stored high-water mark minus a 15-minute overlap (epoch when no
 * mark exists yet). The Phase 2 400-fallback ladder is retired.
 *
 * Concurrency: every sync run takes a per-resource Postgres advisory
 * lock (session-scoped, on a dedicated client). If the lock is held —
 * scheduled run vs. CLI, or overlapping crons — the run SKIPS that
 * resource and reports it; nothing queues.
 *
 * Deletion detection (Phase 3): rows are never hard-deleted. Upserts
 * clear `missing_since`; the nightly full pass (scheduler) flags rows
 * its successful fetch did not touch by setting `missing_since = NOW()`.
 *
 * Failure events: each resource failure increments
 * appfolio.sync_state.consecutive_failures; at exactly 2 an
 * `appfolio.sync.failed` event is emitted to the Prestige Connect bus.
 * The next success after >= 2 failures emits `appfolio.sync.recovered`
 * with the downtime duration. Any success resets the counter.
 *
 * PII: SCRUB_KEYS are deleted from every record, for every resource,
 * before upsert, and the values are never logged anywhere — not even in
 * debug mode. Do not add logging around the scrub.
 */

import appfolioDbApi from "./appfolio-db-api.js";

// Resource registry. Endpoint paths follow the Database API v0 convention
// of one top-level route per entity.
const RESOURCES = {
  properties: { path: "/properties", table: "appfolio.properties" },
  units: { path: "/units", table: "appfolio.units" },
  tenants: { path: "/tenants", table: "appfolio.tenants" },
  leases: { path: "/leases", table: "appfolio.leases" },
};

const PAGE_SIZE = 500;

// Pagination is defensive: we stop on an EMPTY page rather than a short
// one (a server that clamps page[size] below our ask would otherwise end
// the walk after page 1), and we abort if two consecutive pages start
// with the same id (a server that ignores page[number] would otherwise
// loop forever).
const MAX_PAGES = 10_000;

// Delta runs re-read 15 minutes of history so records updated while a
// sync was in flight are never missed. Upserts make the overlap harmless.
const DELTA_OVERLAP_MS = 15 * 60_000;

// Full runs are "everything since the epoch" — semantically unfiltered,
// but the filter must be present (see header).
const EPOCH = "1970-01-01T00:00:00Z";

// PII that must never reach the mirror. Deleted from every record, for
// every resource, before upsert. The values are never logged anywhere —
// not even in debug mode — so do not add logging around the scrub.
// One-time cleanup of rows mirrored before this existed:
// migrations/044_appfolio_curated_columns.sql.
const SCRUB_KEYS = ["SocialSecurityNumber", "BirthDate"];

function scrubRecord(record) {
  for (const key of SCRUB_KEYS) delete record[key];
  return record;
}

// Lazy pool import: lib/db.js pulls in pg + bcryptjs, which aren't
// available in every context this module loads in (offline harnesses
// inject their own pool).
let _getPool = null;
async function resolvePool(injected) {
  if (injected) return injected;
  if (!_getPool) {
    const m = await import("../lib/db.js");
    _getPool = m.getPool;
  }
  return _getPool();
}

// Lazy event-bus import, same reasoning. emitEvent never throws.
let _emitEvent = null;
async function resolveEmitter(injected) {
  if (injected) return injected;
  if (!_emitEvent) {
    const m = await import("../lib/eventBus.js");
    _emitEvent = m.emitEvent;
  }
  return _emitEvent;
}

/** Rows out of the API envelope: { results: [...] } | { data: [...] } | bare array. */
function extractRows(response) {
  if (Array.isArray(response)) return response;
  if (response && typeof response === "object") {
    if (Array.isArray(response.results)) return response.results;
    if (Array.isArray(response.data)) return response.data;
  }
  return [];
}

function extractId(record) {
  const id = record?.Id ?? record?.id ?? record?.ID;
  return id === undefined || id === null ? null : String(id);
}

/** LastUpdatedAt under whatever casing AppFolio uses; null if absent/unparseable. */
function extractLastUpdatedAt(record) {
  const raw =
    record?.LastUpdatedAt ??
    record?.last_updated_at ??
    record?.UpdatedAt ??
    record?.updated_at ??
    null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Advisory locks — one per resource, namespaced under 'appfolio_sync'.
//
// pg advisory locks are SESSION-scoped, so the lock must live on a
// dedicated client held for the whole run; pool.query() would grab a
// different connection per call and the lock would be meaningless. The
// two-int form keyed by hashtext() is stable across processes, which is
// what makes the CLI and the in-process scheduler mutually exclusive.
// ---------------------------------------------------------------------------

async function tryResourceLock(pool, resource) {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT pg_try_advisory_lock(hashtext('appfolio_sync'), hashtext($1)) AS locked`,
      [resource]
    );
    if (r.rows?.[0]?.locked === true) {
      return {
        async release() {
          try {
            await client.query(
              `SELECT pg_advisory_unlock(hashtext('appfolio_sync'), hashtext($1))`,
              [resource]
            );
          } finally {
            client.release();
          }
        },
      };
    }
    client.release();
    return null;
  } catch (err) {
    client.release();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Upserts — scrub first; ON CONFLICT refreshes data and clears
// missing_since (the record is demonstrably present again).
// ---------------------------------------------------------------------------

async function upsertPage(pool, table, records) {
  const byId = new Map();
  let skipped = 0;
  for (const record of records) {
    const id = extractId(record);
    if (id === null) {
      skipped += 1;
      continue;
    }
    byId.set(id, scrubRecord(record));
  }
  if (byId.size === 0) return { upserted: 0, skipped };

  const placeholders = [];
  const params = [];
  let p = 1;
  for (const [id, record] of byId) {
    placeholders.push(`($${p++}, $${p++}::jsonb, $${p++})`);
    params.push(id, JSON.stringify(record), extractLastUpdatedAt(record));
  }
  await pool.query(
    `INSERT INTO ${table} (id, data, last_updated_at)
     VALUES ${placeholders.join(",")}
     ON CONFLICT (id) DO UPDATE SET
       data = EXCLUDED.data,
       last_updated_at = EXCLUDED.last_updated_at,
       synced_at = NOW(),
       missing_since = NULL`,
    params
  );
  return { upserted: byId.size, skipped };
}

// ---------------------------------------------------------------------------
// sync_state bookkeeping + failure/recovery events.
//
// Reads-then-writes here are race-free because the caller holds the
// per-resource advisory lock for the whole run.
// ---------------------------------------------------------------------------

async function readSyncState(pool, resource) {
  const r = await pool.query(
    `SELECT high_water_mark, consecutive_failures, last_success_at
       FROM appfolio.sync_state WHERE resource = $1`,
    [resource]
  );
  return r.rows?.[0] ?? null;
}

const FAILURE_EVENT_THRESHOLD = 2;

async function recordSuccess(pool, emit, resource, { highWaterMark, rowCount }) {
  const prior = await readSyncState(pool, resource);
  const priorFailures = prior?.consecutive_failures ?? 0;

  await pool.query(
    `INSERT INTO appfolio.sync_state
       (resource, high_water_mark, last_run_at, last_status, last_error, last_row_count, consecutive_failures, last_success_at)
     VALUES ($1, $2, NOW(), 'ok', NULL, $3, 0, NOW())
     ON CONFLICT (resource) DO UPDATE SET
       high_water_mark = GREATEST(COALESCE(EXCLUDED.high_water_mark, appfolio.sync_state.high_water_mark), appfolio.sync_state.high_water_mark),
       last_run_at = NOW(),
       last_status = 'ok',
       last_error = NULL,
       last_row_count = EXCLUDED.last_row_count,
       consecutive_failures = 0,
       last_success_at = NOW()`,
    [resource, highWaterMark, rowCount]
  );

  if (priorFailures >= FAILURE_EVENT_THRESHOLD) {
    const lastSuccessAt = prior?.last_success_at ? new Date(prior.last_success_at) : null;
    await emit({
      type: "appfolio.sync.recovered",
      source: "appfolio-sync",
      payload: {
        resource,
        downtimeMs: lastSuccessAt ? Date.now() - lastSuccessAt.getTime() : null,
        lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
        failuresCleared: priorFailures,
      },
    });
  }
}

async function recordFailure(pool, emit, resource, err) {
  const prior = await readSyncState(pool, resource);
  const failures = (prior?.consecutive_failures ?? 0) + 1;
  const message = String(err?.message || err).slice(0, 2000);

  await pool.query(
    `INSERT INTO appfolio.sync_state
       (resource, high_water_mark, last_run_at, last_status, last_error, last_row_count, consecutive_failures)
     VALUES ($1, NULL, NOW(), 'failed', $2, 0, $3)
     ON CONFLICT (resource) DO UPDATE SET
       last_run_at = NOW(),
       last_status = 'failed',
       last_error = EXCLUDED.last_error,
       last_row_count = 0,
       consecutive_failures = $3`,
    [resource, message, failures]
  );

  // Exactly-at-threshold so a long outage produces one event, not one per
  // failed run. err.message already embeds AppFolio's response body.
  if (failures === FAILURE_EVENT_THRESHOLD) {
    await emit({
      type: "appfolio.sync.failed",
      source: "appfolio-sync",
      payload: {
        resource,
        error: message,
        consecutiveFailures: failures,
        lastSuccessAt: prior?.last_success_at
          ? new Date(prior.last_success_at).toISOString()
          : null,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// The page walk — fixed request shape, always filtered.
// ---------------------------------------------------------------------------

async function walkResource({ def, name, api, pool, onProgress, filters, pageSize }) {
  let pages = 0;
  let upserted = 0;
  let skipped = 0;
  let maxUpdatedAt = null;
  let prevFirstId = null;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const response = await api.get(def.path, {
      filters,
      page: { number: pageNumber, size: pageSize },
    });
    const rows = extractRows(response);
    if (rows.length === 0) break;

    const firstId = extractId(rows[0]);
    if (firstId !== null && firstId === prevFirstId) {
      throw new Error(
        `${def.path} returned the same first record (id ${firstId}) on consecutive pages — server appears to ignore page[number]; aborting to avoid an infinite loop.`
      );
    }
    prevFirstId = firstId;

    const result = await upsertPage(pool, def.table, rows);
    upserted += result.upserted;
    skipped += result.skipped;
    pages += 1;

    for (const record of rows) {
      const ts = extractLastUpdatedAt(record);
      if (ts && (!maxUpdatedAt || ts > maxUpdatedAt)) maxUpdatedAt = ts;
    }

    onProgress(`${name}: page ${pageNumber} → ${result.upserted} upserted (running total ${upserted})`);
  }

  return { pages, upserted, skipped, maxUpdatedAt };
}

/**
 * Sync one resource under its advisory lock.
 *
 * Returns { resource, mode, pages, upserted, skipped, since, durationMs }
 * on success, or { resource, lockSkipped: true } when another run holds
 * the lock (skip-and-log semantics — nothing queues).
 *
 * @param {string} name           Key of RESOURCES.
 * @param {object} [opts]
 * @param {"full"|"delta"} [opts.mode]  Default "full".
 * @param {number} [opts.pageSize]
 * @param {object} [opts.pool]      Injected pg pool (tests/offline).
 * @param {object} [opts.api]       Injected API client (tests/offline).
 * @param {Function} [opts.emitEvent] Injected event emitter (tests/offline).
 * @param {(msg: string) => void} [opts.onProgress]
 */
export async function syncResource(name, opts = {}) {
  const def = RESOURCES[name];
  if (!def) {
    throw new Error(
      `Unknown AppFolio mirror resource "${name}". Known: ${Object.keys(RESOURCES).join(", ")}`
    );
  }
  const mode = opts.mode === "delta" ? "delta" : "full";
  const api = opts.api || appfolioDbApi;
  const pool = await resolvePool(opts.pool);
  const emit = await resolveEmitter(opts.emitEvent);
  const onProgress = opts.onProgress || (() => {});

  const lock = await tryResourceLock(pool, name);
  if (!lock) {
    onProgress(`${name}: skipped — another sync holds the advisory lock`);
    return { resource: name, mode, lockSkipped: true };
  }

  const startedAt = Date.now();
  try {
    // Every list request is filtered (required by the v0 list endpoints
    // for properties/units/tenants; applied to leases for uniformity).
    let since = EPOCH;
    if (mode === "delta") {
      const state = await readSyncState(pool, name);
      const mark = state?.high_water_mark ? new Date(state.high_water_mark) : null;
      if (mark && !Number.isNaN(mark.getTime())) {
        since = new Date(mark.getTime() - DELTA_OVERLAP_MS).toISOString();
      }
    }

    const walk = await walkResource({
      def,
      name,
      api,
      pool,
      onProgress,
      filters: { LastUpdatedAtFrom: since },
      pageSize: opts.pageSize || PAGE_SIZE,
    });

    await recordSuccess(pool, emit, name, {
      highWaterMark: walk.maxUpdatedAt,
      rowCount: walk.upserted,
    });

    return {
      resource: name,
      mode,
      pages: walk.pages,
      upserted: walk.upserted,
      skipped: walk.skipped,
      since,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    await recordFailure(pool, emit, name, err).catch(() => {});
    throw err;
  } finally {
    await lock.release().catch(() => {});
  }
}

/**
 * Sync every mirrored resource. One resource failing (or being
 * lock-skipped) does not stop the others. Writes one sync_log row
 * (source 'appfolio_db') to match the platform's other sync engines.
 *
 * Returns { ok, results: [...], errors: [...], lockSkipped: [...] }.
 */
export async function syncAll(opts = {}) {
  const mode = opts.mode === "delta" ? "delta" : "full";
  const triggeredBy = opts.triggeredBy || "manual";
  const pool = await resolvePool(opts.pool);

  const results = [];
  const errors = [];
  const lockSkipped = [];
  for (const name of Object.keys(RESOURCES)) {
    try {
      const r = await syncResource(name, { ...opts, mode, pool });
      if (r.lockSkipped) lockSkipped.push(name);
      else results.push(r);
    } catch (err) {
      errors.push({ resource: name, message: String(err?.message || err) });
    }
  }

  const totalRows = results.reduce((n, r) => n + r.upserted, 0);
  await pool
    .query(
      `INSERT INTO sync_log (status, triggered_by, source, endpoints_synced, total_rows_synced, completed_at, errors)
       VALUES ($1, $2, 'appfolio_db', $3, $4, NOW(), $5::jsonb)`,
      [
        errors.length === 0 ? "success" : results.length > 0 ? "partial" : "failed",
        triggeredBy,
        results.length,
        totalRows,
        errors.length ? JSON.stringify(errors) : null,
      ]
    )
    .catch(() => {}); // sync_log is observability, not correctness

  return { ok: errors.length === 0, results, errors, lockSkipped };
}

export const MIRRORED_RESOURCES = Object.keys(RESOURCES);
export { RESOURCES as RESOURCE_DEFS };
