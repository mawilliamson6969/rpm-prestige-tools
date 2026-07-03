-- 050_maintenance_phase4.sql
-- Maintenance Management System — Phase 4 (Quotes + PrestigeSign).
--
-- maint_quotes and maint_quote_lines shipped in 047 (header with status,
-- owner_approval_state, markup_pct, esign_request_id; lines with kind/qty/
-- unit_cost). Phase 4 adds a quote title and lifecycle timestamps so the
-- approval flow can record when a quote was sent for signature and decided.
--
-- Totals (subtotal, markup, total) are computed on read from the line items,
-- not stored. The AppFolio bill draft on approval is a preview only — nothing
-- is posted (depends on the AppFolio write-back initiative).
--
-- Idempotent — safe to re-run on every boot via ensureMaintSchema().

ALTER TABLE maint_quotes ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE maint_quotes ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE maint_quotes ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
