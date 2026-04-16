/**
 * AppFolio Property Manager — Reports API v2 (HTTP Basic Auth).
 * Base: https://[subdomain].appfolio.com/api/v2/reports/{endpoint}
 * Rate limit: 7 requests per 15 seconds (enforced below for outbound calls).
 */

const RATE_WINDOW_MS = 15_000;
const RATE_MAX_REQUESTS = 7;
const outboundTimestamps = [];

async function acquireAppfolioRateSlot() {
  for (;;) {
    const now = Date.now();
    while (outboundTimestamps.length && outboundTimestamps[0] < now - RATE_WINDOW_MS) {
      outboundTimestamps.shift();
    }
    if (outboundTimestamps.length < RATE_MAX_REQUESTS) {
      outboundTimestamps.push(Date.now());
      return;
    }
    const waitMs = RATE_WINDOW_MS - (now - outboundTimestamps[0]) + 50;
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 0)));
  }
}

function requireAppfolioConfig() {
  const clientId = process.env.APPFOLIO_CLIENT_ID?.trim();
  const clientSecret = process.env.APPFOLIO_CLIENT_SECRET?.trim();
  const subdomain = process.env.APPFOLIO_SUBDOMAIN?.trim();
  if (!clientId || !clientSecret || !subdomain) {
    const err = new Error(
      "AppFolio credentials are not configured. Set APPFOLIO_CLIENT_ID, APPFOLIO_CLIENT_SECRET, and APPFOLIO_SUBDOMAIN."
    );
    err.code = "APPFOLIO_CONFIG";
    throw err;
  }
  return { clientId, clientSecret, subdomain };
}

function basicAuthHeader(clientId, clientSecret) {
  const token = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

/** Unit rows from POST .../unit_directory.json use { results: [...] }. */
function normalizeUnitsPayload(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.results)) return json.results;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.units)) return json.units;
  return [];
}

/**
 * Vacancy from unit directory / report rows (status, etc.).
 */
export function isUnitVacant(unit) {
  if (!unit || typeof unit !== "object") return false;

  const candidates = [
    unit.status,
    unit.Status,
    unit.unit_status,
    unit.unitStatus,
    unit.occupancy_status,
    unit.OccupancyStatus,
    unit.rent_status,
    unit.rentStatus,
    unit.unit_occupancy_status,
    unit.UnitOccupancyStatus,
  ]
    .filter((v) => v != null && String(v).trim() !== "")
    .map((v) => String(v).toLowerCase().trim());

  const text = candidates.join(" ");

  if (
    /\b(vacant|available|unrented|unoccupied|for\s+rent|rent\s*ready\s*[-–]\s*unrented)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (/\b(occupied|leased|current|notice|pending)\b/.test(text)) {
    return false;
  }

  if (unit.leased === false || unit.is_leased === false) return true;
  if (unit.leased === true || unit.is_leased === true) return false;

  return false;
}

export function propertyLabel(unit) {
  const flat =
    unit.property_name ??
    unit.PropertyName ??
    unit.propertyName ??
    unit.property_label;
  if (flat != null && String(flat).trim()) return String(flat).trim();

  const p = unit.property;
  if (typeof p === "string" && p.trim()) return p.trim();
  if (p && typeof p === "object") {
    const name =
      p.name ??
      p.Name ??
      p.label ??
      p.Label ??
      p.property_name ??
      p.display_name ??
      p.title;
    if (name != null && String(name).trim()) return String(name).trim();
  }
  return "Unknown property";
}

/**
 * Fetches unit directory via Reports API v2 (POST + JSON body).
 */
export async function fetchAppfolioUnitsJson() {
  const { clientId, clientSecret, subdomain } = requireAppfolioConfig();
  const url = `https://${subdomain}.appfolio.com/api/v2/reports/unit_directory.json`;
  const body = JSON.stringify({
    property_visibility: "active",
    paginate_results: false,
  });

  await acquireAppfolioRateSlot();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (e) {
    const err = new Error(`Could not reach AppFolio: ${e.message || "network error"}`);
    err.code = "APPFOLIO_NETWORK";
    err.cause = e;
    throw err;
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const err = new Error("AppFolio returned a non-JSON response.");
    err.code = "APPFOLIO_PARSE";
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(
      json?.error || json?.message || `AppFolio request failed (${res.status})`
    );
    err.code = "APPFOLIO_HTTP";
    err.status = res.status;
    err.details = json;
    throw err;
  }

  return json;
}

/**
 * Normalizes AppFolio report JSON to a row array (handles results / array / data).
 */
export function normalizeReportResults(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.results)) return json.results;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.units)) return json.units;
  return [];
}

