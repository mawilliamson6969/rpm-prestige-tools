-- Phase 1: Monday-style boards foundation ("mb_" = monday board).
--
-- Scope (Phase 1, additive only — does NOT touch existing process/board tables):
--   * Boards, columns, groups, items, subitems, subitem templates with
--     structured instructions, updates feeds, AppFolio API audit log,
--     and webhook receiver event log.
--   * No UI, no automations, no AppFolio sync — just the substrate.
--
-- Conventions matched to existing codebase (see 025_agent_hub.sql):
--   * SERIAL primary keys (NOT uuid). FKs to users(id) are INTEGER.
--     Spec called for UUID; users.id is SERIAL so UUID FKs would not link.
--   * TIMESTAMPTZ DEFAULT NOW().
--   * CHECK constraints validate enums in-database.
--   * Soft-delete via archived_at TIMESTAMPTZ (null = active).
--   * Idempotent: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING.
--     Safe to re-run on every boot.
--   * Applied at runtime by ensureMbSchema() in lib/mbSchema.js.
--
-- The existing LeadSimple-style process boards (processes, board_*, stages,
-- subtasks) are left completely untouched and continue to run alongside.

-- ============================================================
-- 1. mb_boards
-- ============================================================

CREATE TABLE IF NOT EXISTS mb_boards (
  id                      SERIAL PRIMARY KEY,
  name                    TEXT NOT NULL,
  slug                    TEXT NOT NULL UNIQUE,
  description             TEXT,
  icon                    TEXT,
  color                   TEXT,
  appfolio_resource_type  TEXT,
  default_view            TEXT NOT NULL DEFAULT 'table',
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at             TIMESTAMPTZ,
  CHECK (default_view IN ('table','dashboard','calendar','kanban','workload','map'))
);

CREATE INDEX IF NOT EXISTS idx_mb_boards_archived_at ON mb_boards (archived_at);
CREATE INDEX IF NOT EXISTS idx_mb_boards_slug ON mb_boards (slug);

-- ============================================================
-- 2. mb_groups (horizontal groupings within a board)
-- ============================================================

