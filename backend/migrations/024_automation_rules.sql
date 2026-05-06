-- Phase 4: workflow automation rules engine.
--
-- Critical: every seed ships in `shadow` mode. Shadow logs hypothetical
-- actions without taking them so operators can tune confidence_min before
-- flipping to suggested/auto.
--
-- Idempotent. Also applied at runtime by ensureAutomationsSchema().

CREATE TABLE IF NOT EXISTS automation_rules (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger         TEXT NOT NULL,
  conditions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  action          TEXT NOT NULL,
  action_params   JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_min  NUMERIC(3,2) NOT NULL DEFAULT 0.90,
  mode            TEXT NOT NULL DEFAULT 'shadow',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  priority_rank   INTEGER NOT NULL DEFAULT 100,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (mode IN ('shadow', 'suggested', 'auto')),
  CHECK (confidence_min >= 0 AND confidence_min <= 1)
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_active_rank
  ON automation_rules(active, priority_rank) WHERE active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_rules_name ON automation_rules(name);

CREATE TABLE IF NOT EXISTS automation_log (
  id              SERIAL PRIMARY KEY,
  rule_id         INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL,
  thread_id       TEXT REFERENCES threads(thread_id) ON DELETE CASCADE,
  trigger         TEXT NOT NULL,
  matched         BOOLEAN NOT NULL,
  proposed_action JSONB,
  revert_payload  JSONB,
  confidence      NUMERIC(3,2),
  mode            TEXT NOT NULL,
  executed        BOOLEAN NOT NULL DEFAULT FALSE,
  executed_at     TIMESTAMPTZ,
  reverted        BOOLEAN NOT NULL DEFAULT FALSE,
  reverted_at     TIMESTAMPTZ,
  reverted_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  skipped_reason  TEXT,
  feedback        TEXT,        -- null | 'good' | 'wrong' (set by shadow-review UI)
  feedback_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  feedback_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (feedback IS NULL OR feedback IN ('good', 'wrong'))
);

CREATE INDEX IF NOT EXISTS idx_automation_log_thread
  ON automation_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_automation_log_executed_revertable
  ON automation_log(executed_at) WHERE executed = TRUE AND reverted = FALSE;
CREATE INDEX IF NOT EXISTS idx_automation_log_recent_shadow
  ON automation_log(rule_id, created_at DESC) WHERE mode = 'shadow' AND matched = TRUE;
-- Idempotency: a single rule can't fire twice on the same thread for the
-- same trigger event (matched OR not — the unique row records the decision).
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_log_rule_thread_trigger
  ON automation_log(rule_id, thread_id, trigger)
  WHERE rule_id IS NOT NULL AND thread_id IS NOT NULL;

-- Seed rules. All start in `shadow`. Seeded by name (uq_automation_rules_name).
-- assignee_username strings get resolved to user_id at engine-evaluate time
-- so the seeds remain stable across DB rebuilds.
INSERT INTO automation_rules
  (name, description, trigger, conditions, action, action_params,
   confidence_min, mode, priority_rank)
VALUES
  ('Auto-route maintenance to Amanda',
   'Assign new maintenance threads to Amanda. Flip to auto after 2 weeks of shadow data.',
   'new_thread',
   '{"category":"maintenance"}'::jsonb,
   'assign',
   '{"assignee_username":"amanda"}'::jsonb,
   0.90, 'shadow', 10),
  ('Auto-route leasing to Lori',
   'Leasing threads default to Lori until Leslie comes online.',
   'new_thread',
   '{"category":"leasing"}'::jsonb,
   'assign',
   '{"assignee_username":"lori"}'::jsonb,
   0.90, 'shadow', 20),
  ('Escalate owner complaints',
   'Owner complaints with high priority get escalated to Lori.',
   'new_thread',
   '{"category":"owner","priority_in":["emergency","high"]}'::jsonb,
   'escalate',
   '{"assignee_username":"lori","priority":"high"}'::jsonb,
   0.85, 'shadow', 25),
  ('Escalate legal mentions',
   'Anything classified legal gets starred + assigned to Mike at high priority.',
   'new_thread',
   '{"category":"legal"}'::jsonb,
   'escalate',
   '{"assignee_username":"mike","priority":"high","star":true}'::jsonb,
   0.95, 'shadow', 5),
  ('Close marketing/no-reply',
   'Auto-close marketing newsletters and no-reply notifications.',
   'new_thread',
   '{"category":"marketing"}'::jsonb,
   'close',
   '{}'::jsonb,
   0.80, 'shadow', 60),
  ('Suggest work order for maintenance',
   'High-priority maintenance threads should get a work order created — suggested only, never auto.',
   'new_thread',
   '{"category":"maintenance","priority_in":["emergency","high"]}'::jsonb,
   'create_work_order',
   '{}'::jsonb,
   0.85, 'shadow', 50)
ON CONFLICT (name) DO NOTHING;

-- Forward-compat: classifier confidence will be written to tickets.ai_confidence
-- by the AI classifier (deferred to a follow-up). Engine treats NULL as
-- "no confidence available" and won't auto-execute when confidence_min > 0.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2);
