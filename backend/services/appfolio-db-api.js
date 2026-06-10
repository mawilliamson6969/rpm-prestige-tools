/**
 * AppFolio Database API client (Phase 1: auth + rate limiting + retry).
 *
 * This is a SEPARATE API from the Reports API v2 used by lib/appfolio.js:
 *   - Different base URL   (https://api.appfolio.com/api/v0)
 *   - Different auth        (HTTP Basic + X-AppFolio-Developer-ID header)
 *   - Different rate limits (8/sec, 256/min, 4096/hour, per credential set)
 *   - Real read/write CRUD  (Reports API is read-only & aggregated)
 *
 * Both clients coexist. Nothing here touches the Reports API.
 *
 * Scope of this phase: a hardened transport layer plus one read path,
 * proven by scripts/test-appfolio-db-api.js. No mirror tables, no
 * backfill, no webhooks, no caching, no feature endpoints — those are
 * later phases.
 *
 * Env vars (read from process.env, never logged, never stored in the DB):
 *   APPFOLIO_DB_CLIENT_ID
 *   APPFOLIO_DB_CLIENT_SECRET
 *   APPFOLIO_DB_DEVELOPER_ID
 *   APPFOLIO_DB_BASE_URL     (optional — defaults to production; must be
 *                             https on a *.appfolio.com host. Point at the
 *                             practice sandbox for write testing.)
 *   APPFOLIO_DB_DRY_RUN=true (optional — GETs run normally, but
 *                             POST/PATCH/DELETE are not sent: the skipped
 *                             write is logged and { dryRun: true } returned)
 *   APPFOLIO_DB_DEBUG=true   (optional — emit per-request debug lines)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Production base URL; override with APPFOLIO_DB_BASE_URL (sandbox).
// This service file is the only place a Database API base URL may live.
const DEFAULT_BASE_URL = "https://api.appfolio.com/api/v0";

// AppFolio's published hard ceilings, per credential set. A request must
// satisfy ALL THREE simultaneously or AppFolio returns 429.
const APPFOLIO_LIMIT_PER_SECOND = 8;
const APPFOLIO_LIMIT_PER_MINUTE = 256;
const APPFOLIO_LIMIT_PER_HOUR = 4096;

// We self-throttle one request/sec below the hard 8/sec ceiling. That 1/sec
// of headroom absorbs retries and clock jitter so our own traffic never
// trips a 429 under normal load.
const TARGET_REQUESTS_PER_SECOND = APPFOLIO_LIMIT_PER_SECOND - 1; // = 7

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const MAX_RETRIES = 3; // initial attempt + up to 3 retries = 4 tries max

// Only these statuses are retried. Everything else (400/401/403/404/422,
// other 5xx) throws immediately — retrying them just wastes the budget.
const STATUS_RATE_LIMITED = 429; // honor Retry-After header
const STATUS_SERVICE_UNAVAILABLE = 503; // exponential backoff
const STATUS_DATA_UNAVAILABLE = 533; // AppFolio-specific; same backoff as 503

// ---------------------------------------------------------------------------
// Debug logging — never logs request/response bodies (tenant PII) or secrets.
// ---------------------------------------------------------------------------

const DEBUG_ENABLED =
  String(process.env.APPFOLIO_DB_DEBUG || "").toLowerCase() === "true";

function debug(...args) {
  if (DEBUG_ENABLED) console.debug("[appfolio-db]", ...args);
}

// ---------------------------------------------------------------------------
// Settings — base URL (validated on first use, then cached) and dry-run.
// Separate from credentials so callers like the proof-of-life script can
// report where requests would go without needing creds in the environment.
// ---------------------------------------------------------------------------

let cachedBaseUrl = null;

function getBaseUrl() {
  if (cachedBaseUrl) return cachedBaseUrl;

  const raw = process.env.APPFOLIO_DB_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const err = new Error(
      `APPFOLIO_DB_BASE_URL is not a valid URL: "${raw}".`
    );
    err.code = "APPFOLIO_DB_CONFIG";
    throw err;
  }
  // Only ever talk https to an *.appfolio.com host — a typo'd or hostile
  // override must not receive Basic credentials.
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".appfolio.com")) {
    const err = new Error(
      `APPFOLIO_DB_BASE_URL must be an https URL on a *.appfolio.com host; got "${raw}".`
    );
    err.code = "APPFOLIO_DB_CONFIG";
    throw err;
  }

  cachedBaseUrl = raw.replace(/\/+$/, ""); // no trailing slash; paths supply their own
  return cachedBaseUrl;
}

// Read per call (not cached) so the write gate always reflects the
// current environment.
function isDryRun() {
  return String(process.env.APPFOLIO_DB_DRY_RUN || "").toLowerCase() === "true";
}

/**
 * Safe-to-print settings (no secrets). Used by the proof-of-life script.
 * Resolving the base URL here triggers its validation.
 */
function getSettings() {
  return { baseUrl: getBaseUrl(), dryRun: isDryRun() };
}

// ---------------------------------------------------------------------------
// Config — read once, base64 computed once, cached. Fails loudly if missing.
// ---------------------------------------------------------------------------

