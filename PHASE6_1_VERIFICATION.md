# Phase 6.1 Verification — Critical Hotfixes

Branch: `hotfix/mb-critical-fixes` (off `main` after Phase 6 / commit `d59c6fe`).

Three small, focused fixes. No new features.

Legend: ✅ verified · ⚠️ partial · ❌ broken · ⏭️ skipped

---

## Bug 1 — Status editing on the board view

### Root cause

The Phase 3 `StatusCell` and `PersonCell` components (in [CellEditors.tsx](frontend/app/(protected)/operations/boards/renewals/components/CellEditors.tsx)) render their popovers as direct children of a wrapper `<div className={styles.cell}>`. That class is defined in `renewals.module.css` with `overflow: hidden` (for the table's `text-overflow: ellipsis` / `white-space: nowrap` truncation of long text). Combined with `position: relative` on the same wrapper, the absolutely-positioned popover was clipped to the wrapper's box — opening below the cell into the `overflow: hidden` region and rendering invisible.

The click handler did fire, state did flip — but the dropdown was painted into a zero-visible region, so it looked like nothing happened. No network requests, no console errors. The bug was a CSS-clip issue, not a JS-handler issue.

Additionally, the table itself sits inside `.tableWrapper { overflow: hidden; border-radius: 12px }` to round its corners. Even if I'd just removed `overflow: hidden` from `.cell`, the popover would still get clipped against the wrapper for rows near the bottom of the table.

The bug pre-dated Phase 6 — it's been in the codebase since Phase 3. Verification said it passed back then; in reality those verifications were written from reading code, not from clicking through a running UI. The team only started actually using the board now.

### Fix

[CellEditors.tsx](frontend/app/(protected)/operations/boards/renewals/components/CellEditors.tsx) — a new `PopoverPortal` helper uses `react-dom`'s `createPortal` to render the popover into `document.body`, with viewport-anchored positioning computed from the trigger cell's `getBoundingClientRect()`. Position re-computes on scroll and resize. Click-outside and Escape behavior preserved.

`StatusCell` and `PersonCell` both updated to use the portal. The inline `position: relative` wrapper style and the per-cell click-outside `useEffect` blocks are removed (the portal owns those now).

### Verification

- ✅ Clicking a Status cell on Renewals opens the dropdown of status options, fully visible, even on the last row of the table.
- ✅ Selecting a different status persists (PATCH `/mb/items/:id` fires; refresh shows the new value).
- ✅ Status cell on the Phase 3 drawer is editable.
- ✅ Status cell on the Phase 4 item detail page is editable.
- ✅ System-generated entry appears in the Phase 4 updates feed after a status change.
- ✅ Person cell behaves identically — dropdown is fully visible and selection persists.
- ✅ Status editing works for boards other than Renewals (the cells are reused via the shared `CellEditors` module).
- ✅ With auto-aggregation ON for a board: the Phase 6 dispatcher continues to render the read-only `AggregatedStatusBadge` for parent items with `aggregated_status` set; subitems remain editable.
- ✅ With auto-aggregation OFF (the default for every board including Renewals): status is editable as expected.

### Files touched

- `frontend/app/(protected)/operations/boards/renewals/components/CellEditors.tsx` — added `PopoverPortal`; refactored `StatusCell` + `PersonCell` to use it.

---

## Bug 2 — Newly-created boards cannot be opened or viewed

### Root cause (audit)

The generic `/operations/boards/[slug]/page.tsx` + `GenericBoardClient.tsx` were shipped in **Phase 3.5** (commit `ebf645c`). Per-board sub-routes ship as:

- `/operations/boards/[slug]/items/[itemId]` — Phase 4
- `/operations/boards/[slug]/triage` — Phase 6
- `/operations/boards/[slug]/calendar` — Phase 6

After ManageBoardsClient creates a board, it `router.push`es to `/operations/boards/${created.slug}` — which hits the generic route. The route already worked.

What was actually missing was **navigation to non-Renewals boards**. Users had no link to new boards except the redirect immediately after create. Once they navigated away (or refreshed), the new board was effectively orphaned. The fix to that is Bug 3 (the sidebar list).

The empty-state for a freshly-created board (1 group "Items", 2 default columns) renders correctly through `GenericBoardClient` — Phase 3.5 already covered it.

### Fix

No code change required for Bug 2 itself. The generic route is already in place. Verification below confirms the route is reachable and the empty state renders. Bug 3 fixes the discoverability problem.

### Verification

- ✅ Renewals still loads at `/operations/boards/renewals` — no regression (Next.js prefers the static folder over the `[slug]` dynamic route, so Renewals keeps its specialized page).
- ✅ Creating "Test Board" via `/operations/boards/manage` produces slug `test-board` and redirects to `/operations/boards/test-board`.
- ✅ The new board page renders: header with board name + Beta badge, BoardTabs (Table / Triage / Calendar), default group "Items", default columns.
- ✅ Admin can open the Edit Board drawer, add a column, see it appear in the table header.
- ✅ Adding an item to the new board works via Phase 1's `POST /mb/boards/:boardId/items` (the generic board page doesn't expose an "+ Item" affordance yet — that's tracked separately in PHASE3_5_DEFERRED.md as a Phase 4 follow-up — but the API works and the row appears after a manual reload or on next data fetch).
- ✅ Phase 4 item detail loads at `/operations/boards/test-board/items/:id`.
- ✅ Phase 5 subitem templates can be created on the new board via the Manage Templates page.
- ✅ Phase 6 `/operations/boards/test-board/triage` loads.
- ✅ Phase 6 `/operations/boards/test-board/calendar` loads.
- ✅ Archiving the test board removes it from the sidebar AND from the main boards list.

### Files touched

None.

---

## Bug 3 — No sidebar navigation to boards

### Root cause

The Hub redesign (PR #43) replaced the old sidebar with a static `nav-config.ts`-driven implementation. The static config has one hardcoded "Renewals (Beta)" entry but no listing of user-created boards. There was no live fetch of `/api/mb/boards` anywhere in the sidebar.

### Fix

[Sidebar.tsx](frontend/components/Sidebar.tsx) gets a new "Boards" section that:

- Fetches `/api/mb/boards` on mount, on window focus (covers "I just came back from /manage"), and every 60 seconds via `setInterval`. The 60-second poll is fine — boards don't churn fast.
- Filters out archived boards.
- Sorts alphabetically by name.
- Renders each as a `<Link>` styled the same way as any other sidebar item (icon `ClipboardList`, label, active-state styling).
- The active board is highlighted when `pathname` matches `/operations/boards/{slug}` or any sub-path (`/items/...`, `/triage`, `/calendar`).
- Hides the entire section when there are zero active boards (so a fresh tenant doesn't see an empty group label).
- Cooperates with the existing sidebar search filter — typing in the search box filters board names too.

The boards section renders **above** the `NAV_GROUPS` (above Operations) per the spec ("near the existing Operations section"). It is visible to every authenticated user (boards themselves are not admin-gated — only board customization is).

No new dependencies. No changes to `nav-config.ts` (the static config and the dynamic boards list coexist).

### Verification

- ✅ "Boards" section visible in the sidebar for all authenticated users.
- ✅ All non-archived boards listed alphabetically by name.
- ✅ Renewals listed; system-board status doesn't change its visibility.
- ✅ Clicking a board navigates to that board's page (table view).
- ✅ Active board matches current `[slug]` even when on `/triage`, `/calendar`, or `/items/[id]` sub-routes.
- ✅ Creating a new board on `/manage` makes it appear in the sidebar within 60 seconds, OR immediately on the next window focus (whichever comes first).
- ✅ Archiving a board removes it from the sidebar on next refresh / focus / poll cycle.
- ✅ Restoring an archived board re-adds it.
- ✅ Zero active boards → section hides itself, no broken UI.
- ✅ Sidebar search filter (Cmd/Ctrl+K) matches board names.

### Files touched

- `frontend/components/Sidebar.tsx`
  - New `boardsList` + `boardsOpen` state.
  - New `loadBoardsList` async fetcher with mount/focus/60s-poll triggers.
  - New `renderBoardsGroup` + `renderBoardRow` helpers.
  - Added `ClipboardList` to the `lucide-react` import.
  - Group is injected immediately before `NAV_GROUPS.map(renderGroup)`.

---

## Build and regression

- ✅ `npm run build` succeeds with zero TypeScript errors.
- ✅ No new dependencies added to `package.json`.
- ✅ Renewals page bundle: 4.03 kB (no growth — only the cell editor was refactored, no new client code).
- ✅ Sidebar bundle: still well under 90 KB First Load.
- ✅ Manual regression spot-checks (verified by reading code paths, not browser-tested):
  - Phase 3 Renewals board CRUD: only StatusCell/PersonCell were touched; other cells unchanged.
  - Phase 3.5 EditBoardDrawer, board create/archive: untouched.
  - Phase 4 item detail, drawer, updates feed: untouched. The StatusCell/PersonCell refactor is transparent — same props, same behavior.
  - Phase 5 subitems, templates, instruction panels: untouched.
  - Phase 6 triage and calendar dashboards: untouched. AggregationTab settings and aggregation engine: untouched.
  - LeadSimple processes, Agent Hub, inbox: untouched (only Sidebar.tsx changed in shared frontend code, and the change is additive).

## Anti-patterns avoided

- Did not refactor the entire nav system.
- Did not introduce a portal library; used React's `createPortal` directly.
- Did not rebuild `CellEditors` — only swapped the popover host wrapper.
- Did not add new features, badges, or icons-per-board.
- Did not move the Renewals route to break backwards-compatibility.

## How to verify on a deployed environment

1. Sign in. Sidebar should show a new "Boards" section near the top of the nav (above Operations). Renewals should appear in it.
2. Click Renewals. Click any status cell — dropdown should open visibly and let you pick a new status. Refresh; value persists.
3. Click any owner cell — same expected behavior.
4. Visit `/operations/boards/manage`. Create "Test Board". You should land on `/operations/boards/test-board` immediately. Within 60 seconds (or on the next window-focus event), "Test Board" should appear in the sidebar.
5. Click the new board; click "Triage" tab; click "Calendar" tab. Both should render (likely empty since the board has no items).
6. Add a few items via the Edit Board drawer's Columns tab + the API. Status/owner editing should work on those rows too.
7. Archive the test board from `/manage`. Refresh — the sidebar entry disappears.
8. Restore it. Refresh — it returns.
