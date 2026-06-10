/**
 * Contacts Phase 1 schema applier.
 *
 * The DDL lives in backend/migrations/042_contacts.sql. We read it at
 * boot and run it against the pool. The migration is idempotent
 * (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS) so it's safe
 * to re-run on every restart. Same pattern as ensureAgentHubSchema().
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "migrations", "042_contacts.sql");

let cachedSql = null;

function loadMigration() {
  if (cachedSql) return cachedSql;
  cachedSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  return cachedSql;
}

export async function ensureContactsSchema() {
  const pool = getPool();
  await pool.query(loadMigration());
}
