# Phase 7.1 — Template Editor — what shipped vs. deferred

Phase 7.1 delivers the **Stages & Workflows** builder plus the **Email
Templates** and **Text Templates** tabs from the Process Management
System design handoff, on top of the 7.0.1 visual pass.

## Shipped

**Schema (migration 036 — inline in `operationsSchema.js` +
`backend/migrations/036_pms_template_editor.sql`)**
- Workflow-step fields on `process_template_steps` AND `process_steps`:
  `kind` (todo/email/text/call/meet/stagechange/branch/exit),
  `actor` (auto/manual), `when_text`, `day_offset`, `branch_config`.
  `email_template_id` / `text_template_id` already existed — kept as
  soft references (no hard FK; see note below).
- Stage grouping reuses the **pre-existing**
  `process_template_stages.category` column (backlog / active /
  completed / cancelled). No new stage column was added.
- The email/text template tables were **not** created here — a
  complete system already exists (`process_email_templates` /
  `process_text_templates` + `routes/processSettings.js`). 7.1 reuses
  it unchanged.

**Backend**
- `mapTemplateStep` now returns `kind`, `actor`, `whenText`,
  `dayOffset`, `branchConfig`.
- `postTemplateStep` + `putTemplateStep` accept + validate the new
  fields (`normalizeWorkflowFields` helper; kind/actor allow-lists).
- `postProcess` copies the new step fields from the template onto the
  per-instance step at launch (alongside the Phase 7 instruction
  columns).
- No new routes — Email/Text tabs call the existing
  `/processes/templates/:id/(email|text)-templates` endpoints.

**Frontend**
- `StagesWorkflowsClient` — split view: left rail of stage groups
  (Backlog/Active/Completed/Canceled) with colored stage chips + step
  counts; right pane is the workflow timeline (when/day rail, kind
  chips, AUTO/MANUAL pills, template-linked indicator, "process enters
  stage" banner). Admins can add stages, add steps (7 kinds), and
  delete steps.
- `MessageTemplatesClient` (one component, `mode="email" | "text"`):
  Email = list + sticky preview pane with inline edit; Text = grid of
  SMS bubbles with inline edit. `{{variable}}` tokens are highlighted.
  Admin-gated create / edit / delete.
- `page.tsx` tab router now renders the real Stages / Email / Text
  tabs; only Autopilot / Custom Fields / Settings remain stubs.

## Deferred to 7.1.1 (editor depth)

The builder is **create / visualize / delete**, not yet full inline
editing. Specifically deferred:

- **Drag-to-reorder** stages and steps. A reorder API already exists
  (`/processes/templates/:id/steps/reorder`,
  `/processes/templates/:id/stages/reorder`) — the UI just doesn't
  wire DnD yet. Steps currently order by `step_number`.
- **Per-step inline editor** — changing a step's `kind`, `actor`,
  `whenText`, `dayOffset`, `assignedRole`, or linking an
  email/text template after creation. The PUT endpoint accepts all of
  these; only the create path sets them today (a sensible `actor`
  default is inferred from `kind`). Editing currently means
  delete + recreate.
- **Branch / stagechange targets** — `branch_config` is persisted and
  copied to instances but has no editor UI; branch/stagechange steps
  render as a labeled step without their target wiring.
- **Stage edit/delete from the rail** (rename, recolor, change
  category, delete). `putTemplateStage` / `deleteTemplateStage` exist;
  the rail only supports add + select today.
- **The "process enters stage" / exit-step affordances** are
  display-only (the design's exit-rule editor is 7.1.1).
- **Email preview fidelity** — the To/From/variable-resolved preview
  and "used by stage X" backref from the design are simplified to a
  subject + body + `{{var}}` highlight. Send-test / preview-as-
  recipient buttons are not built.
- Prompts use `window.prompt`/`confirm` for name capture to keep this
  PR focused; 7.1.1 replaces these with proper inline forms/modals.

## Deferred to later phases (unchanged from PHASE7_DEFERRED.md)

- **7.2** Process Instance redesign (stepper + current-stage card +
  right rail).
- **7.3** Custom Fields tab + schema.
- **7.4** Autopilot Rules tab + execution engine.
- **7.5** Activity Log + Files tabs.

## Notes / risk

- `email_template_id` / `text_template_id` are intentionally **not**
  hard FKs. Those columns predate this migration on some rows; a
  validated FK added at boot could crash startup. Integrity is
  enforced in the handlers (deleting a message template nulls the
  referencing steps).
- Migration 036 is purely additive (ADD COLUMN IF NOT EXISTS). No
  destructive operations, no backfill that can fail.
- The legacy pre-Phase-7 process list components
  (`ProcessesListClient`, `BoardView`, `TableView`, `TimelineView`,
  `CalendarView`, `BulkActionBar`, `PerformancePills`) are still on
  disk, now fully unreachable. Safe to delete in a follow-up cleanup.
