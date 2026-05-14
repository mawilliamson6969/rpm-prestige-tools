-- Phase 7: Unification. Destructive — merges System A (process engine)
-- and System B (Monday boards) into one model.
--
-- Source of truth: unification-plan.md at repo root.
--
-- This migration:
--   1. Adds 8 instruction columns to process_template_steps + process_steps
--   2. Adds a slug column to process_templates so /operations/boards/<slug>
--      can resolve to a template (defaults seeded for the 6 starter templates)
--   3. Rekeys the Phase 4 updates feed to processes: adds process_id to
--      mb_item_updates, drops the FK from mb_item_updates.item_id and
--      mb_api_log.triggered_by_item_id (so the host mb_items table can go)
--   4. Drops the System B structural tables (mb_boards / mb_items /
--      mb_groups / mb_board_columns / mb_subitems / mb_subitem_templates /
--      mb_subitem_updates / mb_subitem_checklist_state / mb_board_settings)
--   5. Seeds the Lease Renewal Prep stage with 5 steps that carry the
--      embedded SOP content the team needs
--
-- Survivors (rekeyed, not dropped):
--   * mb_item_updates  — Phase 4 comment threads
--   * mb_update_mentions
--   * mb_update_reactions
--   * mb_update_attachments
--   * mb_api_log       — AppFolio API audit log
--   * mb_webhook_events — AppFolio webhook receiver log
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP TABLE IF EXISTS, ON CONFLICT
-- DO NOTHING / DO UPDATE on the seed.

-- ============================================================
-- 1. process_templates: slug
-- ============================================================
--
-- A slug lets URLs like /operations/boards/renewals resolve to the
-- "Lease Renewal" template without depending on the auto-increment id.
-- Renewals is pinned to slug = 'renewals' below; other starter templates
-- get derived slugs.

ALTER TABLE process_templates
  ADD COLUMN IF NOT EXISTS slug VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_process_templates_slug
  ON process_templates (slug)
  WHERE slug IS NOT NULL;

-- Backfill slugs for the existing starter templates so the boards URLs
-- work out-of-the-box. Slug values match the conversational shorthand:
--   "Lease Renewal"             → renewals
--   "Move-Out"                  → move-outs
--   "Maintenance Escalation"    → maintenance-escalation
--   "Annual Property Inspection"→ inspections
--   "Owner Termination"         → owner-termination
--   "Eviction Process"          → evictions
--
-- For any template not listed here, derive a slug from the name.

UPDATE process_templates SET slug = 'renewals'              WHERE name = 'Lease Renewal'              AND slug IS NULL;
UPDATE process_templates SET slug = 'move-outs'             WHERE name = 'Move-Out'                   AND slug IS NULL;
UPDATE process_templates SET slug = 'maintenance-escalation' WHERE name = 'Maintenance Escalation'    AND slug IS NULL;
UPDATE process_templates SET slug = 'inspections'           WHERE name = 'Annual Property Inspection' AND slug IS NULL;
UPDATE process_templates SET slug = 'owner-termination'     WHERE name = 'Owner Termination'          AND slug IS NULL;
UPDATE process_templates SET slug = 'evictions'             WHERE name = 'Eviction Process'           AND slug IS NULL;

-- Catch-all: anything still NULL gets a slug derived from its name.
UPDATE process_templates
   SET slug = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'))
 WHERE slug IS NULL;

