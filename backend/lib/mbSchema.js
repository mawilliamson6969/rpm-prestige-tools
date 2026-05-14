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
const CUSTOMIZATION_PATH = path.join(__dirname, "..", "migrations", "031_mb_customization.sql");
const UPDATES_PATH = path.join(__dirname, "..", "migrations", "032_mb_updates.sql");
const SUBITEMS_PATH = path.join(__dirname, "..", "migrations", "033_mb_subitems_and_templates.sql");
const DASHBOARDS_PATH = path.join(__dirname, "..", "migrations", "034_mb_dashboards_aggregation.sql");

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

/**
 * Phase 3.5: customization additions (is_system flag, column archive,
 * dropdown column type). Idempotent ALTER TABLE … ADD COLUMN IF NOT
 * EXISTS plus a DO block that replaces the column_type CHECK.
 *
 * Order: this MUST run after the renewals seed so the system-board
 * flag can be applied to the seeded Renewals row.
 */
export async function ensureMbCustomizationSchema() {
  const pool = getPool();
  await pool.query(loadSql(CUSTOMIZATION_PATH));
}

/**
 * Phase 4: extend mb_item_updates and add mentions/reactions/attachments
 * tables. Includes the "no nested replies" trigger.
 */
export async function ensureMbUpdatesSchema() {
  const pool = getPool();
  await pool.query(loadSql(UPDATES_PATH));
}

/**
 * Phase 5: Subitems + embedded instructions schema.
 * - Extends mb_items with parent_item_id, subitem_template_id,
 *   subitem_position, subitem_detached_at, instructions (JSONB).
 * - Installs the no-sub-sub-items trigger.
 * - Adds archived_at + workflow_name on mb_subitem_templates and the
 *   per-subitem checklist state table.
 * - Seeds the five-step Lease Renewal workflow on the Renewals board.
 *
 * Must run AFTER ensureMbRenewalsSeed so the seed step can find the
 * Renewals board by slug.
 */
export async function ensureMbSubitemsSchema() {
  const pool = getPool();
  await pool.query(loadSql(SUBITEMS_PATH));
}

/**
 * Phase 6: per-board aggregation settings (mb_board_settings),
 * mb_items.aggregated_status cache, triage/calendar indexes, and a
 * default settings row for every existing board.
 */
export async function ensureMbDashboardsSchema() {
  const pool = getPool();
  await pool.query(loadSql(DASHBOARDS_PATH));
}
