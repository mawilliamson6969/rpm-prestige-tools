/**
 * AppFolio Property Manager REST API (Basic Auth).
 * Base: https://[subdomain].appfolio.com/api/v1/
 */

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

function normalizeUnitsPayload(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.units)) return json.units;
  if (json && Array.isArray(json.results)) return json.results;
  return [];
}

/**
 * Heuristic vacancy detection — AppFolio field names vary; we match common status strings.
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
  const flat =
    unit.property_name ??
    unit.PropertyName ??
    unit.propertyName ??
    unit.property_label;
  if (flat != null && String(flat).trim()) return String(flat).trim();
  return "Unknown property";
}

export async function fetchAppfolioUnitsJson() {
  const { clientId, clientSecret, subdomain } = requireAppfolioConfig();
  const url = `https://${subdomain}.appfolio.com/api/v1/units.json`;

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        Accept: "application/json",
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
