-- Phase 2: saved views ("personal queues").
-- A view is a named filter set against `threads`. Owned views (`owner_id`
-- set, `is_shared` false) are visible to the owner only; shared views
-- (`is_shared` true, `owner_id` null) are visible to everyone.
--
-- Idempotent. Also applied at runtime by ensureSavedViewsSchema().

CREATE TABLE IF NOT EXISTS saved_views (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  is_shared   BOOLEAN NOT NULL DEFAULT FALSE,
  filters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort        JSONB,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_owner   ON saved_views(owner_id, position);
CREATE INDEX IF NOT EXISTS idx_saved_views_shared  ON saved_views(is_shared) WHERE is_shared = TRUE;

-- Lets us idempotently seed shared views by name without duplicating on
-- repeated cold starts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_views_shared_name
  ON saved_views(name) WHERE is_shared = TRUE;

-- 7 seed shared views. ON CONFLICT DO NOTHING relies on the partial unique
-- index above; rerunning is safe.
INSERT INTO saved_views (name, icon, owner_id, is_shared, filters, sort, position) VALUES
  ('Overdue maintenance',     '🔧', NULL, TRUE,
     '{"category":"maintenance","status":"open","sla_breached":true}'::jsonb,
     '{"sort":"priority"}'::jsonb, 0),
  ('Owner complaints',        '⚠️', NULL, TRUE,
     '{"category":"owner","priority_in":["emergency","high"],"status":"open"}'::jsonb,
     '{"sort":"priority"}'::jsonb, 1),
  ('Waiting on tenant',       '⌛', NULL, TRUE,
     '{"status":"waiting_on_tenant"}'::jsonb,
     '{"sort":"newest"}'::jsonb, 2),
  ('Waiting on owner',        '⌛', NULL, TRUE,
     '{"status":"waiting_on_owner"}'::jsonb,
     '{"sort":"newest"}'::jsonb, 3),
  ('Unread threads',          '✉️', NULL, TRUE,
     '{"has_unread":true,"bucket":"unread"}'::jsonb,
     '{"sort":"newest"}'::jsonb, 4),
  ('Starred',                 '⭐', NULL, TRUE,
     '{"starred":true}'::jsonb,
     '{"sort":"newest"}'::jsonb, 5),
  ('Unassigned',              '👤', NULL, TRUE,
     '{"unassigned":true,"status":"open"}'::jsonb,
     '{"sort":"newest"}'::jsonb, 6)
ON CONFLICT DO NOTHING;
