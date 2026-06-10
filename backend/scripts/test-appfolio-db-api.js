/**
 * Proof-of-life for services/appfolio-db-api.js.
 *
 * Run from the backend/ directory:
 *   node scripts/test-appfolio-db-api.js
 *
 * Requires real Database API credentials in the environment:
 *   APPFOLIO_DB_CLIENT_ID, APPFOLIO_DB_CLIENT_SECRET, APPFOLIO_DB_DEVELOPER_ID
 *
 * Success: prints up to 10 properties + the first property's address,
 * exits 0. Any failure logs the error and exits 1.
 */

import appfolioDbApi from "../services/appfolio-db-api.js";

function firstIdentifyingField(property) {
  if (!property || typeof property !== "object") return "(no property object)";
  const candidates = [
    "Address1",
    "address1",
    "Address",
    "address",
    "Name",
    "name",
    "PropertyName",
    "property_name",
  ];
  for (const key of candidates) {
    if (property[key]) return `${key}: ${property[key]}`;
  }
  return `(no recognizable address field) keys=${Object.keys(property)
    .slice(0, 8)
    .join(",")}`;
}

async function main() {
  // Resolving settings validates APPFOLIO_DB_BASE_URL (https, *.appfolio.com)
  // before any request is made.
  const settings = appfolioDbApi.getSettings();
  console.log(`Base URL: ${settings.baseUrl}`);
  console.log(`Dry run:  ${settings.dryRun ? "ON (writes will be skipped)" : "off"}`);

  const response = await appfolioDbApi.get("/properties", {
    filters: { LastUpdatedAtFrom: "1970-01-01T00:00:00Z" },
    page: { size: 10 },
  });

  // AppFolio Database API typically wraps rows in { results: [...] };
  // accept a bare array or { data: [...] } too, just in case.
  const properties = Array.isArray(response)
    ? response
    : response?.results || response?.data || [];

  console.log(`Properties returned: ${properties.length}`);
  if (properties.length > 0) {
    console.log(`First property -> ${firstIdentifyingField(properties[0])}`);
  } else {
    console.log("No properties returned (empty result set).");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Proof-of-life FAILED:");
  console.error(`  message:    ${err.message}`);
  if (err.code) console.error(`  code:       ${err.code}`);
  if (err.status !== undefined) console.error(`  status:     ${err.status}`);
  if (err.statusText) console.error(`  statusText: ${err.statusText}`);
  if (err.method) console.error(`  method:     ${err.method}`);
  if (err.path) console.error(`  path:       ${err.path}`);
  if (err.body) console.error(`  body:       ${JSON.stringify(err.body)}`);
  process.exit(1);
});
