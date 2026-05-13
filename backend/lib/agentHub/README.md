# Agent Hub — Phase 1 (CRM Foundation) + Phase 2 (Pipeline) + Phase 3 (Automation Engine) + Phase 4 (Intelligence Layer)

> **Phase 4 is now built and deployed**. Phase 4 turns accumulated data into
> insights: a daily-recomputed engagement score (5 transparent components),
> 6 predictive heuristic flags, cohort analysis with parameterized
> definitions, and a Houston rental-market-data table for partner-facing
> reports. No machine learning — every threshold is a constant in
> `lib/agentHub/intelligence/scoring.js`.

> **Phase 3 is now built and deployed** alongside Phases 1 + 2. Phase 3 adds
> the automation engine: time- and event-based triggers, an action queue
> with approval gating, the compliance layer (canSendTo + DNC + rate limits
> + kill switch + unsubscribe), Microsoft Graph email + OpenPhone SMS
> integration, the manual postcard print queue, reply detection, and
> 5 starter automations + 10 templates.

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

---

# Phase 3 — Automation Engine (built)

## Phase 3 scope (built)

- **9 new tables**: `agent_hub_automations`, `agent_hub_automation_runs`,
  `agent_hub_automation_action_queue`, `agent_hub_message_templates`,
  `agent_hub_send_log`, `agent_hub_postcard_print_queue`,
  `agent_hub_unsubscribe_tokens`, `agent_hub_dnc`,
  `agent_hub_system_config`. Plus two new columns on `agent_hub_agents`
  (`personal_outreach_flag`, `personal_outreach_flagged_at`).
- **5 starter automations** seeded `is_system=true`, `enabled=false`:
  birthday_touchpoint, new_partner_onboarding, dormant_re_engagement,
  post_conversion_thank_you, quarterly_market_update.
- **10 starter templates** seeded `is_system=true`. Email templates
  enforce `{{unsubscribe_link}}` + `{{physical_address}}` (CAN-SPAM)
  via DB CHECK constraint AND app-layer validateTemplate().
- **5 engine workers**:
  - `evaluateTriggers` — every 15 min — scans time-based automations
    and creates eligible runs. Idempotent via `uq_agent_hub_runs_daily`.
  - `executeActions` — every 5 min — drains the action queue.
    Locks rows with `FOR UPDATE SKIP LOCKED` so concurrent crons
    can't double-send.
  - `reapApprovalWindow` — hourly — cancels expired pending_approval runs.
  - `detectReplies` — every 15 min — polls Microsoft Graph for replies
    and pauses outreach on the matching agent.
  - `emitEvent` — inline — fires from referral stage changes + agent
    tier/status changes. Idempotent via `uq_agent_hub_runs_event`.
- **Compliance layer** in `lib/agentHub/compliance.js`:
  - `canSendTo(agent, channel)` — single source of truth. Checks (in order):
    kill switch, do_not_contact, status, channel-specific consent,
    presence of email/phone/address, `agent_hub_dnc` table,
    `personal_outreach_flag`, rate limits.
  - `validateTemplate({ channel, subject, body, body_html })` — rejects
    email templates without `{{unsubscribe_link}}` + `{{physical_address}}`.
  - `processUnsubscribe(token)` — marks agent DNC across all channels,
    cancels in-flight automations.
- **Send adapters** in `lib/agentHub/sendChannels.js`:
  - `sendEmail` — Microsoft Graph `/sendMail`. Mints a deterministic
    `x-agent-hub-message-id` header so the reply detector can match.
  - `sendSms` — OpenPhone `/messages`.
  - `queuePostcard` — inserts into `agent_hub_postcard_print_queue`
    with mailing-address snapshot. Lori marks mailed manually.
- **Frontend pages**: approval-queue, automations (list + detail),
  templates (list + detail with preview + test-send), print-queue,
  send-log, replies, system-config, plus updates to the main dashboard
  (kill-switch banner + 4 new stat cards).

## Phase 3 NON-scope (intentionally deferred — do NOT build here)