-- ============================================================
-- 2. 8 instruction columns on process_template_steps + process_steps
-- ============================================================
--
-- Per spec each step now carries the 8 sections we'd designed for
-- Phase 5: objective (short text), steps (rich-text-lite blocks),
-- decision matrix (rows), email templates (subject + body), SMS
-- templates (body), escalation triggers (text), completion checklist
-- (items), related resources (label + URL). Most are JSONB; the two
-- free-text ones stay TEXT.
--
-- They live on both the template (canonical content) and the per-
-- process step (copied at process launch via postProcess; future
-- per-instance overrides land here without touching the template).

ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS instruction_objective            TEXT,
  ADD COLUMN IF NOT EXISTS instruction_steps                JSONB,
  ADD COLUMN IF NOT EXISTS instruction_decision_matrix      JSONB,
  ADD COLUMN IF NOT EXISTS instruction_email_templates      JSONB,
  ADD COLUMN IF NOT EXISTS instruction_sms_templates        JSONB,
  ADD COLUMN IF NOT EXISTS instruction_escalations          TEXT,
  ADD COLUMN IF NOT EXISTS instruction_completion_checklist JSONB,
  ADD COLUMN IF NOT EXISTS instruction_related_resources    JSONB;

ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS instruction_objective            TEXT,
  ADD COLUMN IF NOT EXISTS instruction_steps                JSONB,
  ADD COLUMN IF NOT EXISTS instruction_decision_matrix      JSONB,
  ADD COLUMN IF NOT EXISTS instruction_email_templates      JSONB,
  ADD COLUMN IF NOT EXISTS instruction_sms_templates        JSONB,
  ADD COLUMN IF NOT EXISTS instruction_escalations          TEXT,
  ADD COLUMN IF NOT EXISTS instruction_completion_checklist JSONB,
  ADD COLUMN IF NOT EXISTS instruction_related_resources    JSONB;

-- ============================================================
-- 3. Rekey Phase 4 updates feed: mb_item_updates → processes
-- ============================================================
--
-- The Phase 4 feed (comments, mentions, reactions, attachments) is the
-- one piece of System B we keep. It moves from per-mb_item to per-
-- process. We add process_id alongside item_id, drop the FK on item_id
-- (so the host mb_items table can be dropped), and leave item_id as a
-- nullable INTEGER for now in case any historical row needs forensic
-- mapping later. New writes only set process_id.

ALTER TABLE mb_item_updates
  ADD COLUMN IF NOT EXISTS process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mb_item_updates_process
  ON mb_item_updates (process_id, created_at DESC)
  WHERE process_id IS NOT NULL;

-- Drop the FK that pins item_id to mb_items (we're about to drop
-- mb_items). The column itself stays as a nullable integer so existing
-- rows aren't lost — they're just orphaned, which is fine because
-- there are no real users yet.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'mb_item_updates'
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid) ILIKE '%mb_items%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE mb_item_updates DROP CONSTRAINT ' || quote_ident(c.conname)
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'mb_item_updates'
         AND c.contype = 'f'
         AND pg_get_constraintdef(c.oid) ILIKE '%mb_items%'
       LIMIT 1
    );
  END IF;
END $$;

-- mb_item_updates.item_id was NOT NULL; relax that now that the column
-- is decommissioned.
ALTER TABLE mb_item_updates ALTER COLUMN item_id DROP NOT NULL;

-- ============================================================
-- 4. Drop FK from mb_api_log to mb_items, mb_subitems
-- ============================================================
--
-- mb_api_log survives (AppFolio audit log) but its triggered_by_item_id
-- and triggered_by_subitem_id columns FK to soon-dropped tables. Drop
-- the constraints; keep the integer columns for the audit value they
-- carry.

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  FOR v_conname IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'mb_api_log'
       AND c.contype = 'f'
       AND (pg_get_constraintdef(c.oid) ILIKE '%mb_items%'
            OR pg_get_constraintdef(c.oid) ILIKE '%mb_subitems%')
  LOOP
    EXECUTE 'ALTER TABLE mb_api_log DROP CONSTRAINT ' || quote_ident(v_conname);
  END LOOP;
END $$;

-- ============================================================
-- 5. Drop the System B structural tables (no longer needed)
-- ============================================================
--
-- Order matters because of FK chains. CASCADE on each handles whatever
-- residual FKs we missed (notably any FK we forgot about pointing into
-- these tables). The plan accepts this — neither system is in
-- production.

DROP TABLE IF EXISTS mb_subitem_checklist_state CASCADE;
DROP TABLE IF EXISTS mb_subitem_templates CASCADE;
DROP TABLE IF EXISTS mb_subitem_updates CASCADE;
DROP TABLE IF EXISTS mb_subitems CASCADE;
DROP TABLE IF EXISTS mb_board_settings CASCADE;
DROP TABLE IF EXISTS mb_groups CASCADE;
DROP TABLE IF EXISTS mb_items CASCADE;
DROP TABLE IF EXISTS mb_board_columns CASCADE;
DROP TABLE IF EXISTS mb_boards CASCADE;
-- These never existed in this codebase (the prompt's spec mentioned
-- them but Phase 5 stored instructions inline on a JSONB column, and
-- Phase 3.5 used mb_board_columns not mb_columns). DROP IF EXISTS
-- makes the line a no-op when they don't exist.
DROP TABLE IF EXISTS mb_instructions CASCADE;
DROP TABLE IF EXISTS mb_columns CASCADE;

