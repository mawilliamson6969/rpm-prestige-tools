-- Phase 4: autopilot rules + execution log.
-- Delayed email/SMS steps reuse process_steps.scheduled_send_at from migration 016
-- rather than introducing a separate scheduled-steps table.
-- Also created at runtime via ensureOperationsSchema in backend/lib/operationsSchema.js.

CREATE TABLE IF NOT EXISTS process_autopilot_rules (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_enabled BOOLEAN DEFAULT FALSE,

  frequency VARCHAR(10) NOT NULL DEFAULT 'month',
  day_of_period INTEGER DEFAULT 1,
  time_of_day TIME DEFAULT '06:00:00',
  timezone VARCHAR(64) DEFAULT 'America/Chicago',

  starting_stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL,

  condition_entity VARCHAR(20) DEFAULT 'unit',
  conditions JSONB DEFAULT '[]'::jsonb,

  process_name_template VARCHAR(500),

  prevent_duplicate BOOLEAN DEFAULT TRUE,
  duplicate_check_field VARCHAR(100) DEFAULT 'property_name',

  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  total_runs INTEGER DEFAULT 0,
  total_processes_created INTEGER DEFAULT 0,

  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_par_template ON process_autopilot_rules(template_id);
CREATE INDEX IF NOT EXISTS idx_par_next_run
  ON process_autopilot_rules(next_run_at) WHERE is_enabled = TRUE;

CREATE TABLE IF NOT EXISTS process_autopilot_log (
  id SERIAL PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES process_autopilot_rules(id) ON DELETE CASCADE,
  run_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'success',
  entities_matched INTEGER DEFAULT 0,
  processes_created INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  errors JSONB,
  details JSONB
);
CREATE INDEX IF NOT EXISTS idx_pal_rule
  ON process_autopilot_log(rule_id, run_at DESC);

-- Process templates can be marked Live to gate autopilot enablement.
ALTER TABLE process_templates
  ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT TRUE;

SELECT 'Migration 017 — autopilot ready' AS status;
