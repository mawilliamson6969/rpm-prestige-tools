/**
 * Phase 1: AppFolio Reports API v2 → PostgreSQL cache. Runs on cron / manual / startup.
 */
import {
  getNextPageUrl,
  normalizeReportResults,
  postAppfolioReport,
  postAppfolioReportAbsoluteUrl,
} from "./appfolio.js";
import { getPool } from "./db.js";
import { runBoomSync } from "./boom-sync.js";
import { runLeadSimpleSync } from "./leadsimple-sync.js";
import { runRentEngineSync } from "./rentengine-sync.js";

const MIN_GAP_MS = 2500;

const TABLES = {
  units: "cached_units",
  properties: "cached_properties",
  rent_roll: "cached_rent_roll",
  income_statement: "cached_income_statement",
  work_orders: "cached_work_orders",
  delinquency: "cached_delinquency",
  owners: "cached_owners",
  guest_cards: "cached_guest_cards",
  rental_applications: "cached_rental_applications",
  lease_expirations: "cached_lease_expirations",
  vendors: "cached_vendors",
};

function gap() {
  return new Promise((r) => setTimeout(r, MIN_GAP_MS));
}

function todayYyyyMmDd() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentMonthYyyyMm() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function twelveMonthsAgoYyyyMmDd() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ninetyDaysAgoYyyyMmDd() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 90);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

let httpCallIndex = 0;

async function reportHttp(runFetch) {
  if (httpCallIndex > 0) await gap();
  httpCallIndex += 1;
  return runFetch();
}

/**
 * @returns {{ rows: unknown[], firstResponse: unknown }}
 */
async function fetchAllReportRows(endpointFilename, initialBody) {
  const collected = [];
  let nextUrl = null;
  let firstResponse = null;

  for (;;) {
    const json = await reportHttp(() =>
      nextUrl
        ? postAppfolioReportAbsoluteUrl(nextUrl, {})
        : postAppfolioReport(endpointFilename, initialBody)
    );
    if (firstResponse === null) firstResponse = json;
    collected.push(...normalizeReportResults(json));
    const nxt = getNextPageUrl(json);
    if (!nxt) break;
    nextUrl = nxt;
  }
  return { rows: collected, firstResponse };
}

async function insertJsonRows(client, tableName, rows, { period } = {}) {
  if (rows.length === 0) return;
  const chunkSize = 250;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const row of chunk) {
      if (period != null) {
        placeholders.push(`($${p++}::jsonb, $${p++}, NOW())`);
        params.push(row, period);
      } else {
        placeholders.push(`($${p++}::jsonb, NOW())`);
        params.push(row);
      }
    }
    const cols =
      period != null ? "(appfolio_data, period, synced_at)" : "(appfolio_data, synced_at)";
    const sql = `INSERT INTO ${tableName} ${cols} VALUES ${placeholders.join(",")}`;
    await client.query(sql, params);
  }
}

const ENDPOINTS = [
  {
    key: "unit_directory",
    file: "unit_directory.json",
    table: TABLES.units,
    body: () => ({ unit_visibility: "active", paginate_results: false }),
  },
  {
    key: "property_directory",
    file: "property_directory.json",
    table: TABLES.properties,
    body: () => ({ paginate_results: false }),
  },
  {
    key: "rent_roll",
    file: "rent_roll.json",
    table: TABLES.rent_roll,
    body: () => ({
      as_of_to: todayYyyyMmDd(),
      unit_visibility: "active",
      paginate_results: false,
    }),
  },
  {
    key: "income_statement",
    file: "income_statement.json",
    table: TABLES.income_statement,
    period: () => currentMonthYyyyMm(),
    body: () => ({
      posted_on_to: currentMonthYyyyMm(),
      property_visibility: "active",
      accounting_basis: "Cash",
      paginate_results: false,
    }),
  },
  {
    key: "work_order",
    file: "work_order.json",
    table: TABLES.work_orders,
    body: () => ({
      property_visibility: "active",
      from_date: ninetyDaysAgoYyyyMmDd(),
      paginate_results: false,
    }),
  },
  {
    key: "delinquency",
    file: "delinquency.json",
    table: TABLES.delinquency,
    body: () => ({ property_visibility: "active", paginate_results: false }),
  },
  {
    key: "owner_directory",
    file: "owner_directory.json",
    table: TABLES.owners,
    body: () => ({ paginate_results: false }),
  },
  {
    key: "guest_cards",
    file: "guest_cards.json",
    table: TABLES.guest_cards,
    body: () => ({
      from_date: twelveMonthsAgoYyyyMmDd(),
      paginate_results: false,
    }),
  },
  {
    key: "rental_applications",
    file: "rental_applications.json",
    table: TABLES.rental_applications,
    body: () => ({
      from_date: twelveMonthsAgoYyyyMmDd(),
      paginate_results: false,
    }),
  },
  {
    key: "lease_expiration_detail",
    file: "lease_expiration_detail.json",
    table: TABLES.lease_expirations,
    body: () => ({ paginate_results: false }),
  },
  {
    key: "vendor_directory",
    file: "vendor_directory.json",
    table: TABLES.vendors,
    body: () => ({ paginate_results: false }),
  },
];

