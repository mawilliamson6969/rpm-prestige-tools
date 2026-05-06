# Agent Hub — Phase 1 (CRM Foundation) + Phase 2 (Pipeline)

> **Phase 2 is now built and deployed** alongside Phase 1. Phase 2 adds the
> referral pipeline, owners, properties, payments, monthly revenue tracking,
> a lightweight task system, and the agent lifetime value materialized view.
> Phase 2 sections are interleaved with Phase 1 below — read the whole file.

---

# Phase 1 — CRM Foundation

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

## Phase 1 open questions answered in Phase 2

- **Where does the referral cycle start?** Manually via the wizard at
  `/agent-hub/referrals/new` (or pre-filled with `?agent_id=N` from the
  agent detail page). No inbound channels yet — Phase 4.
- **Commission tracking?** Separate table: `agent_hub_referral_payments`
  + `agent_hub_revenue_tracking`. The denormalized
  `agent_hub_referrals.actual_referral_fee_paid` is a cached cumulative
  sum that gets recomputed by `recomputeReferralPaid()` on every
  payment write/edit/delete.

## Phase 1 still-open

- Retention policy for `agent_hub_audit_log` — still grows unbounded.
  Address before first compliance audit.
- VIP personal_details audit-on-READ — still write-only.

---

# Phase 2 — Referral Pipeline (built)

## Phase 2 scope (built)

- 7 new tables: `agent_hub_owners`, `agent_hub_properties`,
  `agent_hub_referrals`, `agent_hub_referral_stage_history`,
  `agent_hub_referral_payments`, `agent_hub_revenue_tracking`,
  `agent_hub_tasks`.
- 1 materialized view: `agent_hub_agent_lifetime_value` (refreshed
  nightly at 2:15 AM via cron, plus on-demand by writes).
- 9 new backend route files mounted under `/agent-hub/*`.
- Pipeline kanban with drag-drop stage advancement
  (`/agent-hub/pipeline`).
- 5-step new-referral wizard with localStorage state persistence
  (`/agent-hub/referrals/new`). Pre-fills `?agent_id=` when arriving
  from an agent detail page.
- Phase 1 dashboard + agent detail pages updated to wire in real
  pipeline + LTV cards (placeholders removed).
- Stage transition rules centralized in
  `backend/lib/agentHub/stages.js`. The DB CHECK constraint enforces
  the enum; the JS helper validates allowed transitions.

## Phase 2 scope (NOT built — stay out)

- **Automation engine.** The thank-you task created when a referral hits
  `tenant_placed` is a single SQL INSERT inside `advanceReferralStage`.
  It is NOT a generic trigger. Phase 3 will add a real automation engine.
- **Outbound sending.** No emails / SMS / postcards sent. The thank-you
  task lands on Mike's task queue for manual handling.
- **AppFolio sync.** `external_appfolio_id` and
  `external_appfolio_property_id` columns exist on owners + properties
  for future linking. Not queried in Phase 2.
- **Predictive analytics, "next likely referrer," birthday touchpoint
  automation.** Phase 3 territory.

## Stage transition rules

Source of truth: `backend/lib/agentHub/stages.js`. Enforced server-side
in `agentHubReferrals.js` via `assertValidTransition`.

```
lead_received      → owner_contacted | lost | declined
owner_contacted    → property_toured | lost | declined
property_toured    → agreement_pending | lost | declined
agreement_pending  → agreement_signed | lost | declined
agreement_signed   → tenant_placed | lost
tenant_placed      → active_management
active_management  → (terminal-completed; revenue tracking continues)
lost / declined    → (terminal; use restore endpoint to revert)
```

The `advance-stage` endpoint blocks moves to `lost`/`declined` — those
must use `mark-lost` / `mark-declined` (which require a reason).
Restore is manager+ only.

### Idempotency

- `advance-stage` to the SAME stage: returns 200 with `idempotent: true`,
  no duplicate stage_history row.
- `mark-lost` / `mark-declined` on already-terminal: same.
- The unique index `uq_agent_hub_stage_history_unique` on
  `(referral_id, to_stage, changed_at)` provides DB-level protection
  against double-inserts within the same second.

### Active uniqueness

Only ONE in-flight referral can exist per `(owner_id, property_id)` combo
at a time. Enforced by partial unique index
`uq_agent_hub_referrals_active`. `active_management` is excluded so
re-leases of the same property over time produce multiple completed
records (intentional).

## Side effects on stage advancement

Each transition fires specific side effects, all inside one transaction:

- **Any transition** writes a row to `agent_hub_referral_stage_history`
  with `duration_in_previous_stage` and logs an activity on the
  referring agent's timeline.
- **→ tenant_placed**: stamps `tenant_placed_at`, picks up
  `actual_monthly_rent` / `actual_management_fee_pct` if provided in the
  body, creates a system thank-you task assigned to Mike.
  Idempotent via `uq_agent_hub_tasks_system_thank_you`.
- **→ active_management**: stamps `active_management_started_at`,
  flips `agent_hub_properties.status = 'under_management'`, flips
  `agent_hub_owners.status = 'converted'` (unless already), refreshes
  the LTV materialized view (best-effort, async).

## Thank-you workflow (manual)

The thank-you action when a referral converts is a TASK, not an
auto-send. When you advance a referral to `tenant_placed`:

1. The advance handler creates a task with
   `source = 'system_referral_thank_you'` assigned to Mike (falls back
   to the user who triggered the advance if Mike's user row isn't
   found by username).
2. The task description includes the referring agent's name, the
   property address, and the referral ID.
3. Mike sees it in `/agent-hub/tasks` (default view = "my pending").
4. He sends the thank-you (gift / handwritten card / call) outside
   the system, then marks the task complete.

There is no auto-send and no Phase 2 helper to send. Phase 3 will
optionally add automation behind the same task creation.

## Revenue tracking workflow

Revenue is **manual entry** in Phase 2. Two paths:

- **One-off**: on the referral detail page, "Add month" button →
  `POST /agent-hub/referrals/:id/revenue`. Idempotent: re-adding the
  same month UPSERTs.
- **Bulk CSV import** (manager+):
  `POST /agent-hub/revenue/bulk-import` with CSV body. Required columns:
  `referral_id,month,rent_collected,management_fee_earned`. Optional:
  `notes`. The route reports per-row errors and counts. `month` must
  be `YYYY-MM-01` (first of month).

The use case: monthly batch entry from an AppFolio export or
spreadsheet. Phase 4 will wire this to AppFolio sync directly.

## Lifetime value (LTV)

Read from the materialized view `agent_hub_agent_lifetime_value`.
Reads NEVER compute LTV on the fly — always from the view.

Refresh paths (most frequent first):
- Inside `recordPayment`, `updatePayment`, `deletePayment`.
- Inside `addRevenue`, `updateRevenue`, `deleteRevenue`,
  `bulkImportRevenue`.
- Inside `advanceReferralStage` when transitioning to
  `active_management`.
- Manual: `POST /agent-hub/lifetime-value/refresh` (manager+).
- Nightly: cron at 2:15 AM via `refresh_agent_lifetime_value()`.

The refresh uses `REFRESH MATERIALIZED VIEW CONCURRENTLY` so reads
during refresh aren't blocked. CONCURRENTLY requires the unique index
`uq_agent_hub_ltv_agent_id`.

LTV columns include `total_referral_fees_paid`, `total_revenue_generated`,
and the simple `lifetime_relationship_value = revenue - fees`.
"Net relationship" is what the agent detail page shows in green/red.
Negative LTV = we paid more in fees than we've earned in management
revenue from their conversions yet. (Common early in the relationship —
fees are paid up-front, revenue trickles in monthly.)

## DNC firewall (still relevant in Phase 2)

`createReferral` rejects with 400 + `code: 'AGENT_DNC'` if the referring
agent has `do_not_contact = true`. Existing referrals continue normally.
This is consistent with the Phase 1 promise that DNC blocks new
outreach but doesn't terminate ongoing relationships.

## Permissions matrix (Phase 2 changes only)

| Action | Required |
|--------|----------|
| List/get owners, properties, referrals, payments, revenue, tasks | Hub access |
| Create owner | Hub access |
| Soft-delete owner / property (must have no active referrals) | Manager+ |
| Create referral | Hub access (DNC firewall applies to agent) |
| Advance / mark-lost / mark-declined | Hub access |
| Restore lost/declined referral | Manager+ |
| Record / update / delete payment | Manager+ for record + delete; creator OR manager+ for update |
| Add / update / delete revenue, bulk import | Manager+ |
| Create task (assigned to self) | Hub access |
| Create task (assigned to others) / reassign | Manager+ |
| Refresh LTV | Manager+ |

## Files added in Phase 2

```
backend/
  migrations/026_agent_hub_phase2.sql       # All Phase 2 DDL + materialized view
  lib/agentHubPhase2Schema.js                # ensureAgentHubPhase2Schema + refreshAgentLifetimeValue
  lib/agentHub/
    stages.js                                # Stage transition rules
  routes/
    agentHubOwners.js
    agentHubProperties.js
    agentHubReferrals.js                     # CRUD + advance-stage + mark-lost/declined + restore
    agentHubReferralPayments.js
    agentHubRevenue.js                       # CRUD + bulk CSV import
    agentHubTasks.js
    agentHubLifetimeValue.js                 # Read MV + manual refresh + leaderboard
    agentHubFinancials.js                    # Pipeline stats, summary, by-month, CSV export

frontend/
  lib/agentHub.ts                            # Extended with Phase 2 types + helpers
  app/(protected)/agent-hub/
    pipeline/page.tsx                        # Kanban with drag-drop
    pipeline/[id]/page.tsx                   # Referral detail with payment/revenue forms
    owners/page.tsx + [id]/page.tsx + new/page.tsx
    properties/page.tsx + [id]/page.tsx
    tasks/page.tsx
    financials/page.tsx                      # Stats + monthly chart + leaderboards
    referrals/new/page.tsx                   # 5-step wizard with localStorage persistence
```

## Adversarial-review remaining items (Phase 2)

[Filled in by /codex:adversarial-review run]

## Phase 3 backlog (don't sneak ahead)

- Automation engine (generic triggers + actions): birthday touchpoints,
  dormant-agent revival, "agent X has 3+ referrals this quarter" alerts.
- Email / SMS / postcard sending behind the same task-creation pattern.
- AppFolio sync to populate `agent_hub_owners.external_appfolio_id` and
  monthly revenue rows automatically.
- LinkedIn / HAR Matrix bulk import for new agents.
- Predictive: "agents most likely to refer next."
- Audit log retention policy + rollup.
