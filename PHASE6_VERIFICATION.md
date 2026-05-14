# Phase 6 Verification — Triage + Calendar Dashboards + Auto-Aggregation

Branch: `feat/mb-dashboards-aggregation` (off `main`, with Phases 1, 3, 3.5, 4, 5 merged).

Legend: ✅ verified locally · ⚠️ partial · ❌ broken · ⏭️ skipped

## What shipped

**Backend**
- Migration [034_mb_dashboards_aggregation.sql](backend/migrations/034_mb_dashboards_aggregation.sql) — idempotent:
  - New `mb_board_settings` table with `auto_aggregate_status`, `auto_aggregate_progress`, `primary_date_column_id`.
  - `mb_items.aggregated_status` + `aggregated_status_at` cache columns.
  - Triage/calendar indexes (`idx_mb_items_triage`, `idx_mb_items_values_gin`).
  - Seeds a default settings row for every existing board (auto-picks the first date column) and explicitly pins Renewals' primary date column to Lease End Date.
- [mbDashboards.js](backend/routes/mbDashboards.js) — single routes file owning:
  - `GET/PATCH /mb/boards/:boardId/settings`
  - `POST /mb/boards/:boardId/aggregation/recompute` (admin)
  - `GET  /mb/boards/:boardId/progress`
  - `GET  /mb/dashboards/triage?scope=…&limit=…`
  - `GET  /mb/dashboards/calendar?scope=…&from=…&to=…`
  - The exported `recomputeParentAggregation(itemId, pool)` helper used by `mbItems.updateItem` (subitem status change), `mbSubitemsPhase5.createSubitem` / `createWorkflowSubitems` (subitem count change), and `mbItems.deleteItem` (subitem archive).
- The aggregation ladder is implemented as a fixed `CATEGORY_BY_VALUE` dictionary mapping board option values into canonical categories (`blocked`, `overdue`, `stalled`, `in_progress`, `terminal`, `new`). Documented in code; verification mappings called out in [PHASE6_DEFERRED.md](./PHASE6_DEFERRED.md).
- The triage scorer runs in app code over a single batched fetch (joins items + boards + settings + status column config in one query, plus a separate mention-count query for the current user).

**Frontend**
- [TriageDashboardClient.tsx](frontend/app/(protected)/dashboards/components/TriageDashboardClient.tsx) — single component used for both cross-board (`/dashboards/triage`) and per-board (`/operations/boards/[slug]/triage`) routes via a `scope` prop. Polls every 60s, refreshes on window focus.
- [CalendarDashboardClient.tsx](frontend/app/(protected)/dashboards/components/CalendarDashboardClient.tsx) — vanilla-JS monthly/weekly grid (no date library). Filters by board/owner/status. Day-click shows a popup with all items on that date.
- [AggregationTab.tsx](frontend/app/(protected)/operations/boards/components/AggregationTab.tsx) — new tab inside the Phase 3.5 `EditBoardDrawer`. Toggles, primary-date-column dropdown, "Recompute now" button (admin only). Flipping the status aggregation toggle ON automatically triggers a recompute.
- [AggregatedStatusBadge.tsx](frontend/app/(protected)/operations/boards/components/AggregatedStatusBadge.tsx) + [ProgressBar.tsx](frontend/app/(protected)/operations/boards/components/ProgressBar.tsx) — wired into Phase 3 `BoardTable`. The dispatcher checks `item.aggregated_status` for the status column; the table adds an extra "Progress" column at the end when `showProgressColumn` is on.
- [BoardTabs.tsx](frontend/app/(protected)/operations/boards/components/BoardTabs.tsx) — Table / Triage / Calendar tab nav rendered on every board page header.
- [nav-config.ts](frontend/lib/nav-config.ts) — new "Dashboards" sidebar group with Triage and Calendar entries (visible to all authenticated users).

## Smoke tests

- ✅ Migration `034_mb_dashboards_aggregation.sql` runs on a database with Phases 1, 3, 3.5, 4, 5 applied. ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / INSERT … WHERE NOT EXISTS for the defaults row.
- ✅ Re-running the migration is a no-op (`INSERT … WHERE NOT EXISTS`; the Renewals UPDATE checks the current value and skips if already correct).
- ✅ Default settings rows are created for every existing board (Renewals + any others). The `primary_date_column_id` is auto-picked as the first active date column on each board.
- ✅ Renewals' primary date column is explicitly set to `Lease End Date` by the migration.
- ✅ No regressions: all of Phase 3, 3.5, 4, 5 untouched in behavior. Only changes outside the new Phase 6 surface are:
  - `mb_items.updateItem` got a Phase 6 hook that fires `recomputeParentAggregation` when a subitem's `values.status` changes.
  - `mbSubitemsPhase5.createSubitem` / `createWorkflowSubitems` / `mb_items.deleteItem` fire the same hook when subitem counts change.
  - `BoardTable.tsx` accepts new optional props (`showProgressColumn`, `progressByItem`). Renders identically when omitted.
  - `RenewalsBoardClient` + `GenericBoardClient` fetch settings + progress map in the background (non-blocking).
  - The `EditBoardDrawer` Tab union grew to include `"aggregation"`.
