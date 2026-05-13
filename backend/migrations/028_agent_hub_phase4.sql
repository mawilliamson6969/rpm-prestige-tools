-- Phase 4: Agent Hub intelligence layer.
-- Engagement scoring, predictive flags, cohorts, market intelligence.
--
-- Builds on Phases 1-3. Reads from agent_hub_agents, _activities,
-- _send_log, _referrals, _automation_runs, and the agent_hub_agent_lifetime_value
-- materialized view. Phase 4 does NOT mutate agent records — only writes
-- to its own tables.
--
-- Out of scope (Phase 5+):
--   * ML models — use heuristics
--   * Automated market data fetch (manual entry only)
--   * Real-time score recalc on every event (daily batch is fine)
--   * Agent-facing portal data
--
-- Conventions match Phases 1-3: SERIAL pks, INTEGER FKs, TIMESTAMPTZ
-- DEFAULT NOW(), idempotent, applied via ensureAgentHubPhase4Schema().

-- ============================================================
-- 1. agent_hub_agent_engagement_scores (one row per agent per day)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_agent_engagement_scores (
  id                              SERIAL PRIMARY KEY,
  agent_id                        INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  calculated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score                           INTEGER NOT NULL,
  tier_recommendation             TEXT,
  tier_recommendation_changed     BOOLEAN NOT NULL DEFAULT FALSE,
  component_recency               INTEGER NOT NULL DEFAULT 0,
  component_frequency             INTEGER NOT NULL DEFAULT 0,
  component_two_way               INTEGER NOT NULL DEFAULT 0,
  component_referrals             INTEGER NOT NULL DEFAULT 0,
  component_financials            INTEGER NOT NULL DEFAULT 0,
  explanation                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                           TEXT,
  CHECK (score BETWEEN 0 AND 100),
  CHECK (tier_recommendation IS NULL OR tier_recommendation IN ('cold','prospect','warm','partner','vip','dormant')),
  CHECK (component_recency BETWEEN 0 AND 25),
  CHECK (component_frequency BETWEEN 0 AND 20),
  CHECK (component_two_way BETWEEN 0 AND 15),
  CHECK (component_referrals BETWEEN 0 AND 25),
  CHECK (component_financials BETWEEN 0 AND 15)
);

-- Idempotency: one row per agent per calendar day. UPSERT on conflict.
-- Bare `calculated_at::date` is STABLE (depends on session TimeZone) and
-- Postgres rejects STABLE expressions in index definitions, so we pin
-- the conversion to America/Chicago (which is IMMUTABLE) and also keeps
-- the "day" bucket aligned with the Houston business calendar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_engagement_scores_agent_day
  ON agent_hub_agent_engagement_scores (
    agent_id,
    ((calculated_at AT TIME ZONE 'America/Chicago')::date)
  );
