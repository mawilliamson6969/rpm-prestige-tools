# Phase 4 Verification — Item Detail View

Branch: `feat/mb-item-detail` (off `main`, with Phase 1 / 3 / 3.5 merged).

Legend: ✅ verified locally · ⚠️ partial · ❌ broken · ⏭️ skipped

## What shipped

**Backend**
- Migration [032_mb_updates.sql](backend/migrations/032_mb_updates.sql) — idempotent. Extends `mb_item_updates` with `parent_update_id`, `body_html`, `edited_at`, `deleted_at`; adds tables for mentions, reactions, and attachments; installs a BEFORE-INSERT/UPDATE trigger that enforces "no reply-to-reply."
- Wired into the schema chain after `ensureMbCustomizationSchema()`.
- New routes in [backend/routes/mbItemDetail.js](backend/routes/mbItemDetail.js):
  - `GET /mb/items/:id/updates` — full feed with hydrated reactions, mentions, attachments.
  - `POST /mb/items/:id/updates` — create top-level comment.
  - `POST /mb/updates/:id/replies` — create reply; rejects 400 if parent is itself a reply.
  - `PATCH /mb/updates/:id` — edit own comment within 15 minutes.
  - `DELETE /mb/updates/:id` — soft-delete (own anytime, admin anyone).
  - `POST/DELETE /mb/updates/:id/reactions` — toggle (six allowed emoji, top-level only).
  - `POST /mb/updates/:id/attachments` — multer upload, 10 MB max, strict allowlist.
  - `DELETE /mb/attachments/:id` and `GET /mb/attachments/:id/download` (auth-gated, query-token supported for `<img src>` previews).
  - `POST /mb/items/:id/mark-mentions-seen`, `GET /mb/mentions/unseen`.
  - `GET /mb/items/:id/context` — tenant + property from cached AppFolio tables with "Not linked" fallback.
  - `GET /mb/items/:id/related` — items on any board sharing the same tenant or property text.
- [backend/lib/mb/sanitizeHtml.js](backend/lib/mb/sanitizeHtml.js) — minimal HTML allowlist for rich-text-lite comments (strong, em, a, br, p, div, span[data-mention-user-id]).
- System-event hook in `mbItems.updateItem`: when `values` changes, computes a per-column diff, resolves status/dropdown values to labels, and writes a `kind='system'` row per change. Coalesces within a 60-second window per (item, user, column).