- ✅ LeadSimple processes and other features untouched.

## Triage dashboard — cross-board

- ✅ `/dashboards/triage` loads when authenticated.
- ✅ Items from all boards rendered, sorted by computed score DESC, ties broken by id ASC.
- ✅ Each card shows: score badge (color-coded — red >70, amber 40–70, orange-yellow <40), title, board name, status label, top 4 reasons as chips ("+N more" if more than 4).
- ✅ Clicking a card navigates to `/operations/boards/<slug>/items/<id>` (Phase 4 detail page).
- ✅ Empty state shows "Nothing on fire. 🎉" when no items qualify.
- ✅ Polling: `setInterval` 60s; window focus also triggers refresh.
- ✅ Subitems excluded server-side via `parent_item_id IS NULL`.
- ✅ Archived items excluded server-side via `archived_at IS NULL`.
- ✅ Result list capped at 100; overflow message shows "X more items meet triage criteria — refine board-level filters" when there are more.

## Triage scoring (per rule)

- ✅ +40 if status value is in TRIAGE_NEGATIVE (`stalled`, `overdue`, `blocked`, `not_renewing`, `lost`).
- ✅ +30 if status value is in TRIAGE_NEW (`new`, `unassigned`, `pending`, `not_started`) OR `values.owner == null`.
- ✅ +25 if the current user has unseen `mb_update_mentions` on this item (per-user, joined per-request).
- ✅ +20 if the item's primary date column value (from `mb_items.values[date_key]`) is past today.
- ✅ +10 if that date is within 0–7 days from today.
- ✅ +15 if `values.renewal_score` exists and is below 40.
- ✅ +5 if `updated_at` is ≥ 14 days old.
- ✅ Items with score 0 are excluded from the result (`if (score === 0) continue;`).
- ✅ Reasons surfaced in priority order (sorted by weight) for the card chip rendering.

## Triage dashboard — per-board

- ✅ `/operations/boards/renewals/triage` reuses the same component with `scope="board" boardSlug="renewals"` — filters to Renewals items only.
- ✅ Same triage scoring applied.
- ✅ Tab visible via `BoardTabs` on the Renewals board header.

## Calendar dashboard — cross-board

- ✅ `/dashboards/calendar` loads and shows a monthly grid (Sun–Sat columns, today highlighted).
- ✅ Items appear as colored chips on their primary-date-column dates. The chip background is the status option's color.
- ✅ Chip label is the item title; titles are truncated by CSS `text-overflow: ellipsis`.
- ✅ Day-number click opens a popup listing all items on that day (full title, status chip, board name, link to detail page).
- ✅ Clicking a chip / popup row navigates to the item's detail page.
- ✅ Items with no value for the primary date column are filtered out by the SQL (`i.values ->> c.key IS NOT NULL`).
- ✅ "Today" button jumps the anchor to the current week/month.
- ✅ Forward/back navigation jumps by month or by week depending on view.
- ✅ "Month" / "Week" toggle re-renders the grid.
- ✅ Filters (board, owner, status) combine. Options derived from the current data set so admins don't get filter options for boards/statuses that aren't in the view.

## Calendar dashboard — per-board

- ✅ `/operations/boards/renewals/calendar` uses the same client with `scope="board"`.
- ✅ Tab visible via `BoardTabs`.

## Auto-aggregation — settings UI

- ✅ Admin opens the EditBoardDrawer and sees a new **Aggregation** tab.
- ✅ Status toggle defaults to OFF (migration default).
- ✅ Progress toggle defaults to OFF.
- ✅ Primary date column dropdown lists every active date column on the board; preselects the migration's default.
- ✅ "Recompute now" button visible to admins only.
- ✅ Non-admin PATCH on `/mb/boards/:id/settings` → 403 via `requireAdminRole`. Same for the recompute endpoint.

## Auto-aggregation — status behavior

- ✅ With status aggregation OFF (default), parent status is editable as before — the BoardTable dispatcher's `aggregated_status` branch is dormant.
- ✅ Enabling status aggregation on Renewals + clicking Recompute (which the toggle handler also fires automatically): items with subitems get `aggregated_status` written; the BoardTable dispatcher swaps the status cell for `AggregatedStatusBadge` with an "Auto" pill and a tooltip explaining the calculation.
- ✅ Subitem status changes call `recomputeParentAggregation` via the hook in `mb_items.updateItem`. Fire-and-forget so the response is fast; the eventual-consistency window is sub-second in normal load.
- ✅ Status ladder rules (per [mbDashboards.js](backend/routes/mbDashboards.js) `recomputeParentAggregation`):
  - any `blocked` → parent = first blocked-category subitem's value
  - else any `overdue` or `stalled` → parent = first such
  - else any `in_progress` → parent = first such
  - else all terminal → most common terminal (board-option-order tie-break)
  - else fallback to first `new` or `in_progress`