CREATE TABLE IF NOT EXISTS mb_groups (
  id            SERIAL PRIMARY KEY,
  board_id      INTEGER NOT NULL REFERENCES mb_boards(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  color         TEXT,
  position      INTEGER NOT NULL,
  is_collapsed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mb_groups_board ON mb_groups (board_id, position);

-- ============================================================
-- 3. mb_board_columns
-- ============================================================

CREATE TABLE IF NOT EXISTS mb_board_columns (
  id              SERIAL PRIMARY KEY,
  board_id        INTEGER NOT NULL REFERENCES mb_boards(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  key             TEXT NOT NULL,
  column_type     TEXT NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  position        INTEGER NOT NULL,
  width           INTEGER NOT NULL DEFAULT 150,
  is_required     BOOLEAN NOT NULL DEFAULT FALSE,
  appfolio_field  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (column_type IN (
    'text','status','priority','date','money','person',
    'tags','number','score','longtext','url','file'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mb_board_columns_board_key
  ON mb_board_columns (board_id, key);
CREATE INDEX IF NOT EXISTS idx_mb_board_columns_board
  ON mb_board_columns (board_id, position);

-- ============================================================
-- 4. mb_items (rows on a board)
-- ============================================================
--
-- `position` is NUMERIC so drag-drop reorders can insert between two
-- adjacent items by averaging their positions, avoiding a full
-- re-numbering on every move.

CREATE TABLE IF NOT EXISTS mb_items (
  id                      SERIAL PRIMARY KEY,
  board_id                INTEGER NOT NULL REFERENCES mb_boards(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  position                NUMERIC NOT NULL,
  group_id                INTEGER REFERENCES mb_groups(id) ON DELETE SET NULL,
  values                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  appfolio_id             TEXT,
  appfolio_resource_type  TEXT,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_to             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  archived_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mb_items_board ON mb_items (board_id, position);
CREATE INDEX IF NOT EXISTS idx_mb_items_group ON mb_items (group_id);
CREATE INDEX IF NOT EXISTS idx_mb_items_assigned_to ON mb_items (assigned_to)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mb_items_appfolio
  ON mb_items (appfolio_resource_type, appfolio_id)
  WHERE appfolio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mb_items_archived_at ON mb_items (archived_at);

-- ============================================================
-- 5. mb_subitem_templates (reusable subitem definitions w/ instructions)
-- ============================================================
--
-- This is THE table for Phase 2/3 — instructions for each step of each
-- workflow live here. The instructions JSONB shape is documented in
-- /frontend/types/mb.ts (Instructions interface).

CREATE TABLE IF NOT EXISTS mb_subitem_templates (
  id                         SERIAL PRIMARY KEY,
  board_id                   INTEGER NOT NULL REFERENCES mb_boards(id) ON DELETE CASCADE,
  name                       TEXT NOT NULL,
  description                TEXT,
  position                   INTEGER NOT NULL,
  default_assignee_role      TEXT,
  default_due_offset_days    INTEGER,
  estimated_minutes          INTEGER,
  is_automated               BOOLEAN NOT NULL DEFAULT FALSE,
  instructions               JSONB NOT NULL DEFAULT '{}'::jsonb,
  escalation_triggers        JSONB NOT NULL DEFAULT '[]'::jsonb,
  completion_checklist       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mb_subitem_templates_board
  ON mb_subitem_templates (board_id, position);

-- ============================================================
-- 6. mb_subitems (tasks within an item)
-- ============================================================

CREATE TABLE IF NOT EXISTS mb_subitems (
  id                 SERIAL PRIMARY KEY,
  item_id            INTEGER NOT NULL REFERENCES mb_items(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  position           NUMERIC NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  assigned_to        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date           TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  estimated_minutes  INTEGER,
  is_automated       BOOLEAN NOT NULL DEFAULT FALSE,
  template_id        INTEGER REFERENCES mb_subitem_templates(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending','in_progress','done','blocked','skipped'))
);

CREATE INDEX IF NOT EXISTS idx_mb_subitems_item ON mb_subitems (item_id, position);
CREATE INDEX IF NOT EXISTS idx_mb_subitems_assigned_to
  ON mb_subitems (assigned_to)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mb_subitems_status ON mb_subitems (status);
CREATE INDEX IF NOT EXISTS idx_mb_subitems_template ON mb_subitems (template_id);

-- ============================================================
-- 7. mb_item_updates (activity feed on the parent item)
-- ============================================================

CREATE TABLE IF NOT EXISTS mb_item_updates (
  id                 SERIAL PRIMARY KEY,
  item_id            INTEGER NOT NULL REFERENCES mb_items(id) ON DELETE CASCADE,
  user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body               TEXT NOT NULL,
  update_type        TEXT NOT NULL DEFAULT 'comment',
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  posted_to_appfolio BOOLEAN NOT NULL DEFAULT FALSE,
  appfolio_note_id   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (update_type IN ('comment','status_change','system','appfolio_sync'))
);

CREATE INDEX IF NOT EXISTS idx_mb_item_updates_item
  ON mb_item_updates (item_id, created_at DESC);

-- ============================================================
-- 8. mb_subitem_updates (activity feed on each subitem)
-- ============================================================

CREATE TABLE IF NOT EXISTS mb_subitem_updates (
  id                 SERIAL PRIMARY KEY,
  subitem_id         INTEGER NOT NULL REFERENCES mb_subitems(id) ON DELETE CASCADE,
  user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body               TEXT NOT NULL,
  update_type        TEXT NOT NULL DEFAULT 'comment',
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  posted_to_appfolio BOOLEAN NOT NULL DEFAULT FALSE,
  appfolio_note_id   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (update_type IN ('comment','status_change','system','appfolio_sync'))
);

CREATE INDEX IF NOT EXISTS idx_mb_subitem_updates_subitem
  ON mb_subitem_updates (subitem_id, created_at DESC);

-- ============================================================
-- 9. mb_api_log (audit log for every AppFolio write/read)
-- ============================================================

CREATE TABLE IF NOT EXISTS mb_api_log (
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method                    TEXT NOT NULL,
  endpoint                  TEXT NOT NULL,
  request_payload           JSONB,
  response_status           INTEGER,
  response_body             JSONB,
  duration_ms               INTEGER,
  error_message             TEXT,
  triggered_by_item_id      INTEGER REFERENCES mb_items(id) ON DELETE SET NULL,
  triggered_by_subitem_id   INTEGER REFERENCES mb_subitems(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (method IN ('GET','POST','PATCH','PUT','DELETE'))
);

CREATE INDEX IF NOT EXISTS idx_mb_api_log_created_at
  ON mb_api_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mb_api_log_endpoint
  ON mb_api_log (endpoint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mb_api_log_item
  ON mb_api_log (triggered_by_item_id)
  WHERE triggered_by_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mb_api_log_subitem
  ON mb_api_log (triggered_by_subitem_id)
  WHERE triggered_by_subitem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mb_api_log_errors
  ON mb_api_log (created_at DESC)
  WHERE error_message IS NOT NULL;

-- ============================================================
-- 10. mb_webhook_events (incoming AppFolio webhook envelope log)
-- ============================================================
--
-- Receiver always logs first, returns 200 to AppFolio quickly, then
-- processes async. JWS signature is recorded for later verification
-- (verification itself wired up in Phase 2).

CREATE TABLE IF NOT EXISTS mb_webhook_events (
  id            SERIAL PRIMARY KEY,
  topic         TEXT,
  event_type    TEXT,
  resource_id   TEXT,
  payload       JSONB NOT NULL,
  signature     TEXT,
  processed_at  TIMESTAMPTZ,
  process_error TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mb_webhook_events_created_at
  ON mb_webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mb_webhook_events_unprocessed
  ON mb_webhook_events (created_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mb_webhook_events_topic
  ON mb_webhook_events (topic, event_type);
