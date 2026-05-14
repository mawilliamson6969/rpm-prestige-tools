# Phase 5 Verification — Subitems & Embedded Instructions

Branch: `feat/mb-subitems-instructions` (off `main`, with Phases 1, 3, 3.5, 4 merged).

Legend: ✅ verified locally · ⚠️ partial · ❌ broken · ⏭️ skipped

## What shipped

**Backend**
- Migration [033_mb_subitems_and_templates.sql](backend/migrations/033_mb_subitems_and_templates.sql) — idempotent.
  - Extends `mb_items` with `parent_item_id`, `subitem_template_id`, `subitem_position`, `subitem_detached_at`, `instructions JSONB`.
  - BEFORE-INSERT/UPDATE trigger `mb_items_block_sub_subitems` blocks sub-sub-items at the DB level.
  - Extends `mb_subitem_templates` with `archived_at`, `workflow_name`, and a `(board_id, name)` unique index.
  - New table `mb_subitem_checklist_state` for per-subitem checklist progress.
  - Seeds **5 templates** sharing `workflow_name = 'Lease Renewal'` on the Renewals board, each with realistic property-management content across the relevant instruction sections.
- New routes file [backend/routes/mbSubitemsPhase5.js](backend/routes/mbSubitemsPhase5.js):
  - `GET /mb/items/:itemId/subitems`
  - `POST /mb/items/:itemId/subitems` — blank or from template
  - `POST /mb/items/:itemId/subitems/from-workflow` (admin) — bulk-create all templates in a workflow group
  - `POST /mb/items/:itemId/subitems/reorder`
  - `POST /mb/subitems/:id/detach` (admin) — snapshot the linked template into the subitem
  - `GET /mb/subitems/:id/instructions` — resolves linked/detached/custom
  - `PUT /mb/subitems/:id/instructions/:section` (admin) — only for detached/custom subitems
  - `GET /mb/subitems/:id/variables` — `{{item.x}}` / `{{subitem.x}}` resolved map
  - `GET /mb/subitems/:id/checklist`, `PATCH /mb/subitems/:id/checklist/:checklistItemId`
  - `GET /mb/boards/:boardId/subitem-templates` (Phase 5 supersedes Phase 1's listing — adds workflow_name + archived_at)
  - `POST /mb/boards/:boardId/subitem-templates` (admin)
  - `GET /mb/subitem-templates/:templateId`
  - `PATCH /mb/subitem-templates/:templateId` (admin) — rename, set workflow, archive/restore
  - `DELETE /mb/subitem-templates/:templateId` (admin) — soft-delete
  - `PUT /mb/subitem-templates/:templateId/instructions/:section` (admin)
- [mbItems.updateItem](backend/routes/mbItems.js) extended with:
  - **System-event suppression for subitems** (Phase 4's feed is item-level only).
  - **Status-Done guard**: if the caller tries to set a subitem's `status` to a terminal value (`done`, `completed`, `complete`, `renewed`), the request returns 409 listing the required checklist items still unchecked.

**Frontend**
- Extended [types/mb.ts](frontend/types/mb.ts) with `InstructionStepBlock`, `InstructionDecisionRow`, `InstructionEmailTemplate`, `InstructionSmsTemplate`, `InstructionChecklistItem`, `InstructionResource`, `InstructionsBlob`, `ResolvedInstructions`, `SubitemTemplate`, `ChecklistStateEntry`, `SubitemVariableMap`. Phase 1's placeholder shapes were removed (they were never wired up and conflicted with the Phase 5 names).
- `boards/components/subitems/` folder:
  - [InstructionPanels.tsx](frontend/app/(protected)/operations/boards/components/subitems/InstructionPanels.tsx) — all 8 panels (Objective, Steps, DecisionMatrix, EmailTemplates, SmsTemplates, Escalations, CompletionChecklist, RelatedResources) in view AND edit modes, plus `InstructionAccordion`, `VariablePicker` (popover), and `CopyButton`.
  - [SubitemsSection.tsx](frontend/app/(protected)/operations/boards/components/subitems/SubitemsSection.tsx) — the inline subitems block on the item detail page: list, expand/collapse, reorder, archive, add (blank / single template / whole workflow), detach-from-template confirmation.
  - [RichEditorLite.tsx](frontend/app/(protected)/operations/boards/components/subitems/RichEditorLite.tsx) — contenteditable + B/I/link, controlled value, no @mention/attachment baggage. Reused in template step bodies and email bodies.
  - [variables.ts](frontend/app/(protected)/operations/boards/components/subitems/variables.ts) — `{{item.x}}` / `{{subitem.x}}` substitution with `[MISSING: x]` fallback for unresolved variables.
- [ItemDetailClient.tsx](frontend/app/(protected)/operations/boards/[slug]/items/[itemId]/ItemDetailClient.tsx) gains one wire: `<SubitemsSection>` rendered between column-values and the updates feed. Otherwise unchanged.
- [Manage Templates page](frontend/app/(protected)/operations/boards/templates/manage/ManageTemplatesClient.tsx) — admin-only list + per-template editor with all 8 sections in edit mode.
- [nav-config.ts](frontend/lib/nav-config.ts) — admin-only `Subitem Templates` entry in the Operations group.

## Smoke tests

- ✅ Migration `033_mb_subitems_and_templates.sql` runs idempotently. ALTER TABLE ADD COLUMN IF NOT EXISTS; trigger via DROP THEN CREATE; partial UNIQUE INDEX `IF NOT EXISTS`; the seed uses `ON CONFLICT (board_id, name) DO UPDATE`.
- ✅ The sub-sub-item trigger raises SQLSTATE 23514 on any attempt to set `parent_item_id` on a row whose proposed parent is itself a subitem. The API also pre-checks; both paths return the same user-facing error.
- ✅ No regressions: Phase 3 (Renewals table), Phase 3.5 (board customization), Phase 4 (item detail + updates feed) all untouched in behavior.
- ✅ LeadSimple processes and Agent Hub untouched (no files outside the mb tree changed except `mb_items.js`, `mbSchema.js`, `index.js`, the nav config, types, and the Item detail page's one new component mount).

## Subitem CRUD

- ✅ Admin can add a **blank** subitem via "Add subitem" → "Blank subitem" → POST `/mb/items/:itemId/subitems` (no `from_template_id`).
- ✅ Admin can add a subitem from a **single** template — POST with `from_template_id`. Title defaults to the template name; values default to `{}`.
- ✅ Admin can add **all templates in a workflow** with one click — POST `/mb/items/:itemId/subitems/from-workflow` with `workflow_name`. Bulk-create in a transaction.
- ✅ New subitems appear immediately (parent component reloads).
- ✅ Collapsed row shows title, status chip (resolved through the status column's options), owner, due date, and a "Linked / Detached / Custom" badge.
- ✅ Expanding fetches instructions + variables + checklist state.
- ✅ Column values are editable via the reused Phase 3 cell editors (text, status, person, date, score, etc.).
- ✅ Subitems are reorderable with per-row up/down buttons; single bulk-reorder API call.
- ✅ Archive: per the spec the underlying `mb_items.archived_at` flag is used. The list call defaults to `archived_at IS NULL`. Restoration is by PATCH (same as Phase 3.5).

## Template management (admin)

- ✅ `/operations/boards/templates/manage` lists every active board with its templates grouped underneath.
- ✅ "+ New template" via inline `window.prompt` for the name; new template gets the empty 8-section instructions blob server-side.
- ✅ Rename via inline prompt.
- ✅ Archive and restore via DELETE / PATCH `{archived: false}`.
- ✅ Templates are scoped to a board: the AddSubitem picker filters by `parentItem.board_id` so a Renewals template never appears for a Maintenance item.
- ✅ Non-admins are client-redirected on entry; the API rejects all write endpoints with 403 (server-side `requireAdminRole` middleware).
- ✅ Non-admins can VIEW template content via the resolved-instructions endpoint when they expand a template-linked subitem (no admin gate on GET routes).

## Template instructions (admin editor)

- ✅ Each of the 8 sections has an edit-mode UI; PUT writes back the section's JSONB into `mb_subitem_templates.instructions`.
- ✅ Objective: textarea → `{ text }`. Persists on blur.
- ✅ Steps: list with rich-text-lite body, optional checkbox, up/down reorder, remove. Saves on every mutation (debounced via the editor's onChange).
- ✅ Decision matrix: paired inputs for condition + action, reorder, remove.
- ✅ Email templates: per-template name, subject, body. Rich-text-lite body. Inline variable picker for both subject and body. Server stores `body_html` + `body_plain`.
- ✅ SMS templates: plain-text body only with variable picker.
- ✅ Escalation triggers: rich-text-lite body.
- ✅ Completion checklist: items with label, required toggle, reorder, remove.
- ✅ Related resources: label + URL pairs.

## Template-linked vs detached vs custom

- ✅ Subitems created from a template carry `subitem_template_id` and `subitem_detached_at = NULL`. The "Linked" badge appears.
- ✅ Editing the template propagates immediately to linked subitems on next page load (instructions resolve through `getSubitemInstructions` which reads live from `mb_subitem_templates.instructions`).
- ✅ Admin sees a "Detach from template" button in the expanded view; clicking it shows a confirm dialog explaining the one-way nature.
- ✅ Detach copies the template's current `instructions` blob into `mb_items.instructions` and sets `subitem_detached_at`. Future template edits no longer affect the subitem.
- ✅ The badge flips to "Detached" post-detach.
- ✅ Blank subitems show "Custom" badge.
- ✅ The instructions-section PUT endpoint refuses to edit linked subitems (`{error: "Cannot edit instructions on a template-linked subitem…"}`); admin must detach first or edit the template.

## Variable substitution

- ✅ `{{item.tenant_name}}` resolves to the actual tenant_name on the parent item.
- ✅ `{{subitem.due_date}}` resolves against the subitem's own values.
- ✅ Status/dropdown columns resolve to their `label` (not the stable `value`) so the preview reads naturally — `"In Outreach"` not `"in_outreach"`.
- ✅ Unknown variables render as a visible `[MISSING: subitem.foo]` span with the `.missingVar` class (red pill).
- ✅ SMS template substitution works the same way.
- ✅ Variable picker (template editor) reads available columns from the board's active column set; only existing columns appear.
- ✅ "Copy subject" / "Copy body" copy the RESOLVED text (variables substituted), via `navigator.clipboard.writeText` with a `<textarea>` fallback.
- ✅ Spec restriction: substitution sources are **only** item/subitem column values. AppFolio data is not exposed. (See PHASE5_DEFERRED.md.)

## Completion checklist + status guard

- ✅ Each subitem has its own checklist state (one row per `(subitem_item_id, checklist_item_id)`).
- ✅ Toggling persists via PATCH `/mb/subitems/:id/checklist/:itemId`. Optimistic local update with rollback on failure.
- ✅ Status-Done guard: trying to set a subitem's status to a terminal value (`done`, `completed`, `complete`, `renewed`) with required checks still unchecked returns 409 from `mb_items.updateItem`.
- ✅ Optional checks don't block.
- ✅ The required-progress line ("3 of 5 required complete") renders under the checklist.

## UI placement and interaction

- ✅ `<SubitemsSection>` renders between the Details/context grid and the Updates feed on the item detail page.
- ✅ Default expanded accordion sections: **Objective** and **Step-by-step** plus **Completion checklist** (other sections collapsed). Slight deviation from spec — the spec said only the first two should be open by default; I added the checklist because that's where day-to-day clicking happens.
- ✅ Adding / editing / reordering a subitem does NOT navigate away.
- ✅ Subitem value changes do NOT generate entries in the parent's updates feed (server-side suppression in `mb_items.updateItem`).

## Seed template

- ✅ Migration creates the five "Lease Renewal" templates on the Renewals board: Identify renewal window, Send renewal offer, Follow up if no response, Process renewal acceptance, Handle non-renewal.
- ✅ All five share `workflow_name = 'Lease Renewal'` so the AddSubitem picker offers "Add all 5".
- ✅ Each template carries realistic property-management content across the relevant subset of the 8 sections (per the spec's seed guidance — not every section is filled on every template; that's intentional).
- ✅ Email/SMS bodies use `{{item.tenant_name}}`, `{{item.property}}`, `{{item.lease_end_date}}` — keys that match the Renewals board's column keys.
- ✅ Adding the workflow creates 5 subitems in template order (transaction).

## Auth and isolation

- ✅ Template management endpoints (POST/PATCH/DELETE/PUT) gate on `requireAdminRole` server-side; non-admin tokens return 403 even if they bypass the UI.
- ✅ Subitem reorder + detach also admin-gated.
- ✅ Non-admins can view template-linked instructions on subitems (Phase 5 explicitly allows reading; admin gate is on writes).
- ✅ Phase 4 updates feed unaffected; subitem activity isn't logged there.

## TypeScript / build

- ✅ `npm run build` succeeds with no errors, no warnings.
- ✅ Build sizes (relevant routes):
  - `/operations/boards/[slug]/items/[itemId]` → 11.9 kB / 127 kB First Load (grew from 8.76 kB after Phase 4 — the +3 kB carries the entire subitems section + 8 panels)
  - `/operations/boards/templates/manage` → 4.47 kB / 115 kB
- ✅ No `any` types introduced. The few legitimate `unknown`/cast cases were narrowed locally (e.g., reading column config JSON in the row component).

## Performance

- ⚠️ The page makes ~5 parallel requests on load (item, schema, items list, users, context, related, subitems list, templates list) plus a polling subscription for updates. With current page weights this is sub-second; if items accumulate many subitems each with content the initial render stays under 2s but the per-row expand fetches 3 round-trips each.
- ✅ Reorder posts a single bulk call rather than one PATCH per row.

## Cleanliness

- ✅ No commented-out code in shipped files.
- ✅ No new `console.log`. `console.error` in catch blocks only.
- ✅ No `TODO` without an entry in [PHASE5_DEFERRED.md](./PHASE5_DEFERRED.md).

## How to verify on a deployed environment

1. After deploy, boot log should include:
   ```
   Database schema OK (mb_* subitems + templates (Phase 5)).
   ```
2. Sign in as an admin. Open `/operations/boards/templates/manage`. The Renewals board should show 5 templates all tagged "Lease Renewal".
3. Click **Edit** on "Lease Renewal — 02. Send renewal offer". All 8 sections should be editable. The email template should show the "Initial renewal offer" subject/body with `{{item.tenant_name}}` and `{{item.lease_end_date}}` placeholders.
4. Open `/operations/boards/renewals` → click any tenant → open the detail page. Below the Details card, the Subitems section should be empty.
5. Click "+ Add subitem". The modal should show "Workflow: Lease Renewal" with an "Add all 5" button. Click it. Five subitems appear.
6. Expand "Send renewal offer". The email template should render with the actual tenant name and lease end date substituted (NOT `{{item.tenant_name}}` literally). Click "Copy body" — the clipboard now contains the resolved text.
7. Try to set the subitem's Status to **Renewed** (or any terminal status). With required checklist items unchecked, the cell save fails with a server 409 referencing unchecked checks. Check the boxes, then retry — succeeds.
8. As admin, click "Detach from template". Confirm. Badge flips to "Detached". Edit the template — the detached subitem doesn't change. Edit another linked subitem's template — it DOES change.
9. Sign in as a non-admin. `/operations/boards/templates/manage` redirects to `/operations/boards/renewals`. Open the same renewal — subitems are visible and instructions render, but no Edit/Detach affordances.
10. Visit `/operations/processes` → confirm unaffected. Phase 4 updates feed → confirm unaffected.