- HAR Matrix CSV upload, LinkedIn import (Phase 5)
- Lob.com integration (postcards stay in manual print queue)
- Inbound forms / public referral form (Phase 5)
- Agent portal (Phase 6)
- Predictive analytics (Phase 4)
- Market data automated fetching (Phase 4)

## How to safely launch automations

1. Owner visits `/agent-hub/system-config` and fills in:
   sender email + name, physical address (CAN-SPAM), referral fee
   offer text, rate limits.
2. Owner clicks each starter automation in `/agent-hub/automations` and
   uses the **Simulate** button to see who would fire — no actual sends.
3. Owner sends a **test send** of at least one template from
   `/agent-hub/templates/:id` (uses real Graph/OpenPhone but with
   a `[TEST]` subject prefix).
4. Owner tests the **kill switch** (engage on system-config; verify
   no sends fire; release).
5. Owner clicks **Mark launch checklist complete** on the system-config
   page. Until this is done, the engine refuses to flip any automation
   to `enabled=true`.
6. Owner enables one automation at a time. Each one starts with
   `requires_approval=true` so every run waits in the approval queue.
7. After 2-3 weeks of clean runs, owner can flip individual automations
   to `requires_approval=false` for auto-send.

## Compliance gates (read before adding any new send path)

EVERY send call MUST go through `canSendTo(agent, channel)`. The
compliance check enforces, in order:

1. Kill switch → defer (resume when released)
2. `agent.do_not_contact` → permanent skip
3. `agent.status` ∈ {dnc, deleted} → permanent skip
4. Channel consent: `consent_to_email` for email, `consent_to_sms` for SMS
5. Presence: email/phone/mailing address as the channel needs
6. `agent_hub_dnc` table — email/phone/agent-level
7. `personal_outreach_flag` (set by reply detector)
8. Rate limit (per-hour + per-day from `agent_hub_system_config`) → defer

If `allowed=false, defer=true`: caller (action executor) reschedules
the action for an hour later. If `allowed=false, defer=false`: caller
marks the action `status='skipped'` with the reason logged.

## Reply handling flow

1. `detectReplies()` runs every 15 min, polling the latest 50 messages
   in the configured sender mailbox via Microsoft Graph.
2. Match by `In-Reply-To` header or our custom `x-agent-hub-message-id`
   header against `agent_hub_send_log.external_id`.
3. On match: update `send_log.replied_at`, cancel any in-flight
   automation runs for the agent, set
   `agent.personal_outreach_flag = TRUE`, log activity.
4. The reply surfaces in `/agent-hub/replies` for Mike or Lori to
   handle personally.
5. After Mike responds personally outside the system, he clicks
   "Mark handled" which clears `personal_outreach_flag` so future
   automations can resume.

## Kill switch usage

- **Owner only.** Visit `/agent-hub/system-config`, click "Engage kill
  switch" with a reason.
- Effect: instantaneous halt of all automation sends. The trigger
  evaluator returns early. The action executor returns early. Email,
  SMS, and postcard sends all check `kill_switch_enabled` before
  transmitting.
- Pending action queue rows are NOT cancelled — they're paused. When
  the switch is released, the action executor picks up where it left off.
- The 30-second config cache means it can take up to 30s for a kill
  switch engagement to fully propagate. For emergency use, call
  `invalidateSystemConfigCache()` from a debugger if you can't wait.

## Writing a custom automation

1. POST `/agent-hub/automations` with name, slug, trigger_type,
   trigger_config, conditions, actions, cooldown.
2. Visit the detail page and click **Simulate** to verify the right
   agents would fire.
3. If conditions/actions look right, enable it (requires launch
   checklist complete).
4. Initial runs land in the approval queue. Approve one and watch
   what happens via `/agent-hub/automation-runs/:id`.

## Writing a custom template

1. POST `/agent-hub/templates` with slug, channel, subject (email
   only), body, optional body_html.
2. **Email validation** rejects save if `{{unsubscribe_link}}` or
   `{{physical_address}}` are missing.