export function getNextPageUrl(json) {
  if (!json || typeof json !== "object") return null;
  const u = json.next_page_url ?? json.nextPageUrl ?? json.next_page ?? null;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

/**
 * POST to a full AppFolio Reports API URL (used for pagination via next_page_url).
 */
export async function postAppfolioReportAbsoluteUrl(url, bodyObj) {
  const { clientId, clientSecret } = requireAppfolioConfig();
  const body =
    typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj ?? {});

  await acquireAppfolioRateSlot();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (e) {
    const err = new Error(`Could not reach AppFolio: ${e.message || "network error"}`);
    err.code = "APPFOLIO_NETWORK";
    err.cause = e;
    throw err;
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const err = new Error("AppFolio returned a non-JSON response.");
    err.code = "APPFOLIO_PARSE";
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(
      json?.error || json?.message || `AppFolio request failed (${res.status})`
    );
    err.code = "APPFOLIO_HTTP";
    err.status = res.status;
    err.details = json;
    throw err;
  }

  return json;
}

/**
 * POST to Reports API v2: /api/v2/reports/{endpoint}.json
 */
export async function postAppfolioReport(endpointFilename, bodyObj) {
  const { subdomain } = requireAppfolioConfig();
  const url = `https://${subdomain}.appfolio.com/api/v2/reports/${endpointFilename}`;
  return postAppfolioReportAbsoluteUrl(url, bodyObj);
}

/**
 * GET a saved AppFolio report by absolute URL (for saved reports + pagination).
 */
export async function getAppfolioReportAbsoluteUrl(url) {
  const { clientId, clientSecret } = requireAppfolioConfig();
  await acquireAppfolioRateSlot();
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    const err = new Error(`Could not reach AppFolio: ${e.message || "network error"}`);
    err.code = "APPFOLIO_NETWORK";
    err.cause = e;
    throw err;
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const err = new Error("AppFolio returned a non-JSON response.");
    err.code = "APPFOLIO_PARSE";
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(json?.error || json?.message || `AppFolio request failed (${res.status})`);
    err.code = "APPFOLIO_HTTP";
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

/**
 * GET a saved AppFolio report by UUID.
 */
export async function getAppfolioSavedReport(uuid) {
  const { subdomain } = requireAppfolioConfig();
  const url = `https://${subdomain}.appfolio.com/api/v2/reports/saved/${uuid}.json?paginate_results=true&limit=5000`;
  return getAppfolioReportAbsoluteUrl(url);
}

export function summarizeOccupancy(unitsArray) {
  const units = Array.isArray(unitsArray) ? unitsArray : [];
  const totalUnitCount = units.length;
  let vacantCount = 0;
  const byProperty = new Map();

  for (const unit of units) {
    const vacant = isUnitVacant(unit);
    if (vacant) vacantCount += 1;
    const name = propertyLabel(unit);
    const cur = byProperty.get(name) || { propertyName: name, unitCount: 0, vacantCount: 0 };
    cur.unitCount += 1;
    if (vacant) cur.vacantCount += 1;
    byProperty.set(name, cur);
  }

  const occupiedCount = totalUnitCount - vacantCount;
  const occupancyRatePercent =
    totalUnitCount > 0 ? Math.round((occupiedCount / totalUnitCount) * 1000) / 10 : 0;

  return {
    totalUnitCount,
    occupiedCount,
    vacantCount,
    occupancyRatePercent,
    byProperty: Array.from(byProperty.values()).sort((a, b) =>
      a.propertyName.localeCompare(b.propertyName, undefined, { sensitivity: "base" })
    ),
  };
}

export async function getUnitsForResponse() {
  const json = await fetchAppfolioUnitsJson();
  return normalizeUnitsPayload(json);
}
