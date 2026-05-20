-- Prestige Connect Phase 2 §2: delays + scheduled triggers.
--
-- A `delay` step doesn't block the worker — it writes a NEW event of
-- type 'internal.automation.resume' with scheduled_for=NOW()+duration
-- and marks the run 'waiting'. The worker's claim query already orders
-- by time; we extend it here to respect scheduled_for so a future-dated
-- event isn't picked up early.
--
-- Scheduled triggers live in `automation_schedules`. A small ticker
-- inside the worker (once a minute) finds rows whose next_fire_at has
-- arrived, writes an event of the automation's trigger_type, and bumps
-- next_fire_at via cron-parser using the stored timezone (America/
-- Chicago by default — Houston observes DST, and computing the next
-- 9am in UTC would drift twice a year).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

-- Replace the pending index with one that respects scheduled_for. Older
-- index name kept for safety; new index uses COALESCE so unscheduled
-- (immediate) events still sort by created_at.
DROP INDEX IF EXISTS idx_events_pending;
CREATE INDEX IF NOT EXISTS idx_events_pending
  ON events (COALESCE(scheduled_for, created_at))
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS automation_schedules (
  id SERIAL PRIMARY KEY,
  automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  cron_expression VARCHAR(100) NOT NULL,
  timezone VARCHAR(50) NOT NULL DEFAULT 'America/Chicago',
  last_fired_at TIMESTAMPTZ,
  next_fire_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ticker scan: find schedules whose time has arrived.
CREATE INDEX IF NOT EXISTS idx_schedules_due
  ON automation_schedules (next_fire_at)
  WHERE enabled = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_schedules_automation
  ON automation_schedules (automation_id);