let cachedConfig = null;

function getConfig() {
  if (cachedConfig) return cachedConfig;

  const clientId = process.env.APPFOLIO_DB_CLIENT_ID?.trim();
  const clientSecret = process.env.APPFOLIO_DB_CLIENT_SECRET?.trim();
  const developerId = process.env.APPFOLIO_DB_DEVELOPER_ID?.trim();

  const missing = [];
  if (!clientId) missing.push("APPFOLIO_DB_CLIENT_ID");
  if (!clientSecret) missing.push("APPFOLIO_DB_CLIENT_SECRET");
  if (!developerId) missing.push("APPFOLIO_DB_DEVELOPER_ID");
  if (missing.length) {
    const err = new Error(
      `AppFolio Database API is not configured. Missing env var(s): ${missing.join(
        ", "
      )}.`
    );
    err.code = "APPFOLIO_DB_CONFIG";
    throw err;
  }

  // Encode CLIENT_ID:CLIENT_SECRET once — not per request.
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString(
    "base64"
  );

  cachedConfig = {
    authHeader: `Basic ${basic}`,
    developerId,
  };
  return cachedConfig;
}

// ---------------------------------------------------------------------------
// Rate limiter — single shared, serialized sliding-window limiter.
//
// AppFolio's quotas are per credential set, not per caller, so every
// outbound request in this process must pass through ONE limiter. Acquire
// calls are serialized via a promise chain: only one acquire runs its
// accounting at a time, so two concurrent callers can never both decide a
// slot is free and then both consume it.
//
// Why a sliding window instead of a classic token bucket: a bucket that
// starts full (7) AND refills at 7/sec can emit ~13–14 requests inside a
// single rolling second (initial burst + accrued refill). AppFolio's hard
// cap is 8/sec, so that bursting would draw real 429s. A sliding window
// enforces a true ceiling: "no more than N requests in the trailing W ms".
//
// The math — one `requestTimes` array (timestamps of granted requests in
// the last hour). A request is granted only when ALL THREE hold:
//   - fewer than 7   timestamps in the last  1,000 ms  (per-second target;
//                     7 not 8, leaving 1/sec of headroom for retries/jitter)
//   - fewer than 256 timestamps in the last 60,000 ms  (per-minute limit)
//   - fewer than 4096 timestamps in the last 3,600,000 ms (per-hour limit)
// If a window is full, the binding constraint is the oldest timestamp
// inside that window: a slot frees `oldest + windowMs` from now. We sleep
// until the nearest such moment, then re-check.
// ---------------------------------------------------------------------------

// One row per published ceiling. perSecond uses the 7/sec self-throttle
// target, not AppFolio's hard 8/sec, on purpose (see header).
const RATE_WINDOWS = [
  { max: TARGET_REQUESTS_PER_SECOND, windowMs: 1_000 }, // 7 / 1s
  { max: APPFOLIO_LIMIT_PER_MINUTE, windowMs: MINUTE_MS }, // 256 / 60s
  { max: APPFOLIO_LIMIT_PER_HOUR, windowMs: HOUR_MS }, // 4096 / 3600s
];

let requestTimes = [];

// Serializes acquire() so accounting is never interleaved.
let acquireChain = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function trimRequestTimes(now) {
  const cutoff = now - HOUR_MS; // longest tracked window
  let drop = 0;
  while (drop < requestTimes.length && requestTimes[drop] < cutoff) drop++;
  if (drop) requestTimes = requestTimes.slice(drop);
}

// 0 if a slot is free now; otherwise ms until the binding window frees one.
function windowWaitMs(now) {
  let wait = 0;
  for (const { max, windowMs } of RATE_WINDOWS) {
    const windowStart = now - windowMs;
    // requestTimes is time-ordered; count entries newer than windowStart.
    let inWindow = 0;
    for (let i = requestTimes.length - 1; i >= 0; i--) {
      if (requestTimes[i] > windowStart) inWindow++;
      else break;
    }
    if (inWindow >= max) {
      // The oldest timestamp inside this window must age past windowMs
      // before a slot opens.
      const oldestInWindow = requestTimes[requestTimes.length - max];
      wait = Math.max(wait, oldestInWindow + windowMs - now);
    }
  }
  return wait;
}

async function acquireSlot() {
  for (;;) {
    const now = Date.now();
    trimRequestTimes(now);

    const wait = windowWaitMs(now);
    if (wait === 0) {
      requestTimes.push(now);
      return;
    }
    await sleep(Math.max(wait, 5));
  }
}

// Public acquire: chained so only one runs at a time.
function acquire() {
  const next = acquireChain.then(acquireSlot);
  // Keep the chain alive even if a particular acquire rejects (it won't,
  // acquireSlot only resolves — but be defensive).
  acquireChain = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------------------
// Query string — AppFolio wants literal square brackets in keys
// (filters[Key], page[number]). URLSearchParams would percent-encode the
// brackets, so we build the string by hand and only encode the values.
// ---------------------------------------------------------------------------

function buildQueryString({ filters, page } = {}) {
  const parts = [];

  if (filters && typeof filters === "object") {
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      parts.push(`filters[${key}]=${encodeURIComponent(value)}`);
    }
  }

  if (page && typeof page === "object") {
    if (page.number !== undefined && page.number !== null) {
      parts.push(`page[number]=${encodeURIComponent(page.number)}`);
    }
    if (page.size !== undefined && page.size !== null) {
      parts.push(`page[size]=${encodeURIComponent(page.size)}`);
    }
  }

  return parts.length ? `?${parts.join("&")}` : "";
}

