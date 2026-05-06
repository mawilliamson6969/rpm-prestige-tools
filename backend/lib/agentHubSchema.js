/**
 * Phase 1 Agent Hub schema applier.
 *
 * The DDL lives in backend/migrations/025_agent_hub.sql. We read it at
 * boot and run it against the pool. The migration is idempotent
 * (CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING, etc.) so it's
 * safe to re-run on every restart.
 *
 * Why read the file instead of inlining the DDL like ensureInboxSchema()?
 * Phase 2/3 will add referrals + automations. Keeping the DDL in a single
 * .sql file means the schema diff is reviewable as one document, the
 * migration tool can apply it, and runtime can apply it. Single source.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "migrations", "025_agent_hub.sql");

let cachedSql = null;

function loadMigration() {
  if (cachedSql) return cachedSql;
  cachedSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  return cachedSql;
}

export async function ensureAgentHubSchema() {
  const pool = getPool();
  const sql = loadMigration();
  // pg supports multiple statements in one query when there are no
  // parameters. The migration uses CREATE OR REPLACE FUNCTION blocks
  // with $$ ... $$ delimiters, which the pg driver passes through fine.
  await pool.query(sql);
}
