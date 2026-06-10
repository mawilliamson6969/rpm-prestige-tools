/**
 * Backfill / delta-sync the AppFolio Database API mirror tables.
 *
 * Run from the backend/ directory:
 *   node scripts/backfill-appfolio-db.js                 # full backfill, all resources
 *   node scripts/backfill-appfolio-db.js properties      # full backfill, one resource
 *   node scripts/backfill-appfolio-db.js --delta         # delta sync since last run
 *   node scripts/backfill-appfolio-db.js tenants leases --delta
 *
 * Requires:
 *   DATABASE_URL
 *   APPFOLIO_DB_CLIENT_ID, APPFOLIO_DB_CLIENT_SECRET, APPFOLIO_DB_DEVELOPER_ID
 *
 * The af_* tables are created at app boot; this script also applies the
 * migration itself so it works against a fresh database without the API
 * server having started.
 *
 * Exits 0 when every requested resource synced; 1 otherwise.
 */

import { ensureAfMirrorSchema } from "../lib/af-mirror-schema.js";
import { syncResource, syncAll, MIRRORED_RESOURCES } from "../services/appfolio-db-sync.js";

const args = process.argv.slice(2);
const mode = args.includes("--delta") ? "delta" : "full";
const requested = args.filter((a) => !a.startsWith("--"));

const unknown = requested.filter((r) => !MIRRORED_RESOURCES.includes(r));
if (unknown.length) {
  console.error(`Unknown resource(s): ${unknown.join(", ")}`);
  console.error(`Known resources: ${MIRRORED_RESOURCES.join(", ")}`);
  process.exit(1);
}

const onProgress = (msg) => console.log(`  ${msg}`);

async function main() {
  await ensureAfMirrorSchema();
  console.log(`Mode: ${mode}${requested.length ? ` | resources: ${requested.join(", ")}` : " | all resources"}`);

  let ok = true;
  if (requested.length === 0) {
    const summary = await syncAll({ mode, triggeredBy: "cli", onProgress });
    for (const r of summary.results) {
      console.log(`${r.resource}: ${r.upserted} upserted across ${r.pages} page(s)${r.skipped ? `, ${r.skipped} skipped (no id)` : ""}`);
    }
    for (const e of summary.errors) {
      console.error(`${e.resource}: FAILED — ${e.message}`);
    }
    ok = summary.ok;
  } else {
    for (const name of requested) {
      try {
        const r = await syncResource(name, { mode, onProgress });
        console.log(`${r.resource}: ${r.upserted} upserted across ${r.pages} page(s)${r.skipped ? `, ${r.skipped} skipped (no id)` : ""}`);
      } catch (err) {
        ok = false;
        console.error(`${name}: FAILED — ${err.message}`);
      }
    }
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("Backfill FAILED before syncing began:");
  console.error(`  ${err.message}`);
  process.exit(1);
});
