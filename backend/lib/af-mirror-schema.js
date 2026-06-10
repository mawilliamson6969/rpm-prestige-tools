/**
 * AppFolio Database API mirror schema applier (Phase 2).
 *
 * The DDL lives in backend/migrations/037_af_mirror_tables.sql. We read
 * it at boot and run it against the pool — same pattern as
 * agentHubSchema.js. The migration is idempotent (CREATE TABLE IF NOT
 * EXISTS throughout) so it's safe to re-run on every restart.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "migrations", "037_af_mirror_tables.sql");

let cachedSql = null;

function loadMigration() {
  if (cachedSql) return cachedSql;
  cachedSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  return cachedSql;
}

export async function ensureAfMirrorSchema() {
  const pool = getPool();
  await pool.query(loadMigration());
}
