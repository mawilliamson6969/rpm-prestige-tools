-- Phase 2: Agent Referral Hub — referral pipeline, owners, properties,
-- payments, revenue tracking, lightweight tasks, and the agent lifetime
-- value materialized view.
--
-- Builds on top of Phase 1 (migration 025_agent_hub.sql). Phase 1 must
-- be applied before this one.
--
-- DELIBERATELY OUT OF SCOPE for Phase 2 (do NOT add here):
--   * Automation engine, generic triggers, drip sequences (Phase 3)
--   * Outbound email/SMS/postcard sending (Phase 4)
--   * AppFolio integration — external_appfolio_id columns are placeholders
--     only; we do NOT query AppFolio from this module yet.
--   * MLS / HAR Matrix sync, LinkedIn import (Phase 4)
--
-- Conventions match Phase 1:
--   * SERIAL primary keys; INTEGER FKs to users(id) and other agent_hub_*.
--   * TIMESTAMPTZ DEFAULT NOW().
--   * CHECK constraints validate enums in-database.
--   * `active` boolean for soft-disable; status='deleted' for soft-deletion.
--   * Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--   * Applied at boot by ensureAgentHubPhase2Schema().

-- ============================================================
-- 1. agent_hub_owners
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_owners (
  id                          SERIAL PRIMARY KEY,
  full_name                   TEXT NOT NULL,
  first_name                  TEXT,
  last_name                   TEXT,
  email                       TEXT,
  phone_mobile                TEXT,
  phone_office                TEXT,
  mailing_address_1           TEXT,
  mailing_address_2           TEXT,
  city                        TEXT,
  state                       TEXT,
  zip                         TEXT,
  is_company                  BOOLEAN NOT NULL DEFAULT FALSE,
  company_name                TEXT,
  -- First referrer wins. Set by createReferral() if owner is new.
  source_agent_id             INTEGER REFERENCES agent_hub_agents(id) ON DELETE SET NULL,
  first_referral_date         DATE,
  notes                       TEXT,
  status                      TEXT NOT NULL DEFAULT 'active',
  -- Forward-compat: when AppFolio sync lands, store the AppFolio
  -- contact id here so we can link without renaming a column.
  external_appfolio_id        TEXT,
  -- Soft-delete (matches Phase 1 pattern on agent_hub_agents)
  -- status='deleted' is the soft-delete marker.
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status IN ('active','lost','converted','dormant','deleted'))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_owners_email
  ON agent_hub_owners (LOWER(email))
  WHERE email IS NOT NULL AND status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_agent_hub_owners_source_agent
  ON agent_hub_owners (source_agent_id)
  WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_agent_hub_owners_status
  ON agent_hub_owners (status);
CREATE INDEX IF NOT EXISTS idx_agent_hub_owners_appfolio
  ON agent_hub_owners (external_appfolio_id)
  WHERE external_appfolio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_owners_full_name_trgm
  ON agent_hub_owners USING gin (full_name gin_trgm_ops)
  WHERE status != 'deleted';

