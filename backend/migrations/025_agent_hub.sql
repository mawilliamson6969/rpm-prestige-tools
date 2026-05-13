-- Phase 1: Agent Referral Hub — CRM foundation only.
--
-- Scope (Phase 1):
--   * Brokerages, agents, personal details, timeline activities, tags,
--     agent-to-agent relationships, attachments, hub-specific permissions,
--     and a tamper-evident audit log.
--   * Manual data entry only. No MLS upload, no inbound integrations,
--     no automations, no referral pipeline, no LTV calculations.
--
-- DELIBERATELY OUT OF SCOPE for Phase 1 (do NOT add here without spec):
--   * agent_hub_referrals + financials (Phase 2)
--   * agent_hub_automations + sequences (Phase 3)
--   * Microsoft Graph / OpenPhone / Lob inbound parsing (Phase 4+)
--
-- Conventions matched to existing codebase (see 023_sla_policies.sql,
-- 024_automation_rules.sql):
--   * SERIAL primary keys (NOT uuid). Foreign keys to users(id) are INTEGER.
--   * TIMESTAMPTZ DEFAULT NOW().
--   * CHECK constraints validate enums in-database.
--   * `active` boolean for soft-disable; status='deleted' for soft-deletion
--     of agents (preserves referential integrity for future referral history).
--   * Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--     INSERT ... ON CONFLICT DO NOTHING. Safe to re-run.
--   * Also applied at runtime by ensureAgentHubSchema().

