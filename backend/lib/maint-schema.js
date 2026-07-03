/**
 * Maintenance Management System schema applier (Phase 1).
 *
 * The DDL lives in a numbered migration applied at boot:
 *   047_maintenance.sql — all six core tables + maint_job_photos
 *
 * Read the migration at boot and run it against the pool — same pattern as
 * af-mirror-schema.js. The migration is idempotent (CREATE ... IF NOT EXISTS
 * throughout) so re-running on every restart is safe.
 *
 * MUST run after ensureAfMirrorSchema(): maint_jobs / maint_projects carry
 * TEXT FKs into appfolio.properties(id) and appfolio.units(id), so those
 * tables must exist first.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILES = ["047_maintenance.sql"];

let cachedSql = null;

function loadMigrations() {
  if (cachedSql) return cachedSql;
  cachedSql = MIGRATION_FILES.map((f) =>
    fs.readFileSync(path.join(__dirname, "..", "migrations", f), "utf8")
  );
  return cachedSql;
}

export async function ensureMaintSchema() {
  const pool = getPool();
  for (const sql of loadMigrations()) {
    await pool.query(sql);
  }
}
