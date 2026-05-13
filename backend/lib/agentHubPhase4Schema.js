/**
 * Phase 4 Agent Hub schema applier — applies migrations/028_agent_hub_phase4.sql
 * at boot, idempotent. Must run AFTER ensureAgentHubPhase3Schema().
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "migrations", "028_agent_hub_phase4.sql");

let cached = null;

export async function ensureAgentHubPhase4Schema() {
  const pool = getPool();
  if (!cached) cached = fs.readFileSync(MIGRATION_PATH, "utf8");
  await pool.query(cached);
}