3. Visit the detail page and click **Preview** with an agent_id to
   see the rendered output. Missing merge fields are flagged.
4. Click **Test send** to send to your own email/phone with a
   `[TEST]` prefix.

## Files added in Phase 3

```
backend/
  migrations/027_agent_hub_phase3.sql
  lib/agentHubPhase3Schema.js
  lib/agentHub/
    compliance.js                       # canSendTo + validateTemplate + renderTemplate + unsubscribe
    engine.js                           # 5 workers + run creation + condition eval
    sendChannels.js                     # Graph + OpenPhone + postcard queue adapters
  routes/
    agentHubAutomations.js              # CRUD + simulate + manual trigger
    agentHubAutomationRuns.js           # runs + approval queue
    agentHubTemplates.js                # CRUD + preview + test-send
    agentHubSendLog.js                  # send log + replies queue
    agentHubPostcardQueue.js            # Lori's manual fulfillment UI
    agentHubAdHoc.js                    # send from agent detail page
    agentHubSystemConfig.js             # config + kill switch + launch checklist + public unsubscribe

frontend/app/(protected)/agent-hub/
  approval-queue/page.tsx
  automations/page.tsx + [id]/page.tsx
  templates/page.tsx + [id]/page.tsx
  print-queue/page.tsx
  send-log/page.tsx
  replies/page.tsx
  system-config/page.tsx
```

## Adversarial-review remaining items (Phase 3)

[Filled in by /codex:adversarial-review run]

---

# Phase 4 — Intelligence layer (built)

## Phase 4 scope (built)

- **6 new tables**: `agent_hub_agent_engagement_scores`,
  `agent_hub_engagement_score_history`, `agent_hub_predictive_flags`,
  `agent_hub_market_intelligence`, `agent_hub_cohorts`,
  `agent_hub_intelligence_calculations_log`.
- **4 new daily cron workers**:
  - 3:00 AM — `recomputeAllEngagementScores`
  - 3:30 AM — `refreshAllPredictiveFlags`
  - 4:00 AM — `refreshCohorts` + `maintainQuarterlyCohorts`
  - 5:00 AM — `archiveAndPruneScoreHistory`
- **Engagement scoring**: 5 components (recency, frequency, two-way,
  referrals, financial impact) summed to 0-100. Algorithm in
  `lib/agentHub/intelligence/scoring.js` — single source of truth,
  every threshold a named constant with rationale.
- **Predictive flags**: 6 heuristic rules in
  `lib/agentHub/intelligence/flags.js`. Lifecycle handles
  resolve-on-condition-no-longer-holds, dismiss-with-90d-snooze,
  and idempotent re-evaluation.
- **Cohorts**: auto-generated quarterly cohorts going back 2 years.
  Custom cohorts user-creatable via JSONB definition. The cohort
  evaluator uses a strict whitelist of allowed keys and parameterizes
  every value — NO string-concat SQL.
- **Market intelligence**: manual zip × month CRUD + bulk CSV import.
  Multi-line quoted CSV + UTF-8 BOM handling.
- **Intelligence routes**: scoring, flags, leaderboard (5 metrics),
  health-by-tier, attention queue, funnel, score-distribution,
  tier-movement, referral-velocity.
- **Phase 3 integration**: `engine.js buildAgentEvalRow` now exposes
  `engagement_score`, `tier_recommendation`,
  `tier_recommendation_changed`, and `has_active_flag_<type>` to
  automation conditions. An automation rule can now fire on
  `{ field: "has_active_flag_likely_referrer", op: "eq", value: true }`.
- **Frontend pages**: `/agent-hub/insights` (daily home),
  `/agent-hub/leaderboard` (5 ranking tabs),
  `/agent-hub/cohorts` + detail + new + comparison stub,
  `/agent-hub/market` (CRUD + CSV import). Agent detail page gets an
  Engagement Score card with sparkline trend + explanation breakdown.
  Main dashboard gets attention-queue / tier-rec / scores-rising cards.

## Phase 4 NON-scope (deferred to Phase 5+)

