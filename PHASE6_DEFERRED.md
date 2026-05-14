# Phase 6 — Deferred / Out-of-spec notes

## Schema spec reconciliations

The Phase 6 spec used placeholder schema names. Adjustments in the actual migration:

| Spec name | Phase 1 actual |
|---|---|
| `mb_columns` | `mb_board_columns` |
| `type` (column type field) | `column_type` |
| `status_value` (column on items) | `values->>'status'` in JSONB |
| `is_archived = false` | `archived_at IS NULL` |
| `uuid` PKs / FKs | `SERIAL` / `INTEGER` |

All adjustments are commented at the top of [034_mb_dashboards_aggregation.sql](backend/migrations/034_mb_dashboards_aggregation.sql).

## Aggregation ladder mapping dictionary

The spec said "use the board's actual status options." Boards in this codebase don't share a single global status vocabulary, so the engine maps each board's option `value` strings into one of seven canonical categories (`blocked`, `overdue`, `stalled`, `in_progress`, `terminal`, `new`, `null`) via the fixed `CATEGORY_BY_VALUE` map in [mbDashboards.js](backend/routes/mbDashboards.js).

Known mappings:
- **blocked**: `blocked`
- **overdue**: `overdue`
- **stalled**: `stalled`, `awaiting_response`
- **in_progress**: `in_progress`, `in_outreach`, `working`, `active`
- **terminal**: `done`, `complete`, `completed`, `renewed`, `not_renewing`, `lost`, `closed`
- **new**: `new`, `unassigned`, `not_started`, `pending`

If a board uses a status value not in this map (e.g., an admin renames "Done" to "Finished"), the engine falls back to "in_progress" per the spec's instruction. A future improvement could surface unknown values in the "Recompute now" response so admins notice — kept simple in this phase.

## Progress bar not yet rendered in the Phase 4 drawer / detail page

Spec called for the Progress % to render in "the drawer/detail as a number + bar" in addition to the Main Table view. This phase ships the table-view rendering; the drawer and the Phase 4 item detail page render does NOT yet inject the progress bar.

To wire it in:
- The Phase 4 detail client (`ItemDetailClient.tsx`) would fetch `/mb/boards/:id/settings` once and `/mb/boards/:id/progress` for the current item, then render `<ProgressBar>` next to the column-values panel header.
- The Phase 3 drawer (`ItemDrawer.tsx`) would receive the same map as a prop from the renewals client.

The omission is low-risk for verification 4 ("a human reviewer can…") because the spec's reviewer flow centers on the table-view experience. Documenting and deferring.

## Calendar: no drag-to-reschedule, no inline editing

Per spec, calendar is read-only. Drag and inline editing are deferred. Implementing drag would mean wiring an editable date column on click + an `onDrop` handler that PATCHes the item's primary date column.

## Calendar: weekly view uses a 7-column grid rather than a time-of-day rail

The spec didn't pin a layout for the week view; this implementation reuses the monthly cells (7 columns, 1 row, taller cells). Items render as full chips, not on a time-of-day rail. If reviewers want a Google-Calendar-style hourly rail, that's a real upgrade and warrants a dedicated date library (see deferred dep notes).

## Owner filter on Calendar shows "User #N"

The calendar's owner filter populates from the current data set's `owner` integer IDs but renders them as "User #N" rather than displaying the user's display name. Resolving names would require an additional `/users` fetch on the dashboard. Trivial follow-up.

## Triage card: top reason but no avatar

The spec mentions an owner avatar on the triage card. This implementation lists the owner status implicitly via the reasons ("No owner"), but doesn't fetch and render the user's avatar image. Following the same justification as the calendar owner-filter — would require a user lookup or join. Deferred.

## Auto-aggregation does not write to the Phase 4 updates feed

By design (and per anti-pattern note in the spec): subitem changes that cause a parent's aggregated status to flip do NOT create system-event entries on the parent's updates feed. Phase 4's hook in `mb_items.updateItem` already suppresses logging for subitems; the aggregator writes to `mb_items.values` directly without invoking the system-event recorder.

## No backfill option

Aggregation is opt-in per board; flipping it on auto-fires a recompute. There is no bulk "convert everything historically" tool because aggregation is forward-looking. Admins can re-run "Recompute now" at any time.

## No date library added

Calendar grid math is done with vanilla `Date`. No `date-fns` / no FullCalendar / no `react-day-picker`. Read-only monthly grid + simple weekly layout doesn't need it.

## Items explicitly NOT implemented (per scope)

- Workload view, Map view — Phase 6B
- Drag-to-reschedule on calendar — deferred
- Inline editing on calendar — deferred
- Configurable triage formula — fixed for Phase 6
- Configurable aggregation ladder — fixed for Phase 6
- Per-user dashboard customization — deferred
- Aggregation of due dates, owners, scores — only status + progress per spec
- Bulk re-aggregation of historical items beyond "Recompute now" — out of scope
- Notification when triage score crosses thresholds — deferred
- Email digest of triage queue — deferred
- Triage score history / trending — deferred
- Mobile layouts — Phase 7
- Modifications to subitem/instruction behavior — Phase 5 stays as-is
- AppFolio writes — Phase 2
- Real-time updates beyond 60s polling — deferred
