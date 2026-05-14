# Phase 7 — Deferred Work

Phase 7 is the structural foundation. Several Phase 1–6 capabilities were not
ported over in this PR. They are queued behind explicit follow-ups so the
unification can land first and the regressions surface immediately rather than
hide behind half-finished features.

## Deferred to Phase 7.1 — Template Editor (over System A)

The Phase 3.5 board-customization screen (`/operations/boards/manage`) and the
Phase 5 subitem templates screen (`/operations/boards/templates/manage`) were
deleted in this PR. A single unified Template Editor will replace them,
working directly on `process_templates` / `process_template_stages` /
`process_template_steps` + the 8 new instruction columns.

Concretely, 7.1 owes:

- Group-by selector, column visibility, and color palette (Phase 3.5 features
  formerly on `EditBoardDrawer`).
- Drag-to-reorder for template stages and template steps.
- An editor for the 8 instruction sections on a template step:
  objective (text) / steps (rich list, optional checkboxes) / decision matrix
  (condition→action grid) / email templates / SMS templates / escalation
  triggers / completion checklist / related resources.
- The legacy `/operations/templates` route (admin-only, kept in nav as
  "Templates (legacy)") stays until 7.1 ships; once the new editor is live it
  should be removed from `nav-config.ts`.

## Deferred to Phase 7.2 — Dashboards (Triage + Calendar) over Processes

The Phase 6 Triage and Calendar dashboards (`/operations/boards/[slug]/triage`,
`/operations/boards/[slug]/calendar`, plus the top-level `/dashboards/triage`
and `/dashboards/calendar`) were deleted in this PR. They will be rebuilt as
read-only views over System A:

- Triage: shows steps assigned-to-me / blocked / overdue across all active
  processes, regardless of board slug.
- Calendar: shows step due dates + process targetCompletion dates, grouped by
  template / property / assignee.

These need to wait for 7.1's template editor (so the column-visibility prefs
are consistent) and for the step-assignment flow to be polished.

## Deferred to Phase 7.3 — AI Suggestions / AppFolio cross-post

- `frontend/app/(protected)/operations/processes/[id]/AiSuggestionsPanel.tsx`
  was deleted. The "summarize next steps" AI prompt panel will return as a
  side panel on `ProcessDetailClient`, but it needs a new server route that
  reads the process + stages + steps rather than the legacy
  `/processes/[id]/ai-suggest` endpoint.
- `mb_item_updates.posted_to_appfolio` / `appfolio_note_id` columns survive
  on the table but are unused by the rekeyed handlers; the cross-post
  feature (Phase 4) is paused while we audit whether updates on a process
  should sync to AppFolio at all (was item-scoped before).

## Deferred to Phase 7.4 — Activity history / system events

`recordValueChangeSystemEvents` (formerly in `mbItemDetail.js`) is left as
dead code in the rekeyed file but is no longer wired up. The status-change /
column-edit "system" updates that Phase 4 emitted on every column change are
not currently emitted by System A's process / stage / step mutations. 7.4
should walk the System A mutation paths and emit equivalent system updates so
the activity feed picks up status changes the way it used to.

## Deferred to Phase 7.5 — Properties / Contacts integration polish

The Launch Process modal accepts free-text property name and free-text
contact (name / email / phone). It should be wired to the existing
property & contact pickers (used in the legacy process create flow) for
referential integrity. Today it's effectively a v0 form so the unification
can ship.

## Decisions that diverged from the prompt

The prompt asked for two specific schema choices that the unification plan
overrode. Recording them here so future-me doesn't get confused:

1. **Slug column name.** The prompt suggested a UUID slug on
   `process_templates`. The plan kept slugs human-readable (`renewals`,
   `move-out-walkthrough`) so URLs stay shareable. Migration 035 adds
   `slug TEXT UNIQUE`, backfilled from the template name.
2. **Instruction storage.** The prompt floated a separate `mb_instructions`
   table keyed by step. The plan stores all 8 instruction sections as columns
   on `process_template_steps` + `process_steps`. Rationale: instructions are
   1:1 with steps, copied at process launch, and almost always read in the
   same query as the step row. A side table would have meant a join on every
   detail page render with no real benefit.

## Items intentionally not rebuilt

- **Renewals static folder** (`frontend/app/(protected)/operations/boards/renewals/`):
  deleted. The dynamic `[slug]` board renders the same view when slug=renewals.
- **`GenericBoardClient` + `ItemDetailClient`**: replaced by `BoardClient` +
  `ProcessDetailClient`. Same purpose, different shape; not reverting.
- **Subitems** (`mb_subitems`, `mb_subitem_*`): subsumed by stages → steps.
  Phase 5's embedded subitem instructions map directly onto step instructions,
  so no separate concept remains.
