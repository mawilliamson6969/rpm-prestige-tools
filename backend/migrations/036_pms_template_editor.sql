-- ============================================================
-- 036 — PMS Template Editor (Phase 7.1)
--
-- Source of truth for the schema delta behind the Stages &
-- Workflows builder + Email/Text Templates tabs. This file is the
-- documented/repeatable form; the same statements are applied
-- inline (idempotent) at boot by backend/lib/operationsSchema.js so
-- there is no separate migration runner to invoke.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
-- guarded ADD CONSTRAINT. Safe to run repeatedly.
-- ============================================================

-- 1. Stage grouping (Backlog / Active / Completed / Canceled) reuses
--    the pre-existing process_template_stages.category column. No new
--    stage column is added by this migration.

-- 2. Workflow-step fields. Applied to BOTH the template steps and the
--    per-instance steps so a launched process carries the kind/actor/
--    timing it was started with.
--      kind:  todo | email | text | call | meet | stagechange | branch | exit
--      actor: auto | manual              (design's `who`)
--      when_text: free text — "immediately", "in 2 days",
--                 "on tenant reply", "after confirm", "every 3 days"
--      day_offset: optional day number shown on the timeline rail
--      email_template_id / text_template_id: referenced template
--      branch_config: jsonb for branch / stagechange targets
ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS kind              VARCHAR(20) DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS actor             VARCHAR(10) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS when_text         VARCHAR(120),
  ADD COLUMN IF NOT EXISTS day_offset        INTEGER,
  ADD COLUMN IF NOT EXISTS email_template_id INTEGER,
  ADD COLUMN IF NOT EXISTS text_template_id  INTEGER,
  ADD COLUMN IF NOT EXISTS branch_config     JSONB;

ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS kind              VARCHAR(20) DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS actor             VARCHAR(10) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS when_text         VARCHAR(120),
  ADD COLUMN IF NOT EXISTS day_offset        INTEGER,
  ADD COLUMN IF NOT EXISTS email_template_id INTEGER,
  ADD COLUMN IF NOT EXISTS text_template_id  INTEGER,
  ADD COLUMN IF NOT EXISTS branch_config     JSONB;

-- 3. Email + text template libraries are NOT created here. The
--    process_email_templates / process_text_templates tables and
--    their CRUD already exist (operationsSchema.js + migration 015,
--    served by routes/processSettings.js). Phase 7.1 reuses that
--    system unchanged; the editor's Email/Text tabs call the existing
--    /processes/templates/:id/(email|text)-templates endpoints.
--
-- NOTE: email_template_id / text_template_id on the step tables stay
-- soft references (no hard FK) — those columns predate this migration
-- on some rows and a validated FK at boot would crash startup.
-- Referential integrity is enforced by the route handlers.
