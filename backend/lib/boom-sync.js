/**
 * Boom Screening Partner API → PostgreSQL cache.
 * https://api.production.boompay.app/partner/v1 — Bearer token from POST /authenticate
 */
import { getPool } from "./db.js";

const BASE = "https://api.production.boompay.app/partner/v1";
const GAP_MS = 300;
const PER_PAGE = 20;

/** In-memory token cache (refresh on 401 or expiry). */
let tokenCache = { token: null, expiresAtMs: 0 };

function delay(ms = GAP_MS) {
  return new Promise((r) => setTimeout(r, ms));
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function normalizeList(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.results)) return json.results;
    if (Array.isArray(json.applications)) return json.applications;
    if (Array.isArray(json.properties)) return json.properties;
    if (Array.isArray(json.units)) return json.units;
  }
  return [];
}

async function logBoomSync(triggeredBy, status, endpointsSynced, totalRows, errors) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO sync_log (status, triggered_by, source, endpoints_synced, total_rows_synced, completed_at, errors)
     VALUES ($1, $2, 'boom', $3, $4, NOW(), $5::jsonb)`,
    [status, triggeredBy, endpointsSynced, totalRows, errors?.length ? JSON.stringify(errors) : null]
  );
}

async function authenticateBoom(accessKey, secretKey) {
  await delay();
  const res = await fetch(`${BASE}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ access_key: accessKey, secret_key: secretKey }),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Boom auth: invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      `Boom authenticate ${res.status}: ${json.message || json.error || text?.slice(0, 200)}`
    );
  }
  const token =
    json.auth_token ??
    json.data?.auth_token ??
    json.access_token ??
    json.token ??
    json.bearer_token ??
    json.data?.access_token ??
    json.data?.token;
  if (!token || typeof token !== "string") {
    throw new Error("Boom authenticate: no token in response");
  }
  const expiresInSec = Number(json.expires_in ?? json.expiresIn ?? 2700);
  const ttlMs =
    Number.isFinite(expiresInSec) && expiresInSec > 120 ? expiresInSec * 1000 - 60_000 : 45 * 60 * 1000;
  tokenCache = { token, expiresAtMs: Date.now() + ttlMs };
  return token;
}

async function getValidToken(accessKey, secretKey) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAtMs) {
    return tokenCache.token;
  }
  return authenticateBoom(accessKey, secretKey);
}

/**
 * GET/POST with 300ms spacing, 401 re-auth once, 429 Retry-After (up to 3 retries).
 */
async function boomFetch(pathWithQuery, accessKey, secretKey, opts = {}) {
  const { method = "GET", body, is401Retry = false, rate429Attempts = 0 } = opts;
  await delay();
  const token = await getValidToken(accessKey, secretKey);
  const res = await fetch(`${BASE}${pathWithQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(method !== "GET" && body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !is401Retry) {
    tokenCache = { token: null, expiresAtMs: 0 };
    await authenticateBoom(accessKey, secretKey);
    return boomFetch(pathWithQuery, accessKey, secretKey, { ...opts, is401Retry: true });
  }

  if (res.status === 429 && rate429Attempts < 3) {
    const ra = res.headers.get("Retry-After");
    const sec = ra != null ? parseInt(ra, 10) : NaN;
    const waitMs = Number.isFinite(sec) && sec >= 0 ? sec * 1000 : 5000;
    await sleepMs(waitMs);
    return boomFetch(pathWithQuery, accessKey, secretKey, { ...opts, rate429Attempts: rate429Attempts + 1 });
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Boom ${pathWithQuery}: invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text?.slice(0, 200) || res.statusText;
    throw new Error(`Boom ${res.status} ${pathWithQuery}: ${msg}`);
  }
  return json;
}

async function fetchAllPages(accessKey, secretKey, path) {
  let page = 1;
  const out = [];
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const pathWithQuery = `${path}${sep}page=${page}&per_page=${PER_PAGE}`;
    const json = await boomFetch(pathWithQuery, accessKey, secretKey);
    const batch = normalizeList(json);
    out.push(...batch);
    if (batch.length < PER_PAGE) break;
    page += 1;
  }
  return out;
}

/**
 * Runs after RentEngine sync. Skips if credentials unset.
 * @param {string} [triggeredBy] — e.g. 'cron' | 'manual' | 'startup' (defaults for sync_log if missing)
 */
export async function runBoomSync(triggeredBy) {
  const syncTriggeredBy =
    typeof triggeredBy === "string" && triggeredBy.trim() !== "" ? triggeredBy.trim() : "sync";

  const accessKey = process.env.BOOM_ACCESS_KEY?.trim();
  const secretKey = process.env.BOOM_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) {
    console.log("[sync] boom: skipped (BOOM_ACCESS_KEY / BOOM_SECRET_KEY not set)");
    return { skipped: true, applications: 0, properties: 0, units: 0 };
  }

  const syncErrors = [];
  let applications = [];
  let properties = [];
  let units = [];

  try {
    await authenticateBoom(accessKey, secretKey);
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[sync] boom authenticate failed:", msg);
    await logBoomSync(syncTriggeredBy, "failed", 0, 0, [{ step: "authenticate", error: msg }]);
    return { skipped: true, error: msg };
  }

  try {
    applications = await fetchAllPages(accessKey, secretKey, "/applications");
    console.log(`[sync] boom applications: ${applications.length} rows cached`);
  } catch (e) {
    const msg = e?.message || String(e);
    syncErrors.push({ step: "applications", error: msg });
    console.error("[sync] boom applications failed:", msg);
    await logBoomSync(syncTriggeredBy, "failed", 0, 0, syncErrors);
    return { applications: 0, failed: true };
  }

  try {
    properties = await fetchAllPages(accessKey, secretKey, "/properties");
    console.log(`[sync] boom properties: ${properties.length} rows cached`);
  } catch (e) {
    const msg = e?.message || String(e);
    syncErrors.push({ step: "properties", error: msg });
    console.error("[sync] boom properties failed:", msg);
  }

  try {
    units = await fetchAllPages(accessKey, secretKey, "/units");
    console.log(`[sync] boom units: ${units.length} rows cached`);
  } catch (e) {
    const msg = e?.message || String(e);
    syncErrors.push({ step: "units", error: msg });
    console.error("[sync] boom units failed:", msg);
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM cached_boom_applications`);
    await insertJsonRows(client, "cached_boom_applications", applications);
    await client.query(`DELETE FROM cached_boom_properties`);
    await insertJsonRows(client, "cached_boom_properties", properties);
    await client.query(`DELETE FROM cached_boom_units`);
    await insertJsonRows(client, "cached_boom_units", units);
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    syncErrors.push({ step: "database", error: e?.message || String(e) });
    await logBoomSync(syncTriggeredBy, "failed", 3, 0, syncErrors);
    throw e;
  } finally {
    client.release();
  }

  const totalRows = applications.length + properties.length + units.length;
  await logBoomSync(syncTriggeredBy, "completed", 3, totalRows, syncErrors.length ? syncErrors : null);

  return {
    applications: applications.length,
    properties: properties.length,
    units: units.length,
  };
}
