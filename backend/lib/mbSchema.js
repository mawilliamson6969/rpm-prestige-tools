/**
 * Phase 7 (Unification) — the schema applier is now thin.
 *
 * Pre-Phase 7 we had six migrations (029..034) creating and extending
 * the System B Monday-boards tables. Phase 7's `035_unification.sql`
 * drops most of those tables, leaving only the Phase 4 updates feed
 * (rekeyed to processes) plus the AppFolio audit + webhook log.
 *
 * Going forward we don't re-apply the pre-7 migrations on boot —
 * they would just recreate tables we just dropped. Instead we:
 *
 *   1. Apply `survivors.sql` (inlined here) which idempotently creates
 *      ONLY the tables we kept (mb_item_updates and its mentions/
 *      reactions/attachments, plus mb_api_log and mb_webhook_events).
 *      Standalone — does not depend on the older mb_* migrations.
 *
 *   2. Apply `035_unification.sql` which adds process_id to
 *      mb_item_updates, the 8 instruction columns to process_*_steps,
 *      slug column on process_templates, and the Lease Renewal Prep
 *      seed. Idempotent.
 *
 * The old `ensureMbSchema` / `ensureMbRenewalsSeed` /
 * `ensureMbCustomizationSchema` / `ensureMbUpdatesSchema` /
 * `ensureMbSubitemsSchema` / `ensureMbDashboardsSchema` exports are
 * gone — index.js no longer calls them.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNIFICATION_PATH = path.join(
  __dirname,
  "..",
  "migrations",
  "035_unification.sql"
);

let cachedUnification = null;
function loadUnification() {
  if (cachedUnification != null) return cachedUnification;
  cachedUnification = fs.readFileSync(UNIFICATION_PATH, "utf8");
  return cachedUnification;
}

// Inlined "survivors only" schema. Idempotent CREATE TABLE IF NOT
// EXISTS for every Phase 4 update-feed table and the two AppFolio log
// tables that survive Phase 7. Fresh databases get a complete schema
// without ever touching the dropped Phase 1 tables.
const SURVIVORS_SQL = `
CREATE TABLE IF NOT EXISTS mb_item_updates (
  id                 SERIAL PRIMARY KEY,
  item_id            INTEGER,                              -- legacy from Phase 1; nullable; FK dropped in Phase 7
  process_id         INTEGER REFERENCES processes(id) ON DELETE CASCADE,
  user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body               TEXT NOT NULL DEFAULT '',
  body_html          TEXT,
  update_type        TEXT NOT NULL DEFAULT 'comment',
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  posted_to_appfolio BOOLEAN NOT NULL DEFAULT FALSE,
  appfolio_note_id   TEXT,
  parent_update_id   INTEGER REFERENCES mb_item_updates(id) ON DELETE CASCADE,
  edited_at          TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (update_type IN ('comment','status_change','system','appfolio_sync'))
);

CREATE INDEX IF NOT EXISTS idx_mb_item_updates_process
  ON mb_item_updates (process_id, created_at DESC)
  WHERE process_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mb_item_updates_parent
  ON mb_item_updates (parent_update_id)
  WHERE parent_update_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mb_item_updates_user
  ON mb_item_updates (user_id)
  WHERE user_id IS NOT NULL;

-- One-level-only reply trigger (preserved from Phase 4 / migration 032).
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
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mb_item_updates_block_nested ON mb_item_updates;
CREATE TRIGGER trg_mb_item_updates_block_nested
  BEFORE INSERT OR UPDATE OF parent_update_id ON mb_item_updates
  FOR EACH ROW EXECUTE FUNCTION mb_item_updates_block_nested_replies();

CREATE TABLE IF NOT EXISTS mb_update_mentions (
  id                  SERIAL PRIMARY KEY,
  update_id           INTEGER NOT NULL REFERENCES mb_item_updates(id) ON DELETE CASCADE,
  mentioned_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (update_id, mentioned_user_id)
);
CREATE INDEX IF NOT EXISTS idx_mb_mentions_unseen
  ON mb_update_mentions (mentioned_user_id) WHERE seen_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mb_mentions_update
  ON mb_update_mentions (update_id);

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

CREATE TABLE IF NOT EXISTS mb_update_attachments (
  id            SERIAL PRIMARY KEY,
  update_id     INTEGER NOT NULL REFERENCES mb_item_updates(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  storage_path  TEXT NOT NULL UNIQUE,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (size_bytes > 0 AND size_bytes <= 10485760)
);
CREATE INDEX IF NOT EXISTS idx_mb_attachments_update
  ON mb_update_attachments (update_id);

-- AppFolio API audit log (Phase 1) — FK to mb_items dropped in 035.
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
  triggered_by_item_id      INTEGER,
  triggered_by_subitem_id   INTEGER,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (method IN ('GET','POST','PATCH','PUT','DELETE'))
);
CREATE INDEX IF NOT EXISTS idx_mb_api_log_created_at
  ON mb_api_log (created_at DESC);

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
`;

/**
 * Single boot-time applier. Creates the surviving tables (idempotent)
 * and then applies the unification migration (also idempotent). The
 * older ensure*Schema functions are gone — see file header.
 */
export async function ensureMbUnifiedSchema() {
  const pool = getPool();
  await pool.query(SURVIVORS_SQL);
  await pool.query(loadUnification());
}