-- ============================================================
-- 6. Seed Lease Renewal Prep — stage + 5 steps with SOP content
-- ============================================================
--
-- The Lease Renewal template already has stages (Notice Sent / Analysis
-- / Tenant Response / Lease Signing / Complete) seeded by
-- operationsSchema.js. Per the spec we add a "Lease Renewal Prep"
-- stage at the front of the workflow with 5 prep steps, each carrying
-- the instruction sections relevant to that step.
--
-- Idempotency:
--   * The stage is matched by (template_id, name).
--   * Each step is matched by (template_id, step_number).
--   * Re-running refreshes the instruction content for the existing
--     rows (so we can iterate on copy without surgery).

-- Helper: idempotent upsert for the prep steps. Defined BEFORE the
-- seed DO block since plpgsql resolves PERFORM calls at execution
-- time. Re-declared with CREATE OR REPLACE so re-running the migration
-- is a no-op.

CREATE OR REPLACE FUNCTION seed_renewal_prep_step(
  p_template_id INTEGER,
  p_stage_id    INTEGER,
  p_step_number INTEGER,
  p_name        TEXT,
  p_description TEXT,
  p_task_type   TEXT
) RETURNS VOID AS $$
DECLARE
  v_existing_id INTEGER;
BEGIN
  SELECT id INTO v_existing_id
    FROM process_template_steps
   WHERE template_id = p_template_id AND step_number = p_step_number;
  IF v_existing_id IS NULL THEN
    INSERT INTO process_template_steps
      (template_id, step_number, name, description, stage_id, task_type)
    VALUES
      (p_template_id, p_step_number, p_name, p_description, p_stage_id, p_task_type);
  ELSE
    UPDATE process_template_steps
       SET name = p_name,
           description = p_description,
           stage_id = p_stage_id,
           task_type = p_task_type
     WHERE id = v_existing_id;
  END IF;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_template_id   INTEGER;
  v_stage_id      INTEGER;
  v_stage_order   INTEGER;
BEGIN
  SELECT id INTO v_template_id FROM process_templates WHERE name = 'Lease Renewal' LIMIT 1;
  IF v_template_id IS NULL THEN
    RAISE NOTICE 'Lease Renewal template not seeded — skipping Phase 7 seed.';
    RETURN;
  END IF;

  -- Insert or update the Prep stage. Place it before any existing
  -- stages by giving it stage_order = -1 if no existing stages, or
  -- (min stage_order - 1) otherwise. Idempotent via UNIQUE check.
  SELECT COALESCE(MIN(stage_order), 0) INTO v_stage_order
    FROM process_template_stages WHERE template_id = v_template_id;
  IF v_stage_order > 0 THEN v_stage_order := 0; ELSE v_stage_order := v_stage_order - 1; END IF;

  SELECT id INTO v_stage_id
    FROM process_template_stages
   WHERE template_id = v_template_id AND name = 'Lease Renewal Prep'
   LIMIT 1;
  IF v_stage_id IS NULL THEN
    INSERT INTO process_template_stages
      (template_id, name, stage_order, color, description)
    VALUES
      (v_template_id, 'Lease Renewal Prep', v_stage_order, '#B5D4F4',
       'Pre-outreach prep: confirm lease terms, run CMA, document recommendation.')
    RETURNING id INTO v_stage_id;
  END IF;

  -- Per-step UPSERT. step_number is the natural key within a template.
  PERFORM seed_renewal_prep_step(
    v_template_id, v_stage_id, 1,
    'Review current lease terms',
    'Pull the existing lease and note any unusual terms before contacting the tenant.',
    'todo'
  );
  UPDATE process_template_steps
     SET instruction_objective = 'Confirm what the current lease actually says before negotiating a renewal. Most disputes start because someone proposed terms that don''t match the existing lease.',
         instruction_steps = $j$
