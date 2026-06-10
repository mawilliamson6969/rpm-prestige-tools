/**
 * AppFolio mirror sync scheduler (Phase 3).
 *
 * Two cadences, wired into the backend process from index.js the same
 * way the Reports-API cache syncs are:
 *
 *   delta  — hourly (APPFOLIO_SYNC_DELTA_CRON, default "0 * * * *").
 *            Per resource: filters[LastUpdatedAtFrom] = high-water mark
 *            minus 15 minutes (epoch when no mark), paginate, upsert
 *            (which clears missing_since), advance the mark.
 *   full   — nightly 3:00 AM America/Chicago (APPFOLIO_SYNC_FULL_CRON,
 *            default "0 3 * * *"). Epoch-filtered full fetch, then the
 *            MISSING SWEEP: for each resource that completed
 *            successfully, rows the run did not touch
 *            (synced_at < run start) get missing_since = NOW().
 *            Never hard-deletes. A failed or lock-skipped resource
 *            skips its sweep entirely — a partial fetch must not flag
 *            live records as missing.
 *
 * Concurrency: per-resource advisory locks live in syncResource itself,
 * so scheduled runs, overlapping crons, and the CLI backfill are all
 * mutually exclusive. A held lock means skip-and-log, never queue.
 *
 * Config:
 *   APPFOLIO_SYNC_ENABLED     default true; also auto-disabled (with a
 *                             clear log line) when DB-API creds are
 *                             absent so local dev never errors.
 *   APPFOLIO_SYNC_DELTA_CRON  override the delta cadence.
 *   APPFOLIO_SYNC_FULL_CRON   override the full cadence (America/Chicago).
 *
 * Logging: one summary line per run; page-by-page detail stays behind
 * APPFOLIO_DB_DEBUG on the API client.
 */

import { createRequire } from "node:module";
import { syncAll, RESOURCE_DEFS } from "./appfolio-db-sync.js";

// node-cron is loaded lazily so this module (and its run functions) can
// be imported in contexts without backend deps installed — offline
// harnesses exercise runDeltaSync/runFullSyncWithSweep directly.
const require = createRequire(import.meta.url);
function loadCron() {
  return require("node-cron");
}

const DEFAULT_DELTA_CRON = "0 * * * *"; // hourly, on the hour
const DEFAULT_FULL_CRON = "0 3 * * *"; // 3:00 AM
const CRON_TIMEZONE = "America/Chicago";

// Lazy pool import (see appfolio-db-sync.js for reasoning).
let _getPool = null;
async function resolvePool(injected) {
  if (injected) return injected;
  if (!_getPool) {
    const m = await import("../lib/db.js");
    _getPool = m.getPool;
  }
  return _getPool();
}

function credsPresent() {
  return Boolean(
    process.env.APPFOLIO_DB_CLIENT_ID?.trim() &&
      process.env.APPFOLIO_DB_CLIENT_SECRET?.trim() &&
      process.env.APPFOLIO_DB_DEVELOPER_ID?.trim()
  );
}

/**
 * Enabled unless APPFOLIO_SYNC_ENABLED=false, and only when credentials
 * exist. Returns { enabled, reason } so callers can log why not.
 */
export function syncSchedulerStatus() {
  if (String(process.env.APPFOLIO_SYNC_ENABLED || "true").toLowerCase() === "false") {
    return { enabled: false, reason: "APPFOLIO_SYNC_ENABLED=false" };
  }
  if (!credsPresent()) {
    return {
      enabled: false,
      reason:
        "AppFolio Database API credentials absent (APPFOLIO_DB_CLIENT_ID / _CLIENT_SECRET / _DEVELOPER_ID) — scheduled mirror sync disabled",
    };
  }
  return { enabled: true, reason: null };
}

function describeRun(kind, summary, durationMs, extras = {}) {
  const parts = summary.results.map((r) => {
    const sweep = extras.sweptByResource?.[r.resource];
    return `${r.resource} ${r.upserted} rows${sweep !== undefined ? ` (${sweep} flagged missing)` : ""}`;
  });
  for (const name of summary.lockSkipped) parts.push(`${name} LOCK-SKIPPED`);
  for (const e of summary.errors) parts.push(`${e.resource} FAILED`);
  return `[appfolio-sync] ${kind}: ${parts.join(", ") || "nothing to do"} | ${(durationMs / 1000).toFixed(1)}s total`;
}

/**
 * Hourly delta pass. Exported for tests and manual triggering.
 */
export async function runDeltaSync(opts = {}) {
  const startedAt = Date.now();
  const summary = await syncAll({
    ...opts,
    mode: "delta",
    triggeredBy: opts.triggeredBy || "cron-delta",
  });
  console.log(describeRun("delta", summary, Date.now() - startedAt));
  return summary;
}

/**
 * Nightly full pass + missing sweep.
 *
 * The sweep predicate is synced_at < run start: every row the full fetch
 * touched got synced_at = NOW() (> run start) via the upsert, so
 * anything older was absent from AppFolio's response. Only resources
 * whose fetch SUCCEEDED are swept; errors and lock-skips leave their
 * rows untouched.
 */
export async function runFullSyncWithSweep(opts = {}) {
  const startedAt = Date.now();
  const runStart = new Date();
  const pool = await resolvePool(opts.pool);

  const summary = await syncAll({
    ...opts,
    pool,
    mode: "full",
    triggeredBy: opts.triggeredBy || "cron-full",
  });

  const sweptByResource = {};
  for (const r of summary.results) {
    const table = RESOURCE_DEFS[r.resource].table;
    const swept = await pool.query(
      `UPDATE ${table}
          SET missing_since = NOW()
        WHERE synced_at < $1
          AND missing_since IS NULL`,
      [runStart]
    );
    sweptByResource[r.resource] = swept.rowCount ?? 0;
  }

  console.log(describeRun("full", summary, Date.now() - startedAt, { sweptByResource }));
  return { ...summary, sweptByResource };
}

/**
 * Wire both cadences. Called once from index.js start(). Returns true
 * when scheduled, false when disabled (after logging why).
 */
export function ensureAppfolioSyncScheduled() {
  const status = syncSchedulerStatus();
  if (!status.enabled) {
    console.log(`[appfolio-sync] disabled: ${status.reason}`);
    return false;
  }

  const deltaCron = process.env.APPFOLIO_SYNC_DELTA_CRON?.trim() || DEFAULT_DELTA_CRON;
  const fullCron = process.env.APPFOLIO_SYNC_FULL_CRON?.trim() || DEFAULT_FULL_CRON;

  const cron = loadCron();
  cron.schedule(deltaCron, () => {
    runDeltaSync().catch((e) => console.error("[appfolio-sync] delta run error:", e.message || e));
  }, { timezone: CRON_TIMEZONE });

  cron.schedule(fullCron, () => {
    runFullSyncWithSweep().catch((e) => console.error("[appfolio-sync] full run error:", e.message || e));
  }, { timezone: CRON_TIMEZONE });

  console.log(
    `[appfolio-sync] scheduled: delta "${deltaCron}", full "${fullCron}" (${CRON_TIMEZONE})`
  );
  return true;
}
