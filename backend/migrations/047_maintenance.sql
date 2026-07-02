-- 047_maintenance.sql
-- Maintenance Management System — shared data model (Phase 1).
--
-- Five interconnected modules share one data model. This migration creates
-- ALL of the core tables up front so the model is designed once, even though
-- Phase 1 only builds CRUD/UI for the central `maint_jobs` entity. The other
-- tables are created empty and filled in by later phases:
--   maint_subcontractors  — Phase 2 (vendor DB)
--   maint_techs           — Phase 3 (roster)
--   maint_tech_assignments— Phase 3 (scheduling)
--   maint_quotes(_lines)  — Phase 4 (quotes + PrestigeSign)
--   maint_projects        — Phase 5 (make-ready via process engine)
--
-- Jobs link to AppFolio property/unit IDs from the read-only `appfolio`
-- mirror schema. AppFolio stays the system of record: we store the AppFolio
-- id (TEXT) and JOIN — we never duplicate property data. Because the FK
-- targets live in the `appfolio` schema, this applier must run AFTER
-- ensureAfMirrorSchema (see backend/index.js boot order).
--
-- Conventions (matched to 042_contacts.sql / 043_appfolio_mirror_tables.sql):
--   * SERIAL pks, INTEGER FKs to users(id), TEXT FKs to appfolio.*(id)
--   * TIMESTAMPTZ NOT NULL DEFAULT NOW() for created_at/updated_at (no update
--     trigger — handlers set updated_at = NOW() on UPDATE)
--   * soft-delete via archived_at + partial indexes WHERE archived_at IS NULL
--   * CHECK constraints validate enums in-database
--   * Idempotent — safe to re-run on every boot via ensureMaintSchema().

-- ---------------------------------------------------------------------------
-- Subcontractor DB (Phase 2). No FK to AppFolio.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maint_subcontractors (
  id              SERIAL PRIMARY KEY,
  company_name    TEXT NOT NULL,
  contact_name    TEXT,
  email           TEXT,
  phone           TEXT,
  trades          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  zip_coverage    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  coi_expiry      DATE,
  w9_on_file      BOOLEAN NOT NULL DEFAULT FALSE,
  rating          NUMERIC(2,1),
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_maint_subs_trades
  ON maint_subcontractors USING GIN (trades) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maint_subs_zip
  ON maint_subcontractors USING GIN (zip_coverage) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Internal tech roster (Phase 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maint_techs (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  trade_skills    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  hourly_rate     NUMERIC(10,2),
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_maint_techs_active
  ON maint_techs (id) WHERE is_active AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Make-ready / multi-task projects — parent container of child jobs (Phase 5).
-- process_id links to a spawned process in the existing process engine.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maint_projects (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  property_id     TEXT REFERENCES appfolio.properties(id),
  unit_id         TEXT REFERENCES appfolio.units(id),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'on_hold', 'complete', 'cancelled')),
  process_id      INTEGER REFERENCES processes(id) ON DELETE SET NULL,
  target_completion DATE,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_maint_projects_property
  ON maint_projects (property_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maint_projects_status
  ON maint_projects (status) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Central ticket / work order (Phase 1 — the one entity we build CRUD for).
-- Status pipeline: New → Triaged → Quoted → Scheduled → In Progress →
-- Complete → Invoiced. property_id is required (a job is always about a
-- property); unit_id optional (property-level jobs exist).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maint_jobs (
  id                SERIAL PRIMARY KEY,
  property_id       TEXT NOT NULL REFERENCES appfolio.properties(id),
  unit_id           TEXT REFERENCES appfolio.units(id),
  project_id        INTEGER REFERENCES maint_projects(id) ON DELETE SET NULL,
  subcontractor_id  INTEGER REFERENCES maint_subcontractors(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'triaged', 'quoted', 'scheduled',
                                        'in_progress', 'complete', 'invoiced')),
  priority          TEXT NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  source            TEXT
                      CHECK (source IN ('tenant_report', 'inspection', 'owner_request')),
  sla_due_at        TIMESTAMPTZ,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_maint_jobs_status
  ON maint_jobs (status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maint_jobs_property
  ON maint_jobs (property_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maint_jobs_unit
  ON maint_jobs (unit_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maint_jobs_project
  ON maint_jobs (project_id) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Photo / file attachments for jobs (Phase 1 model; upload wiring later).
-- Mirrors the disk-storage convention of the inbox `attachments` table
-- (storage_kind 'disk' now, 's3'/Linode Object Storage reserved) but stands
-- alone — the inbox table is message-oriented (NOT NULL direction, ticket/
-- thread FKs) and does not fit job photos.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maint_job_photos (
  id              SERIAL PRIMARY KEY,
  job_id          INTEGER NOT NULL REFERENCES maint_jobs(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  content_type    TEXT,
  size_bytes      BIGINT,
  storage_path    TEXT,
  storage_kind    TEXT NOT NULL DEFAULT 'disk'
                    CHECK (storage_kind IN ('disk', 's3')),
  uploaded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maint_job_photos_job ON maint_job_photos (job_id);

-- ---------------------------------------------------------------------------
-- Quotes (Phase 4). Header + line items. owner_approval_state drives the
-- owner sign-off flow; esign_request_id links to a PrestigeSign envelope;
-- on approval a suggested AppFolio bill draft is generated (preview-only,
-- never auto-posted).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maint_quotes (
  id                    SERIAL PRIMARY KEY,
  job_id                INTEGER NOT NULL REFERENCES maint_jobs(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'sent', 'approved', 'rejected')),
  owner_approval_state  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (owner_approval_state IN ('pending', 'approved', 'declined')),
  markup_pct            NUMERIC(5,2) NOT NULL DEFAULT 0,
  esign_request_id      INTEGER REFERENCES esign_requests(id) ON DELETE SET NULL,
  notes                 TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_maint_quotes_job
  ON maint_quotes (job_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS maint_quote_lines (
  id              SERIAL PRIMARY KEY,
  quote_id        INTEGER NOT NULL REFERENCES maint_quotes(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('labor', 'material')),
  description     TEXT NOT NULL,
  qty             NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maint_quote_lines_quote ON maint_quote_lines (quote_id);

-- ---------------------------------------------------------------------------
-- Tech ↔ job assignments with scheduled windows and hours logged (Phase 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maint_tech_assignments (
  id              SERIAL PRIMARY KEY,
  job_id          INTEGER NOT NULL REFERENCES maint_jobs(id) ON DELETE CASCADE,
  tech_id         INTEGER NOT NULL REFERENCES maint_techs(id) ON DELETE CASCADE,
  scheduled_start TIMESTAMPTZ,
  scheduled_end   TIMESTAMPTZ,
  hours_logged    NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maint_tech_assign_job  ON maint_tech_assignments (job_id);
CREATE INDEX IF NOT EXISTS idx_maint_tech_assign_tech ON maint_tech_assignments (tech_id);