- ✅ Items with NO subitems → `aggregated_status` cleared (or stays NULL); the row remains editable.
- ✅ Disabling status aggregation clears `aggregated_status` on every item on that board (handler sets it to NULL); rows revert to editable, no data loss in `values.status` (the last aggregated value remains as the manual value, per spec).
- ✅ "Recompute now" iterates every top-level non-archived item on the board and runs `recomputeParentAggregation`; response includes `parents_examined` and `parents_updated`.

## Auto-aggregation — progress %

- ✅ With progress aggregation OFF, no Progress column in the table.
- ✅ Enabling progress aggregation → BoardTable receives `showProgressColumn={true}` + `progressByItem={…}`; the extra column appears at the end of each row.
- ✅ Progress = `(subitems with terminal status) / (total subitems)`, rounded; computed at read time in `computeProgressFor()`.
- ✅ Items with zero subitems show "—" (the helper returns `pct: null` and `ProgressBar` renders the dash).
- ⚠️ The Phase 4 item detail page and the Phase 3 drawer do NOT (yet) render the progress bar — only the Main Table view does. Spec listed both as "also show the progress." See PHASE6_DEFERRED.md.
- ✅ Disabling progress aggregation → column disappears.

## Performance

- ✅ Triage page first paint in well under 2s with the seed data set. The single batched fetch caps at 500 rows + a parallel mention count query.
- ✅ Calendar page first paint sub-second on a month with the seed data. Items are filtered to the requested date range in SQL.
- ✅ Recompute on a board with ~10 items + 5 subitems each completes in milliseconds. Larger boards will scale linearly with the number of parents.

## Auth and isolation

- ✅ All dashboard + settings endpoints require auth (`requireAuth`).
- ✅ `PATCH /mb/boards/:id/settings` and `POST /mb/boards/:id/aggregation/recompute` additionally require admin (`requireAdminRole`).
- ✅ Triage's `+25 mentions` only counts mentions where `mentioned_user_id = req.user.id` (per-user, not global).

## TypeScript / build

- ✅ `npm run build` succeeds with no errors.
- ✅ Phase 6 routes weight in:
  - `/dashboards/triage` → 2.63 kB / 107 kB
  - `/dashboards/calendar` → 0.16 kB shell / 108 kB (the bulk of the page is the shared CalendarDashboardClient)
  - `/operations/boards/[slug]/triage` → 2.63 kB / 107 kB
  - `/operations/boards/[slug]/calendar` → 0.16 kB / 108 kB
  - Renewals page grew from 3.85 kB to 4.03 kB (BoardTabs + the aggregation fetches).
- ✅ No `any` types introduced. New types: `BoardSettings`, `TriageReason`, `TriageItem`, `TriageResponse`, `CalendarItem`, `BoardProgressEntry` — all in `types/mb.ts`.

## Cleanliness

- ✅ No commented-out code in shipped files.
- ✅ No new `console.log` (`console.error` in catch blocks only).
- ✅ No `TODO` without an entry in `PHASE6_DEFERRED.md`.

## How to verify on a deployed environment

1. Boot log should include:
   ```
   Database schema OK (mb_* dashboards + aggregation (Phase 6)).
   ```
2. Sign in. Sidebar shows a new **Dashboards** group with **Triage** and **Calendar**.
3. Visit `/dashboards/triage`. The Renewals seed items should produce cards (the seed includes lease dates spanning past-due / 0–30 / 31+ days, and one tenant explicitly tagged `not_renewing`). Each card has a numeric score badge and reason chips.
4. Click any card → lands on the item detail page.
5. Visit `/dashboards/calendar`. Items appear on their lease-end-date cells. Switch to Week view. Use "Today" to jump back.
6. Visit `/operations/boards/renewals`. Three tabs in the header: Table / Triage / Calendar. Click Triage / Calendar to confirm the per-board variants.
7. As admin, open Edit board → **Aggregation** tab. Toggle "Auto-aggregate parent status from subitems" ON. A recompute fires automatically. Add a few subitems to a renewal (via the Phase 5 picker) and observe the parent status flip to match the ladder.
8. Toggle "Auto-aggregate parent progress". The Progress column appears in the table with stacked bars. Mark a subitem's status to a terminal value (e.g., "Renewed") — the percentage updates after the next page load.
9. Toggle status aggregation OFF. The "Auto" badges disappear; cells are editable again. (`values.status` retains whatever the last aggregated value was — that's the manual value going forward.)
10. Visit `/operations/processes` and confirm legacy boards still work. Visit Phase 4 item detail + Phase 5 Manage Templates and confirm both work identically.
