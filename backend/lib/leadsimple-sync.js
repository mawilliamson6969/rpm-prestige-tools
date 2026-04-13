/**
 * LeadSimple REST API → PostgreSQL cache (read-only).
 * https://api.leadsimple.com/rest — Bearer LEADSIMPLE_API_KEY
 *
 * Optimized for large accounts: scoped syncs + 2s pacing + page caps (see fetch paths below).
 */
import { getPool } from "./db.js";

const BASE = "https://api.leadsimple.com/rest";
const GAP_MS = 2000;
const PER_PAGE = 200;
/** Max pages per paginated API call (50 × 200 = 10k rows per call). */
const MAX_PAGES_PER_CALL = 50;
const RETRY_AFTER_BUFFER_MS = 5000;

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function delay() {
  return sleepMs(GAP_MS);
}

/** Unix timestamp (seconds). */
function unixDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return Math.floor(d.getTime() / 1000);
}

/** Unix timestamp (seconds). */
function unixMonthsAgo(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return Math.floor(d.getTime() / 1000);
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

function mergeRowsById(rowArrays) {
  const map = new Map();
  for (const rows of rowArrays) {
    for (const row of rows) {
      if (row && typeof row === "object" && row.id != null) {
        map.set(String(row.id), row);
      }
    }
  }
  return [...map.values()];
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
 * GET with 2s spacing, 429 → wait Retry-After (seconds) + 5s buffer, then retry.
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
    const baseMs = sec != null ? sec * 1000 : 5000;
    const waitMs = baseMs + RETRY_AFTER_BUFFER_MS;
    console.warn(
      `[sync] leadsimple 429, waiting ${waitMs}ms (Retry-After + 5s buffer) (${pathWithQuery.slice(0, 96)})`
    );
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

function buildPagePath(basePath, page) {
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}page=${page}&per_page=${PER_PAGE}`;
}

/**
 * @returns {{ rows: unknown[], hitPageLimit: boolean }}
 */
async function fetchAllPages(apiKey, basePath, logLabel) {
  let page = 1;
  const out = [];
  let hitPageLimit = false;
  for (;;) {
    if (page > MAX_PAGES_PER_CALL) {
      hitPageLimit = true;
      console.warn(
        `[sync] leadsimple ${logLabel}: reached maximum page limit (${MAX_PAGES_PER_CALL}), stopping pagination`
      );
      break;
    }
    const pathWithQuery = buildPagePath(basePath, page);
    const json = await leadsimpleFetch(apiKey, pathWithQuery);
    const batch = normalizeList(json);
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < PER_PAGE) break;
    page += 1;
  }
  return { rows: out, hitPageLimit };
}

const ENDPOINT_COUNT = 7;

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

  const ts6mo = unixMonthsAgo(6);
  const ts30d = unixDaysAgo(30);

  /** @type {{ ok: boolean, rows: unknown[], label: string, table: string }[]} */
  const results = [];
  const syncErrors = [];
  const pageLimitNotes = [];

  async function runFetch(label, table, fn) {
    try {
      const rows = await fn();
      results.push({ ok: true, rows, label, table });
    } catch (e) {
      const msg = e?.message || String(e);
      syncErrors.push({ step: label, error: msg });
      console.error(`[sync] leadsimple ${label} failed:`, msg);
      results.push({ ok: false, rows: [], label, table });
    }
  }

  // Pipelines & properties — full sync (small).
  await runFetch("pipelines", "cached_leadsimple_pipelines", async () => {
    const { rows, hitPageLimit } = await fetchAllPages(apiKey, "/pipelines", "pipelines");
    if (hitPageLimit) pageLimitNotes.push("pipelines");
    return rows;
  });

  await runFetch("properties", "cached_leadsimple_properties", async () => {
    const { rows, hitPageLimit } = await fetchAllPages(apiKey, "/properties", "properties");
    if (hitPageLimit) pageLimitNotes.push("properties");
    return rows;
  });

  // Contacts — full sync.
  await runFetch("contacts", "cached_leadsimple_contacts", async () => {
    const { rows, hitPageLimit } = await fetchAllPages(apiKey, "/contacts", "contacts");
    if (hitPageLimit) pageLimitNotes.push("contacts");
    return rows;
  });

  // Deals — last 6 months by updated_since (Unix seconds).
  await runFetch("deals", "cached_leadsimple_deals", async () => {
    const base = `/deals?updated_since=${ts6mo}`;
    const { rows, hitPageLimit } = await fetchAllPages(apiKey, base, "deals");
    if (hitPageLimit) pageLimitNotes.push("deals (6mo window)");
    return rows;
  });

  // Tasks — incomplete + anything updated in last 30 days (dedupe by id).
  await runFetch("tasks", "cached_leadsimple_tasks", async () => {
    const openPath = `/tasks?completed=false`;
    const recentPath = `/tasks?updated_since=${ts30d}`;
    const a = await fetchAllPages(apiKey, openPath, "tasks (completed=false)");
    const b = await fetchAllPages(apiKey, recentPath, "tasks (updated_since 30d)");
    if (a.hitPageLimit) pageLimitNotes.push("tasks (open)");
    if (b.hitPageLimit) pageLimitNotes.push("tasks (recent)");
    return mergeRowsById([a.rows, b.rows]);
  });

  // Processes — open + completed in last 30 days (dedupe by id).
  await runFetch("processes", "cached_leadsimple_processes", async () => {
    const openPath = `/processes?status=open`;
    const donePath = `/processes?status=completed&updated_since=${ts30d}`;
    const a = await fetchAllPages(apiKey, openPath, "processes (open)");
    const b = await fetchAllPages(apiKey, donePath, "processes (completed 30d)");
    if (a.hitPageLimit) pageLimitNotes.push("processes (open)");
    if (b.hitPageLimit) pageLimitNotes.push("processes (completed)");
    return mergeRowsById([a.rows, b.rows]);
  });

  // Conversations — updated in last 30 days.
  await runFetch("conversations", "cached_leadsimple_conversations", async () => {
    const base = `/conversations?updated_since=${ts30d}`;
    const { rows, hitPageLimit } = await fetchAllPages(apiKey, base, "conversations");
    if (hitPageLimit) pageLimitNotes.push("conversations (30d)");
    return rows;
  });

  if (pageLimitNotes.length) {
    console.warn(
      `[sync] leadsimple: page cap (${MAX_PAGES_PER_CALL} pages/call) hit for: ${pageLimitNotes.join(", ")}`
    );
  }

  const n = (label) => results.find((x) => x.label === label && x.ok)?.rows.length ?? 0;
  const dealsN = n("deals");
  const tasksN = n("tasks");
  const convN = n("conversations");
  const procN = n("processes");
  const contN = n("contacts");
  const pipeN = n("pipelines");
  const propN = n("properties");

  console.log(`[sync] leadsimple deals: ${dealsN} rows cached (limited to last 6 months)`);
  console.log(
    `[sync] leadsimple tasks: ${tasksN} rows cached (incomplete + updated in last 30 days, deduped)`
  );
  console.log(`[sync] leadsimple conversations: ${convN} rows cached (updated in last 30 days)`);
  console.log(`[sync] leadsimple contacts: ${contN} rows cached`);
  console.log(
    `[sync] leadsimple processes: ${procN} rows cached (open + completed in last 30 days, deduped)`
  );
  console.log(`[sync] leadsimple pipelines: ${pipeN} rows cached`);
  console.log(`[sync] leadsimple properties: ${propN} rows cached`);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const row of results) {
      if (!row.ok) continue;
      await client.query(`DELETE FROM ${row.table}`);
      await insertJsonRows(client, row.table, row.rows);
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
    await logLeadSimpleSync(syncTriggeredBy, "failed", ENDPOINT_COUNT, 0, syncErrors);
    throw e;
  } finally {
    client.release();
  }

  const totalRows = results.filter((x) => x.ok).reduce((acc, x) => acc + x.rows.length, 0);
  await logLeadSimpleSync(
    syncTriggeredBy,
    "completed",
    ENDPOINT_COUNT,
    totalRows,
    syncErrors.length ? syncErrors : null
  );

  return {
    skipped: false,
    endpointsSynced: ENDPOINT_COUNT,
    endpointsSucceeded: results.filter((x) => x.ok).length,
    totalRows,
    errors: syncErrors.length ? syncErrors : undefined,
  };
}
