/**
 * AppFolio Database API client (Phase 1 stub).
 *
 * The Database API is distinct from the Reports API v2 used by lib/appfolio.js:
 *   * Different base URL          (https://api.appfolio.com/api/v0)
 *   * Different auth model         (Basic + X-AppFolio-Developer-ID header)
 *   * Different rate limits        (8/s, 256/min, 4096/hr)
 *   * Real read/write CRUD         (Reports API is read-only & aggregated)
 *
 * Phase 1 ships the substrate only. Once we receive Database API
 * credentials, no code change is needed beyond setting env vars and
 * flipping APPFOLIO_DB_DRY_RUN=false.
 *
 * Audit posture: every call (real, dry-run, or failed) writes one row to
 * mb_api_log BEFORE returning. The log is best-effort — see lib/mb/audit.js.
 *
 * Env vars:
 *   APPFOLIO_DB_CLIENT_ID
 *   APPFOLIO_DB_CLIENT_SECRET
 *   APPFOLIO_DB_DEVELOPER_ID
 *   APPFOLIO_DB_BASE_URL        (defaults to https://api.appfolio.com/api/v0)
 *   APPFOLIO_DB_DRY_RUN=true    (skip the network, log + return mock)
 *
 * Why a different prefix from APPFOLIO_CLIENT_ID? The Reports API
 * already owns that env var (see lib/appfolio.js); colliding it would
 * silently break Reports auth. APPFOLIO_DB_* is namespaced.
 */

import { createRateLimiter } from "./rate-limiter.js";

/**
 * Default audit logger. Loaded lazily so the audit chain (which pulls in
 * pg + bcrypt via db.js) isn't required just to import this module — this
 * matters for unit tests that inject their own logger and never run in
 * an environment with the full backend deps installed.
 */
let _defaultLogger = null;
async function defaultLogApiCall(entry) {
  if (!_defaultLogger) {
    const m = await import("../mb/audit.js");
    _defaultLogger = m.logApiCall;
  }
  return _defaultLogger(entry);
}

const DEFAULT_BASE_URL = "https://api.appfolio.com/api/v0";

/**
 * Module-level limiter — AppFolio's quotas are per-account, not per
 * client instance. All callers share one bucket.
 */
let sharedLimiter = null;
function getLimiter() {
  if (!sharedLimiter) sharedLimiter = createRateLimiter();
  return sharedLimiter;
}