[
  {"id":"s1","text_html":"Locate the executed lease in AppFolio (Documents → Leases).","text_plain":"Locate the executed lease in AppFolio (Documents → Leases).","has_checkbox":true,"position":1},
  {"id":"s2","text_html":"Confirm: lease end date, current monthly rent, security deposit on file, any addenda (pets, parking, utilities).","text_plain":"Confirm: lease end date, current monthly rent, security deposit on file, any addenda.","has_checkbox":true,"position":2},
  {"id":"s3","text_html":"Note any concessions, abated months, or escalator clauses that affect the renewal math.","text_plain":"Note any concessions, abated months, or escalator clauses.","has_checkbox":true,"position":3},
  {"id":"s4","text_html":"Record the confirmed numbers on this process so later steps don''t need to re-pull.","text_plain":"Record the confirmed numbers on this process.","has_checkbox":true,"position":4}
]
$j$::jsonb,
         instruction_related_resources = $j$
{"resources":[
  {"id":"r1","label":"AppFolio: Documents library","url":"https://www.appfolio.com/","position":1}
]}
$j$::jsonb
   WHERE template_id = v_template_id AND step_number = 1;

  PERFORM seed_renewal_prep_step(
    v_template_id, v_stage_id, 2,
    'Check resident payment + violation history',
    'Pull payment ledger and any documented violations to inform the recommendation.',
    'todo'
  );
  UPDATE process_template_steps
     SET instruction_objective = 'Decide whether this tenant earns a clean renewal offer, a flat / discounted offer, or a non-renewal recommendation. Payment history and lease compliance carry the most weight.',
         instruction_steps = $j$
[
  {"id":"s1","text_html":"Pull the tenant ledger for the last 12 months. Count late payments, NSF returns, and any lease violations.","text_plain":"Pull the tenant ledger for the last 12 months.","has_checkbox":true,"position":1},
  {"id":"s2","text_html":"Check the property file for HOA violations, complaints from neighbors, or notices we sent (e.g., parking, noise, pets).","text_plain":"Check for HOA violations or notices sent.","has_checkbox":true,"position":2},
  {"id":"s3","text_html":"Cross-reference any prior renewal cycles — does this tenant repeatedly demand discounts?","text_plain":"Cross-reference prior renewal cycles.","has_checkbox":true,"position":3},
  {"id":"s4","text_html":"Summarise the resident profile in 2–3 sentences on this process for the owner conversation.","text_plain":"Summarise the resident profile in 2–3 sentences.","has_checkbox":true,"position":4}
]
$j$::jsonb
   WHERE template_id = v_template_id AND step_number = 2;

  PERFORM seed_renewal_prep_step(
    v_template_id, v_stage_id, 3,
    'Run CMA in HAR and BLANKET',
    'Comparative market analysis to anchor the renewal offer to current rents in the area.',
    'todo'
  );
  UPDATE process_template_steps
     SET instruction_objective = 'Anchor the renewal offer to current market rents. Owners and tenants both push back on numbers that don''t track to comparable properties; doing the CMA first short-circuits the negotiation.',
         instruction_steps = $j$
[
  {"id":"s1","text_html":"In HAR: filter by zip, bed/bath count, square footage ±10%, leased in the last 90 days. Pull 4–6 comparable units.","text_plain":"In HAR: filter by zip, bed/bath, sqft ±10%, leased in last 90 days. Pull 4–6 comps.","has_checkbox":true,"position":1},
  {"id":"s2","text_html":"In BLANKET: pull a market rent report for the property type. Note the median.","text_plain":"In BLANKET: pull market rent report. Note median.","has_checkbox":true,"position":2},
  {"id":"s3","text_html":"Reconcile the two sources. If they differ by more than 10%, prefer HAR.","text_plain":"Reconcile sources; prefer HAR if they differ by >10%.","has_checkbox":true,"position":3},
  {"id":"s4","text_html":"Calculate the renewal offer range: <strong>low</strong> = current rent, <strong>target</strong> = median of comps, <strong>high</strong> = top quartile of comps.","text_plain":"Calculate offer range: low/target/high.","has_checkbox":true,"position":4},
  {"id":"s5","text_html":"Attach the CMA artifact (PDF or screenshot) to this process for the owner record.","text_plain":"Attach CMA artifact to this process.","has_checkbox":true,"position":5}
]
$j$::jsonb,
         instruction_related_resources = $j$
{"resources":[
  {"id":"r1","label":"HAR (Houston Association of REALTORS) — leases search","url":"https://www.har.com/","position":1},
  {"id":"r2","label":"BLANKET — market rent report","url":"https://www.blanket.com/","position":2}
]}
$j$::jsonb
   WHERE template_id = v_template_id AND step_number = 3;

  PERFORM seed_renewal_prep_step(
    v_template_id, v_stage_id, 4,
    'Review tenant payment history + last inspection',
    'Final check on tenant behavior + property condition before locking in the offer terms.',
    'todo'
  );
  UPDATE process_template_steps
     SET instruction_objective = 'Combine the payment history (step 2) with the most recent property inspection. A tenant who pays on time but trashes the property is a different case from one who''s late but careful.',
         instruction_steps = $j$
