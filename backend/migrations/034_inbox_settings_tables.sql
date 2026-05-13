-- Phase 8: settings-screen tables.
--
--   tag_definitions   — a catalog of known tag names + their display color.
--                       Threads still store free-form tags TEXT[]; this table
--                       is for the Settings → Tags page and the tag pickers.
--                       Tags are case-sensitive (matches the runtime model)
--                       and unique on `name`.
--   canned_responses  — pre-written reply text that the composer can insert.
--                       Owner = NULL means a shared/team-wide response;
--                       owner = user.id means a personal one. Indexed for
--                       quick search by name or shortcut.
--
-- Idempotent. Mirrored in migrateInboxSettingsTables() in lib/db.js.

CREATE TABLE IF NOT EXISTS tag_definitions (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#6A737B',
  description  TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(name) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_definitions_name ON tag_definitions(name);

-- Seed the design's canonical tags so the Tags page has data on day one.
-- Re-inserts are no-ops on the unique index.
INSERT INTO tag_definitions (name, color, description) VALUES
  ('urgent',           '#B32317', 'High-priority issue needing same-day attention'),
  ('renewal',          '#1F8A5B', 'Lease renewal-related conversation'),
  ('legal',            '#6A1B9A', 'Attorney involvement or eviction-adjacent'),
  ('repair',           '#0098D0', 'Maintenance repair coordination'),
  ('waiting:tenant',   '#B45309', 'Waiting on tenant response'),
  ('waiting:owner',    '#B45309', 'Waiting on owner response'),
  ('waiting:vendor',   '#B45309', 'Waiting on vendor response')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS canned_responses (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  shortcut     TEXT,
  body         TEXT NOT NULL,
  owner_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  is_shared    BOOLEAN NOT NULL DEFAULT FALSE,
  use_count    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canned_responses_owner ON canned_responses(owner_id);
CREATE INDEX IF NOT EXISTS idx_canned_responses_shared ON canned_responses(is_shared) WHERE is_shared = TRUE;
-- Soft uniqueness on shared names so admins can't accidentally seed the
-- same shared response twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_canned_responses_shared_name
  ON canned_responses(name) WHERE is_shared = TRUE;

INSERT INTO canned_responses (name, shortcut, body, owner_id, is_shared) VALUES
  (
    'Maintenance acknowledgement',
    '/ack-maint',
    $$Hi,

Thanks for letting us know. We've logged this and a vendor will reach out within 24 business hours to schedule the visit. If this is an emergency (water, gas, electrical, no heat in winter) please reply EMERGENCY and we will escalate immediately.

Best,
RPM Prestige$$,
    NULL,
    TRUE
  ),
  (
    'Owner statement explainer',
    '/owner-statement',
    $$Hi,

Your monthly statement has been posted in the owner portal under Reports → Statements. The most common questions we get:

  • Reserves are held in the trust account for unexpected repairs.
  • Management fees are debited at month close (always the same day).
  • Maintenance >$300 is approved by you before work begins.

Let me know if anything looks off and I'll loop in accounting.

Best,
RPM Prestige$$,
    NULL,
    TRUE
  ),
  (
    'Lease renewal cadence',
    '/renewal-cadence',
    $$Hi,

A quick note on the renewal timing for your lease:

  • 90 days out: we send a renewal offer with the new rate.
  • 60 days out: we confirm the lease terms.
  • 30 days out: lease is signed or we list the property.

We'll keep you in the loop at each step.

Best,
RPM Prestige$$,
    NULL,
    TRUE
  )
ON CONFLICT DO NOTHING;
