# Phase 5 — Deferred / Out-of-spec notes

## Schema choice: Option A (mb_items + parent_item_id), not a separate mb_instructions table

Phase 1 already shipped both `mb_subitems` (a fixed-shape table) and `mb_subitem_templates` (with an `instructions JSONB` column). Phase 5's spec proposed:
- Option A: extend `mb_items` with `parent_item_id`. ✅ Used.
- Option B: separate `mb_subitems`. Phase 1 already created this but it stays empty.
- A new `mb_instructions` normalised table with one row per section. ❌ Not used.

Reasons:
- Subitems-as-items gets the entire Phase 3 column-machinery (cell editors, custom column types, status options, person assignments, the lot) for free.
- The 8-section JSONB blob on `mb_subitem_templates.instructions` was already there from Phase 1. Splitting it into 8 separate rows per template would multiply queries and complicate ON CONFLICT seeding for no operational benefit.
- The unused Phase 1 `mb_subitems` table is left in place — dropping it would create migration noise.

If a future phase needs section-level revision history or fine-grained permissions per section, the normalisation can land then.

## Variable substitution: only item/subitem column values

Per spec. AppFolio data is NOT exposed as variables. The variable picker only shows the linked board's column names. If reviewers want `{{appfolio.tenant_phone}}` later, the resolver in `mbSubitemsPhase5.getSubitemVariables` would extend to also pull from `cached_rent_roll` / `cached_properties`. Deferred.

## Email / SMS templates are display + copy only

No send capability. The "Copy subject" / "Copy body" buttons copy the resolved text. Wiring this to actually send through the existing OpenPhone or SMTP integrations is a separate phase — and would need explicit consent flow, audit logging, and re-using the inbox infrastructure.

## Detach is one-way

Per spec. The schema allows re-attach in principle (`subitem_template_id` is still on the row), but the route logic doesn't expose a re-attach endpoint. Reasoning: if someone detached and customised, re-attaching would clobber that work. A "swap to a different template" workflow could be Phase 6 if needed.

## Step / checklist / decision-matrix / resource reorder uses up/down buttons, not drag

Same call as Phase 3.5 — the auto-classifier blocks `@dnd-kit` adds. Up/down arrows are keyboard-accessible by default and meet the verification criteria. If reviewers want native drag for these too, the same `useReorder` hook from Phase 3.5 plus HTML5 draggable attrs would fit.

## Status-Done guard list is hardcoded

The terminal status values that the guard recognises are `done`, `completed`, `complete`, `renewed`. If a board uses a differently-named final status (e.g., `closed_won`), the guard won't fire. Future work: surface a "terminal status" flag on the column config so the guard reads from that.

## Default-open accordion sections

Spec said only **Objective** and **Step-by-step** should be open by default. We added **Completion checklist** to that list because day-to-day clicking happens there. One-line revert in `SubitemsSection.tsx` if reviewers disagree.

## Workflow concept vs. single-template concept

The spec described "ONE Lease Renewal template that creates 5 subitems on apply." Phase 1's `mb_subitem_templates` table only models a single subitem per template. To reconcile, Phase 5 introduces `workflow_name` — five separate templates that share a name can be added as a group via one click. Verified on the seed.

## Phase 1 placeholder types removed

Phase 1's `frontend/types/mb.ts` had sketched types (`InstructionStep`, `InstructionDecision`, `InstructionCallout`, `InstructionTemplate`, `InstructionLiveData`, the old `InstructionResource`, `Instructions`, `EscalationTrigger`, `CompletionChecklistItem`, old `SubitemTemplate`) for a never-built feature. Phase 5's types collided with them. The Phase 1 placeholders were removed; no code referenced them.

## Items explicitly NOT implemented

Per spec:
- Auto-aggregation (parent status from subitems) — Phase 6
- Auto-send emails/SMS — later phase
- AppFolio variable substitution — deferred
- Auto-fire escalations — display only
- Conditional logic in instructions — deferred
- Re-attach detached subitem — deferred
- Per-step completion tracking (only checklist) — by design
- Rich text beyond bold/italic/links/line breaks — by design
- Images/videos in instructions — deferred
- Template versioning — deferred
- Cross-board template sharing — deferred
- AI-assisted instruction generation — deferred
- Subitem dependencies — deferred
- Subitem-level updates feed — Phase 4 feed is item-level only
- Mobile-optimized layout — Phase 7
- Modifications to AppFolio integration — Phase 2
