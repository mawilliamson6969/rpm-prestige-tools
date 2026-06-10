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
const PHASE2_PATH = path.join(__dirname, "..", "migrations", "043_process_contacts.sql");

let cachedSql = null;
let cachedPhase2Sql = null;

function loadMigration() {
  if (cachedSql) return cachedSql;
  cachedSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  return cachedSql;
}

function loadPhase2Migration() {
  if (cachedPhase2Sql) return cachedPhase2Sql;
  cachedPhase2Sql = fs.readFileSync(PHASE2_PATH, "utf8");
  return cachedPhase2Sql;
}

export async function ensureContactsSchema() {
  const pool = getPool();
  await pool.query(loadMigration());
}

/**
 * Phase 2: process_contacts + contact_roles on process_templates.
 * Separate applier (own steps-array entry) so a Phase 2 failure can't
 * take the Phase 1 tables down with it.
 */
export async function ensureProcessContactsSchema() {
  const pool = getPool();
  await pool.query(loadPhase2Migration());
}
