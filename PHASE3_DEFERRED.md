# Phase 3 — Deferred / Out-of-spec notes

Items here were either deliberately deferred to a later phase or are judgement calls made during Phase 3 that a reviewer should sign off on.

## Schema additions used by the seed

Phase 1's spec said "Do not silently change schema." I added **two partial unique indexes** in the renewals seed migration (`030_mb_renewals_seed.sql`). I did NOT add columns to existing tables.

- `uq_mb_groups_board_name` — `UNIQUE (board_id, name)` on `mb_groups`. Needed so the seed can `ON CONFLICT DO NOTHING` against the "All Renewals" group. Reasonable invariant for boards going forward; if a future board legitimately needs duplicate group names, drop this index.
- `uq_mb_items_seed_appfolio` — `UNIQUE (appfolio_resource_type, appfolio_id) WHERE appfolio_resource_type = 'seed'`. Needed so the seed can `ON CONFLICT DO UPDATE` against the sample items without conflicting with real AppFolio rows (which use `appfolio_resource_type = 'lease'` etc. in Phase 2). The base schema already has a non-unique index on the same pair; I'm narrowing it to a unique partial index for the seed tag only.

Both are `CREATE … IF NOT EXISTS`. Neither modifies existing rows.

## `is_seed` flag was not added

The spec suggested adding `is_seed = true` "if the schema supports it." Phase 1's `mb_items` does not have an `is_seed` column. Per the spec's fallback, sample items are tagged via:

- `appfolio_resource_type = 'seed'`
- `appfolio_id = 'SAMPLE-<n>'`
- `title` prefixed with `SAMPLE — `

That makes them findable, listable, and deletable as a set without a schema addition.

## Lease End Date is read-only in this phase

The renewal countdown bucket is computed from `lease_end_date`, which is sourced from AppFolio. To match Phase 1's contract (AppFolio is read-only until Phase 2), the Lease End Date column is marked `config.readOnly = true` and cannot be edited from the table or the drawer.

This means the verification step "an item's group updates if its Lease End Date changes" is not directly demonstrable through the UI. The bucket-recomputation logic itself is exercised on every render (`bucketForItem(item)` in `RenewalsBoardClient.tsx`), so changing the DB value and refreshing puts the item in the new group.

If a reviewer wants a demonstrable test, the fastest path is to UPDATE the DB directly:
```sql
UPDATE mb_items SET values = values || '{"lease_end_date": "2026-05-25"}'::jsonb
  WHERE appfolio_id = 'SAMPLE-3';
```
Then reload the page — the item moves to the "Due in 0–30 days" group.

## Subitem migration / templates

`mb_subitem_templates` and `mb_subitems` are untouched in this phase. The seed does not create renewal subitem templates (e.g., "Send renewal offer", "Run RentCast comp", "Confirm renewal terms"). That work belongs in Phase 4 (subitems + instructions).

## Sort by computed countdown

The sort toolbar sorts within the visible buckets, not across them. Sorting by `lease_end_date` sorts items *within* each bucket by date. There is no UI to switch from "group by countdown" to "flat list sorted by countdown." That's a Phase 6 concern (Calendar / Timeline views) and would be redundant in the table view.

## Empty groups

The "Due in 0–30 days" bucket is always rendered (even when empty) so users notice it exists; other buckets only render when they have items. That's a small UX call — if a reviewer prefers all five buckets always visible (including when empty) or only the buckets with items (including 0–30), it's a one-line change in `RenewalsBoardClient.tsx`.

## Things explicitly NOT done (per scope)

- Board customization UI (create/rename/delete boards, columns, groups) — Phase 3.5
- Workspaces / spaces / folders — Phase 3.5
- Other board types (Maintenance, Turnover, Onboarding, Leasing) — Phase 3.6
- Kanban / Calendar / Timeline / Workload / Map views — Phase 6
- Full item detail page with subitems, instructions, updates feed — Phase 4 & 5
- Migration from LeadSimple-style process boards — Phase 8
- Any modification to Phase 1's existing `/mb/*` routes
- AppFolio writes of any kind
- Inline editing of the item's title or description (column values only, per scope)
