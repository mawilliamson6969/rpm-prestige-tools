/**
 * RentEngine public API → PostgreSQL cache (prospects + units).
 * https://app.rentengine.io/api/public/v1 — Bearer RENTENGINE_API_KEY
 */
import { getPool } from "./db.js";

const BASE = "https://app.rentengine.io/api/public/v1";
const GAP_MS = 300;
const PAGE_LIMIT = 100;

function delay() {
  return new Promise((r) => setTimeout(r, GAP_MS));
}

function normalizeArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.results)) return json.results;
    if (Array.isArray(json.prospects)) return json.prospects;
    if (Array.isArray(json.units)) return json.units;
  }
  return [];
}

async function fetchJson(apiKey, pathWithQuery) {
  await delay();
  const res = await fetch(`${BASE}${pathWithQuery}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`RentEngine invalid JSON for ${pathWithQuery.slice(0, 120)}`);
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && (json.message || json.error)) ||
      text?.slice(0, 240) ||
      res.statusText;
    throw new Error(`RentEngine ${res.status}: ${msg}`);
  }
  return json;
}

function sixMonthsAgoIso() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d.toISOString();
}

/**
 * Paginate until a page returns fewer than PAGE_LIMIT items.
 */
async function fetchAllPages(apiKey, path, extraParams = {}) {
  let page = 0;
  const out = [];
  for (;;) {
    const params = new URLSearchParams();
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v != null && v !== "") params.set(k, String(v));
    });
    params.set("limit", String(PAGE_LIMIT));
    params.set("page_number", String(page));
    const json = await fetchJson(apiKey, `${path}?${params.toString()}`);
    const batch = normalizeArray(json);
    out.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    page += 1;
  }
  return out;
}

async function insertJsonRows(client, tableName, rows) {
  if (rows.length === 0) return;
  const chunkSize = 250;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const row of chunk) {
      placeholders.push(`($${p++}::jsonb, NOW())`);
      params.push(row);
    }
    await client.query(
      `INSERT INTO ${tableName} (appfolio_data, synced_at) VALUES ${placeholders.join(",")}`,
      params
    );
  }
}

async function logRentEngineSync(triggeredBy, status, endpointsSynced, totalRows, errors) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO sync_log (status, triggered_by, source, endpoints_synced, total_rows_synced, completed_at, errors)
     VALUES ($1, $2, 'rentengine', $3, $4, NOW(), $5::jsonb)`,
    [
      status,
      triggeredBy,
      endpointsSynced,
      totalRows,
      errors && errors.length ? JSON.stringify(errors) : null,
    ]
  );
}

/**
 * Runs after AppFolio sync. Skips if RENTENGINE_API_KEY is unset.
 * @returns {Promise<{ skipped?: boolean, prospectRows: number, unitRows: number }>}
 */
export async function runRentEngineSync(triggeredBy) {
  const apiKey = process.env.RENTENGINE_API_KEY?.trim();
  if (!apiKey) {
    console.log("[sync] rentengine: skipped (RENTENGINE_API_KEY not set)");
    return { skipped: true, prospectRows: 0, unitRows: 0 };
  }

  const syncErrors = [];
  let prospects = [];
  let units = [];

  try {
    prospects = await fetchAllPages(apiKey, "/prospects", {
      created_after: sixMonthsAgoIso(),
    });
    console.log(`[sync] rentengine prospects: ${prospects.length} rows cached`);
  } catch (e) {
    const msg = e?.message || String(e);
    syncErrors.push({ step: "prospects", error: msg });
    console.error("[sync] rentengine prospects failed:", msg);
    await logRentEngineSync(triggeredBy, "failed", 0, 0, syncErrors);
    throw e;
  }

  try {
    units = await fetchAllPages(apiKey, "/units", {});
    console.log(`[sync] rentengine units: ${units.length} rows cached`);
  } catch (e) {
    const msg = e?.message || String(e);
    syncErrors.push({ step: "units", error: msg });
    console.error("[sync] rentengine units failed:", msg);
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM cached_rentengine_leads`);
    await insertJsonRows(client, "cached_rentengine_leads", prospects);
    await client.query(`DELETE FROM cached_rentengine_units`);
    await insertJsonRows(client, "cached_rentengine_units", units);
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    syncErrors.push({ step: "database", error: e?.message || String(e) });
    await logRentEngineSync(triggeredBy, "failed", 2, 0, syncErrors);
    throw e;
  } finally {
    client.release();
  }

  const totalRows = prospects.length + units.length;
  await logRentEngineSync(triggeredBy, "completed", 2, totalRows, syncErrors.length ? syncErrors : null);

  return { prospectRows: prospects.length, unitRows: units.length };
}