- **Machine learning models** — heuristics only.
- **Automated MLS/AppFolio market data fetch** — manual entry only.
- **Real-time score recalc** on every event — daily batch is fine.
- **Agent-facing portal exposure** of scores/flags.
- **Predictive lifetime value** — current LTV from MV is enough.
- **A/B testing infrastructure** for templates.

## Engagement scoring algorithm (the math)

Five transparent components, summed to a 0-100 score. Defined as
named constants in `lib/agentHub/intelligence/scoring.js`:

```
COMPONENT 1: Recency (0-25)
  ≤7 d: 25  ≤30: 23  ≤60: 20  ≤90: 15  ≤180: 10  ≤365: 5  else 0

COMPONENT 2: Frequency (0-20)
  Distinct activities in last 90 d:
  0: 0  1: 5  2-3: 10  4-6: 15  7+: 20

COMPONENT 3: Two-way engagement (0-15)
  Days since last reply (any inbound activity OR send_log.replied_at):
  ≤30: 15  ≤90: 12  ≤180: 8  any reply ever: 5  none: 0

COMPONENT 4: Referrals (0-25)
  Lifetime count base: 0:0  1:8  2-3:14  4-6:19  7+:22
  Plus recency bonus: last <90d +3, last <180d +1. Cap 25.

COMPONENT 5: Financial impact (0-15)
  Total revenue from agent_hub_agent_lifetime_value:
  ≥$50K: 15  ≥$15K: 12  ≥$5K: 8  >$0: 4  0/null: 0

TIER RECOMMENDATION (post-score):
  90+ AND existing partner+ → vip
  70+ OR 3+ converted+consent → partner
  40+ → warm
  20+ AND any inbound → prospect
  <20 AND >180 d ago AND no interactions → dormant
  else → cold
```

**Edge cases (verified):**
- Brand-new agent, no data: all components 0 → score 0, no error.
- Referrals but no replies: component 3 = 0, others computed.
- Replies but no referrals: component 4 = 0, others computed.
- NULL last_interaction_date: component 1 = 0.

## Predictive flag rules

Each flag is a deterministic boolean function in
`lib/agentHub/intelligence/flags.js`. Rules fire daily; conditions
must hold continuously for the flag to remain active.

| Flag | Severity | Rule summary |
|---|---|---|
| `likely_referrer` | action | warm/partner, ≥2 referrals, days since last is within ±30% of personal avg interval, score ≥50 |
| `dormancy_risk` | watch | warm/partner/vip, last interaction 75-110 d ago, no pending automation, score dropped 5+ points in 14 d |
| `tier_upgrade_candidate` | info | recommendation higher than current tier, consistent for 14+ d |
| `tier_downgrade_candidate` | info | recommendation = cold/dormant, current = warm/partner/vip, consistent for 30+ d |
| `re_engagement_candidate` | action | tier=dormant, score rose 10+ points in last 30 d |
| `vip_consideration` | info | tier=partner, ≥5 converted referrals, ≥$50K revenue, last interaction <60 d |

**Lifecycle:**
1. Condition first holds → INSERT with status active.
2. Condition still holds on next refresh → UPDATE last_seen_at + reasoning.
3. Condition no longer holds → resolved_at = NOW, resolution_reason auto-filled.
4. Manually dismissed → dismissed_at + dismissed_reason + snooze_until = NOW + 90d.
5. Snoozed flag whose condition still holds is NOT recreated until snooze expires.

The partial unique index `uq_agent_hub_flags_active` enforces "one
active flag of each type per agent." Resolved/dismissed flags don't
count.

## Cohort framework (and why it's SQL-injection-safe)

A cohort is a JSONB definition stored in `agent_hub_cohorts`. The
evaluator in `lib/agentHub/intelligence/cohorts.js` translates the
JSONB to a parameterized WHERE clause with a strict key whitelist:

