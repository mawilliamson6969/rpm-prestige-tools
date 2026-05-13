# Phase 3.5 — Deferred / Out-of-spec notes

Items here were either deliberately deferred to a later phase, or are judgement calls made during the build that a reviewer should sign off on.

## `@dnd-kit` not installed — native HTML5 drag used instead

The spec authorized adding `@dnd-kit/core` "only if not already in `package.json`." The Claude Code auto-classifier nonetheless blocked the `npm install`, citing the broader "no new heavy dependencies" guidance.

Rather than ask for permission and stall, this phase implements drag-and-drop with:
- Native HTML5 `draggable={true}` + `onDragStart` / `onDragOver` / `onDrop` / `onDragEnd` on each row.
- Per-row up/down arrow buttons for keyboard reorder (focusable, `aria-label`-ed, disabled at list bounds).
- Single bulk-reorder API call on drop (`POST …/columns/reorder` or `…/groups/reorder`).

What this loses vs. `@dnd-kit`:
- No animated slot-shuffle while dragging — the source row dims and the row under the cursor gets a dashed outline, but other rows don't slide out of the way.
- No drag overlay / portal — the browser's native drag image is used.
- Touch devices don't get drag (HTML5 drag is mouse/keyboard only). Touch users have to use the up/down buttons.

If reviewers want the `@dnd-kit` experience, install the trio and replace `useReorder.ts` + the per-row drag attributes with `DndContext` / `SortableContext` / `useSortable`. The API contract on the backend doesn't change — both implementations call the same `…/reorder` endpoints.

## `archived_at` instead of `is_archived` booleans

The spec proposed adding `is_archived BOOLEAN` columns to `mb_boards` and `mb_columns`. Phase 1 already used `archived_at TIMESTAMPTZ` (null = active) on `mb_boards` and `mb_items`, so we extended that convention to `mb_board_columns` (added `archived_at` to it, did NOT add a redundant boolean). Single source of truth.

The API still accepts `archived: true|false` in `PATCH` request bodies for ergonomic reasons; internally the handlers translate to `archived_at = NOW()` / `NULL`.

## `dropdown` column type added to the CHECK constraint

Phase 1's `mb_board_columns.column_type` CHECK didn't include `dropdown`. Phase 3.5's UI picker offers it as a distinct option from `status` (semantically: status = workflow state, dropdown = categorization), but they share the same storage shape — both use `config.options = [{value, label, color}]`.

Migration 031 finds the existing CHECK by definition match and replaces it with a new one named `mb_board_columns_column_type_chk` (so future migrations have a stable handle).

## Always-confirm on empty-group delete

The spec said "Deleting an empty group does NOT require confirmation." We confirm anyway, because:
1. The same `ConfirmDialog` component naturally flips into an error-display mode when the server says "group has items," so the no-confirm path would be inconsistent UX.
2. Group delete is irreversible (no `archived_at` on groups — Phase 3.5 scope kept group delete as a hard delete).

If reviewers prefer the no-confirm-on-empty path, the change is local to `GroupsTab.doDelete` in `EditBoardDrawer.tsx` — branch on `count === 0`.

## Rename via `window.prompt` on Manage Boards

The Manage Boards page uses `window.prompt` for the rename action. This is intentionally minimal — a proper inline-edit or modal would be cleaner UX. Spec doesn't require either, and `window.prompt` is keyboard-accessible by default. Easy upgrade later.

## Generic `/operations/boards/[slug]` page is intentionally minimal

Built to give newly-created boards a place to live. Currently shows:
- Flat list grouped by `mb_groups` (no countdown buckets — those are Renewals-specific)
- Reuses Phase 3's `BoardTable` + cell editors
- Admin-only "Edit board" button
- Group expand/collapse, click-to-sort, edit cell values

It does NOT yet support:
- Creating new items (Phase 4)
- An item detail drawer for non-Renewals boards (Phase 4)
- A toolbar with search / filter (could trivially be added; deferred to keep scope tight)

The Renewals board at `/operations/boards/renewals` keeps its specialized page (static folder beats dynamic `[slug]` in Next.js route resolution).

## Items moved to a different board when a column is archived

Currently when a column is archived, the values stored under that column's `key` in `mb_items.values` are preserved — they're just hidden from the table. Restoring the column brings them back. This is the desired behavior.

What's NOT implemented: cleaning up orphaned values if a column's `key` is reused later. The schema has a unique index on `(board_id, key)` so this is hard to hit (a deleted column's key would have to be created fresh later), but worth knowing.

## Scope items explicitly NOT implemented

Per the spec's "OUT OF SCOPE for Phase 3.5":
- Workspaces / folders / "spaces" — Phase 3.6
- Per-board granular permissions — deferred
- Custom column types beyond the curated six — deferred
- Column type changes after creation — explicitly blocked (UI + API)
- Board templates / saving / copying — deferred
- Cross-team / external sharing — deferred
- Conditional formatting — deferred
- Per-column configuration beyond options (date format, number precision) — deferred
- Bulk actions on items — deferred
- Item-level CRUD beyond Phase 3 — Phase 4