DROP TRIGGER IF EXISTS trg_agent_hub_owners_updated_at ON agent_hub_owners;
CREATE TRIGGER trg_agent_hub_owners_updated_at
  BEFORE UPDATE ON agent_hub_owners
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 2. agent_hub_properties
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_properties (
  id                              SERIAL PRIMARY KEY,
  owner_id                        INTEGER NOT NULL REFERENCES agent_hub_owners(id) ON DELETE RESTRICT,
  address_1                       TEXT NOT NULL,
  address_2                       TEXT,
  city                            TEXT NOT NULL,
  state                           TEXT NOT NULL,
  zip                             TEXT NOT NULL,
  property_type                   TEXT,
  bedrooms                        NUMERIC(4,1),
  bathrooms                       NUMERIC(4,1),
  square_feet                     INTEGER,
  year_built                      INTEGER,
  notes                           TEXT,
  status                          TEXT NOT NULL DEFAULT 'prospect',
  external_appfolio_property_id   TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by                      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (property_type IS NULL OR property_type IN ('single_family','condo','townhome','duplex','multi_family','other')),
  CHECK (status IN ('prospect','under_management','lost','inactive','deleted')),
  CHECK (bedrooms IS NULL OR bedrooms >= 0),
  CHECK (bathrooms IS NULL OR bathrooms >= 0),
  CHECK (square_feet IS NULL OR square_feet > 0),
  CHECK (year_built IS NULL OR (year_built BETWEEN 1800 AND 2200))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_properties_owner
  ON agent_hub_properties (owner_id)
  WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_agent_hub_properties_zip
  ON agent_hub_properties (zip)
  WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_agent_hub_properties_status
  ON agent_hub_properties (status);
CREATE INDEX IF NOT EXISTS idx_agent_hub_properties_appfolio
  ON agent_hub_properties (external_appfolio_property_id)
  WHERE external_appfolio_property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_properties_address_trgm
  ON agent_hub_properties USING gin ((address_1 || ' ' || city) gin_trgm_ops)
  WHERE status != 'deleted';

DROP TRIGGER IF EXISTS trg_agent_hub_properties_updated_at ON agent_hub_properties;
CREATE TRIGGER trg_agent_hub_properties_updated_at
  BEFORE UPDATE ON agent_hub_properties
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 3. agent_hub_referrals
-- ============================================================
-- THE core deal record. Each row is one referral cycle. A property
-- can have multiple referrals over time (re-leases) but only ONE
-- active (non-terminal) referral at a time — enforced via partial
-- unique index below.

CREATE TABLE IF NOT EXISTS agent_hub_referrals (
  id                                  SERIAL PRIMARY KEY,
  agent_id                            INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE RESTRICT,
  owner_id                            INTEGER NOT NULL REFERENCES agent_hub_owners(id) ON DELETE RESTRICT,
  property_id                         INTEGER REFERENCES agent_hub_properties(id) ON DELETE SET NULL,

  stage                               TEXT NOT NULL DEFAULT 'lead_received',
  stage_changed_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage_changed_by                    INTEGER REFERENCES users(id) ON DELETE SET NULL,

  lost_reason                         TEXT,
  lost_at                             TIMESTAMPTZ,
  declined_reason                     TEXT,
  declined_at                         TIMESTAMPTZ,

  expected_monthly_rent               NUMERIC(12,2),
  expected_management_fee_pct         NUMERIC(5,2),
  expected_first_month_referral_fee   NUMERIC(12,2),

  actual_monthly_rent                 NUMERIC(12,2),
  actual_management_fee_pct           NUMERIC(5,2),
  -- actual_referral_fee_paid is denormalized cumulative sum of payments.
  -- Kept in sync by application code (recordPayment) and by audit query
  -- on demand. Source of truth is agent_hub_referral_payments.
  actual_referral_fee_paid            NUMERIC(12,2) NOT NULL DEFAULT 0,

  tenant_placed_at                    TIMESTAMPTZ,
  active_management_started_at        TIMESTAMPTZ,

  notes                               TEXT,
  internal_priority                   TEXT NOT NULL DEFAULT 'medium',
  expected_close_date                 DATE,
  source_activity_id                  INTEGER REFERENCES agent_hub_activities(id) ON DELETE SET NULL,

  created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by                          INTEGER REFERENCES users(id) ON DELETE SET NULL,

  CHECK (stage IN (
    'lead_received','owner_contacted','property_toured','agreement_pending',
    'agreement_signed','tenant_placed','active_management','lost','declined'
  )),
  CHECK (internal_priority IN ('low','medium','high','urgent')),
  -- Financial sanity: non-negative, fee % between 0 and 100.
  CHECK (expected_monthly_rent IS NULL OR expected_monthly_rent >= 0),
  CHECK (actual_monthly_rent IS NULL OR actual_monthly_rent >= 0),
  CHECK (expected_management_fee_pct IS NULL OR (expected_management_fee_pct BETWEEN 0 AND 100)),
  CHECK (actual_management_fee_pct IS NULL OR (actual_management_fee_pct BETWEEN 0 AND 100)),
  CHECK (expected_first_month_referral_fee IS NULL OR expected_first_month_referral_fee >= 0),
  CHECK (actual_referral_fee_paid >= 0),
  -- Terminal-stage timestamps must align with stage.
  CHECK ((stage = 'lost') = (lost_at IS NOT NULL)),
  CHECK ((stage = 'declined') = (declined_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_referrals_agent
  ON agent_hub_referrals (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_hub_referrals_owner
  ON agent_hub_referrals (owner_id);
CREATE INDEX IF NOT EXISTS idx_agent_hub_referrals_property
  ON agent_hub_referrals (property_id)
  WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_referrals_stage
  ON agent_hub_referrals (stage);
CREATE INDEX IF NOT EXISTS idx_agent_hub_referrals_stage_changed
  ON agent_hub_referrals (stage_changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_referrals_active_management
  ON agent_hub_referrals (active_management_started_at DESC)
  WHERE active_management_started_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_referrals_pipeline
  ON agent_hub_referrals (stage, stage_changed_at DESC)
  WHERE stage NOT IN ('lost','declined','active_management');
CREATE INDEX IF NOT EXISTS idx_agent_hub_referrals_priority
  ON agent_hub_referrals (internal_priority)
  WHERE stage NOT IN ('lost','declined');

-- Active uniqueness: only ONE in-flight referral per (owner, property)
-- combination. active_management is excluded because re-leases of the
-- same property over time produce multiple completed referrals (intentional).
-- Lost / declined are obviously terminal so excluded too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_referrals_active
  ON agent_hub_referrals (owner_id, COALESCE(property_id, 0))
  WHERE stage NOT IN ('lost','declined','active_management');

DROP TRIGGER IF EXISTS trg_agent_hub_referrals_updated_at ON agent_hub_referrals;
CREATE TRIGGER trg_agent_hub_referrals_updated_at
  BEFORE UPDATE ON agent_hub_referrals
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 4. agent_hub_referral_stage_history
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_referral_stage_history (
  id                              SERIAL PRIMARY KEY,
  referral_id                     INTEGER NOT NULL REFERENCES agent_hub_referrals(id) ON DELETE CASCADE,
  from_stage                      TEXT,
  to_stage                        TEXT NOT NULL,
  changed_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by                      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes                           TEXT,
  -- Calculated by app code at insert time: how long the referral spent
  -- in from_stage. Null on initial creation.
  duration_in_previous_stage      INTERVAL
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_stage_history_referral
  ON agent_hub_referral_stage_history (referral_id, changed_at);

-- Idempotency: prevent two identical transitions in the same second from
-- creating duplicate rows. A genuine same-stage no-op is rejected at the
-- app level via the stage transition rules.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_stage_history_unique
  ON agent_hub_referral_stage_history (referral_id, to_stage, changed_at);

-- ============================================================
-- 5. agent_hub_referral_payments
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_referral_payments (
  id                  SERIAL PRIMARY KEY,
  referral_id         INTEGER NOT NULL REFERENCES agent_hub_referrals(id) ON DELETE RESTRICT,
  amount              NUMERIC(12,2) NOT NULL,
  payment_date        DATE NOT NULL,
  payment_method      TEXT NOT NULL,
  check_number        TEXT,
  paid_to_name        TEXT NOT NULL,
  notes               TEXT,
  -- Soft delete: set deleted_at instead of hard delete so cumulative
  -- totals can be recomputed correctly. Application filters by deleted_at IS NULL.
  deleted_at          TIMESTAMPTZ,
  deleted_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (amount >= 0),
  CHECK (payment_method IN ('check','ach','wire','zelle','other'))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_payments_referral
  ON agent_hub_referral_payments (referral_id, payment_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_payments_date
  ON agent_hub_referral_payments (payment_date DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_agent_hub_payments_updated_at ON agent_hub_referral_payments;
CREATE TRIGGER trg_agent_hub_payments_updated_at
  BEFORE UPDATE ON agent_hub_referral_payments
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 6. agent_hub_revenue_tracking
-- ============================================================
-- Manual monthly revenue entry. Phase 2 doesn't sync from AppFolio —
-- bulk CSV import is the batch path.

CREATE TABLE IF NOT EXISTS agent_hub_revenue_tracking (
  id                          SERIAL PRIMARY KEY,
  referral_id                 INTEGER NOT NULL REFERENCES agent_hub_referrals(id) ON DELETE RESTRICT,
  -- First day of month. Stored as DATE; CHECK enforces day-of-month=1.
  month                       DATE NOT NULL,
  rent_collected              NUMERIC(12,2) NOT NULL DEFAULT 0,
  management_fee_earned       NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes                       TEXT,
  -- Soft delete
  deleted_at                  TIMESTAMPTZ,
  deleted_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (rent_collected >= 0),
  CHECK (management_fee_earned >= 0),
  CHECK (EXTRACT(DAY FROM month) = 1)
);

-- Idempotent: one row per (referral, month). A re-import overwrites via
-- ON CONFLICT in the app layer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_revenue_referral_month
  ON agent_hub_revenue_tracking (referral_id, month)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_revenue_referral
  ON agent_hub_revenue_tracking (referral_id, month DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_revenue_month
  ON agent_hub_revenue_tracking (month)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_agent_hub_revenue_updated_at ON agent_hub_revenue_tracking;
CREATE TRIGGER trg_agent_hub_revenue_updated_at
  BEFORE UPDATE ON agent_hub_revenue_tracking
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 7. agent_hub_tasks
-- ============================================================
-- Lightweight task system. Used by Phase 2 for the manual thank-you
-- queue (system creates a task when a referral hits tenant_placed)
-- plus general followups. Phase 3 will extend with automation.

CREATE TABLE IF NOT EXISTS agent_hub_tasks (
  id                          SERIAL PRIMARY KEY,
  title                       TEXT NOT NULL,
  description                 TEXT,
  assigned_to                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  related_agent_id            INTEGER REFERENCES agent_hub_agents(id) ON DELETE SET NULL,
  related_referral_id         INTEGER REFERENCES agent_hub_referrals(id) ON DELETE SET NULL,
  related_owner_id            INTEGER REFERENCES agent_hub_owners(id) ON DELETE SET NULL,
  related_property_id         INTEGER REFERENCES agent_hub_properties(id) ON DELETE SET NULL,
  due_date                    DATE,
  status                      TEXT NOT NULL DEFAULT 'pending',
  priority                    TEXT NOT NULL DEFAULT 'medium',
  completed_at                TIMESTAMPTZ,
  completed_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source                      TEXT NOT NULL DEFAULT 'manual',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status IN ('pending','in_progress','completed','cancelled')),
  CHECK (priority IN ('low','medium','high','urgent')),
  CHECK (source IN ('manual','system_referral_thank_you','system_followup_reminder','system_other')),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_tasks_assigned_status
  ON agent_hub_tasks (assigned_to, status, due_date)
  WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_agent_hub_tasks_referral
  ON agent_hub_tasks (related_referral_id)
  WHERE related_referral_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_tasks_agent
  ON agent_hub_tasks (related_agent_id)
  WHERE related_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_tasks_due
  ON agent_hub_tasks (due_date, status)
  WHERE due_date IS NOT NULL AND status IN ('pending','in_progress');

-- Idempotency: a system-generated thank-you task is created at most once
-- per referral. Manual tasks have no source-id so the partial index
-- only constrains system_* sources.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_tasks_system_thank_you
  ON agent_hub_tasks (related_referral_id, source)
  WHERE source = 'system_referral_thank_you' AND related_referral_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_agent_hub_tasks_updated_at ON agent_hub_tasks;
CREATE TRIGGER trg_agent_hub_tasks_updated_at
  BEFORE UPDATE ON agent_hub_tasks
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 8. Materialized view: agent_hub_agent_lifetime_value
-- ============================================================
-- Refreshed nightly by cron + on-demand by writes (recordPayment,
-- addRevenue, advanceStage to active_management).
--
-- We use MATERIALIZED VIEW so REFRESH MATERIALIZED VIEW CONCURRENTLY
-- can run while the view is being read. CONCURRENTLY requires a unique
-- index on the view (built below).

DROP MATERIALIZED VIEW IF EXISTS agent_hub_agent_lifetime_value CASCADE;

-- IMPORTANT: when an agent has been merged (Phase 1), their referrals stay
-- attached to the loser's id (we don't reparent on merge to keep history
-- intact). This view rolls all loser stats up to the winner via
-- COALESCE(merged_into_agent_id, id) so the winner sees the full lifetime.
-- Loser rows still appear with their own id but the leaderboard / CSV
-- export query filters merged_into_agent_id IS NULL so they're hidden in UI.
CREATE MATERIALIZED VIEW agent_hub_agent_lifetime_value AS
WITH effective_agent AS (
  -- Map every (loser, winner) pair plus every standalone agent to the
  -- "effective" id used for aggregation.
  SELECT
    a.id AS agent_id,
    COALESCE(a.merged_into_agent_id, a.id) AS effective_id
  FROM agent_hub_agents a
),
referral_counts AS (
  SELECT
    ea.effective_id AS agent_id,
    COUNT(r.id) AS total_received,
    COUNT(r.id) FILTER (
      WHERE r.stage NOT IN ('lost','declined','active_management')
    ) AS in_pipeline,
    COUNT(r.id) FILTER (WHERE r.stage = 'active_management') AS converted,
    COUNT(r.id) FILTER (WHERE r.stage = 'lost') AS lost,
    COUNT(r.id) FILTER (WHERE r.stage = 'declined') AS declined,
    MIN(r.created_at) AS first_referral_date,
    MAX(r.created_at) AS last_referral_date,
    AVG(
      CASE
        WHEN r.stage = 'active_management' AND r.active_management_started_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (r.active_management_started_at - r.created_at)) / 86400.0
      END
    ) AS avg_days_to_convert
  FROM effective_agent ea
  LEFT JOIN agent_hub_referrals r ON r.agent_id = ea.agent_id
  GROUP BY ea.effective_id
),
fees_paid AS (
  SELECT
    ea.effective_id AS agent_id,
    COALESCE(SUM(p.amount), 0) AS total_paid
  FROM effective_agent ea
  LEFT JOIN agent_hub_referrals r ON r.agent_id = ea.agent_id
  LEFT JOIN agent_hub_referral_payments p
    ON p.referral_id = r.id AND p.deleted_at IS NULL
  GROUP BY ea.effective_id
),
revenue AS (
  SELECT
    ea.effective_id AS agent_id,
    COALESCE(SUM(rev.management_fee_earned), 0) AS total_revenue
  FROM effective_agent ea
  LEFT JOIN agent_hub_referrals r ON r.agent_id = ea.agent_id
  LEFT JOIN agent_hub_revenue_tracking rev
    ON rev.referral_id = r.id AND rev.deleted_at IS NULL
  GROUP BY ea.effective_id
)
-- One row per agent_hub_agents row (including merged losers — they get
-- their winner's stats so callers that look up by loser id still see
-- consistent numbers).
SELECT
  ea.agent_id,
  rc.total_received                                                 AS total_referrals_received,
  rc.in_pipeline                                                    AS total_referrals_in_pipeline,
  rc.converted                                                      AS total_referrals_converted,
  rc.lost                                                           AS total_referrals_lost,
  rc.declined                                                       AS total_referrals_declined,
  CASE WHEN (rc.converted + rc.lost + rc.declined) = 0 THEN 0
       ELSE ROUND(
         100.0 * rc.converted / NULLIF(rc.converted + rc.lost + rc.declined, 0),
         2
       )
  END                                                               AS conversion_rate_pct,
  COALESCE(fp.total_paid, 0)                                        AS total_referral_fees_paid,
  COALESCE(rev.total_revenue, 0)                                    AS total_revenue_generated,
  COALESCE(rev.total_revenue, 0) - COALESCE(fp.total_paid, 0)       AS lifetime_relationship_value,
  rc.first_referral_date,
  rc.last_referral_date,
  rc.avg_days_to_convert,
  NOW()                                                             AS last_calculated_at
FROM effective_agent ea
LEFT JOIN referral_counts rc ON rc.agent_id = ea.effective_id
LEFT JOIN fees_paid       fp ON fp.agent_id = ea.effective_id
LEFT JOIN revenue        rev ON rev.agent_id = ea.effective_id;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_ltv_agent_id
  ON agent_hub_agent_lifetime_value (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_hub_ltv_revenue
  ON agent_hub_agent_lifetime_value (total_revenue_generated DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_ltv_fees
  ON agent_hub_agent_lifetime_value (total_referral_fees_paid DESC);

-- Refresh helper. Use CONCURRENTLY so reads during the refresh aren't
-- blocked. CONCURRENTLY requires a unique index, which we created above.
CREATE OR REPLACE FUNCTION refresh_agent_lifetime_value() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY agent_hub_agent_lifetime_value;
END;
$$ LANGUAGE plpgsql;

-- Initial population (CONCURRENTLY won't work on first refresh).
-- Wrap in DO block so subsequent runs (where the view already has data) are no-ops.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_hub_agent_lifetime_value LIMIT 1) THEN
    REFRESH MATERIALIZED VIEW agent_hub_agent_lifetime_value;
  END IF;
END $$;
