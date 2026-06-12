# Spec: AppFolio Database API client for Prestige Dash (Phase 1)

**Status:** Implemented and verified live on the VPS (2026-06-09).
**Implementation:** `backend/services/appfolio-db-api.js`, proof-of-life `backend/scripts/test-appfolio-db-api.js`.

> Revision 2026-06-09 (Phase 1.1): the legacy `backend/lib/appfolio-db/`
> class-based client (May substrate) is retired — this service is the only
> Database API client. Sections 1 and 3 amended: `APPFOLIO_DB_BASE_URL`
> (optional override, validated https + *.appfolio.com; sandbox
> `https://practicerpmtx033.appfolio.com/api/v0`) and `APPFOLIO_DB_DRY_RUN`
> (write gate — GETs normal, POST/PATCH/DELETE logged and skipped, returns
> `{ dryRun: true }`; default false) now apply to this client.
>
> Revision 2026-06-09: section 4 originally specified a token-bucket limiter
> (start at 7 tokens, refill 7/sec). Implementation review showed that shape
> allows ~13 requests inside the first rolling second (initial burst plus
> accrued refill), which exceeds AppFolio's hard 8/sec cap and would draw
> 429s — violating acceptance criterion 4. The spec now describes the
> sliding-window mechanism that shipped. Deviation approved by Mike.

## Goal

Build a single Express service file, `backend/services/appfolio-db-api.js`,
that wraps the AppFolio Database API with authentication, rate limiting, and
retry logic. Prove it works with one read endpoint. Do not build features,
tables, webhooks, or UI in this phase.

## Context

- Existing platform: Next.js + Express + PostgreSQL + Docker on Linode VPS.
- Existing AppFolio integration: Reports API v2 (read-only, 4-hour syncs) in
  `backend/lib/appfolio.js`. Untouched — both APIs coexist with separate
  credentials.

## Hard requirements

### 1. Credentials and environment

Three env vars, documented in `.env.example`, read from `process.env`:

```
APPFOLIO_DB_CLIENT_ID=
APPFOLIO_DB_CLIENT_SECRET=
APPFOLIO_DB_DEVELOPER_ID=
```

Never commit values, never store the secret in the database, never log the
secret. Fail loudly with a clear error naming the missing var(s).
(Implementation note: the check runs lazily on first request rather than at
module load, so importing the service before credentials are provisioned
cannot crash app boot. The base64 encoding is computed once and cached.)

Optional (Phase 1.1):

- `APPFOLIO_DB_BASE_URL` — override the production base URL (see section 3).
- `APPFOLIO_DB_DRY_RUN=true` — write gate: GETs run normally;
  POST/PATCH/DELETE are not sent. The skipped write is logged (method,
  path, payload summary — key names and size, never values) and a
  structured `{ dryRun: true, method, path }` is returned. Default false.
  Recommended wherever write features are under test.
- `APPFOLIO_DB_DEBUG=true` — emits one debug line per request
  (method, path, status, latency — never bodies, never secrets).

### 2. Authentication

HTTP Basic Auth plus a custom header on every request:

- `Authorization: Basic <base64 of CLIENT_ID:CLIENT_SECRET>` (encoded once,
  not per request)
- `X-AppFolio-Developer-ID: <developer-id>`
- `Content-Type: application/json`

### 3. Base URL (revised — Phase 1.1)