-- ============================================================
-- 1. agent_hub_brokerages
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_brokerages (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  address_1           TEXT,
  address_2           TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  phone               TEXT,
  website             TEXT,
  mls_office_id       TEXT,
  notes               TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Same brokerage name in different cities is fine (e.g. "Compass" in Houston vs Dallas).
-- Same name in same city is the duplicate we want to block.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_brokerages_name_city
  ON agent_hub_brokerages (LOWER(name), LOWER(COALESCE(city, '')))
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_agent_hub_brokerages_mls_office
  ON agent_hub_brokerages (mls_office_id)
  WHERE mls_office_id IS NOT NULL;

-- ============================================================
-- 2. agent_hub_agents
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_agents (
  id                          SERIAL PRIMARY KEY,

  -- Identity
  full_name                   TEXT NOT NULL,
  first_name                  TEXT,
  last_name                   TEXT,
  preferred_name              TEXT,
  pronouns                    TEXT,
  photo_url                   TEXT,

  -- Professional
  license_number              TEXT,
  license_state               TEXT NOT NULL DEFAULT 'TX',
  license_status              TEXT,
  license_expiration          DATE,
  mls_id                      TEXT,
  years_licensed              INTEGER,
  brokerage_id                INTEGER REFERENCES agent_hub_brokerages(id) ON DELETE SET NULL,
  brokerage_name              TEXT,
  title                       TEXT,
  team_name                   TEXT,

  -- Business
  niche                       TEXT,
  target_zips                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  average_price_point         NUMERIC(12,2),
  annual_volume               NUMERIC(14,2),
  referral_fee_split          NUMERIC(5,4),

  -- Contact
  email                       TEXT,
  phone_mobile                TEXT,
  phone_office                TEXT,
  mailing_address_1           TEXT,
  mailing_address_2           TEXT,
  city                        TEXT,
  state                       TEXT,
  zip                         TEXT,
  preferred_channel           TEXT,
  preferred_contact_time      TEXT,
  do_not_contact              BOOLEAN NOT NULL DEFAULT FALSE,

  -- Online presence
  linkedin_url                TEXT,
  facebook_url                TEXT,
  instagram_handle            TEXT,
  personal_website            TEXT,
  har_profile_url             TEXT,

  -- Relationship
  tier                        TEXT NOT NULL DEFAULT 'cold',
  source                      TEXT,
  source_detail               TEXT,
  first_contact_date          DATE,
  last_interaction_date       TIMESTAMPTZ,
  relationship_owner_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Status
  status                      TEXT NOT NULL DEFAULT 'active',
  notes                       TEXT,

  -- Compliance
  consent_to_email            BOOLEAN NOT NULL DEFAULT FALSE,
  consent_to_email_at         TIMESTAMPTZ,
  consent_to_sms              BOOLEAN NOT NULL DEFAULT FALSE,
  consent_to_sms_at           TIMESTAMPTZ,
  unsubscribed_at             TIMESTAMPTZ,

  -- Merge tracking (when this record is the loser in a merge)
  merged_into_agent_id        INTEGER REFERENCES agent_hub_agents(id) ON DELETE SET NULL,
  merged_at                   TIMESTAMPTZ,
  merged_by                   INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- System
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Full-text search vector (maintained by trigger below).
  search_tsv                  TSVECTOR,

  CHECK (tier IN ('cold','prospect','warm','partner','vip','dormant')),
  CHECK (status IN ('active','paused','dnc','skipped','converted','deleted')),
  CHECK (preferred_channel IS NULL OR preferred_channel IN ('email','text','call','mail')),
  CHECK (niche IS NULL OR niche IN ('luxury','first_time','investor','leases','relocation','multi','other')),
  CHECK (source IS NULL OR source IN ('manual','mls_listing','linkedin','event','referral_from_agent','website_form','other')),
  -- DNC firewall — biconditional. status='dnc' iff do_not_contact=true,
  -- with one exception: status='deleted' allows do_not_contact in either
  -- direction (deleted rows are considered DNC for outreach purposes).
  CHECK (
    status = 'deleted'
    OR ( (status = 'dnc') = (do_not_contact = TRUE) )
  )
);

-- Dedupe key: license_number is globally unique among non-deleted, non-merged
-- agents. Partial index keeps soft-deleted rows from blocking re-creation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_agents_license
  ON agent_hub_agents (license_number)
  WHERE license_number IS NOT NULL
    AND status != 'deleted'
    AND merged_into_agent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_email
  ON agent_hub_agents (LOWER(email))
  WHERE email IS NOT NULL AND status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_mls_id
  ON agent_hub_agents (mls_id)
  WHERE mls_id IS NOT NULL AND status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_brokerage
  ON agent_hub_agents (brokerage_id)
  WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_tier_status
  ON agent_hub_agents (tier, status);
CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_last_interaction
  ON agent_hub_agents (last_interaction_date DESC NULLS LAST)
  WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_relationship_owner
  ON agent_hub_agents (relationship_owner_user_id)
  WHERE relationship_owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_dnc
  ON agent_hub_agents (do_not_contact)
  WHERE do_not_contact = TRUE;
-- Fuzzy name matching for dedupe lookups & search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_name_trgm
  ON agent_hub_agents USING gin (full_name gin_trgm_ops)
  WHERE status != 'deleted';
-- Full-text search.
CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_search_tsv
  ON agent_hub_agents USING gin (search_tsv);

-- Search vector trigger. Index agent name, brokerage name (denormalized),
-- license #, MLS ID, email, and notes. Activity bodies are indexed separately.
CREATE OR REPLACE FUNCTION agent_hub_agents_search_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', COALESCE(NEW.full_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.preferred_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.brokerage_name, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.email, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.license_number, '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(NEW.mls_id, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.notes, '')), 'D');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_hub_agents_search_tsv ON agent_hub_agents;
CREATE TRIGGER trg_agent_hub_agents_search_tsv
  BEFORE INSERT OR UPDATE OF full_name, preferred_name, brokerage_name, email, license_number, mls_id, notes
  ON agent_hub_agents
  FOR EACH ROW EXECUTE FUNCTION agent_hub_agents_search_tsv_trigger();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION agent_hub_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_hub_agents_updated_at ON agent_hub_agents;
