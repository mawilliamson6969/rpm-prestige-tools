/**
 * AppFolio Database API → local mirror tables (Phase 2).
 *
 * Pulls properties / units / tenants / leases through
 * services/appfolio-db-api.js (which owns auth, rate limiting, and retry)
 * and upserts each record into its af_* mirror table created by
 * migrations/037_af_mirror_tables.sql.
 *
 * Two modes:
 *   full  — no filters; walks every page of the resource. This is the
 *           initial backfill.
 *   delta — filters[LastUpdatedAtFrom] = high_water_mark - 5min overlap,
 *           where the high-water mark is the max LastUpdatedAt seen on a
 *           previous successful run (tracked in af_sync_state). If no
 *           mark exists yet, delta degrades to a full pass.
 *
 * Mirror rows are JSONB-first: the whole API record lands in `data`, and
 * only id / last_updated_at are promoted (see the migration's header).
 *
 * Not in this phase: cron scheduling, webhooks, feature endpoints. Run
 * via scripts/backfill-appfolio-db.js or call syncAll() from later-phase
 * code.
 */

import appfolioDbApi from "./appfolio-db-api.js";

// Resource registry. Endpoint paths follow the Database API v0 convention
// of one top-level route per entity.
const RESOURCES = {
  properties: { path: "/properties", table: "af_properties" },
  units: { path: "/units", table: "af_units" },
  tenants: { path: "/tenants", table: "af_tenants" },
  leases: { path: "/leases", table: "af_leases" },
};

const PAGE_SIZE = 500;

// Pagination is defensive because we can't see live response envelopes
// yet: we stop on an EMPTY page rather than a short one (a server that
// clamps page[size] below our ask would otherwise end the walk after
// page 1), and we abort if two consecutive pages start with the same id
// (a server that ignores page[number] would otherwise loop forever).
const MAX_PAGES = 10_000;

// Delta runs re-read a little history so records updated while a sync was
// in flight are never missed. Upserts make the overlap harmless.
const DELTA_OVERLAP_MS = 5 * 60_000;

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

/**
 * Upsert one page of records. Records without a recognizable id are
 * counted and skipped, never thrown — one malformed record must not sink
 * a backfill. Within-page duplicate ids keep the last occurrence
 * (Postgres rejects ON CONFLICT touching the same row twice in one
 * statement).
 */
async function upsertPage(pool, table, records) {
  const byId = new Map();
  let skipped = 0;
  for (const record of records) {
    const id = extractId(record);
    if (id === null) {
      skipped += 1;
      continue;
    }
    byId.set(id, record);
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
       synced_at = NOW()`,
    params
  );
  return { upserted: byId.size, skipped };
}

async function readSyncState(pool, resource) {
  const r = await pool.query(
    `SELECT high_water_mark FROM af_sync_state WHERE resource = $1`,
    [resource]
  );
  return r.rows?.[0] ?? null;
}

async function writeSyncState(pool, resource, { highWaterMark, status, error, rowCount }) {
  await pool.query(
    `INSERT INTO af_sync_state (resource, high_water_mark, last_run_at, last_status, last_error, last_row_count)
     VALUES ($1, $2, NOW(), $3, $4, $5)
     ON CONFLICT (resource) DO UPDATE SET
       high_water_mark = GREATEST(COALESCE(EXCLUDED.high_water_mark, af_sync_state.high_water_mark), af_sync_state.high_water_mark),
       last_run_at = NOW(),
       last_status = EXCLUDED.last_status,
       last_error = EXCLUDED.last_error,
       last_row_count = EXCLUDED.last_row_count`,
    [resource, highWaterMark, status, error, rowCount]
  );
}

/**
 * Sync one resource. Returns { resource, mode, pages, upserted, skipped }.
 *
 * @param {string} name           Key of RESOURCES.
 * @param {object} [opts]
 * @param {"full"|"delta"} [opts.mode]  Default "full".
 * @param {number} [opts.pageSize]
 * @param {object} [opts.pool]    Injected pg pool (tests/offline).
 * @param {object} [opts.api]     Injected API client (tests/offline).
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
  const pageSize = opts.pageSize || PAGE_SIZE;
  const api = opts.api || appfolioDbApi;
  const pool = await resolvePool(opts.pool);
  const onProgress = opts.onProgress || (() => {});

  // Delta start point: stored high-water mark minus overlap.
  let filters;
  if (mode === "delta") {
    const state = await readSyncState(pool, name);
    const mark = state?.high_water_mark ? new Date(state.high_water_mark) : null;
    if (mark && !Number.isNaN(mark.getTime())) {
      filters = {
        LastUpdatedAtFrom: new Date(mark.getTime() - DELTA_OVERLAP_MS).toISOString(),
      };
    }
    // No mark yet → fall through with no filter (full pass).
  }

  let pages = 0;
  let upserted = 0;
  let skipped = 0;
  let maxUpdatedAt = null;
  let prevFirstId = null;

  try {
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

    await writeSyncState(pool, name, {
      highWaterMark: maxUpdatedAt,
      status: "ok",
      error: null,
      rowCount: upserted,
    });
    return { resource: name, mode, pages, upserted, skipped };
  } catch (err) {
    // Record the failure but preserve the previous high-water mark
    // (writeSyncState only ever raises it).
    await writeSyncState(pool, name, {
      highWaterMark: null,
      status: "failed",
      error: String(err?.message || err).slice(0, 2000),
      rowCount: upserted,
    }).catch(() => {}); // state write is best-effort on the failure path
    throw err;
  }
}

/**
 * Sync every mirrored resource. One resource failing does not stop the
 * others; failures are collected and reported. Writes one sync_log row
 * (source 'appfolio_db') to match the platform's other sync engines.
 *
 * Returns { ok, results: [...], errors: [{ resource, message }] }.
 */
export async function syncAll(opts = {}) {
  const mode = opts.mode === "delta" ? "delta" : "full";
  const triggeredBy = opts.triggeredBy || "manual";
  const pool = await resolvePool(opts.pool);

  const results = [];
  const errors = [];
  for (const name of Object.keys(RESOURCES)) {
    try {
      results.push(await syncResource(name, { ...opts, mode, pool }));
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

  return { ok: errors.length === 0, results, errors };
}

export const MIRRORED_RESOURCES = Object.keys(RESOURCES);
