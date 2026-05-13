# Phase 4 — Deferred / Out-of-spec notes

## Schema convention reconciliation

The Phase 4 spec proposed creating a new `mb_updates` table with UUID PKs. Phase 1 already shipped `mb_item_updates` with SERIAL PKs and INTEGER FKs to `users(id)` — the standing codebase convention. We **extended the existing table** instead of creating a parallel one. All new tables (`mb_update_mentions`, `mb_update_reactions`, `mb_update_attachments`) follow SERIAL/INTEGER. The `kind` field is mapped to Phase 1's existing `update_type` column (which already accepted `comment`, `status_change`, `system`, `appfolio_sync`).

## Slug name reconciliation

The spec asked for the route `/operations/boards/[boardSlug]/items/[itemId]`. Phase 3.5 had already created `/operations/boards/[slug]/` for the generic board page. Next.js rejects different dynamic-segment names within the same path (`boardSlug !== slug`), so we use `[slug]` everywhere. The internal prop name on the client stays `boardSlug` for clarity — it's just the route param that has to match.

## No rich-text editor library — contenteditable instead

Spec authorized adding Lexical or TipTap only if not already present. Neither is in `package.json`. Per spec, we built a minimal contenteditable using:
- `document.execCommand("bold")` / `("italic")` — deprecated but works in every supported browser, and a few KB instead of 50KB+.
- `document.execCommand("createLink")` after a `prompt()` for the URL.
- A custom @mention typeahead.

What we don't get:
- Undo/redo beyond the browser default.
- Markdown shortcuts (`**bold**`, `_italic_`).
- Code blocks, headings, blockquotes, lists.

If reviewers want any of those, the upgrade path is to swap `UpdateComposer.tsx` for a TipTap or Lexical implementation. The server-side sanitizer's allowlist would have to grow accordingly, and `body_html` would have to be re-sanitized server-side regardless of what the client sends.

## Updates feed pagination not implemented

Spec said "Use pagination if performance becomes an issue. If items don't accumulate that many updates, skip pagination — note in PHASE4_DEFERRED.md." We list up to 1000 updates per item in one fetch. Given Renewals items will accumulate maybe a few dozen updates each over their lifetime (lease cycles), pagination is genuinely YAGNI for now.

When this stops being true:
- Backend: replace the single SELECT with a top-level cursor query (`WHERE created_at < $cursor LIMIT 50`) and a separate "replies by parent ids" query.
- Frontend: add an "Older comments" button at the bottom of the feed.

## No real-time / websocket updates

Polling every 30 seconds + a refresh on window focus per spec. No sockets, no SSE.

## "Back to board" scroll-into-view is partial

We add an anchor (`<span id={`item-${id}`} />`) on the detail page and the back link uses `/operations/boards/<slug>#item-<id>`. The board page does NOT currently programmatically scroll the row into view or expand the group containing it. If reviewers want this, the board page would need to:
1. Parse `location.hash` on mount.
2. Find the item, expand its bucket if collapsed.
3. `scrollIntoView` the row.

Estimated 30 minutes; intentionally deferred to keep this PR tight.

## AppFolio context — "real-data" branch is theoretical

All current items (Renewals seed) are tagged `appfolio_resource_type = 'seed'`, so the context API returns the "Not yet linked" branch for every item right now. The "linked" branch (joining `cached_rent_roll` + `cached_properties`) is coded but exercised only by data that arrives via Phase 2's AppFolio sync (not yet running). Field name assumptions inside the linked branch (`d.tenant`, `d.lease_from`, `p.address`, `p.owner_name`, etc.) are based on standard AppFolio API field names — if real responses differ, the panel will show empty fields, not break.

## Email / push notifications for @mentions — deferred

Per spec. The schema records `seen_at` so we know what's unread; surfacing those out-of-app is a separate phase.

## In-app notification center / bell icon — deferred

Per spec. We expose `GET /mb/mentions/unseen` which is enough for the Renewals badge, but there's no "Notifications" page yet.

## File serving via local filesystem, not object storage

Per spec. Files live in `backend/uploads-private/mb-updates/` on the API container. This is fine for dozens-of-files-per-week traffic; will need to move to S3/equivalent if attachment volume grows significantly OR if multiple backend replicas need shared storage. The download route is already auth-gated, so the storage swap is a one-file change.

## `mbUpdates.js` is now a legacy file

Phase 1's `backend/routes/mbUpdates.js` (the simple list/create on `mb_item_updates`) is kept as-is, but the public routes (`/mb/items/:id/updates` and the POST) are rerouted to the new Phase 4 handlers in `mbItemDetail.js`. The old handlers are kept reachable under `*/updates-legacy` purely as a fallback in case external integrations were hitting them; if nothing breaks after a deploy or two, those aliases can be dropped.

## Items explicitly NOT implemented (per scope)

- Subitems / nested items — Phase 5
- Embedded SOPs / instructions — Phase 5
- Score breakdown panel — deferred
- Email notifications — deferred
- Notification center — deferred
- S3 / object storage — deferred
- Reply nesting beyond one level — explicitly blocked at UI, API, and DB
- Reactions on replies — explicitly blocked at UI and API
- Comment search/filter/pagination — deferred
- Edit window beyond 15 minutes — by design
- @mentions in column values — deferred (only feed comments)
- Real-time updates — deferred
- Score calculation — Phase 6+
- AppFolio writes — Phase 2
