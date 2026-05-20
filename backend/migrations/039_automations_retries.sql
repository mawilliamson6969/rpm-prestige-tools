-- Prestige Connect Phase 2 §1: retry logic on automation_runs.
--
-- A run that fails on a transient error (network blip, 5xx, 429, timeout)
-- shouldn't die — it should retry a few times with backoff and only land
-- in 'dead_letter' after exhausting attempts. Permanent errors (bad
-- config, validation failures, 4xx that isn't 429) skip retry entirely.
--
-- `resume_from_step` references automation_steps.id (NOT step_order) so
-- the retry resumes at the exact failed step even when the step lives
-- inside a branch path — branching ships in §3 of this phase.

ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resume_from_step INTEGER REFERENCES automation_steps(id) ON DELETE SET NULL,
  -- Persist the run's `context` blob so a retry that resumes past an
  -- ai_draft step still sees the same {{context.draft}} value rather
  -- than rendering empty. The blob lives only for the run's lifetime.
  ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Retry sweeper: claim ready-to-retry runs ordered by next_retry_at.
CREATE INDEX IF NOT EXISTS idx_runs_retry
  ON automation_runs (next_retry_at)
  WHERE status = 'retrying';

-- Dead-letter view filter.
CREATE INDEX IF NOT EXISTS idx_runs_dead_letter
  ON automation_runs (started_at DESC)
  WHERE status = 'dead_letter';