function requireConfig() {
  const clientId = process.env.APPFOLIO_DB_CLIENT_ID?.trim();
  const clientSecret = process.env.APPFOLIO_DB_CLIENT_SECRET?.trim();
  const developerId = process.env.APPFOLIO_DB_DEVELOPER_ID?.trim();
  if (!clientId || !clientSecret || !developerId) {
    const err = new Error(
      "AppFolio Database API credentials are not configured. " +
        "Set APPFOLIO_DB_CLIENT_ID, APPFOLIO_DB_CLIENT_SECRET, and APPFOLIO_DB_DEVELOPER_ID."
    );
    err.code = "APPFOLIO_DB_CONFIG";
    throw err;
  }
  const baseUrl = (process.env.APPFOLIO_DB_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { clientId, clientSecret, developerId, baseUrl };
}

function basicAuthHeader(clientId, clientSecret) {
  const token = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function isDryRun(opts) {
  if (opts?.dryRun === true) return true;
  return String(process.env.APPFOLIO_DB_DRY_RUN || "").toLowerCase() === "true";
}

function mockResponse(method, endpoint) {
  return {
    _dryRun: true,
    method,
    endpoint,
    note: "APPFOLIO_DB_DRY_RUN is enabled — no live request was sent.",
  };
}

function buildUrl(baseUrl, endpoint, params) {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${baseUrl}${path}`);
  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.append(k, String(v));
      }
    }
  }
  return url.toString();
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;

async function fetchWithRetry(url, init, limiter) {
  let attempt = 0;
  let lastErr;
  let lastRes;
  while (attempt <= MAX_RETRIES) {
    await limiter.acquire();
    try {
      const res = await fetch(url, init);
      if (!RETRY_STATUSES.has(res.status)) return res;
      lastRes = res;
      // Honor Retry-After if present, otherwise exponential backoff with jitter.
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, 2 ** attempt * 500) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(30_000, 2 ** attempt * 500) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
    }
    attempt += 1;
  }
  if (lastRes) return lastRes;
  throw lastErr || new Error("AppFolio Database API request failed after retries.");
}

export class AppFolioDBClient {
  /**
   * @param {object} [ctx]
   * @param {number|null} [ctx.userId]                 Acting user (for audit log).
   * @param {number|null} [ctx.triggeredByItemId]      mb_items.id that initiated this call.
   * @param {number|null} [ctx.triggeredBySubitemId]   mb_subitems.id that initiated this call.
   * @param {boolean} [ctx.dryRun]                     Force dry-run regardless of env.
   * @param {ReturnType<typeof createRateLimiter>} [ctx.limiter]  Inject for tests.
   */
  constructor(ctx = {}) {
    this.ctx = {
      userId: ctx.userId ?? null,
      triggeredByItemId: ctx.triggeredByItemId ?? null,
      triggeredBySubitemId: ctx.triggeredBySubitemId ?? null,
      dryRun: ctx.dryRun ?? null,
    };
    this.limiter = ctx.limiter || getLimiter();
    // Audit hook is injectable for tests. Default logs to mb_api_log.
    this.logger = ctx.logger || defaultLogApiCall;
  }

  get(endpoint, params, opts) {
    return this.request("GET", endpoint, { params, ...opts });
  }
  post(endpoint, body, opts) {
    return this.request("POST", endpoint, { body, ...opts });
  }
  patch(endpoint, body, opts) {
    return this.request("PATCH", endpoint, { body, ...opts });
  }
  put(endpoint, body, opts) {
    return this.request("PUT", endpoint, { body, ...opts });
  }
  delete(endpoint, opts) {
    return this.request("DELETE", endpoint, { ...opts });
  }

  /**
   * Generic request. Returns the parsed JSON body on 2xx, throws on 4xx/5xx
   * after retries are exhausted. The audit row is always written first.
   */
  async request(method, endpoint, { params, body, dryRun } = {}) {
    const cfg = requireConfig();
    const useDryRun = dryRun ?? this.ctx.dryRun ?? isDryRun();
    const url = buildUrl(cfg.baseUrl, endpoint, params);
    const startedAt = Date.now();

    if (useDryRun) {
      const mock = mockResponse(method, endpoint);
      await this.logger({
        userId: this.ctx.userId,
        method,
        endpoint,
        requestPayload: body ?? null,
        responseStatus: 0,
        responseBody: mock,
        durationMs: Date.now() - startedAt,
        errorMessage: null,
        triggeredByItemId: this.ctx.triggeredByItemId,
        triggeredBySubitemId: this.ctx.triggeredBySubitemId,
      });
      return mock;
    }

    const init = {
      method,
      headers: {
        Authorization: basicAuthHeader(cfg.clientId, cfg.clientSecret),
        "X-AppFolio-Developer-ID": cfg.developerId,
        Accept: "application/json",
      },
    };
    if (body != null && method !== "GET" && method !== "DELETE") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let res;
    let parsedBody = null;
    let errorMessage = null;
    try {
      res = await fetchWithRetry(url, init, this.limiter);
      const text = await res.text();
      if (text) {
        try {
          parsedBody = JSON.parse(text);
        } catch {
          parsedBody = { raw: text.slice(0, 4096) };
        }
      }
      if (!res.ok) {
        errorMessage = `AppFolio ${res.status}: ${typeof parsedBody === "object" && parsedBody?.error
          ? parsedBody.error
          : res.statusText || "request failed"}`;
      }
    } catch (e) {
      errorMessage = e.message || "AppFolio request error";
    }

    await this.logger({
      userId: this.ctx.userId,
      method,
      endpoint,
      requestPayload: body ?? null,
      responseStatus: res?.status ?? null,
      responseBody: parsedBody,
      durationMs: Date.now() - startedAt,
      errorMessage,
      triggeredByItemId: this.ctx.triggeredByItemId,
      triggeredBySubitemId: this.ctx.triggeredBySubitemId,
    });

    if (errorMessage) {
      const err = new Error(errorMessage);
      err.status = res?.status ?? null;
      err.body = parsedBody;
      throw err;
    }
    return parsedBody;
  }
}

/**
 * Factory for routes/jobs that have a user context. Always prefer this
 * over instantiating the class directly so the audit log carries the
 * actor's id.
 */
export function newAppFolioDBClient(ctx) {
  return new AppFolioDBClient(ctx);
}
