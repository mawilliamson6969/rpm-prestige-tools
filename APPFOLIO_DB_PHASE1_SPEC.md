# Spec: AppFolio Database API client for Prestige Dash (Phase 1)

**Status:** Implemented and verified live on the VPS (2026-06-09).
**Implementation:** `backend/services/appfolio-db-api.js`, proof-of-life `backend/scripts/test-appfolio-db-api.js`.

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

Optional: `APPFOLIO_DB_DEBUG=true` emits one debug line per request
(method, path, status, latency — never bodies, never secrets).

### 2. Authentication

HTTP Basic Auth plus a custom header on every request:

- `Authorization: Basic <base64 of CLIENT_ID:CLIENT_SECRET>` (encoded once,
  not per request)
- `X-AppFolio-Developer-ID: <developer-id>`
- `Content-Type: application/json`

### 3. Base URL

`https://api.appfolio.com/api/v0` — hardcoded in this service file only.

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

Logging: debug-level method/path/timestamp outbound, status/latency on
response. Never log POST/PATCH bodies or response bodies (tenant PII).

Errors are structured: `{ status, statusText, path, method, body }` where
`body` is the JSON response body or null.

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

## Phase roadmap

1. **Client + proof-of-life** — this document. ✅ shipped & verified
2. **Local mirror tables + initial backfill** for `properties`, `units`,
   `tenants`, `leases` — `migrations/037_af_mirror_tables.sql`,
   `backend/services/appfolio-db-sync.js`,
   `backend/scripts/backfill-appfolio-db.js`
3. Webhooks / delta scheduling — not yet specified
