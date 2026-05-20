-- Prestige Connect Phase 2 §3: branching steps.
--
-- A `branch` step has a condition (same field/operator/value shape as
-- `filter`) and two child step lists: true_steps and false_steps. We
-- model the children as ordinary automation_steps rows that point at
-- their parent branch via parent_step_id, tagged with branch_path =
-- 'true' or 'false'. Top-level steps keep parent_step_id NULL and
-- branch_path NULL.
--
-- step_order is no longer unique within just (automation_id) — it is
-- unique within (automation_id, parent_step_id, branch_path). The old
-- unique constraint is dropped here so existing flat automations keep
-- working unchanged (they all have parent_step_id IS NULL).

ALTER TABLE automation_steps
  ADD COLUMN IF NOT EXISTS parent_step_id INTEGER REFERENCES automation_steps(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS branch_path VARCHAR(10);

-- Drop the legacy unique key, replace with the path-scoped one. The
-- COALESCE bridges NULL parent / NULL branch_path so the unique index
-- still applies to the top-level (main) path.
ALTER TABLE automation_steps
  DROP CONSTRAINT IF EXISTS automation_steps_automation_id_step_order_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_steps_path_order
  ON automation_steps
     (automation_id, COALESCE(parent_step_id, 0), COALESCE(branch_path, 'main'), step_order);
