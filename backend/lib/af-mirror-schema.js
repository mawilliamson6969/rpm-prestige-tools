/**
 * AppFolio Database API mirror schema applier (Phase 2 + 2.1).
 *
 * The DDL lives in numbered migrations applied in order:
 *   043_appfolio_mirror_tables.sql   — schema + mirror tables + sync_state
 *   044_appfolio_curated_columns.sql — PII scrub of pre-existing rows,
 *                                      generated columns, indexes,
 *                                      appfolio.current_tenancies view
 *   045_appfolio_sync_phase3.sql     — missing_since, failure counters,
 *                                      missing-aware current_tenancies
 *   046_appfolio_webhook_events.sql  — raw webhook inbox (doorbell model)
 *
 * We read them at boot and run them against the pool — same pattern as
 * agentHubSchema.js. Both migrations are idempotent (CREATE ... IF NOT
 * EXISTS / CREATE OR REPLACE / guarded UPDATE throughout) so re-running
 * on every restart is safe.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILES = [
  "043_appfolio_mirror_tables.sql",
  "044_appfolio_curated_columns.sql",
  "045_appfolio_sync_phase3.sql",
  "046_appfolio_webhook_events.sql",
];

let cachedSql = null;

function loadMigrations() {
  if (cachedSql) return cachedSql;
  cachedSql = MIGRATION_FILES.map((f) =>
    fs.readFileSync(path.join(__dirname, "..", "migrations", f), "utf8")
  );
  return cachedSql;
}

export async function ensureAfMirrorSchema() {
  const pool = getPool();
  for (const sql of loadMigrations()) {
    await pool.query(sql);
  }
}
