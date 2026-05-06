# Agent Hub — Phase 1 (CRM Foundation)

The Agent Hub is the real-estate-agent referral CRM inside Prestige Dash.
Phase 1 ships the data model, permissions, audit trail, and manual UI
for managing agent relationships. **No automations, no inbound parsing,
no outreach, no referral pipeline yet** — those land in Phase 2+.

If you're picking this up to extend, read this file first.

## Phase 1 scope (built)

- 9 tables under `agent_hub_*`: brokerages, agents, personal_details,
  activities, tags, relationships, attachments, user_permissions, audit_log.
- CRUD routes mounted at `/agent-hub/*` (frontend), `/api/agent-hub/*` (browser).
- Hub-specific permission layer (`agent_hub_user_permissions`) that wraps
  the global JWT auth.
- Soft-delete agents (status='deleted'), idempotent merge, full-text +
  trigram search, dashboard cards, bulk ops, CSV export, audit log.
- Frontend pages under `/agent-hub`: dashboard, agents list, add, detail,
  brokerages, search, settings.

## Phase 1 NON-scope (intentionally deferred — do NOT build here)

- Referral pipeline, kanban, financial tracking → Phase 2
- Automation engine, sequences, drip campaigns → Phase 3
- Email/SMS/postcard sending → Phase 4
- HAR Matrix CSV upload, MLS sync, LinkedIn integration → Phase 4
- Inbound forms, email parsing → Phase 4
- Agent-facing portal (logged-in agent view) → Phase 5
- Lifetime-value calculations beyond the placeholder card → Phase 2

If a request says "wire this up to Microsoft Graph" or "auto-send a
postcard," it's out of Phase 1 scope. Ship the manual flow first.

## Files

```
backend/
  migrations/025_agent_hub.sql            # All DDL, indexes, triggers, seeds
  lib/agentHubSchema.js                    # ensureAgentHubSchema() applier
  lib/agentHub/
    permissions.js                         # requireAgentHubAccess + assertPermission
    audit.js                               # logAudit + logFieldDiff
    contactable.js                         # isContactable() — DNC firewall
    validators.js                          # vEmail, vPhone, vTier, etc.
    mappers.js                             # row → API response shape
    README.md                              # this file
  routes/agentHub*.js                      # 10 route files (one per resource)

frontend/
  lib/agentHub.ts                          # types + agentHubFetch + helpers
  app/(protected)/agent-hub/
    page.tsx                               # dashboard
    AgentHubGate.tsx                       # permissions gate (render-prop)
    components.tsx                         # shared: Avatar, TierBadge, Toast, etc.
    agentHub.module.css                    # all hub styling
    agents/page.tsx                        # list
    agents/new/page.tsx                    # add (quick + manual tabs)
    agents/[id]/page.tsx                   # detail (three-column)
    brokerages/page.tsx + [id]/page.tsx
    search/page.tsx
    settings/page.tsx
```

## How to add a new agent

Two paths, both gated by Hub access (any role):

1. **Manual form** — Settings → Agents → "+ Add agent" → "Full form" tab.
   Validates license number against existing records (license collision
   rejects with 409). Email / name+brokerage collisions return *warnings*
   in the response so the user can choose to proceed or jump to the dupe.

2. **Quick add** — Same modal, "Quick add" tab. Just full_name + brokerage
   (+ optional email/phone). Creates a stub at `tier='cold'`,
   `status='active'`. The detail page invites the user to enrich later.

Programmatic: `POST /agent-hub/agents` with at minimum `{ full_name }`.

## Permission model (read this before touching gates)

The Hub has its own permission layer ON TOP of the global JWT auth.
A user with valid login but no row in `agent_hub_user_permissions` has
**no Hub access** (the Gate component shows an "ask Mike or Lori" message).

Roles:

- `owner` — Mike. All flags on. Cannot have access revoked from the UI.
- `manager` — Lori. All flags except `can_merge` (owner-only by default).
- `team` — Amanda, Amelia. Read most things, log activities, no DNC, no tier change.
- `outreach` — (future role) restricted to `assigned_agent_ids` array.
- `read_only` — (future role) view-only.

Permission flags (orthogonal to role):

- `can_view_personal_details` — gate on `agent_hub_personal_details` table
  (spouse name, kids, etc.). Server-enforced; UI hides the card too.
- `can_change_tier` — required to set/change `tier` on any agent.
- `can_mark_dnc` — required to set `do_not_contact = true`. UN-marking
  also requires `manager` role on top.
- `can_export` — CSV export (writes to audit log with row count).
- `can_merge` — required for `POST /agent-hub/agents/:id/merge/:other_id`.

Server-side enforcement is in `routes/agentHub*.js` via `assertPermission`,
`assertManagerRole`, and `requireAgentHubAccess` middleware. The frontend
uses the same flags from `/agent-hub/permissions/me` for UX, but **never**
trusts the client.