[
  {"id":"s1","text_html":"Pull the most recent property inspection from AppFolio or the inspection log. Note any unresolved maintenance items the tenant caused.","text_plain":"Pull last property inspection; note tenant-caused issues.","has_checkbox":true,"position":1},
  {"id":"s2","text_html":"If unresolved damage is significant, factor it into the recommendation (offer with damage charges, or recommend non-renewal).","text_plain":"Factor unresolved damage into the recommendation.","has_checkbox":true,"position":2},
  {"id":"s3","text_html":"Flag anything that needs to be addressed BEFORE renewal terms are sent (e.g., open work orders the tenant is waiting on).","text_plain":"Flag anything needing resolution before terms go out.","has_checkbox":true,"position":3}
]
$j$::jsonb
   WHERE template_id = v_template_id AND step_number = 4;

  PERFORM seed_renewal_prep_step(
    v_template_id, v_stage_id, 5,
    'Document recommendation',
    'Write the owner-facing renewal recommendation and decide: Increase / Hold / Decrease / Non-Renew.',
    'todo'
  );
  UPDATE process_template_steps
     SET instruction_objective = 'Translate everything from steps 1–4 into a single owner-facing recommendation. The decision matrix below is the team standard — use it to keep recommendations consistent across owners.',
         instruction_steps = $j$
[
  {"id":"s1","text_html":"Pick a recommendation per the decision matrix below (Increase / Hold / Decrease / Non-Renew).","text_plain":"Pick a recommendation per the decision matrix.","has_checkbox":true,"position":1},
  {"id":"s2","text_html":"Write 2–3 sentences explaining the reasoning, citing the CMA and the resident profile.","text_plain":"Write 2–3 sentences of reasoning citing CMA + resident profile.","has_checkbox":true,"position":2},
  {"id":"s3","text_html":"Send the recommendation to the owner via email (template lives on the next stage''s step).","text_plain":"Send the recommendation to the owner via email.","has_checkbox":true,"position":3},
  {"id":"s4","text_html":"Set the process''s <strong>Recommendation</strong> custom field so downstream conditional routing can fork on it.","text_plain":"Set the process''s Recommendation custom field.","has_checkbox":true,"position":4}
]
$j$::jsonb,
         instruction_decision_matrix = $j$
{"rows":[
  {"id":"d1","condition":"On-time payments, clean inspection, market rent ≥ current + 3%","action":"Increase: offer at CMA median (typically +3% to +6%)","position":1},
  {"id":"d2","condition":"Mixed payment history OR minor maintenance issues OR market rent within ±2% of current","action":"Hold: offer at current rent for a 12-month renewal","position":2},
  {"id":"d3","condition":"Tenant has been an excellent resident (3+ years, zero late payments) and a small concession keeps them","action":"Decrease: offer a small reduction (1–2%) or extended-term incentive","position":3},
  {"id":"d4","condition":"Multiple late payments, lease violations, or unresolved damage","action":"Non-Renew: recommend the owner not renew; route to Step 05 (Handle non-renewal)","position":4}
]}
$j$::jsonb
   WHERE template_id = v_template_id AND step_number = 5;
END $$;

-- Drop the helper function — it's only used by this migration.
DROP FUNCTION IF EXISTS seed_renewal_prep_step(INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT);
