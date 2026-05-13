-- Phase 4: Item detail — updates feed (comments, replies, mentions,
-- reactions, attachments).
--
-- IMPORTANT — naming reconciliation:
--   The Phase 4 spec proposed creating a new `mb_updates` table with
--   UUID PKs. Phase 1 already shipped `mb_item_updates` with SERIAL PKs
--   and INTEGER FKs to users(id) — the standing convention for this
--   codebase. We EXTEND the existing table rather than create a parallel
--   one. All new tables here follow the same SERIAL/INTEGER convention.
--
-- Idempotent:
--   * ADD COLUMN IF NOT EXISTS for the new mb_item_updates columns.
--   * CREATE TABLE IF NOT EXISTS for the new mention/reaction/attachment
--     tables.
--   * CREATE TRIGGER guarded by an "IF NOT EXISTS via DROP first" idiom
--     (CREATE TRIGGER lacks IF NOT EXISTS pre-pg14).
--
-- "No reply-to-reply" rule:
--   A CHECK constraint cannot contain a subquery in Postgres, so we
--   enforce one-level-only nesting with a BEFORE INSERT/UPDATE trigger.

-- ------------------------------------------------------------
-- 1. mb_item_updates: new columns
-- ------------------------------------------------------------

ALTER TABLE mb_item_updates
  ADD COLUMN IF NOT EXISTS parent_update_id INTEGER
    REFERENCES mb_item_updates(id) ON DELETE CASCADE;

ALTER TABLE mb_item_updates
  ADD COLUMN IF NOT EXISTS body_html TEXT;

ALTER TABLE mb_item_updates
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

ALTER TABLE mb_item_updates
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mb_item_updates_parent
  ON mb_item_updates (parent_update_id)
  WHERE parent_update_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mb_item_updates_user
  ON mb_item_updates (user_id)
  WHERE user_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. One-level-only nesting trigger
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION mb_item_updates_block_nested_replies()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_update_id IS NOT NULL THEN
    PERFORM 1 FROM mb_item_updates p
      WHERE p.id = NEW.parent_update_id
        AND p.parent_update_id IS NOT NULL;
    IF FOUND THEN
      RAISE EXCEPTION 'Replies cannot have replies (parent % is itself a reply).',
        NEW.parent_update_id
        USING ERRCODE = '23514';  -- check_violation
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mb_item_updates_block_nested ON mb_item_updates;
CREATE TRIGGER trg_mb_item_updates_block_nested
  BEFORE INSERT OR UPDATE OF parent_update_id ON mb_item_updates
  FOR EACH ROW EXECUTE FUNCTION mb_item_updates_block_nested_replies();

-- ------------------------------------------------------------
-- 3. mb_update_mentions
-- ------------------------------------------------------------
--
-- An @mention on an update. seen_at is set when the mentioned user opens
-- the parent item. Unseen rows feed the badge counter on the board view.

CREATE TABLE IF NOT EXISTS mb_update_mentions (
  id                  SERIAL PRIMARY KEY,
  update_id           INTEGER NOT NULL REFERENCES mb_item_updates(id) ON DELETE CASCADE,
  mentioned_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (update_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_mb_mentions_unseen
  ON mb_update_mentions (mentioned_user_id)
  WHERE seen_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mb_mentions_update
  ON mb_update_mentions (update_id);

-- ------------------------------------------------------------
-- 4. mb_update_reactions
-- ------------------------------------------------------------
--
-- One row per (update, user, emoji). Adding the same reaction twice is
-- a no-op via ON CONFLICT DO NOTHING (handled in app layer); the unique
-- index here is the guarantee.

CREATE TABLE IF NOT EXISTS mb_update_reactions (
  id          SERIAL PRIMARY KEY,
  update_id   INTEGER NOT NULL REFERENCES mb_item_updates(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (update_id, user_id, emoji),
  CHECK (emoji IN ('👍','❤️','😄','🎉','😢','🚀'))
);

CREATE INDEX IF NOT EXISTS idx_mb_reactions_update ON mb_update_reactions (update_id);

-- ------------------------------------------------------------
-- 5. mb_update_attachments
-- ------------------------------------------------------------
--
-- storage_path is the server-generated UUID filename (e.g.
-- "<uuid>.png") relative to the private uploads root
-- (backend/uploads-private/mb-updates/). NEVER user-supplied —
-- prevents path traversal. The display `filename` keeps the original
-- name for the UI.

CREATE TABLE IF NOT EXISTS mb_update_attachments (
  id            SERIAL PRIMARY KEY,
  update_id     INTEGER NOT NULL REFERENCES mb_item_updates(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  storage_path  TEXT NOT NULL UNIQUE,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (size_bytes > 0 AND size_bytes <= 10485760) -- 10 MB
);

CREATE INDEX IF NOT EXISTS idx_mb_attachments_update
  ON mb_update_attachments (update_id);
