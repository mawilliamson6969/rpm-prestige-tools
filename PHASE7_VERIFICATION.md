# Phase 7 — Unification Foundation — Verification

This branch (`feat/mb-unification-foundation`) collapses Monday Boards (System B,
Phases 1–6) onto the Operations Hub process engine (System A). Boards are now a
view layer on top of `processes` / `process_stages` / `process_steps` /
`process_templates`. The Phase 4 updates feed (comments, replies, mentions,
reactions, attachments) is preserved verbatim; its handlers were rekeyed from
`item_id` to `process_id`.

The plan of record is `unification-plan.md` at the repo root. When the prompt
and the plan disagreed, the plan won.

## What survives from System B

- `mb_item_updates` (renamed-in-place by rekey: `item_id` → `process_id`,
  FK now points at `processes(id)`)
- `mb_update_mentions`, `mb_update_reactions`, `mb_update_attachments`
- The Phase 4 nested-reply trigger (replies cannot themselves have replies)
- `mb_api_log`, `mb_webhook_events` (AppFolio integration logs — referenced by
  the webhook receiver, unaffected by the rekey)
- `mb_settings` is intentionally untouched (org-wide settings KV)

## What was dropped (CASCADE)

`mb_boards`, `mb_board_columns`, `mb_groups`, `mb_items`, `mb_board_settings`,
`mb_subitems`, `mb_subitem_updates`, `mb_subitem_templates`,
`mb_subitem_checklist_state`. Migration 035 drops these explicitly. The
schema applier (`backend/lib/mbSchema.js`) was rewritten to a single
`ensureMbUnifiedSchema` that:

1. Inlines a "survivors only" SQL block that creates the 6 surviving tables
   standalone (no FK into `mb_items` anymore).
2. Applies `backend/migrations/035_unification.sql` for the slug + 8
   instruction columns + rekey + drops + seed.

The old `ensureMb*` functions (Boards / Items / Subitems / Updates /
Customization / Dashboards) are gone, and the System B route mounts in
`backend/index.js` were removed.

## System A schema extensions (migration 035)

- `process_templates.slug TEXT UNIQUE` — backfilled from name (lower, trim,
  spaces → dashes, fall back to `template-<id>`).
- `process_template_steps` + `process_steps` each got 8 instruction columns:
  - `instruction_objective` TEXT
  - `instruction_steps` JSONB
  - `instruction_decision_matrix` JSONB
  - `instruction_email_templates` JSONB
  - `instruction_sms_templates` JSONB
  - `instruction_escalations` TEXT
  - `instruction_completion_checklist` JSONB
  - `instruction_related_resources` JSONB
- `mb_item_updates.process_id` added, indexed; legacy `item_id` FK dropped.
- `mb_api_log` / `mb_webhook_events` FKs into `mb_items` / `mb_subitems`
  dropped — these tables keep their (now string-only) item references for log
  archeology.
- Seed: idempotent insert of a "Lease Renewal Prep" stage + 5 instructed
  steps on the Renewals template, only if absent.

## Backend changes

| File | Change |
|---|---|
| `backend/migrations/035_unification.sql` | New — 6-section unification migration. |
| `backend/lib/mbSchema.js` | Rewritten to a single `ensureMbUnifiedSchema`. |
| `backend/index.js` | Replaced 6 schema-ensure calls with 1; removed System B route mounts (boards / items / subitems / updates / dashboards / customization); kept `mbItemDetail` (rekeyed) + `mbWebhooks`. |
| `backend/routes/mbItemDetail.js` | All handlers (`listItemUpdates`, `createItemUpdate`, `createReply`, `markMentionsSeen`, `listUnseenMentions`) rekeyed to `process_id`; `listUnseenMentions` returns both `by_process` and a `by_item` alias for any consumer still using the old key. |
| `backend/routes/processes.js` | `mapStep` returns the 8 instruction fields; `POST /processes` copies them from template steps at launch. |
| `backend/routes/processTemplates.js` | `mapTemplate` returns `slug`; `mapTemplateStep` returns the 8 instruction fields. |

## Frontend changes