VIP-tier personal_details have an extra rule: only `role='owner'` can see
them, not even managers. (Mike's request — VIP relationships are owner-only.)

## DNC firewall (most important rule for Phase 2+)

`do_not_contact = TRUE` is a one-way switch enforced at three levels:

1. **DB CHECK constraint:** `do_not_contact = FALSE OR status IN ('dnc','deleted')`.
   Cannot set DNC without a corresponding status.
2. **Route layer:** `applyDncCascade()` in `agentHubAgents.js` automatically
   sets `status = 'dnc'`, `unsubscribed_at = NOW()` on any save that toggles
   `do_not_contact = true`.
3. **`isContactable()` helper** in `lib/agentHub/contactable.js`. **EVERY**
   outreach added in Phase 2+ MUST call this before sending. The function
   returns `{ contactable: bool, reason: string }`. If `contactable=false`,
   the outreach must be aborted and logged.

The DNC check also rolls up to:
- `unsubscribed_at` — set automatically on DNC, cleared on un-DNC.
- channel-specific consent: `consent_to_email`, `consent_to_sms`. Required
  before Phase 2 sending even if `do_not_contact = false`.

When you wire up Phase 2 sending, the *only* approved entry point is
`isContactable(agent, channel)` returning `true`. No exceptions.

## How merge works

`POST /agent-hub/agents/:winner_id/merge/:loser_id` (requires `can_merge`):

1. Wraps in a transaction with row-level locks (`SELECT ... FOR UPDATE`).
2. Validates winner exists, isn't deleted, and loser isn't already merged
   into a different winner.
3. Re-points all loser's activities to winner.
4. Inserts loser's tags into winner (skipping dupes), then deletes from loser.
5. Re-points relationships to winner; deletes any self-relationships that
   result.
6. Inserts loser's personal_details into winner if winner has none (winner
   wins on conflict).
7. Marks loser with `merged_into_agent_id = winner`, `merged_at`, `merged_by`.
8. Writes two audit log rows (one for winner, one for loser).
9. Idempotent: re-running on an already-merged loser returns 200 OK.

The loser stays in the DB (we don't delete) so foreign keys from future
referral-history tables (Phase 2) keep pointing somewhere valid. The
unique index on `license_number` excludes merged records via partial
index, so the same license can be re-attached if needed.

## Personal details isolation

`agent_hub_personal_details` is a separate table on purpose. Two reasons:

1. **Permission gate.** `GET /agent-hub/agents/:id/personal` requires
   `can_view_personal_details`. The general `GET /agent-hub/agents/:id`
   does NOT join this table. If a route author later joins them by mistake,
   the audit log will show it (and code review should catch it).

2. **Future encryption.** When we add column-level encryption (Phase 4
   probably), it's localized to one table.

VIP tier adds a second layer: only `role='owner'` can see VIP personal_details
(`assertVipOwnerOnly()` in `routes/agentHubPersonalDetails.js`).

## Audit log

`agent_hub_audit_log` records every WRITE: create, update (per field),
delete, merge, bulk_update, export, permission_change. Written by `logAudit()`
and `logFieldDiff()` in `lib/agentHub/audit.js`.

**Audit is best-effort, not strict.** A write that fails the audit insert
still completes. We prefer a missing audit row over blocking legitimate
work. If you find audit gaps, they go in `console.error` with the
`[agent-hub] audit log write failed` prefix.

The audit log table is currently insert-only. Phase 2+ should add a
retention/rollup job — until then, plan for unbounded growth.

## DB schema notes

- All FKs to `users(id)` use `INTEGER` (not UUID) — matches existing
  schema (`automation_rules`, `sla_policies`, etc.).
- `tier` and `status` are independent: `tier` = relationship warmth;
  `status` = lifecycle state. Don't conflate. Bulk-DNC sets both;
  un-DNC requires manual status update.
- Soft-delete: agents use `status='deleted'`; activities use `deleted_at`;
  brokerages use `active=false`. Don't standardize them — each has
  reasons (agents need referential integrity for future referrals;
  activities need timestamp-based purge later; brokerages need an active
  flag for the current-active filter).
- Search: `tsvector` on agents (full_name, brokerage_name, email, license,
  notes) and on activities (subject, summary, body). Trigram index on
  `agents.full_name` for fuzzy matching. Both maintained by triggers,
  no app-side maintenance.
- `last_interaction_date` on agents is bumped by a trigger when a new
  activity is inserted. Don't update it from app code.

## Adding new fields

When adding a column to `agent_hub_agents`:

1. Add it to `migrations/025_agent_hub.sql` (or a new migration if 025
   has shipped to production — never edit applied migrations).
2. Add to the `ALLOWED_FIELDS` map in `routes/agentHubAgents.js` with
   the appropriate validator.
3. Add to `mapAgent()` in `lib/agentHub/mappers.js`.
4. Add to the `Agent` type in `frontend/lib/agentHub.ts`.
5. Add to the edit form in `frontend/app/(protected)/agent-hub/agents/[id]/page.tsx`.

If the field is sensitive (PII), put it in `agent_hub_personal_details`
instead, then update `routes/agentHubPersonalDetails.js`. Don't mix.

## Local development

The schema is applied at app boot via `ensureAgentHubSchema()` in
`backend/lib/agentHubSchema.js`. To apply manually:

```bash
psql $DATABASE_URL < backend/migrations/025_agent_hub.sql
```

The migration is idempotent. Re-running is safe and required when the
file is updated.

To seed permissions for a new team member:

```sql
-- Replace 'newuser' with the actual username from users.username
INSERT INTO agent_hub_user_permissions (user_id, role)
SELECT id, 'team' FROM users WHERE username = 'newuser'
ON CONFLICT (user_id) DO NOTHING;
```

## Tests

Phase 1 ships without a test suite — matches the rest of the codebase.
When/if we add tests, the highest-value targets are:

- Permission gates (server-side; never trust client).
- DNC propagation (toggling `do_not_contact = true` always cascades to
  `status` and `unsubscribed_at`).
- Merge idempotency (re-merge is a no-op).
- Personal details isolation (the general agent endpoint never returns
  spouse_name).
- Soft-delete preserving FK targets (referral history in Phase 2 will
  rely on this).

## Open questions for Phase 2

- Where does the referral cycle start — manually from the agent detail
  page, or via an inbound MLS hit? (Spec says manual-first.)
- Commission-tracking: separate table, or column on `referrals`?
- Retention policy for `agent_hub_audit_log` — keep forever, or roll
  up after 1 year?
- VIP personal_details access: should we audit-log every read, not just
  writes? (Currently we don't log reads of any kind.)
