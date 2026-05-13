-- Phase 3.5: Board customization (Tier 1).
--
-- Adds the schema bits the admin-driven customization UI needs:
--   * mb_boards.is_system — protects baked-in boards (Renewals) from being
--     renamed or archived through the UI.
--   * mb_board_columns.archived_at — soft-delete for columns. Matches the
--     archived_at convention already used on mb_boards and mb_items so
--     the existing `WHERE archived_at IS NULL` filter pattern carries over.
--     We deliberately did NOT add a redundant is_archived boolean — single
--     source of truth.
--   * mb_board_columns.column_type CHECK now includes 'dropdown'. Status
--     and dropdown share the same options-list shape but differ in UI
--     affordance (status for workflow state, dropdown for categorization).
--   * Renewals board flagged as is_system.
--
-- All operations are idempotent and safe to re-run.

-- ------------------------------------------------------------
-- 1. mb_boards.is_system
-- ------------------------------------------------------------

ALTER TABLE mb_boards
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_mb_boards_is_system
  ON mb_boards (is_system)
  WHERE is_system = TRUE;

-- ------------------------------------------------------------
-- 2. mb_board_columns.archived_at
-- ------------------------------------------------------------

ALTER TABLE mb_board_columns
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mb_board_columns_archived_at
  ON mb_board_columns (archived_at);

-- ------------------------------------------------------------
-- 3. mb_board_columns.column_type CHECK: include 'dropdown'
-- ------------------------------------------------------------
--
-- Postgres doesn't expose CHECK constraints by a stable name unless we
-- gave them one. The Phase 1 table created an unnamed inline CHECK on
-- column_type; we look it up by definition and replace it with the new
-- list (which adds 'dropdown'). If a previous run of this migration
-- already replaced it with the new name (mb_board_columns_column_type_chk),
-- the DO block is a no-op.

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  -- Drop ANY existing CHECK constraint on column_type, by name.
  FOR v_conname IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class       rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'mb_board_columns'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%column_type%'
  LOOP
    EXECUTE format('ALTER TABLE mb_board_columns DROP CONSTRAINT %I', v_conname);
  END LOOP;

  -- Add the new one with a stable name so a future migration can find it.
  ALTER TABLE mb_board_columns
    ADD CONSTRAINT mb_board_columns_column_type_chk
    CHECK (column_type IN (
      'text','status','priority','date','money','person',
      'tags','number','score','longtext','url','file','dropdown'
    ));
END $$;

-- ------------------------------------------------------------
-- 4. Mark the Renewals board as a system board
-- ------------------------------------------------------------

UPDATE mb_boards
   SET is_system = TRUE
 WHERE slug = 'renewals'
   AND is_system = FALSE;