| File | Change |
|---|---|
| `frontend/app/(protected)/operations/boards/[slug]/BoardClient.tsx` | New — slug → template → `/processes?template={id}` table view + Launch Process modal that POSTs to `/processes` and routes to `/operations/boards/{slug}/items/{newId}`. |
| `frontend/app/(protected)/operations/boards/[slug]/board.module.css` | New. |
| `frontend/app/(protected)/operations/boards/[slug]/items/[itemId]/ProcessDetailClient.tsx` | New — the canonical detail page. Renders stages + steps with embedded 8-section instructions, plus the Phase 4 updates feed (process-keyed). |
| `frontend/app/(protected)/operations/boards/[slug]/items/[itemId]/page.tsx` | Thin server shell — params.itemId → process id → `<ProcessDetailClient />`. |
| `frontend/app/(protected)/operations/processes/[id]/page.tsx` + `ProcessRedirectClient.tsx` | Legacy URL → unified URL. Fetches the process's template, reads the slug, and `router.replace`s to `/operations/boards/{slug}/items/{id}`. |
| `frontend/components/Sidebar.tsx` | The dynamic Boards list now sources from `/processes/templates` (filtered to active + slug-present). |
| `frontend/lib/nav-config.ts` | Removed the `dashboards` group, `ops-renewals`, `ops-boards`, `ops-sub-templates`. Repointed `ops-processes` at `/operations/boards/renewals`. |
| `frontend/types/mb.ts` | `ItemUpdate.item_id` / `posted_to_appfolio` / `appfolio_note_id` are now optional; `process_id` was added. |

Deleted (consolidation):

- `frontend/app/(protected)/dashboards/` (entire folder — deferred to 7.2)
- `frontend/app/(protected)/operations/boards/renewals/` (replaced by `[slug]`)
- `frontend/app/(protected)/operations/boards/components/subitems/` (subitems
  collapsed into process steps)
- `frontend/app/(protected)/operations/boards/manage/`, `templates/manage/`,
  `[slug]/triage/`, `[slug]/calendar/` (deferred to 7.1 / 7.2)
- The Phase 3.5 customization components (EditBoardDrawer / Aggregation /
  ColorPalette / ColumnTypePicker / ConfirmDialog / ProgressBar /
  StatusOptionsEditor / useReorder / BoardTabs)
- `frontend/app/(protected)/operations/boards/[slug]/GenericBoardClient.tsx`,
  `ItemDetailClient.tsx`, `RelatedItemsPanel.tsx`, `ContextPanels.tsx`
- The legacy `/operations/processes/[id]/` component files (replaced by
  the redirect)

## Smoke checks

- [x] `npm run build` in `frontend/` passes (Next.js 14.2.35 — strict TS).
- [x] `node --check` on the modified backend files passes.
- [ ] `node backend/index.js` runtime check requires `node-cron` and a Postgres
      connection — verified in Docker on deploy, not locally.

## Manual QA after merge (suggested)

1. Visit `/operations/boards/renewals` — should list active renewal processes
   with a Launch Process button. The Sidebar's "Boards" group should list
   every active template (slug + name).
2. Launch a process via the modal. Verify the redirect lands you at
   `/operations/boards/renewals/items/<id>` and the page renders stages,
   steps, and an empty updates composer.
3. Open the seeded "Lease Renewal Prep" stage's step 5 ("Recommend
   renewal terms"). The decision matrix should render as a grid with
   Increase / Hold / Decrease / Non-Renew rows.
4. Post a comment with an @mention. Reload — the comment and mention should
   persist, and the recipient should see an unseen-mention badge resolved
   by `/mb/items/<processId>/mark-mentions-seen`.
5. Hit a stale URL — `/operations/processes/123` — and confirm it redirects
   to the unified URL (or to `/operations/boards/renewals` if the id is
   bogus).

## Risk notes

- The migration is *destructive* on System B tables. There is no rollback;
  re-creating the dropped tables would require running the old `ensureMb*`
  functions, which are gone from the repo. If you need them back, restore
  from prior to commit 7XXXXXX (the merge of this branch).
- `mb_api_log` and `mb_webhook_events` still reference `mb_items` /
  `mb_subitems` IDs in text form. They are not joined to the dropped tables
  by FK anymore, but the data they carry is now orphaned.
- The board view currently does NOT show step counts / progress beyond a
  simple `completed/total` ratio. Customization (Phase 3.5 features:
  group-by, column visibility, color palette) is deferred to 7.1.