// ---------------------------------------------------------------------------
// Response parsing + structured errors
// ---------------------------------------------------------------------------

async function readJsonBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // not JSON — caller gets null per the error contract
  }
}

function structuredError({ status, statusText, path, method, body }) {
  const err = new Error(
    `AppFolio Database API ${method} ${path} failed: ${status} ${
      statusText || ""
    }`.trim()
  );
  err.status = status;
  err.statusText = statusText;
  err.path = path;
  err.method = method;
  err.body = body ?? null;
  return err;
}

// ---------------------------------------------------------------------------
// Core request: rate-limited, with retry logic.
// ---------------------------------------------------------------------------

/**
 * Body description safe for logs: key names and size only, never values
 * (POST/PATCH bodies can carry tenant PII).
 */
function summarizePayload(body) {
  if (body === undefined || body === null) return "no body";
  const json = JSON.stringify(body);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return `keys [${Object.keys(body).join(", ")}], ${json.length} bytes`;
  }
  return `${Array.isArray(body) ? "array" : typeof body}, ${json.length} bytes`;
}

async function request(method, path, { query, body } = {}) {
  // Dry-run write gate: reads pass through untouched; writes never leave
  // the process. Checked before the rate limiter so skipped writes don't
  // consume request slots. Logged unconditionally — it is the only record
  // that the write was attempted.
  if (method !== "GET" && isDryRun()) {
    console.info(
      `[appfolio-db] DRY RUN — skipped ${method} ${path} (${summarizePayload(body)})`
    );
    return { dryRun: true, method, path };
  }

  const config = getConfig();
  const url = `${getBaseUrl()}${path}${buildQueryString(query)}`;

  const headers = {
    Authorization: config.authHeader,
    "X-AppFolio-Developer-ID": config.developerId,
    "Content-Type": "application/json",
  };

  const init = { method, headers };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }

  let attempt = 0;
  for (;;) {
    await acquire();

    const startedAt = Date.now();
    // Never log query/body — only method, path, timestamp.
    debug(`-> ${method} ${path} @ ${new Date(startedAt).toISOString()}`);

    let res;
    try {
      res = await fetch(url, init);
    } catch (networkErr) {
      debug(`x  ${method} ${path} network error after ${Date.now() - startedAt}ms`);
      throw structuredError({
        status: 0,
        statusText: networkErr.message || "network error",
        path,
        method,
        body: null,
      });
    }

    const latency = Date.now() - startedAt;
    debug(`<- ${method} ${path} ${res.status} ${latency}ms`);

    if (res.ok) {
      return readJsonBody(res);
    }

    const retryable =
      res.status === STATUS_RATE_LIMITED ||
      res.status === STATUS_SERVICE_UNAVAILABLE ||
      res.status === STATUS_DATA_UNAVAILABLE;

    if (retryable && attempt < MAX_RETRIES) {
      let waitMs;
      if (res.status === STATUS_RATE_LIMITED) {
        // Retry-After is an integer number of seconds.
        const retryAfter = parseInt(res.headers.get("retry-after"), 10);
        waitMs =
          Number.isFinite(retryAfter) && retryAfter >= 0
            ? retryAfter * 1000
            : 1000; // sane default if the header is absent/garbage
      } else {
        // 503 / 533: exponential backoff 1s, 2s, 4s.
        waitMs = 2 ** attempt * 1000;
      }
      attempt += 1;
      debug(
        `~  ${method} ${path} ${res.status} retry ${attempt}/${MAX_RETRIES} in ${waitMs}ms`
      );
      await sleep(waitMs);
      continue;
    }

    // Non-retryable, or retries exhausted.
    const errorBody = await readJsonBody(res);
    throw structuredError({
      status: res.status,
      statusText: res.statusText,
      path,
      method,
      body: errorBody,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API — a single object. All methods return a Promise.
// ---------------------------------------------------------------------------

const appfolioDbApi = {
  /**
   * GET request.
   * @param {string} path e.g. "/properties"
   * @param {object} [opts]
   * @param {object} [opts.filters] -> filters[Key]=value
   * @param {object} [opts.page]    -> { number, size }
   */
  get(path, { filters, page } = {}) {
    return request("GET", path, { query: { filters, page } });
  },

  /** POST request with a JSON body. */
  post(path, body) {
    return request("POST", path, { body });
  },

  /** PATCH request with a JSON body. */
  patch(path, body) {
    return request("PATCH", path, { body });
  },

  /** DELETE request. */
  delete(path) {
    return request("DELETE", path);
  },

  /** { baseUrl, dryRun } — safe to print, never includes credentials. */
  getSettings,
};

export default appfolioDbApi;
export { appfolioDbApi };
