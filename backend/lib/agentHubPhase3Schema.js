/**
 * Phase 3 Agent Hub schema applier — applies migrations/027_agent_hub_phase3.sql
 * at boot, idempotent. Must run AFTER ensureAgentHubPhase2Schema().
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "migrations", "027_agent_hub_phase3.sql");

let cachedSql = null;

function loadMigration() {
  if (cachedSql) return cachedSql;
  cachedSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  return cachedSql;
}

export async function ensureAgentHubPhase3Schema() {
  const pool = getPool();
  const sql = loadMigration();
  await pool.query(sql);
}