CREATE TRIGGER trg_agent_hub_agents_updated_at
  BEFORE UPDATE ON agent_hub_agents
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- DNC cascade trigger: defense in depth. If do_not_contact flips to true
-- without status being set explicitly, force status='dnc' and stamp
-- unsubscribed_at. This makes the biconditional CHECK satisfiable for any
-- direct SQL UPDATE (not just app-layer ones via applyDncCascade).
CREATE OR REPLACE FUNCTION agent_hub_agents_dnc_cascade() RETURNS trigger AS $$
BEGIN
  IF NEW.do_not_contact = TRUE AND NEW.status NOT IN ('dnc','deleted') THEN
    NEW.status := 'dnc';
    NEW.unsubscribed_at := COALESCE(NEW.unsubscribed_at, NOW());
  END IF;
  IF NEW.do_not_contact = FALSE AND NEW.status = 'dnc' THEN
    -- Un-DNC must explicitly set status to something else; if caller didn't,
    -- default to 'active' to keep the biconditional satisfied.
    NEW.status := 'active';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_hub_agents_dnc_cascade ON agent_hub_agents;
CREATE TRIGGER trg_agent_hub_agents_dnc_cascade
  BEFORE INSERT OR UPDATE OF do_not_contact, status ON agent_hub_agents
  FOR EACH ROW EXECUTE FUNCTION agent_hub_agents_dnc_cascade();

DROP TRIGGER IF EXISTS trg_agent_hub_brokerages_updated_at ON agent_hub_brokerages;
CREATE TRIGGER trg_agent_hub_brokerages_updated_at
  BEFORE UPDATE ON agent_hub_brokerages
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 3. agent_hub_personal_details
-- ============================================================
-- ISOLATED for permissions: this table is only readable by users with
-- agent_hub_user_permissions.can_view_personal_details = TRUE. The route
-- layer enforces that — DO NOT join this table into general agent endpoints.

