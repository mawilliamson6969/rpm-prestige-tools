/**
 * Phase 2 Agent Hub schema applier — applies migrations/026_agent_hub_phase2.sql
 * at boot, idempotent.
 *
 * Must run AFTER ensureAgentHubSchema() because Phase 2 references
 * agent_hub_agents, agent_hub_activities, etc.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "migrations", "026_agent_hub_phase2.sql");

let cachedSql = null;

function loadMigration() {
  if (cachedSql) return cachedSql;
  cachedSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  return cachedSql;
}

export async function ensureAgentHubPhase2Schema() {
  const pool = getPool();
  const sql = loadMigration();
  await pool.query(sql);
}

/**
 * Refresh the agent_hub_agent_lifetime_value materialized view.
 * Called by:
 *   - Nightly cron at 2:15am (see backend/index.js)
 *   - On-demand from POST /agent-hub/lifetime-value/refresh
 *   - From inside payment / revenue / advance-stage handlers
 *
 * CONCURRENTLY means reads during the refresh aren't blocked, BUT only
 * one CONCURRENT refresh can run at a time on the same MV. If a second
 * caller arrives mid-refresh, Postgres errors with
 *   "cannot refresh materialized view ... concurrently"
 * (SQLSTATE 55000).
 *
 * To handle high-write bursts (e.g. bulk imports, multiple payments
 * recorded in quick succession), we coalesce: if a refresh is already
 * running, the next caller marks _pending and returns. When the running
 * refresh finishes, it checks _pending and re-runs if needed. This
 * collapses N concurrent calls into at most 2 actual refreshes, which
 * is exactly the right semantics — the second refresh sees all writes
 * that happened during the first.
 */
let _running = null; // Promise of in-flight refresh
let _pending = false; // Another refresh requested while one was running

export async function refreshAgentLifetimeValue() {
  if (_running) {
    _pending = true;
    return _running;
  }
  _running = (async () => {
    try {
      const pool = getPool();
      await pool.query(`SELECT refresh_agent_lifetime_value()`);
      return new Date().toISOString();
    } finally {
      const wasPending = _pending;
      _pending = false;
      _running = null;
      if (wasPending) {
        // Don't await — fire and forget, otherwise the first caller
        // ends up waiting for the coalesced second refresh too.
        // Non-blocking: errors logged by the caller.
        refreshAgentLifetimeValue().catch((e) =>
          console.error("[agent-hub] coalesced LTV refresh", e)
        );
      }
    }
  })();
  return _running;
}
