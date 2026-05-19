-- Prestige Connect Phase 1: event bus + automations engine.
--
-- Pattern: transactional inbox. Every source (webhook handler, internal
-- emitter) writes to `events`; a separate worker process polls and
-- executes the user-defined automations that match.

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  source VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error TEXT
);

-- Worker poll query: scan only the (small) pending tail, ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_events_pending
  ON events (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);

-- Stuck-event sweeper: find rows still in 'processing' past a stale threshold.
CREATE INDEX IF NOT EXISTS idx_events_processing
  ON events (processed_at)
  WHERE status = 'processing';

-- Webhook retries: a duplicate delivery (same source, type, external_id) is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe
  ON events (source, type, external_id)
  WHERE external_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS automations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  trigger_type VARCHAR(100) NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  max_runs_per_day INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_trigger
  ON automations (trigger_type)
  WHERE enabled = true;


CREATE TABLE IF NOT EXISTS automation_steps (
  id SERIAL PRIMARY KEY,
  automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  step_type VARCHAR(50) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (automation_id, step_order)
);


CREATE TABLE IF NOT EXISTS automation_runs (
  id BIGSERIAL PRIMARY KEY,
  automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  step_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_automation
  ON automation_runs (automation_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_event ON automation_runs (event_id);