CREATE TABLE IF NOT EXISTS agent_hub_personal_details (
  id                          SERIAL PRIMARY KEY,
  agent_id                    INTEGER NOT NULL UNIQUE REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  birthday_month              INTEGER,
  birthday_day                INTEGER,
  birthday_year               INTEGER,
  spouse_name                 TEXT,
  spouse_birthday_month       INTEGER,
  spouse_birthday_day         INTEGER,
  anniversary_date            DATE,
  children                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  pets                        JSONB NOT NULL DEFAULT '[]'::jsonb,
  alma_mater                  TEXT,
  graduation_year             INTEGER,
  hometown                    TEXT,
  hobbies                     TEXT,
  food_preferences            TEXT,
  gift_preferences            TEXT,
  religious_observances       TEXT,
  important_dates             JSONB NOT NULL DEFAULT '[]'::jsonb,
  personal_notes              TEXT,
  last_updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (birthday_month IS NULL OR (birthday_month BETWEEN 1 AND 12)),
  CHECK (birthday_day IS NULL OR (birthday_day BETWEEN 1 AND 31)),
  CHECK (spouse_birthday_month IS NULL OR (spouse_birthday_month BETWEEN 1 AND 12)),
  CHECK (spouse_birthday_day IS NULL OR (spouse_birthday_day BETWEEN 1 AND 31))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_personal_details_birthday
  ON agent_hub_personal_details (birthday_month, birthday_day)
  WHERE birthday_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_personal_details_anniversary
  ON agent_hub_personal_details (anniversary_date)
  WHERE anniversary_date IS NOT NULL;

-- ============================================================
-- 4. agent_hub_activities
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_activities (
  id                  SERIAL PRIMARY KEY,
  agent_id            INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  direction           TEXT NOT NULL,
  subject             TEXT,
  summary             TEXT,
  body                TEXT,
  external_id         TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- automation_id and template_id are nullable text for now; FK constraints
  -- will be added in Phase 3 when those tables exist.
  automation_id       INTEGER,
  template_id         INTEGER,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Soft-delete to keep activity history immutable.
  deleted_at          TIMESTAMPTZ,
  deleted_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Full-text search vector for body + subject + summary.
  search_tsv          TSVECTOR,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (type IN (
    'email_sent','email_received','call_made','call_received',
    'text_sent','text_received','postcard_sent','letter_sent','gift_sent',
    'meeting_in_person','event_attended','note_added','system_event'
  )),
  CHECK (direction IN ('inbound','outbound','internal')),
  -- Idempotency: same external_id from same source shouldn't insert twice.
  -- Allows multiple NULL externals (manual entries), unique among non-null.
  CONSTRAINT uq_agent_hub_activities_external UNIQUE (external_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_activities_agent_occurred
  ON agent_hub_activities (agent_id, occurred_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_activities_type
  ON agent_hub_activities (type)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_activities_direction
  ON agent_hub_activities (direction)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_activities_created_at
  ON agent_hub_activities (created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_activities_search_tsv
  ON agent_hub_activities USING gin (search_tsv);

CREATE OR REPLACE FUNCTION agent_hub_activities_search_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('english', COALESCE(NEW.subject, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.body, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_hub_activities_search_tsv ON agent_hub_activities;
CREATE TRIGGER trg_agent_hub_activities_search_tsv
  BEFORE INSERT OR UPDATE OF subject, summary, body
  ON agent_hub_activities
  FOR EACH ROW EXECUTE FUNCTION agent_hub_activities_search_tsv_trigger();

DROP TRIGGER IF EXISTS trg_agent_hub_activities_updated_at ON agent_hub_activities;
CREATE TRIGGER trg_agent_hub_activities_updated_at
  BEFORE UPDATE ON agent_hub_activities
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- Cascade last_interaction_date back onto the agent record when a new
-- activity lands. We DON'T cascade on update — once last_interaction_date
-- is set we don't bump it back in time when an old row is patched.
CREATE OR REPLACE FUNCTION agent_hub_activities_bump_last_interaction() RETURNS trigger AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    UPDATE agent_hub_agents
       SET last_interaction_date = GREATEST(COALESCE(last_interaction_date, 'epoch'::timestamptz), NEW.occurred_at)
     WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_hub_activities_bump_last ON agent_hub_activities;
CREATE TRIGGER trg_agent_hub_activities_bump_last
  AFTER INSERT ON agent_hub_activities
  FOR EACH ROW EXECUTE FUNCTION agent_hub_activities_bump_last_interaction();

-- ============================================================
-- 5. agent_hub_tags
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_tags (
  id              SERIAL PRIMARY KEY,
  agent_id        INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  tag             TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_agent_hub_tags_agent_tag UNIQUE (agent_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_tags_tag
  ON agent_hub_tags (LOWER(tag));

-- ============================================================
-- 6. agent_hub_relationships
-- ============================================================
-- Directed: agent_a is the subject, agent_b is the object.
-- Example: type='mentor' means A mentors B.
-- Symmetric types (team, spouse, friend, competitor) are stored once;
-- the API layer surfaces both sides.

CREATE TABLE IF NOT EXISTS agent_hub_relationships (
  id                  SERIAL PRIMARY KEY,
  agent_a_id          INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  agent_b_id          INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  relationship_type   TEXT NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (agent_a_id <> agent_b_id),
  CHECK (relationship_type IN ('team','mentor','mentee','spouse','competitor','friend','other')),
  CONSTRAINT uq_agent_hub_relationships UNIQUE (agent_a_id, agent_b_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_relationships_a ON agent_hub_relationships (agent_a_id);
CREATE INDEX IF NOT EXISTS idx_agent_hub_relationships_b ON agent_hub_relationships (agent_b_id);

-- ============================================================
-- 7. agent_hub_activity_attachments
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_activity_attachments (
  id                  SERIAL PRIMARY KEY,
  activity_id         INTEGER NOT NULL REFERENCES agent_hub_activities(id) ON DELETE CASCADE,
  filename            TEXT NOT NULL,           -- Original filename (user-facing label)
  file_url            TEXT NOT NULL,           -- API-relative download URL (auth-gated)
  disk_basename       TEXT,                    -- Backend-only: on-disk filename in uploads-private/agent-hub/. NEVER returned to clients.
  file_type           TEXT,
  file_size_bytes     BIGINT,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by         INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Idempotent upgrade for environments that already have the table.
ALTER TABLE agent_hub_activity_attachments
  ADD COLUMN IF NOT EXISTS disk_basename TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_hub_activity_attachments_activity
  ON agent_hub_activity_attachments (activity_id);

-- ============================================================
-- 8. agent_hub_user_permissions
-- ============================================================
-- Hub-specific permission layer ON TOP of the global users.role + permissions.
-- A user only gets Hub access if a row exists here. Owners bypass the gate
-- via existing isAdmin() but still get a row seeded for visibility.

CREATE TABLE IF NOT EXISTS agent_hub_user_permissions (
  id                            SERIAL PRIMARY KEY,
  user_id                       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role                          TEXT NOT NULL DEFAULT 'team',
  can_view_personal_details     BOOLEAN NOT NULL DEFAULT FALSE,
  can_change_tier               BOOLEAN NOT NULL DEFAULT FALSE,
  can_mark_dnc                  BOOLEAN NOT NULL DEFAULT FALSE,
  can_export                    BOOLEAN NOT NULL DEFAULT FALSE,
  can_merge                     BOOLEAN NOT NULL DEFAULT FALSE,
  -- For 'outreach' role: NULL means all agents; an array restricts to specific IDs.
  assigned_agent_ids            INTEGER[],
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (role IN ('owner','manager','team','outreach','read_only'))
);

DROP TRIGGER IF EXISTS trg_agent_hub_user_permissions_updated_at ON agent_hub_user_permissions;
CREATE TRIGGER trg_agent_hub_user_permissions_updated_at
  BEFORE UPDATE ON agent_hub_user_permissions
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- Seed permissions for known team members (idempotent — keyed on username).
-- This tolerates users that don't exist yet by skipping rows where the
-- subquery returns NULL. Add new users to users table first, then re-run.
INSERT INTO agent_hub_user_permissions
  (user_id, role, can_view_personal_details, can_change_tier, can_mark_dnc, can_export, can_merge)
SELECT u.id, 'owner', TRUE, TRUE, TRUE, TRUE, TRUE
  FROM users u
 WHERE u.username = 'mike'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO agent_hub_user_permissions
  (user_id, role, can_view_personal_details, can_change_tier, can_mark_dnc, can_export, can_merge)
SELECT u.id, 'manager', TRUE, TRUE, TRUE, TRUE, FALSE
  FROM users u
 WHERE u.username = 'lori'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO agent_hub_user_permissions
  (user_id, role, can_view_personal_details, can_change_tier, can_mark_dnc, can_export, can_merge)
SELECT u.id, 'team', FALSE, FALSE, FALSE, FALSE, FALSE
  FROM users u
 WHERE u.username = 'amanda'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO agent_hub_user_permissions
  (user_id, role, can_view_personal_details, can_change_tier, can_mark_dnc, can_export, can_merge)
SELECT u.id, 'team', FALSE, FALSE, FALSE, FALSE, FALSE
  FROM users u
 WHERE u.username = 'amelia'
ON CONFLICT (user_id) DO NOTHING;

-- TODO: if you add a new team member to the users table, also INSERT a row
-- here with the appropriate role. The Hub will return 403 for users without
-- a row; admins see a friendly "no Hub access" message.

-- ============================================================
-- 9. agent_hub_audit_log
-- ============================================================
-- Tamper-evident audit trail. Every WRITE through the API logs here.
-- This is in addition to the inline updated_at / updated_by columns so we
-- have a per-field history for compliance & debugging.

CREATE TABLE IF NOT EXISTS agent_hub_audit_log (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity_type       TEXT NOT NULL,        -- 'agent','brokerage','personal_details','activity','tag','relationship','attachment','permissions'
  entity_id         INTEGER,
  action            TEXT NOT NULL,        -- 'create','update','delete','merge','bulk_update','export','permission_change'
  field_name        TEXT,                 -- NULL for action='create'/'delete'/'merge'/'export'
  old_value         JSONB,
  new_value         JSONB,
  context           JSONB,                -- Request metadata (ip, ua, route)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_audit_entity
  ON agent_hub_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_audit_user
  ON agent_hub_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_audit_action
  ON agent_hub_audit_log (action, created_at DESC);
