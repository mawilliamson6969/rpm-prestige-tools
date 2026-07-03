-- 049_maintenance_phase3.sql
-- Maintenance Management System — Phase 3 (Tech management + scheduling).
--
-- The maint_techs and maint_tech_assignments tables shipped in 047 (data model
-- designed once) and already cover the roster (rates, skills, active) and
-- scheduled windows + hours_logged. Phase 3 only needs a per-assignment note
-- for scheduling context.
--
-- Hours→billing rollup is a pure computed preview (hours_logged × hourly_rate),
-- so it needs no schema. Nothing is posted to AppFolio in Phase 3 (suggest-only).
--
-- Idempotent — safe to re-run on every boot via ensureMaintSchema().

ALTER TABLE maint_tech_assignments
  ADD COLUMN IF NOT EXISTS notes TEXT;