CREATE INDEX IF NOT EXISTS idx_agent_hub_engagement_scores_agent
  ON agent_hub_agent_engagement_scores (agent_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_engagement_scores_score
  ON agent_hub_agent_engagement_scores (score DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_engagement_scores_rec_changed
  ON agent_hub_agent_engagement_scores (tier_recommendation_changed)
  WHERE tier_recommendation_changed = TRUE;

-- ============================================================
-- 2. agent_hub_engagement_score_history (compact 365-day trend store)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_engagement_score_history (
  id                  SERIAL PRIMARY KEY,
  agent_id            INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  calculation_date    DATE NOT NULL,
  score               INTEGER NOT NULL,
  tier_at_time        TEXT,
  CHECK (score BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_score_history_agent_date
  ON agent_hub_engagement_score_history (agent_id, calculation_date);
CREATE INDEX IF NOT EXISTS idx_agent_hub_score_history_agent
  ON agent_hub_engagement_score_history (agent_id, calculation_date DESC);

-- ============================================================
-- 3. agent_hub_predictive_flags
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_predictive_flags (
  id                      SERIAL PRIMARY KEY,
  agent_id                INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  flag_type               TEXT NOT NULL,
  severity                TEXT NOT NULL DEFAULT 'info',
  confidence              TEXT NOT NULL DEFAULT 'medium',
  reasoning               TEXT NOT NULL,
  data_points             JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_flagged_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at             TIMESTAMPTZ,
  resolution_reason       TEXT,
  dismissed_at            TIMESTAMPTZ,
  dismissed_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dismissed_reason        TEXT,
  -- Snooze: when dismissed, the flag won't re-create for snooze_until.
  snooze_until            TIMESTAMPTZ,
  CHECK (flag_type IN (
    'likely_referrer','dormancy_risk','tier_upgrade_candidate',
    'tier_downgrade_candidate','re_engagement_candidate','vip_consideration'
  )),
  CHECK (severity IN ('info','watch','action')),
  CHECK (confidence IN ('low','medium','high'))
);

-- One ACTIVE flag of each type per agent. Resolved or dismissed flags
-- don't count against this — that's the partial unique index trick.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_flags_active
  ON agent_hub_predictive_flags (agent_id, flag_type)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_flags_severity
  ON agent_hub_predictive_flags (severity, last_seen_at DESC)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_flags_agent
  ON agent_hub_predictive_flags (agent_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_flags_snoozed
  ON agent_hub_predictive_flags (agent_id, flag_type, snooze_until)
  WHERE snooze_until IS NOT NULL AND snooze_until > NOW();

-- ============================================================
-- 4. agent_hub_market_intelligence (manual zip+month data)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_market_intelligence (
  id                          SERIAL PRIMARY KEY,
  zip                         TEXT NOT NULL,
  month                       DATE NOT NULL,                  -- first of month
  avg_lease_price             NUMERIC(12,2),
  median_lease_price          NUMERIC(12,2),
  total_active_listings       INTEGER,
  total_leased                INTEGER,
  avg_days_on_market          NUMERIC(6,1),
  inventory_level             TEXT,
  notable_events              TEXT,
  data_source                 TEXT NOT NULL DEFAULT 'manual',
  source_notes                TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (inventory_level IS NULL OR inventory_level IN ('low','balanced','high')),
  CHECK (data_source IN ('manual','appfolio','mls_export','external')),
  CHECK (EXTRACT(DAY FROM month) = 1),
  CHECK (avg_lease_price IS NULL OR avg_lease_price >= 0),
  CHECK (median_lease_price IS NULL OR median_lease_price >= 0),
  CHECK (total_active_listings IS NULL OR total_active_listings >= 0),
  CHECK (total_leased IS NULL OR total_leased >= 0),
  CHECK (avg_days_on_market IS NULL OR avg_days_on_market >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_market_zip_month_source
  ON agent_hub_market_intelligence (zip, month, data_source);
CREATE INDEX IF NOT EXISTS idx_agent_hub_market_zip
  ON agent_hub_market_intelligence (zip, month DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_market_month
  ON agent_hub_market_intelligence (month DESC);

DROP TRIGGER IF EXISTS trg_agent_hub_market_updated_at ON agent_hub_market_intelligence;
CREATE TRIGGER trg_agent_hub_market_updated_at
  BEFORE UPDATE ON agent_hub_market_intelligence
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 5. agent_hub_cohorts (system + user-defined)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_cohorts (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  description         TEXT,
  -- definition is a structured JSON object understood by the cohort
  -- evaluator. Allowed keys (whitelisted in the evaluator):
  --   added_after, added_before        — ISO date strings
  --   tiers                            — array of tier strings
  --   sources                          — array of source strings
  --   target_zips                      — array of zip strings
  --   brokerage_ids                    — array of int ids
  --   tags                             — array of tag strings
  -- The evaluator NEVER concatenates JSON values into SQL — every
  -- value flows through parameterized placeholders.
  definition          JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system           BOOLEAN NOT NULL DEFAULT FALSE,
  -- Cached metrics from the last refresh. Recomputed nightly.
  metrics             JSONB,
  metrics_calculated_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS trg_agent_hub_cohorts_updated_at ON agent_hub_cohorts;
CREATE TRIGGER trg_agent_hub_cohorts_updated_at
  BEFORE UPDATE ON agent_hub_cohorts
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 6. agent_hub_intelligence_calculations_log
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_intelligence_calculations_log (
  id                  SERIAL PRIMARY KEY,
  calculation_type    TEXT NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  agents_processed    INTEGER,
  flags_added         INTEGER,
  flags_resolved      INTEGER,
  errors_count        INTEGER NOT NULL DEFAULT 0,
  error_log           JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_ms         INTEGER,
  triggered_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (calculation_type IN (
    'engagement_score','predictive_flags','market_intelligence_refresh',
    'cohort_refresh','score_history_archival'
  ))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_intel_log_type
  ON agent_hub_intelligence_calculations_log (calculation_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_intel_log_recent
  ON agent_hub_intelligence_calculations_log (started_at DESC);

-- ============================================================
-- SEEDS: system quarterly cohorts (last 8 quarters + current)
-- ============================================================
-- We seed quarterly cohorts going back 2 years and forward 1 quarter.
-- The cohort refresh job adds future cohorts as they become relevant.

DO $$
DECLARE
  q INT;
  yr INT;
  start_date DATE;
  end_date DATE;
  cohort_name TEXT;
BEGIN
  FOR yr IN (EXTRACT(YEAR FROM CURRENT_DATE)::int - 2) .. (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1) LOOP
    FOR q IN 1..4 LOOP
      start_date := make_date(yr, (q - 1) * 3 + 1, 1);
      end_date := (start_date + INTERVAL '3 months')::date;
      cohort_name := yr::text || ' Q' || q::text || ' cohort';
      INSERT INTO agent_hub_cohorts (name, description, definition, is_system)
      VALUES (
        cohort_name,
        'Auto-generated quarterly cohort',
        jsonb_build_object('added_after', start_date::text, 'added_before', end_date::text),
        TRUE
      ) ON CONFLICT (name) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
