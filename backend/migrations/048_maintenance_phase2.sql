-- 048_maintenance_phase2.sql
-- Maintenance Management System — Phase 2 (Subcontractor DB).
--
-- The maint_subcontractors table itself shipped in 047 (data model designed
-- once). Phase 2 adds:
--   * per-job rating history (maint_subcontractor_ratings)
--   * coi_alerted_at — dedup marker so the daily COI-expiry cron texts once
--     per expiry window instead of every day.
--
-- Idempotent — safe to re-run on every boot via ensureMaintSchema().

-- Per-job (or ad-hoc) rating history. The subcontractor's shown rating is the
-- live AVG over these rows; maint_subcontractors.rating (from 047) is left as
-- an optional manual baseline and is not surfaced by the API.
CREATE TABLE IF NOT EXISTS maint_subcontractor_ratings (
  id                SERIAL PRIMARY KEY,
  subcontractor_id  INTEGER NOT NULL REFERENCES maint_subcontractors(id) ON DELETE CASCADE,
  job_id            INTEGER REFERENCES maint_jobs(id) ON DELETE SET NULL,
  rating            INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  notes             TEXT,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maint_sub_ratings_sub
  ON maint_subcontractor_ratings (subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_maint_sub_ratings_job
  ON maint_subcontractor_ratings (job_id);

-- When the COI-expiry cron last texted about this vendor. Cleared (set NULL)
-- whenever coi_expiry moves forward past the alert window, so a renewed-then-
-- re-expiring COI alerts again.
ALTER TABLE maint_subcontractors
  ADD COLUMN IF NOT EXISTS coi_alerted_at TIMESTAMPTZ;