Read from `APPFOLIO_DB_BASE_URL`; defaults to production
`https://api.appfolio.com/api/v0` when unset. Validated on first use: must
be https on a `*.appfolio.com` host, else an `APPFOLIO_DB_CONFIG` error is
thrown (a typo'd or hostile override must never receive Basic credentials).
Sandbox: `https://practicerpmtx033.appfolio.com/api/v0`. No Database API
base URL may appear anywhere else in the codebase.

### 4. Rate limiter (revised — sliding window)

AppFolio enforces three limits per credential set:

- 8 requests per second
- 256 requests per minute
- 4096 requests per hour

The client self-throttles with a **sliding-window limiter** targeting
**7 requests per second** (1/sec of headroom for retries and timing jitter).
In-memory, no Redis, no library — Prestige Dash runs on a single VPS.

Mechanism: one time-ordered array of granted-request timestamps (trimmed to
the trailing hour). A request is granted only when **all three** windows have
room:

- fewer than 7 timestamps in the trailing 1,000 ms
- fewer than 256 timestamps in the trailing 60,000 ms
- fewer than 4096 timestamps in the trailing 3,600,000 ms

If a window is full, the binding constraint is the oldest timestamp inside
that window: a slot frees at `oldest + windowMs`. The limiter sleeps until
the nearest such moment, then re-checks.

All outbound requests serialize through a single acquire queue (a promise
chain), so two simultaneous callers can never both observe a free slot and
both consume it. The 8/256/4096 ceilings appear as named constants at the
top of the file.

Why not the token bucket originally specified: a bucket that starts full
(7) and refills continuously at 7/sec permits initial-burst + refill ≈ 13
requests within a single rolling second — over the hard 8/sec cap. The
sliding window enforces a true ceiling of "at most N in any trailing W ms."

### 5. Retry logic

- **429**: wait `Retry-After` (integer seconds; default 1s if absent), then
  retry the same request. Max 3 retries.
- **503**: exponential backoff 1s, 2s, 4s. Max 3 retries.
- **533** (Data Unavailable): same backoff as 503. Max 3 retries. Usually
  resolves within ~5 minutes during AppFolio maintenance (9 PM–4 AM PST);
  retry briefly, then surface the error.
- All other 4xx/5xx (400, 401, 403, 404, 422, …): throw immediately, no retry.

### 6. Public API

A single exported object; all methods return a `Promise` and run through the
rate limiter and retry logic:

```javascript
get(path, { filters, page })   // filters → filters[Key]=value; page → page[number]/page[size]
post(path, body)               // JSON body
patch(path, body)              // JSON body
delete(path)
```

Query-string rule: the square brackets in `filters[Key]` / `page[size]` stay
literal (AppFolio requires it); values are URL-encoded.

Logging: debug-level method + full request path *including the query
string* (filters/page params — no PII, no secrets) + timestamp outbound,
status/latency on response. Never log POST/PATCH bodies or response
bodies (tenant PII). (Query strings were added after the first live
backfill, where the bare path hid exactly the diagnostic that mattered.)

Errors are structured: `{ status, statusText, path, method, body }` where
`path` includes the query string and `body` is the response body —
parsed JSON when AppFolio sends JSON, otherwise the raw text (truncated).
A short body excerpt is also embedded in `err.message` so consumers that
only store the message (CLI output, `appfolio.sync_state.last_error`)
still carry AppFolio's explanation.

### 7. Dependencies

None added. Node 18+ built-in `fetch`, ESM to match the backend, limiter
written inline.

### 8. Proof-of-life

`backend/scripts/test-appfolio-db-api.js` — fetches `/properties` with
`filters[LastUpdatedAtFrom]=1970-01-01T00:00:00Z`, `page[size]=10`; prints
the count and the first property's identifying field; exits 0/1.
**Verified live on the VPS 2026-06-09.**

## Out of scope for Phase 1

Mirror tables, backfill jobs, webhook receiver/JWS, UI, feature endpoints,
response caching, tests beyond the proof-of-life script.

## Phase 2.1 — PII scrub, curated columns, current_tenancies

Shipped in `migrations/044_appfolio_curated_columns.sql` (applied at boot
by `lib/af-mirror-schema.js` after 043; append-only and idempotent) plus
the sync-engine scrub.

### PII scrub policy

The mirror must never hold `SocialSecurityNumber` or `BirthDate`. The
sync engine (`SCRUB_KEYS` in `backend/services/appfolio-db-sync.js`)
deletes those keys from **every** record, for **all** resources, before
upsert; migration 044 scrubbed rows mirrored before the policy existed.
Scrubbed values are never logged anywhere, including debug mode. Adding a
key to `SCRUB_KEYS` requires a matching one-time `UPDATE ... SET data =
data - 'Key'` migration for existing rows.

### Curated generated columns

Each mirror table promotes a curated set of STORED generated columns from
`data` (snake_case of AppFolio's PascalCase keys, defensive
`NULLIF(...,'')` casts; date/timestamptz casts go through declared-
immutable `appfolio.iso_date` / `appfolio.iso_timestamptz` helpers since
generated columns demand immutable expressions):

- **properties:** name, address1, address2, city, state, zip,
  property_type, class, portfolio_id, management_start_date (date),
  management_end_date (date), management_end_reason, hidden_at (tstz)
- **units:** property_id, current_occupancy_id, name, address1, city,
  state, zip, bedrooms / bathrooms / square_feet / market_rent (numeric),
  status, rent_status, rent_ready (bool), available_on (date),
  non_revenue (bool), hidden_at (tstz)
- **tenants:** occupancy_id, property_id, unit_id, first_name, last_name,
  email, phone_number, status, tenant_type, primary_tenant (bool),
  move_in_on / move_out_on / lease_start_date / lease_end_date (date),
  current_rent (numeric), is_monthly_lease (bool), hidden_at (tstz)
- **leases:** occupancy_id, start_on / end_on / signed_on / renewed_on
  (date), is_mtm (bool), status

Every `*_id` join key is indexed, plus tenants.status, leases.end_on, and
partial active-row indexes on properties/units (`hidden_at IS NULL`).

### View contract: `appfolio.current_tenancies`

One row per **active unit** (unit `hidden_at IS NULL`) on an **actively
managed property** (`management_end_date IS NULL AND hidden_at IS NULL`).
LEFT JOINs (vacant units stay visible with NULL tenant/lease columns):

- the **primary current tenant**: `occupancy_id = units.
  current_occupancy_id`, `status IN ('Current','Notice','Evict')`,
  `primary_tenant`
- the **lease covering today** for that occupancy: `start_on <=
  CURRENT_DATE AND (is_mtm OR end_on >= CURRENT_DATE)`, latest `start_on`
  wins (lateral, LIMIT 1)

Exposes property/unit ids + names, unit address1/city/state/zip, tenant
id/name/email/phone/status, current_rent, lease id/start_on/end_on/is_mtm.

### Data-model facts (learned from live data, 2026-06-09)

- Lease `Status` is the **e-signature workflow state**, not lease
  currency. The current lease is the one **covering today** for an
  occupancy — never select "the" lease by status.
- Tenants are **per person**; an occupancy can have several, with
  `PrimaryTenant` marking the primary. Observed tenant statuses:
  `Current`, `Past`, `Notice`, `Evict`, `Future`.
- v0 **list endpoints for properties/units/tenants require at least one
  filter** (the cause of the first backfill's 400s); `/leases` lists
  unfiltered. The sync engine's request-shape ladder handles this.

## Phase 3 — Scheduled syncs, deletion detection, failure events

Shipped in `migrations/045_appfolio_sync_phase3.sql`,
`backend/services/appfolio-db-scheduler.js`, and the reworked sync
engine. Wired from `index.js` like the Reports-API cache syncs.

### Request shape (ladder retired)

Every list request to every resource carries
`filters[LastUpdatedAtFrom]` — required by the v0 list endpoints for
properties/units/tenants, applied to leases for uniformity. Full runs
send the epoch; delta runs send `high_water_mark − 15 minutes` (epoch
when no mark exists). The Phase 2 400-fallback ladder is gone; a 400 is
now a real failure.

### Cadences

- **Delta, hourly** (`APPFOLIO_SYNC_DELTA_CRON`, default `0 * * * *`):
  fetch since the overlap-adjusted high-water mark, upsert (clears
  `missing_since`), advance the mark. The 15-minute overlap re-reads a
  little history so records updated mid-sync are never missed; upserts
  make the re-read harmless.
- **Full, nightly 3:00 AM America/Chicago** (`APPFOLIO_SYNC_FULL_CRON`,
  default `0 3 * * *`): epoch-filtered full fetch, then the missing
  sweep.

### missing_since semantics (deletion detection)

Rows are **never hard-deleted**. The nightly full pass records its start
time; after a resource's fetch completes **successfully**, rows that
fetch did not touch (`synced_at < run start AND missing_since IS NULL`)
get `missing_since = NOW()`. Any later upsert that sees the record again
clears it. A failed or lock-skipped resource skips its sweep entirely —
a partial fetch must not flag live records as missing.
`current_tenancies` excludes missing-flagged units, tenants, and leases.

### Lock strategy

Every sync run (scheduled or CLI) takes a per-resource Postgres advisory
lock — `pg_try_advisory_lock(hashtext('appfolio_sync'),
hashtext(resource))` on a dedicated client held for the whole run
(advisory locks are session-scoped; pooled per-query connections would
make them meaningless). Held lock = skip and log, never queue.

### Config

`APPFOLIO_SYNC_ENABLED` (default true; auto-disabled with a clear log
line when DB-API creds are absent — local dev must not error),
`APPFOLIO_SYNC_DELTA_CRON`, `APPFOLIO_SYNC_FULL_CRON`. One summary log
line per run; per-page detail stays behind `APPFOLIO_DB_DEBUG`.

### Failure / recovery event contract (Prestige Connect)

Emitted via `lib/eventBus.js` (emit-only; no automation config in code),
`source: "appfolio-sync"`:

- `appfolio.sync.failed` — emitted when a resource's
  `consecutive_failures` reaches **exactly 2** (one event per outage,
  not per failed run). Payload: `resource`, `error` (message including
  AppFolio's response body), `consecutiveFailures`, `lastSuccessAt`.
- `appfolio.sync.recovered` — emitted on the first success after a
  streak of ≥ 2 failures. Payload: `resource`, `downtimeMs`,
  `lastSuccessAt` (the pre-outage success), `failuresCleared`. Any
  success resets the counter.

`appfolio.sync_state` gained `consecutive_failures` and
`last_success_at` (the latter feeds the events' downtime math).

## Phase 3.5 — Webhooks as sync triggers + automation events

Shipped in `migrations/046_appfolio_webhook_events.sql`,
`backend/routes/appfolio-db-webhook.js`, and
`backend/services/appfolio-webhook-processor.js`.

### Doorbell model

Webhooks **accelerate** the mirror; they never own correctness. The
receiver stores the raw delivery and returns 200 in milliseconds; a
15-second processor turns stored events into targeted delta syncs and
bus events; the Phase 3 polling sync (hourly delta + nightly full) stays
untouched as the reconciliation layer. A lost or malformed webhook costs
freshness, never data.

### Receiver: `POST /webhooks/appfolio-db/:token`

- Shared-token auth: the path token is compared constant-time against
  `APPFOLIO_WEBHOOK_TOKEN`. Unset env **or** wrong token → 404, so the
  endpoint is indistinguishable from a missing route without the token.
  Signature verification is a follow-up once AppFolio's signing scheme
  is known.
- Bodies over 100 KB → 413.
- The payload is stored verbatim in `appfolio.webhook_events`
  (audit/debug inbox) and trusted for nothing beyond topic extraction.
  Topic extraction is tolerant (`topic`/`Topic`/`event_type`/headers…)
  because AppFolio's format is unknown until first delivery; extraction
  failure logs a warning and stores the event with NULL topic.
- Dedupe: provider event id when present, else
  `sha256(topic + payload + minute bucket)`, enforced by a partial
  unique index — provider retries are idempotent inserts answered 200.

### Processor (15-second tick)

- Topics mapping to mirrored resources (Properties/Units/Tenants/Leases,
  normalized) trigger **one delta sync per resource per tick** — a burst
  of webhooks coalesces into a single fetch. The sync's per-resource
  advisory lock covers contention with scheduled/CLI runs; a held lock
  defers those events to the next tick.
- Work-order and unknown topics: no fetch (work orders aren't mirrored).
- Every processed event emits `appfolio.webhook.<topic_snake_case>`
  (source `appfolio-webhook`) with `{ topic, receivedAt, raw }`, then
  gets `processed_at` stamped. Unknown topics warn once per process.
  These compose with the "Internal: Custom event" automation trigger
  (e.g. pattern `appfolio.webhook.*`).
- A delta-sync *failure* (not lock contention) still emits + stamps:
  notification is the doorbell's job; polling reconciles the data.
- Processor self-disables when `APPFOLIO_WEBHOOK_TOKEN` is unset (the
  receiver 404s, so there is nothing to process).

## Phase roadmap

1. **Client + proof-of-life** — this document. ✅ shipped & verified
2. **Local mirror tables + initial backfill** for `properties`, `units`,
   `tenants`, `leases` — mirrors live in the dedicated `appfolio` schema
   (`appfolio.properties` etc.) per the platform decision on integration
   tables — `migrations/043_appfolio_mirror_tables.sql`,
   `backend/services/appfolio-db-sync.js`,
   `backend/scripts/backfill-appfolio-db.js`. ✅ shipped & backfilled
   2.1. **PII scrub + curated columns + current_tenancies view** —
   `migrations/044_appfolio_curated_columns.sql`. ✅
3. **Scheduled delta syncs + deletion detection + failure events** —
   `migrations/045_appfolio_sync_phase3.sql`,
   `backend/services/appfolio-db-scheduler.js`. ✅
   3.5. **Webhooks as sync triggers + automation events** —
   `migrations/046_appfolio_webhook_events.sql`,
   `backend/routes/appfolio-db-webhook.js`,
   `backend/services/appfolio-webhook-processor.js` (this section). ✅
4. Webhook signature verification — once AppFolio's signing scheme is
   known. Retention cleanup for the webhook inbox — when the table earns
   it.
