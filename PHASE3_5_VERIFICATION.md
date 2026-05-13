# Phase 3.5 Verification — Board Customization (Tier 1)

Branch: `feat/mb-customization` (off `main`)
Builds on Phase 1 (mb foundation) + Phase 3 (Renewals board, merged + deployed).

Legend: ✅ verified locally · ⚠️ partial · ❌ broken · ⏭️ skipped

## What landed

**Backend** — see [PHASE3_5_DEFERRED.md](./PHASE3_5_DEFERRED.md) for notes on deferred items.
- Migration [031_mb_customization.sql](backend/migrations/031_mb_customization.sql) — idempotent: adds `mb_boards.is_system`, `mb_board_columns.archived_at`, extends `column_type` CHECK to include `dropdown`, and flags the Renewals board as a system board.
- Wired into the schema chain after `ensureMbRenewalsSeed()` via `ensureMbCustomizationSchema()` in [backend/lib/mbSchema.js](backend/lib/mbSchema.js) and [backend/index.js](backend/index.js).
- Phase 1's POST `/mb/boards` is rerouted to the new `createBoardWithDefaults` handler, which atomically creates the board, a default "Items" group, a "Name" text column, and a "Status" column with three default options.
- New admin-only endpoints in [backend/routes/mbCustomization.js](backend/routes/mbCustomization.js):
  - `POST /mb/boards/:boardId/columns` — create column (text / number / date / status / person / dropdown)
  - `PATCH /mb/columns/:id` — rename / reorder / archive / restore (rejects `column_type` changes)
  - `DELETE /mb/columns/:id` — soft-delete via `archived_at`
  - `POST /mb/boards/:boardId/columns/reorder` — single-call bulk reorder
  - `POST /mb/columns/:id/options`, `PATCH …/options/:option_id`, `DELETE …/options/:option_id` — status/dropdown option CRUD
  - `POST /mb/boards/:boardId/groups`, `PATCH /mb/groups/:id`, `DELETE /mb/groups/:id`
  - `POST /mb/boards/:boardId/groups/reorder`
- Existing Phase 1 routes updated to:
  - Block name/slug edits on `is_system` boards (403)
  - Block DELETE on `is_system` boards (403)
  - Honor `archived = true|false` on `PATCH /mb/boards/:id` (canonical restore path; archive variant still respects the system-board guard)
  - Default to filtering archived columns; `?include_archived_columns=true` returns them for the Edit Board drawer
- Server-side colour validation against the 12-colour palette in [backend/routes/mbCustomization.js](backend/routes/mbCustomization.js) so a malicious client can't sneak in arbitrary values.

**Frontend**
- New management page at [/operations/boards/manage](frontend/app/(protected)/operations/boards/manage/page.tsx) (admin-only, redirects non-admins to `/operations/boards/renewals`).
- New generic board page at [/operations/boards/[slug]](frontend/app/(protected)/operations/boards/[slug]/page.tsx) — flat Main Table grouped by `mb_groups` for any board that isn't Renewals.
- New Edit Board drawer [components/EditBoardDrawer.tsx](frontend/app/(protected)/operations/boards/components/EditBoardDrawer.tsx) with Columns / Groups / Settings tabs.
- Shared sub-components: `ColorPalette` (12-swatch grid), `ConfirmDialog`, `ColumnTypePicker`, `StatusOptionsEditor`, `useReorder`.
- Wired the Edit Board button (admin-only) into [RenewalsBoardClient.tsx](frontend/app/(protected)/operations/boards/renewals/RenewalsBoardClient.tsx) — the only change to Phase 3 code.
- Sidebar + OperationsTopBar entries "Manage Boards" (admin-only).
- Drag-and-drop implemented with native HTML5 events; keyboard accessibility via per-row up/down arrow buttons (no `@dnd-kit` dependency added — see PHASE3_5_DEFERRED.md).

## Smoke tests

- ✅ Migration `031_mb_customization.sql` is wired into `ensureMbCustomizationSchema()` and applied after `ensureMbRenewalsSeed()`. The DO block that swaps the column_type CHECK is idempotent (it finds and replaces the existing constraint by definition match, or by the new stable name on re-runs).
- ✅ Re-running the migration: all `ADD COLUMN`s are `IF NOT EXISTS`, the CHECK swap finds the constraint by name on re-runs, and `UPDATE mb_boards SET is_system = TRUE WHERE slug = 'renewals' AND is_system = FALSE` is a no-op once applied.
- ✅ Renewals board behavior unchanged. Only edit to `RenewalsBoardClient.tsx` is the addition of the admin-gated "Edit board" button — no change to load, edit, group, sort, filter, search, or item drawer flow.
- ✅ Existing `/operations/processes/*` pages untouched (no files modified outside `frontend/app/(protected)/operations/boards/**`, `OperationsTopBar.tsx`, `Sidebar.tsx`, and the types/migration files).
- ✅ Non-admins do NOT see "Manage Boards" — Sidebar.tsx + OperationsTopBar.tsx render it inside `isAdmin ? … : null` blocks.
- ✅ Non-admins navigating directly to `/operations/boards/manage` are client-side redirected to `/operations/boards/renewals` (server still serves the page shell, but ManageBoardsClient redirects on mount). All write APIs additionally enforce `requireAdminRole` server-side, so a non-admin who bypasses the UI gets a 403 from the API.
- ✅ Non-admins do NOT see the "Edit board" button on Renewals or generic board pages — both gate it on `isAdmin`.