let syncInProgress = false;

export function isSyncRunning() {
  return syncInProgress;
}

async function syncOneEndpoint(def, syncErrors) {
  const client = await getPool().connect();
  try {
    const { rows, firstResponse } = await fetchAllReportRows(def.file, def.body());
    const period = typeof def.period === "function" ? def.period() : null;
    await client.query("BEGIN");
    await client.query(`DELETE FROM ${def.table}`);
    await insertJsonRows(client, def.table, rows, { period: period ?? undefined });
    await client.query("COMMIT");

    console.log(`[sync] ${def.key}: ${rows.length} rows cached`);
    if (def.key === "guest_cards") {
      const fr = firstResponse;
      const meta =
        fr && typeof fr === "object" && !Array.isArray(fr)
          ? { keys: Object.keys(fr), resultsLen: Array.isArray(fr.results) ? fr.results.length : null }
          : typeof fr;
      console.log(`[sync] guest_cards: detail`, meta);
    }
    if (rows.length === 0) {
      try {
        console.log(
          `[sync] ${def.key}: empty result, full first response:`,
          JSON.stringify(firstResponse)
        );
      } catch {
        console.log(`[sync] ${def.key}: empty result (response not JSON-serializable)`);
      }
    }

    return { rowCount: rows.length, endpoint: def.key };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = e?.message || String(e);
    syncErrors.push({ endpoint: def.key, error: msg });
    console.error(`[sync] ${def.key} failed:`, msg);
    return { rowCount: 0, endpoint: def.key, failed: true };
  } finally {
    client.release();
  }
}

async function insertSyncLog(triggeredBy) {
  const pool = getPool();
  const {
    rows: [logRow],
  } = await pool.query(
    `INSERT INTO sync_log (status, triggered_by) VALUES ('running', $1) RETURNING id`,
    [triggeredBy]
  );
  return logRow.id;
}

async function runSyncEndpointsForId(syncId, triggeredBy) {
  const pool = getPool();
  const syncErrors = [];
  let endpointsSynced = 0;
  let totalRows = 0;

  try {
    for (const def of ENDPOINTS) {
      const result = await syncOneEndpoint(def, syncErrors);
      if (!result.failed) endpointsSynced += 1;
      totalRows += result.rowCount;
    }

    await pool.query(
      `UPDATE sync_log SET completed_at = NOW(), status = $2,
       endpoints_synced = $3, total_rows_synced = $4, errors = $5::jsonb
       WHERE id = $1`,
      [
        syncId,
        "completed",
        endpointsSynced,
        totalRows,
        JSON.stringify(syncErrors.length ? syncErrors : null),
      ]
    );

    try {
      await runRentEngineSync(triggeredBy);
    } catch (reErr) {
      console.error("[sync] rentengine failed:", reErr?.message || reErr);
    }

    try {
      await runBoomSync(triggeredBy);
    } catch (boomErr) {
      console.error("[sync] boom failed:", boomErr?.message || boomErr);
    }

    try {
      await runLeadSimpleSync(triggeredBy);
    } catch (lsErr) {
      console.error("[sync] leadsimple failed:", lsErr?.message || lsErr);
    }

    return { syncId, endpointsSynced, totalRows, errors: syncErrors };
  } catch (e) {
    await pool.query(
      `UPDATE sync_log SET completed_at = NOW(), status = 'failed',
       errors = $2::jsonb WHERE id = $1`,
      [syncId, JSON.stringify([{ endpoint: "_fatal", error: e?.message || String(e) }])]
    );
    throw e;
  }
}

/**
 * Awaited sync (cron / startup).
 * @param {string} triggeredBy — 'cron' | 'manual' | 'startup'
 */
export async function runFullSync(triggeredBy) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (syncInProgress) {
    const err = new Error("Sync already in progress");
    err.code = "SYNC_IN_PROGRESS";
    throw err;
  }

  syncInProgress = true;
  httpCallIndex = 0;

  try {
    const syncId = await insertSyncLog(triggeredBy);
    return await runSyncEndpointsForId(syncId, triggeredBy);
  } finally {
    syncInProgress = false;
  }
}

/**
 * Manual trigger: returns immediately; job runs in background.
 */
export async function startSyncInBackground(triggeredBy) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (syncInProgress) {
    const err = new Error("Sync already in progress");
    err.code = "SYNC_IN_PROGRESS";
    throw err;
  }

  syncInProgress = true;
  httpCallIndex = 0;

  let syncId;
  try {
    syncId = await insertSyncLog(triggeredBy);
  } catch (e) {
    syncInProgress = false;
    throw e;
  }

  setImmediate(() => {
    runSyncEndpointsForId(syncId, triggeredBy)
      .catch((e) => console.error("[sync] background job failed:", e))
      .finally(() => {
        syncInProgress = false;
      });
  });

  return { syncId };
}

export async function getLatestSyncLog() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, started_at, completed_at, status, endpoints_synced, total_rows_synced, errors, triggered_by
     FROM sync_log ORDER BY started_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

export async function getSyncHistory(limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, started_at, completed_at, status, endpoints_synced, total_rows_synced, errors, triggered_by
     FROM sync_log ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