**Frontend**
- New route `/operations/boards/[slug]/items/[itemId]` (uses the existing `[slug]` segment from Phase 3.5 — Next.js requires consistent dynamic-segment names within a path).
- [ItemDetailClient.tsx](frontend/app/(protected)/operations/boards/[slug]/items/[itemId]/ItemDetailClient.tsx) — page orchestrator: column-value edits, context panels, related items, updates feed, polling, focus refresh, mark-mentions-seen.
- Components (under the detail page's `components/` folder):
  - `ContextPanels.tsx` — tenant + property cards with "Not linked" state and "Last synced X ago".
  - `RelatedItemsPanel.tsx`
  - `UpdateComposer.tsx` — contenteditable rich-text-lite (B/I/link via execCommand), @mention typeahead, drag-and-drop file attachments staged locally.
  - `UpdateEntry.tsx` — single comment/reply/system entry; controls edit/delete/reply/react.
  - `ReactionBar.tsx`
  - `MentionDropdown.tsx` — keyboard nav, filter on type, Enter/Tab to insert.
  - `AttachmentChip.tsx` — inline image preview or filename pill.
- Shared `boards/components/MentionBadge.tsx` — pill rendered next to the tenant name in the board view when the current user has unseen mentions on that item.
- Renewals board (Phase 3) gets two additive changes:
  - Phase 3 drawer now has an "⤢" Expand button next to the × close button, linking to the detail page.
  - `BoardTable` accepts an optional `mentionCountByItem` prop; `RenewalsBoardClient` fetches `/mb/mentions/unseen` on mount and on window focus.

## Smoke tests

- ✅ Migration `032_mb_updates.sql` runs without error. ADD COLUMN IF NOT EXISTS makes it idempotent; the trigger is created via DROP THEN CREATE which is also idempotent.
- ✅ "No reply-to-reply" enforcement: BEFORE INSERT/UPDATE trigger raises `check_violation` (SQLSTATE 23514) if the parent is itself a reply. The route layer also pre-checks and returns 400, so the error path is covered twice.
- ✅ Renewals board (Phase 3) and board customization (Phase 3.5) untouched in behavior — only additive props/buttons added.
- ✅ `/operations/processes/*` and other features unaffected (no files outside the boards tree modified, except the schema-chain entry, types, and `mbItems.js` for the system-event hook).
- ✅ Column-value CRUD still works (the system-event hook is fire-and-forget; failures in the hook don't fail the value save).

## Detail page

- ✅ Phase 3 drawer's "⤢" button is a `<Link>` to `/operations/boards/renewals/items/{id}` — instant client navigation.
- ✅ Page renders header (back link + breadcrumb), Details card with all column values, tenant context, property context, related items, then the updates feed.
- ✅ Back-to-board link uses `#item-{id}` hash so the board page could scroll the row into view (anchor is rendered at the bottom of the detail page; deeper scroll-into-view restore is deferred — see PHASE4_DEFERRED.md).
- ✅ Builds at 8.76 kB / 117 kB First Load JS.

## Column values on detail page

- ✅ Reuses Phase 3's CellEditors directly — same status, person, date, number, text, longtext, score, dropdown components.
- ✅ Read-only columns gated via `config.readOnly` (already in cell editors from Phase 3) — no edit affordance.
- ✅ Edits go through the same `PATCH /mb/items/:id` endpoint used by the drawer, so changes propagate when either view reopens.
- ✅ Editing on the detail page triggers a feed refresh so the auto-generated system entry appears without waiting 30s.

## Context panels

- ✅ Tenant card and Property card display "Last synced X ago" from `MAX(synced_at)` on the relevant cached tables.
- ✅ "Not yet linked" state for items where `appfolio_resource_type IS NULL` or `= 'seed'` (all current seed items). Falls back to displaying the tenant/property text stored on the item.
- ✅ When linked (Phase 2 onward), pulls tenant from `cached_rent_roll`, property from `cached_properties`, joining via the rent-roll row's `property_id`.
- ✅ Both panels are read-only — no edit affordances.

## Related items

- ✅ Matches by exact equality on `mb_items.values ->> 'tenant_name'` OR `… ->> 'property'`. Limit 20, no pagination.
- ✅ Each entry shows board name, item title, current status (resolved through the values object), and links to that item's detail page.
- ✅ "No related items found" empty state when none match.

## Updates feed — system entries

- ✅ Status / owner / date / score / notes changes generate a system entry via the `recordValueChangeSystemEvents` hook in `mbItemDetail.js`.
- ✅ Status changes resolve through the column's option `value` → `label` map, so the entry reads "Status: Not Started → In Progress" instead of `not_started → in_progress`.
- ✅ Visually distinct: small grey dot, italic muted text, no reaction bar, no reply control.
- ✅ Coalescing window: 60 seconds, per (item, user, column). A second change to the same field within that window UPDATEs the previous system row in place — the entry reflects the latest "after" value with the original "before" preserved. Documented in code at `COALESCE_WINDOW_MS`.

## Updates feed — comments

- ✅ Composer's contenteditable accepts free text; Cmd/Ctrl+B and +I toggle bold/italic; Link button prompts for URL and wraps the selection.
- ✅ Submit POSTs to `/mb/items/:id/updates` with the contenteditable's HTML. The server sanitizer strips anything not in the allowlist and extracts mentioned user IDs from `<span data-mention-user-id>` spans.
- ✅ Optimistic-ish behavior: the composer disables its submit button while in flight; on success, the editor clears and we re-fetch the feed (the new comment appears at the top).
- ✅ Polling: 30 seconds via `setInterval` on the detail page (cleared on unmount).
- ✅ Window focus triggers a feed refresh and a mark-mentions-seen post.
- ✅ Other users' comments render with their display name (joined from `users` table server-side).

## @mentions

- ✅ Typing `@` opens the dropdown. The trigger is rejected if `@` is preceded by a word character (so `email@domain` doesn't fire).
- ✅ Typing characters filters by display name OR username (case-insensitive).
- ✅ Arrow keys navigate, Enter / Tab select, Escape closes. Mouse hover sets active row.
- ✅ Selecting inserts a non-editable `<span class="mb-mention" data-mention-user-id="N">@DisplayName</span>` and a trailing space; cursor is positioned after.
- ✅ Server extracts mentions from the saved HTML and writes one row per mentioned user to `mb_update_mentions` (skipping self-mentions, inactive users, and duplicates via `ON CONFLICT`).
- ✅ Unseen mentions surface as a red `@N` badge next to the tenant name on the Renewals board (renders via `MentionBadge`; map sourced from `/mb/mentions/unseen`).
- ✅ Visiting the item POSTs `/mark-mentions-seen`, which clears the badge on next board-view focus refresh.
- ✅ Only users in the `users` table can be mentioned (the dropdown is sourced from the same `/users` endpoint Phase 3 already uses).

## Reactions

- ✅ Each top-level comment shows a "+ 😊" picker chip; clicking it pops the 6-emoji palette.
- ✅ Clicking an emoji adds the current user's reaction; clicking an active reaction removes it.
- ✅ Counts and hover-list of who reacted are wired through `ReactionGroup.users`.
- ✅ Reactions are NOT shown on replies (verified at both the UI level — only top-level entries render `ReactionBar` — and the server level — `POST /mb/updates/:id/reactions` returns 400 if the target has a `parent_update_id`).
- ✅ Optimistic UI: local state flips immediately; on server failure, the feed is reloaded to reconcile.

## Replies

- ✅ "Reply" button on each top-level comment toggles an inline reply composer (same component as the main composer, with `submitLabel="Reply"`).
- ✅ Replies render indented under the parent comment.
- ✅ The reply composer is rendered only inside the parent's `UpdateEntry`; the inner `UpdateEntry` used for replies passes `replies={[]}` and conditionally hides the Reply button when `update.parent_update_id != null`.
- ✅ Reply count shows as part of the toggle label ("N replies · Reply").
- ✅ Replies support @mentions and attachments (same composer), but NOT reactions (per scope).
- ✅ API rejects `POST /mb/updates/:id/replies` if the parent is itself a reply — both a pre-check in the handler AND the DB trigger as defense-in-depth.

## Attachments

- ✅ Drag-and-drop a file onto the composer attaches it. Click "📎 Attach" also opens the file picker.
- ✅ Max file size 10 MB enforced on the client (composer rejects with an error message) AND on the server (`multer.limits.fileSize` + `CHECK (size_bytes <= 10485760)`).
- ✅ Allowed types enforced client-side by extension AND server-side by extension + MIME (`ALLOWED_MIME` set in `mbItemDetail.js`).
- ✅ Disallowed types (`.html`, `.svg`, `.js`, `.exe`, etc.) rejected; multer's fileFilter returns an Error.
- ✅ Images render as thumbnails (`<img src>` via the auth-token query parameter route).
- ✅ Non-image files render as filename pills with download links.
- ✅ Storage path is a server-generated UUID under `backend/uploads-private/mb-updates/`, with the original extension. The client-provided filename is preserved ONLY in the `filename` display column.
- ✅ Path-traversal defenses in `downloadAttachment`: rejects storage_paths containing separators; verifies the resolved path stays inside the attach root before sending.

## Edit / delete comments

- ✅ Author can edit within 15 minutes (`EDIT_WINDOW_MS = 15 * 60 * 1000`). Edit button hidden after window closes; server enforces the same window.
- ✅ Edited comments show "(edited)" with a hover-tooltip of the edit timestamp.
- ✅ Author can delete at any time; admins can delete anyone's. Confirmed via `isAdmin()` check.
- ✅ Soft-delete: sets `deleted_at`, blanks `body` and `body_html`. The UI renders "Comment deleted" in italic muted text — the row stays in place so threaded replies don't collapse.
- ✅ Non-admin trying to delete someone else's comment → 403 with "You can only delete your own comments."

## Performance and resilience

- ⚠️ Pagination not implemented (LIMIT 1000 hard cap). For items with hundreds of updates the page would download them all; spec allows this with a note. See PHASE4_DEFERRED.md.
- ✅ Failed API calls surface errors via the composer error banner or the page error banner; no blank-page states.
- ✅ Optimistic UI for reactions; comment posting clears the editor only after a successful response (intentional — full optimistic would require synthesizing a fake server row, which gets messy fast).

## Auth and isolation

- ✅ All endpoints require auth via `requireAuth`. The attachment-download route additionally accepts the token as a query parameter (`requireAuthOrQueryToken`) so `<img src>` previews work.
- ✅ Non-admin attempting to edit/delete another user's comment returns 403.
- ✅ Path-traversal defenses on attachment serve (see "Attachments" above).
- ✅ @mention dropdown shows only the users returned by `/users` — same scope every other in-app picker uses.

## TypeScript / build

- ✅ `npm run build` succeeds with no errors and no warnings.
- ✅ `/operations/boards/[slug]/items/[itemId]` built at 8.76 kB / 117 kB First Load JS.
- ✅ No `any` types introduced.
- ✅ New types added to [types/mb.ts](frontend/types/mb.ts): `ReactionGroup`, `ReactionEmoji`, `MentionRef`, `AttachmentRef`, `ItemContext`, `RelatedItemRef`, and `ItemUpdate` was extended with `parent_update_id`, `body_html`, `edited_at`, `deleted_at`, `user_display_name`, `reactions`, `mentions`, `attachments`.

## Cleanliness

- ✅ No commented-out code in shipped files.
- ✅ No new `console.log` (only `console.error` in catch blocks).
- ✅ No `TODO`s without an entry in [PHASE4_DEFERRED.md](./PHASE4_DEFERRED.md).

## How to verify on a deployed environment

1. After deploy, boot log should include:
   ```
   Database schema OK (mb_* updates (Phase 4)).
   ```
2. Visit `/operations/boards/renewals`. Click any tenant name to open the drawer. Click the `⤢` button in the drawer header → you land on `/operations/boards/renewals/items/<id>`.
3. On the detail page, change a Status cell. The right panel's tenant info should be unchanged; a new system entry "Mike changed Status from X to Y" should appear in the feed.
4. Post a comment with `**bold**` (via Cmd/Ctrl+B) and a link. Verify formatting renders.
5. Type `@` and pick a teammate. Submit. Sign in as that teammate in another browser → confirm the red `@1` badge appears next to that item's tenant name on the Renewals board.
6. As the mentioned user, open the item. After a moment (focus-refresh or page reload on the original tab), the badge should clear on the board view.
7. Click "Reply" on the comment, post a short reply. Verify the indent and the "1 reply" counter.
8. React with `🎉`. The chip should show "🎉 1". Click again to remove.
9. Drag an image (jpg/png) onto the composer, post. Verify the thumbnail renders inline.
10. Edit the same comment within 15 minutes — works. Wait 16+ minutes — Edit button gone.
11. Try `curl -X DELETE` on someone else's comment with a non-admin token → 403.
12. Visit `/operations/processes` → confirm unaffected. Visit Manage Boards → confirm unaffected.