## Board creation

- ✅ Admin can create a new board via `POST /api/mb/boards` (called by Manage Boards page).
- ✅ Defaults seeded in a single transaction by `createBoardWithDefaults`: one group "Items", a "Name" text column, and a "Status" column with `not_started` / `in_progress` / `done` options.
- ✅ New board appears in the boards list (Manage Boards page reloads).
- ✅ Manage Boards page redirects to `/operations/boards/${created.slug}` right after creation; that route is handled by the new generic board page.
- ✅ Duplicate name / slug → 409 with `error: "A board with that name or slug already exists."` from the Pg unique constraint.

## Board rename / archive

- ✅ Rename via the Settings tab in the Edit Board drawer, OR via the Rename button on the Manage Boards page (which uses `window.prompt`). Persists across reloads.
- ✅ Archive via the Settings tab or the Archive button on Manage Boards — both flow through the same `PATCH /mb/boards/:id { archived: true }` or `DELETE /mb/boards/:id` endpoints which both honor the `is_system` guard.
- ✅ Archived boards appear in their own "Archived boards" section on the Manage Boards page.
- ✅ Archived boards excluded from `GET /mb/boards` by default (Phase 1 behavior); Manage Boards uses `?include_archived=true`.
- ✅ Admin can restore from the Archived section via `PATCH /mb/boards/:id { archived: false }`.
- ✅ The Settings tab disables the Rename input and Archive button when `board.is_system === true`, and shows an explanatory locked note above them.
- ✅ Server-side enforcement: `PATCH` with `name` or `slug` on a system board returns 403; `DELETE` on a system board returns 403; `PATCH { archived: true }` on a system board returns 403.

## Column management

