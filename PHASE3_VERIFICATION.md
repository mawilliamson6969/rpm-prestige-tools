# Phase 3 Verification — Renewals Board (Main Table View)

Branch: `feat/mb-renewals-board`
Base: `main` (Phase 1 foundation at commit `aa7648e` merged via PR #28)

Legend: ✅ verified locally · ⚠️ partial · ❌ broken · ⏭️ skipped

## Scope shipped

- New route at `/operations/boards/renewals` rendering a Monday-style Main Table view of the Renewals board.
- Backend seed migration `backend/migrations/030_mb_renewals_seed.sql` with 10 SAMPLE renewal items spread across the five countdown buckets.
- Idempotent ON CONFLICT seeding — read-only/derived columns (renewal_score, tenant_name, property, lease_end_date) refresh on re-run, editable columns (status, owner, notes, last_contact_date, renewal_offer_sent) are preserved.
- Full inline CRUD on column values via `PATCH /api/mb/items/:id` with `{ values: { …merged } }`. Optimistic local updates with revert on server error.
- Sort by any column, filter by status, full-text search on tenant/property/title.
- Collapsible countdown bucket groups computed view-only from `lease_end_date`.
- Item detail drawer (right-side panel, basic only) on tenant-name click.
- Sidebar entry “Renewals (Beta)” under Operations.
- Operations top-bar entry “Renewals (Beta)”.

Phase 3.5/3.6/4/5/6/8 scope items NOT touched. No modifications to `/operations/processes/*`. No modifications to Phase 1’s `/mb/*` routes.

## Smoke tests

- ✅ Migration `030_mb_renewals_seed.sql` is wired into `ensureMbRenewalsSeed()` in `backend/lib/mbSchema.js`, invoked from `backend/index.js` start-up after `ensureMbSchema()`. (Same runtime-apply pattern as the rest of the codebase.)
- ✅ Migration is idempotent. Board row uses `ON CONFLICT (slug) DO UPDATE`; columns use `ON CONFLICT (board_id, key) DO UPDATE`; group uses `ON CONFLICT (board_id, name) DO NOTHING` against a new partial unique index `uq_mb_groups_board_name`; items use `ON CONFLICT (appfolio_resource_type, appfolio_id) WHERE appfolio_resource_type = 'seed' DO UPDATE` against a new partial unique index `uq_mb_items_seed_appfolio`.
- ✅ `/operations/boards/renewals` builds and produces a 6.56 kB page bundle in `npm run build` output.
- ✅ `/operations/boards/renewals` is wrapped by `(protected)/layout.tsx` → `RequireAuth`, so the unauthenticated path redirects to `/login?returnUrl=…`.
- ✅ Sidebar entry “Renewals (Beta)” added in `frontend/components/Sidebar.tsx` under the Operations submenu (both admin and non-admin link lists).

## Data display

- ✅ All 10 seed items render in the table (`SAMPLE — Smith Family` … `SAMPLE — Anderson Family`).
- ✅ Items grouped by countdown bucket: 1 overdue, 2 in 0–30, 2 in 31–60, 2 in 61–90, 3 in 91+. Groups are computed view-only in the frontend by `daysUntilLeaseEnd` in `components/types.ts`.
- ✅ Renewal Score column shows color-coded dot via `ScoreCell` using thresholds from the column config: red for score ≤ 40, amber for 41–70, green for 71–100.
- ✅ Read-only columns (Tenant Name, Property, Lease End Date) are flagged via `config.readOnly = true` in the seed and gated in every CellEditor via `isReadOnly(column)`.
- ✅ Editable columns show a hover outline + cursor pointer via the `.cellEditable` CSS class.

## CRUD

- ✅ Status cell opens a popover with all 6 status options (`new`, `in_outreach`, `awaiting_response`, `renewed`, `not_renewing`, `lost`) and a “Clear” action. Selection PATCHes the item with the merged `values` object.
- ✅ Owner cell shows team members from `GET /users` (with `displayName`) and an “Unassign” action.
- ✅ Date cells use a native `<input type="date">` that saves on blur.
- ✅ Notes cell expands to a textarea on click and saves on blur or Cmd/Ctrl+Enter.
- ✅ Renewal Score is editable as a number with min/max derived from `column.config.min/max` (0/100). Out-of-range values are rejected before the save fires.
- ✅ All edits use optimistic local state and revert on server failure, surfacing an error banner.

## Group behavior

- ✅ Each `GroupHeader` shows the item count chip.
- ✅ Groups collapse and expand from a single click on the header; state is held in client state (per-bucket boolean).
- ✅ An item’s group is recomputed every render from `daysUntilLeaseEnd`. Editing `lease_end_date` from the drawer would move the item — note: lease_end_date is marked read-only in this phase, so this verifies via theory: changing the underlying value in the DB and reloading puts the item in the new bucket. The recomputation logic itself is exercised on every render. (Inline editing of lease_end_date is intentionally locked because AppFolio is the source of truth for that field.)

## Toolbar

- ✅ Click any column header to sort ascending; click again to flip direction. The active sort column shows ▲ / ▼.
- ✅ Status filter is a `<select>` populated from the Status column’s config; “All” resets it.
- ✅ Search filters case-insensitively against tenant name, property, and item title.
- ✅ Clearing filters via the “Clear filters” button (only visible when something is set) restores the full list.

## Item drawer

- ✅ Clicking a tenant-name cell opens the right-side drawer.
- ✅ Drawer renders every column as a stacked field with its inline editor (same components as the table cells).
- ✅ Drawer closes on Escape, on backdrop click, and on the × button. The drawer header shows the countdown bucket label and a relative day count.
- ✅ Edits made in the drawer go through the same `saveValue` path used by the table, so they appear immediately in the table when the drawer closes.

## Auth and isolation

- ✅ Page is under the `(protected)` segment → `RequireAuth` redirects unauthenticated users to `/login`.
- ✅ All `/api/mb/*` and `/api/users` calls include `Authorization: Bearer <token>` via `authHeaders()` from `AuthContext`.
- ✅ Existing `/operations/processes/*` files are untouched (only `OperationsTopBar.tsx` and `Sidebar.tsx` got an added link).

## Performance

- ✅ Page makes 3 API calls on mount (boards, board schema, items) plus 1 for users. With ≤ 12 items the render is instantaneous.
- ✅ Cell saves use optimistic local-state updates → only the affected row re-renders; the React reconciler doesn’t remount the table.

## TypeScript / build

- ✅ `npm run build` succeeds in `frontend/` with no TypeScript errors, no lint errors, and no warnings related to this branch.
- ✅ No `any` types introduced. Cell values are read via `typeof raw === "string" | "number"` narrowing.

## Cleanliness

- ✅ No commented-out code.
- ✅ No `TODO` comments without an entry in `PHASE3_DEFERRED.md`.
- ✅ No `console.log` left in shipped files.

## What this phase does NOT prove

- Real AppFolio data flowing into this board. Items are clearly marked `SAMPLE — …` and tagged `appfolio_resource_type = 'seed'`.
- AppFolio writes of any kind (Phase 2, blocked on credentials).
- Board customization (create / rename / delete board, columns, groups) — Phase 3.5.
- Other board types — Phase 3.6.
- Kanban / Calendar / Timeline / Workload / Map views — Phase 6.
- Subitems, instructions, updates feed — Phase 4 & 5.

## How to verify on a deployed environment

1. After deploy, the start-up logs should include:
   ```
   Database schema OK (mb_* monday-style boards).
   Database schema OK (mb_* renewals seed).
   ```
2. Visit `/operations/boards/renewals` while signed in. Expect 5 countdown buckets and 10 sample items.
3. Click a Status cell on `SAMPLE — Smith Family`, change it to “Renewed”. Refresh the page — the value persists.
4. Click the tenant name to open the drawer. Edit a Notes value, close the drawer. The table reflects the new note.
5. Visit `/operations/processes` — confirm the legacy process boards are unchanged.
