/**
 * Phase 1 Monday-style boards schema applier.
 *
 * The DDL lives in backend/migrations/029_mb_foundation.sql. We read it
 * at boot and run it against the pool. The migration is idempotent
 * (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS) so it's safe
 * to re-run on every restart.
 *
 * Same pattern as ensureAgentHubSchema() — single source of truth in the
 * .sql file, applied both by the migration tool and at runtime.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FOUNDATION_PATH = path.join(__dirname, "..", "migrations", "029_mb_foundation.sql");
const RENEWALS_SEED_PATH = path.join(__dirname, "..", "migrations", "030_mb_renewals_seed.sql");

const cache = new Map();

function loadSql(p) {
  if (cache.has(p)) return cache.get(p);
  const sql = fs.readFileSync(p, "utf8");
  cache.set(p, sql);
  return sql;
}

export async function ensureMbSchema() {
  const pool = getPool();
  await pool.query(loadSql(FOUNDATION_PATH));
}

/**
 * Phase 3: seed the Renewals board. Idempotent — re-running refreshes
 * read-only/derived values (renewal_score, tenant_name, property,
 * lease_end_date) but preserves user edits to editable columns
 * (status, owner, notes, etc.).
 */
export async function ensureMbRenewalsSeed() {
  const pool = getPool();
  await pool.query(loadSql(RENEWALS_SEED_PATH));
}