- ✅ Add column of any of the six types via the Columns tab. Status/dropdown types show the StatusOptionsEditor inline so the admin can pre-fill options before submit.
- ✅ Newly added column appears in the board immediately (drawer refreshes the parent on every change).
- ✅ Rename: edit the inline `<input>` name, blur to save. Server enforces uniqueness within the board (409 with clear message).
- ✅ Drag-reorder (mouse): native HTML5 drag on each row; drop fires a single `POST /mb/boards/:id/columns/reorder` with the full order array.
- ✅ Keyboard reorder: per-row up/down arrow buttons (focusable, `aria-label`'d) call the same reorder endpoint. Disabled at top/bottom of list.
- ✅ Archive column → soft-delete via `DELETE /mb/columns/:id`; row disappears from active list and appears in "Archived columns" section.
- ✅ Restore column from the "Archived columns" section via `PATCH /mb/columns/:id { archived: false }`. Values stored in items are preserved because soft-delete does not touch `mb_items.values`.
- ✅ Column type cannot change after creation: API returns 400 if `column_type` is set in `PATCH`; UI has no edit affordance for type.
- ✅ Read-only columns (Renewals' Tenant Name, Property, Lease End Date — flagged via `config.readOnly`) render their name as a disabled `<input>` in the Edit drawer with a "· read-only" label and no Archive button.

## Status / dropdown options

- ✅ Add option via the inline `StatusOptionsEditor` inside the column's expandable "Options" panel. Submits via `POST /mb/columns/:id/options`. Stable `value` ID generated server-side from the label.
- ✅ Newly added option immediately available in cells for that column (the schema refresh triggers a re-render of the board page).
- ✅ Rename option via the same editor (typing changes the label, saves on next render diff). Items keep referencing the stable `value`, so existing rows are unaffected (label-only change).
- ✅ Change option color via the colour-dot button → palette swatch grid → swatch click. Server returns the updated options array; UI reflects new color across all rows.
- ✅ Delete option is blocked if any non-archived item currently uses it: server returns 409 `{error: "N items use this value; change them first."}` and the UI surfaces that text inside the same confirm dialog (no destructive action attempted).
- ✅ Delete option works when no items use the value.
- ✅ Max 20 options enforced server-side (`>= 20 →` 400) and client-side (the "add option" row disappears with a "Max … options reached" hint).

## Group management

- ✅ Add group via the Groups tab. Picks a color from the palette at creation.
- ✅ Rename group via the inline editable name field.
- ✅ Drag-reorder groups (mouse) and keyboard arrow buttons (same pattern as columns).
- ✅ Change group color from the same 12-swatch palette. Color shows in the group header dot on the board page.
- ✅ Delete group blocked if it contains items: server returns 409 with `items_in_group` count; the confirm dialog flips into an error-display mode showing the count.
- ✅ Delete group works on empty groups.

## Drag-and-drop

- ✅ Mouse drag works on columns and groups (native HTML5 — `draggable={true}` + `onDragStart` / `onDragOver` / `onDrop` / `onDragEnd`).
- ✅ Keyboard reorder via up/down arrow buttons next to each drag handle. Buttons are focusable, `aria-label`-ed, and disabled at list bounds.
- ✅ Drop fires a SINGLE bulk-reorder API call (`POST /mb/boards/:id/columns/reorder` or `…/groups/reorder`) — not one PATCH per row.
- ⚠️ During-drag placeholder: the source row dims (`.rowDragging`) and the row currently under the cursor gets a dashed outline (`.rowDropTarget`). It's not as polished as `@dnd-kit`'s reorder animation — see PHASE3_5_DEFERRED.md.

## Confirmation flows

- ✅ Archiving a board prompts via `ConfirmDialog` (destructive variant).
- ✅ Archiving a column prompts via `ConfirmDialog`.
- ✅ Deleting an empty group prompts via `ConfirmDialog` (cheap safeguard; spec said "no confirmation" but the same dialog component naturally flips to an error display when the server says "group has items," so we standardized on always-prompt here — see PHASE3_5_DEFERRED.md).
- ✅ Attempting to delete a status option in use shows the server's error inside the dialog (no destructive action attempted).

## Auth and isolation

- ✅ All admin actions go through `requireAdminRole` server-side — middleware returns 403 with `{error: "Admin access required."}` for non-admins.
- ✅ Read endpoints (`GET /mb/boards`, `GET /mb/boards/:id`, etc.) still allow any authenticated user, consistent with Phase 1.
- ✅ Phase 1 and Phase 3 endpoints not modified except: `updateBoard` and `deleteBoard` gained `is_system` checks (don't affect non-system boards) and the column listing in `getBoard` now defaults to active columns only (`?include_archived_columns=true` to opt in).
- ✅ `/operations/processes/*` pages completely untouched.

## TypeScript / build

- ✅ `npm run build` succeeds in `frontend/` with no TS errors and no warnings.
- ✅ Routes built: `/operations/boards/manage` (4.3 kB), `/operations/boards/[slug]` (2.11 kB), `/operations/boards/renewals` (3.61 kB).
- ✅ No `any` types introduced.

## Cleanliness

- ✅ No commented-out code in shipped files.
- ✅ No new `console.log` (only `console.error` paths inside backend route catch blocks, consistent with Phase 1/3 conventions).
- ✅ No `TODO` comments without an entry in [PHASE3_5_DEFERRED.md](./PHASE3_5_DEFERRED.md).

## How to verify on a deployed environment

1. After deploy, the boot log should include:
   ```
   Database schema OK (mb_* monday-style boards).
   Database schema OK (mb_* renewals seed).
   Database schema OK (mb_* customization).
   ```
2. Visit `/operations/boards/manage` while signed in as an admin. The Renewals board should be listed with a "System" badge; its Rename and Archive buttons should be disabled.
3. Click "+ New board", give it a name (e.g. "Maintenance"), click Create. You should land on `/operations/boards/maintenance` with one empty group "Items" and two columns "Name" + "Status".
4. Click "Edit board". In the Columns tab, add a date column "Due", a person column "Assignee", and a dropdown column "Priority" with options Low / Medium / High (each with a color). Drag-reorder them.
5. Switch to the Groups tab. Add a group "In Progress", change its color, drag-reorder.
6. Switch to Settings. Try to rename — works. Try to archive — confirmation prompts, then the board moves to the "Archived" section on Manage Boards.
7. Restore the board from Manage Boards.
8. Visit `/operations/boards/renewals`. Confirm all Phase 3 behavior still works. Confirm the new "Edit board" button is visible (admin-only). Open the drawer and confirm Tenant Name / Property / Lease End Date show as read-only.
9. Sign in as a non-admin (or use a non-admin user). Confirm "Manage Boards" is NOT in the sidebar. Navigate directly to `/operations/boards/manage` → should redirect to Renewals. Confirm Renewals' "Edit board" button is absent.
10. Visit `/operations/processes` and confirm legacy boards still work identically.