| Key | Validation |
|---|---|
| `added_after`, `added_before` | ISO date string `YYYY-MM-DD` |
| `tiers` | array, filtered against the tier enum |
| `sources` | array, filtered against the source enum |
| `target_zips` | array, regex-validated as `^\d{5}(-\d{4})?$` |
| `brokerage_ids` | array, coerced to integer, filtered for n>0 |
| `tags` | array of strings, max 64 chars each |

Every value flows through `$N` placeholders. Unknown keys are
silently dropped. The output `whereClause` contains only literal
operators and column names — never user-provided strings.

System cohorts are auto-generated quarterly cohorts going back 2
years and forward 1 quarter. `maintainQuarterlyCohorts` runs nightly
and adds the next-upcoming-quarter cohort if it doesn't exist.

## Phase 3 + Phase 4 integration (automation conditions)

`engine.buildAgentEvalRow` now joins the latest engagement score and
exposes:
- `engagement_score` (number 0-100)
- `tier_recommendation` (string)
- `tier_recommendation_changed` (boolean)
- `has_active_flag_likely_referrer` (boolean)
- `has_active_flag_dormancy_risk` (boolean)
- `has_active_flag_tier_upgrade_candidate` (boolean)
- `has_active_flag_tier_downgrade_candidate` (boolean)
- `has_active_flag_re_engagement_candidate` (boolean)
- `has_active_flag_vip_consideration` (boolean)

Example automation condition:
```json
[
  { "field": "tier", "op": "in", "value": ["warm", "partner"] },
  { "field": "engagement_score", "op": "gt", "value": 50 },
  { "field": "has_active_flag_likely_referrer", "op": "eq", "value": true }
]
```

A future Phase 5 will let automation creation flow through this from
the `/agent-hub/automations/:id` UI form (Phase 4 ships the backend
support; the conditions builder UI extension is a small follow-up).

## Data retention

| Table | Retention |
|---|---|
| `agent_hub_agent_engagement_scores` | 90 days (older archived to history) |
| `agent_hub_engagement_score_history` | 365 days |
| `agent_hub_predictive_flags` | forever (resolved/dismissed kept for audit) |
| `agent_hub_intelligence_calculations_log` | 60 days |

The 5:00 AM `archiveAndPruneScoreHistory` job enforces all four.

## Files added in Phase 4

```
backend/
  migrations/028_agent_hub_phase4.sql
  lib/agentHubPhase4Schema.js
  lib/agentHub/intelligence/
    scoring.js                     # Single source of truth for engagement score
    flags.js                       # 6 flag-evaluation rules
    cohorts.js                     # Cohort SQL builder + metric refresh
    jobs.js                        # 4 cron jobs
  routes/
    agentHubIntelligence.js        # scores + flags + leaderboard + health + funnel + trends
    agentHubCohorts.js             # cohort CRUD + compare
    agentHubMarket.js              # market data CRUD + bulk CSV import

frontend/app/(protected)/agent-hub/
  insights/page.tsx                # The daily home view
  leaderboard/page.tsx             # 5 ranking tabs
  cohorts/page.tsx + [id]/page.tsx + new/page.tsx
  market/page.tsx                  # CRUD + CSV import
```

Plus updates to: `agent-hub/page.tsx` (4 new dashboard cards),
`agent-hub/agents/[id]/page.tsx` (Engagement Score card +
sparkline + Active Flags), `lib/agentHub.ts` (Phase 4 types),
`components/Sidebar.tsx` (4 new sub-links), `engine.js`
(`buildAgentEvalRow` extended).

## Adversarial-review remaining items (Phase 4)

[Filled in by /codex:adversarial-review run]

## Phase 5 backlog (don't sneak ahead)

- Automation engine (generic triggers + actions): birthday touchpoints,
  dormant-agent revival, "agent X has 3+ referrals this quarter" alerts.
- Email / SMS / postcard sending behind the same task-creation pattern.
- AppFolio sync to populate `agent_hub_owners.external_appfolio_id` and
  monthly revenue rows automatically.
- LinkedIn / HAR Matrix bulk import for new agents.
- Predictive: "agents most likely to refer next."
- Audit log retention policy + rollup.
