/**
 * LeadSimple REST API → PostgreSQL cache (read-only).
 * https://api.leadsimple.com/rest — Bearer LEADSIMPLE_API_KEY
 */
import { getPool } from "./db.js";

const BASE = "https://api.leadsimple.com/rest";
const GAP_MS = 500;
const PER_PAGE = 200;

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function delay() {
  return sleepMs(GAP_MS);
}

function normalizeList(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.results)) return json.results;
    if (Array.isArray(json.deals)) return json.deals;
    if (Array.isArray(json.contacts)) return json.contacts;
    if (Array.isArray(json.pipelines)) return json.pipelines;
    if (Array.isArray(json.tasks)) return json.tasks;
    if (Array.isArray(json.processes)) return json.processes;
    if (Array.isArray(json.properties)) return json.properties;
    if (Array.isArray(json.conversations)) return json.conversations;
  }
  return [];
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

async function logLeadSimpleSync(triggeredBy, status, endpointsSynced, totalRows, errors) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO sync_log (status, triggered_by, source, endpoints_synced, total_rows_synced, completed_at, errors)
     VALUES ($1, $2, 'leadsimple', $3, $4, NOW(), $5::jsonb)`,
    [status, triggeredBy, endpointsSynced, totalRows, errors?.length ? JSON.stringify(errors) : null]
  );
}

function parseRetryAfterSeconds(res) {
  const h =
    res.headers.get("X-RateLimit-Retry-After") ??
    res.headers.get("x-ratelimit-retry-after") ??
    res.headers.get("Retry-After");
  if (h == null || h === "") return null;
  const sec = parseInt(String(h).trim(), 10);
  return Number.isFinite(sec) && sec >= 0 ? sec : null;
}

function maybeBackoffFromHeaders(res) {
  const rem = res.headers.get("X-RateLimit-Remaining") ?? res.headers.get("x-ratelimit-remaining");
  const n = rem != null ? parseInt(String(rem), 10) : NaN;
  if (Number.isFinite(n) && n >= 0 && n < 10) {
    return sleepMs(1000);
  }
  return Promise.resolve();
}

/**
 * GET with 500ms spacing, 429 → wait X-RateLimit-Retry-After (seconds), optional light backoff from rate headers.
 */
async function leadsimpleFetch(apiKey, pathWithQuery, rate429Attempts = 0) {
  await delay();
  const res = await fetch(`${BASE}${pathWithQuery}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  await maybeBackoffFromHeaders(res);

  if (res.status === 429 && rate429Attempts < 8) {
    const sec = parseRetryAfterSeconds(res);
    const waitMs = sec != null ? sec * 1000 : 5000;
    console.warn(`[sync] leadsimple 429, waiting ${waitMs}ms before retry (${pathWithQuery.slice(0, 80)})`);
    await sleepMs(waitMs);
    return leadsimpleFetch(apiKey, pathWithQuery, rate429Attempts + 1);
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`LeadSimple ${pathWithQuery}: invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && (json.message || json.error)) ||
      text?.slice(0, 240) ||
      res.statusText;
    throw new Error(`LeadSimple ${res.status} ${pathWithQuery}: ${msg}`);
  }
  return json;
}

async function fetchAllPages(apiKey, path, logLabel) {
  let page = 1;
  const out = [];
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const pathWithQuery = `${path}${sep}page=${page}&per_page=${PER_PAGE}`;
    const json = await leadsimpleFetch(apiKey, pathWithQuery);
    const batch = normalizeList(json);
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < PER_PAGE) break;
    page += 1;
  }
  console.log(`[sync] leadsimple ${logLabel}: ${out.length} rows cached`);
  return out;
}

const RESOURCE_SPECS = [
  { path: "/deals", table: "cached_leadsimple_deals", label: "deals" },
  { path: "/contacts", table: "cached_leadsimple_contacts", label: "contacts" },
  { path: "/pipelines", table: "cached_leadsimple_pipelines", label: "pipelines" },
  { path: "/tasks", table: "cached_leadsimple_tasks", label: "tasks" },
  { path: "/processes", table: "cached_leadsimple_processes", label: "processes" },
  { path: "/properties", table: "cached_leadsimple_properties", label: "properties" },
  { path: "/conversations", table: "cached_leadsimple_conversations", label: "conversations" },
];

/**
 * Runs after Boom sync. Skips if LEADSIMPLE_API_KEY unset.
 * @param {string} [triggeredBy]
 */
export async function runLeadSimpleSync(triggeredBy) {
  const syncTriggeredBy =
    typeof triggeredBy === "string" && triggeredBy.trim() !== "" ? triggeredBy.trim() : "sync";

  const apiKey = process.env.LEADSIMPLE_API_KEY?.trim();
  if (!apiKey) {
    console.log("[sync] leadsimple: skipped (LEADSIMPLE_API_KEY not set)");
    return { skipped: true };
  }

  /** @type {{ ok: boolean, rows: unknown[], label: string, table: string }[]} */
  const results = [];
  const syncErrors = [];

  for (const spec of RESOURCE_SPECS) {
    try {
      const rows = await fetchAllPages(apiKey, spec.path, spec.label);
      results.push({ ok: true, rows, label: spec.label, table: spec.table });
    } catch (e) {
      const msg = e?.message || String(e);
      syncErrors.push({ step: spec.label, error: msg });
      console.error(`[sync] leadsimple ${spec.label} failed:`, msg);
      results.push({ ok: false, rows: [], label: spec.label, table: spec.table });
    }
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const r of results) {
      if (!r.ok) continue;
      await client.query(`DELETE FROM ${r.table}`);
      await insertJsonRows(client, r.table, r.rows);
    }
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = e?.message || String(e);
    syncErrors.push({ step: "database", error: msg });
    await logLeadSimpleSync(syncTriggeredBy, "failed", RESOURCE_SPECS.length, 0, syncErrors);
    throw e;
  } finally {
    client.release();
  }

  const totalRows = results.filter((x) => x.ok).reduce((acc, r) => acc + r.rows.length, 0);
  await logLeadSimpleSync(
    syncTriggeredBy,
    "completed",
    RESOURCE_SPECS.length,
    totalRows,
    syncErrors.length ? syncErrors : null
  );

  return {
    skipped: false,
    endpointsSynced: RESOURCE_SPECS.length,
    endpointsSucceeded: results.filter((x) => x.ok).length,
    totalRows,
    errors: syncErrors.length ? syncErrors : undefined,
  };
}
