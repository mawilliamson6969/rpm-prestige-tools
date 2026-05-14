-- Phase 6: Dashboards (Triage + Calendar) + auto-aggregation.
--
-- Adjustments from spec to match actual Phase 1 schema:
--   * Phase 1 uses SERIAL primary keys, not UUIDs.
--   * The columns table is mb_board_columns (not mb_columns).
--   * The column type field is column_type (not type).
--   * Soft-delete is via archived_at IS NULL (no is_archived boolean).
--   * Item status is stored inside mb_items.values JSONB under the key
--     'status' (not a dedicated status_value column).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- INSERT … WHERE NOT EXISTS. Safe to re-run.

-- ------------------------------------------------------------
-- 1. Per-board settings
-- ------------------------------------------------------------
--
-- One row per board. Both aggregation flags default to FALSE — boards
-- behave exactly as they did pre-Phase-6 until an admin opts in.
-- primary_date_column_id powers both calendar plotting and the
-- "past due / due soon" triage scoring.

CREATE TABLE IF NOT EXISTS mb_board_settings (
  board_id                INTEGER PRIMARY KEY REFERENCES mb_boards(id) ON DELETE CASCADE,
  auto_aggregate_status   BOOLEAN NOT NULL DEFAULT FALSE,
  auto_aggregate_progress BOOLEAN NOT NULL DEFAULT FALSE,
  primary_date_column_id  INTEGER REFERENCES mb_board_columns(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- 2. Cached aggregated status on mb_items
-- ------------------------------------------------------------
--
-- When auto-aggregation is on for a board, the aggregator writes both
-- mb_items.aggregated_status (the cached label string used by the UI's
-- "Auto" badge) AND the parent's values.status (the canonical column
-- value, so existing Phase 3 read paths "just work"). aggregated_status
-- being non-NULL is the signal to the UI to render the parent as
-- read-only with an Auto badge.

ALTER TABLE mb_items
  ADD COLUMN IF NOT EXISTS aggregated_status TEXT;

ALTER TABLE mb_items
  ADD COLUMN IF NOT EXISTS aggregated_status_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 3. Triage / calendar indexes
-- ------------------------------------------------------------
--
-- The triage query joins mb_items, mb_update_mentions, and a date-
-- column-value lookup. The two queries it has to run fast:
--
--   * "all top-level non-archived items, newest update activity first"
--   * "items by date" (calendar window)
--
-- The first is served by idx_mb_items_triage. The status filter is
-- pushed to a generated key on the values JSONB so we don't have to
-- jsonb_extract on every row at filter time.

CREATE INDEX IF NOT EXISTS idx_mb_items_triage
  ON mb_items (updated_at DESC)
  WHERE archived_at IS NULL AND parent_item_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mb_items_aggregated
  ON mb_items (aggregated_status)
  WHERE aggregated_status IS NOT NULL;

-- A GIN index on mb_items.values lets us filter on `values->>'status'`,
-- `values->>'owner'`, and the primary-date column key efficiently.
-- Phase 1 doesn't have this; add it now since Phase 6 queries lean on it.
CREATE INDEX IF NOT EXISTS idx_mb_items_values_gin
  ON mb_items USING GIN (values jsonb_path_ops)
  WHERE archived_at IS NULL;

-- ------------------------------------------------------------
-- 4. Seed default settings for every existing board
-- ------------------------------------------------------------
--
-- Default primary_date_column_id picks the first active date-type
-- column on the board, if any. Renewals gets an explicit override to
-- Lease End Date below.

INSERT INTO mb_board_settings (board_id, primary_date_column_id)
SELECT b.id,
       (
         SELECT c.id
           FROM mb_board_columns c
          WHERE c.board_id = b.id
            AND c.column_type = 'date'
            AND c.archived_at IS NULL
          ORDER BY c.position ASC
          LIMIT 1
       )
  FROM mb_boards b
 WHERE NOT EXISTS (
   SELECT 1 FROM mb_board_settings s WHERE s.board_id = b.id
 );

-- Renewals: explicit pin to Lease End Date so the calendar plots
-- against lease ends out-of-the-box. Idempotent — only sets when
-- the field is NULL or different.

UPDATE mb_board_settings s
   SET primary_date_column_id = (
     SELECT c.id
       FROM mb_board_columns c
       JOIN mb_boards b ON b.id = c.board_id
      WHERE b.slug = 'renewals'
        AND c.key = 'lease_end_date'
        AND c.archived_at IS NULL
      LIMIT 1
   )
 WHERE s.board_id = (SELECT id FROM mb_boards WHERE slug = 'renewals')
   AND (
     s.primary_date_column_id IS NULL
     OR s.primary_date_column_id NOT IN (
       SELECT c.id FROM mb_board_columns c WHERE c.key = 'lease_end_date'
     )
   );
