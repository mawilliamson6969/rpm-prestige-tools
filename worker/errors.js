/**
 * Transient vs permanent error classification.
 *
 * A "transient" error is one that might resolve on its own a few minutes
 * later — network glitch, DNS hiccup, provider 5xx, rate limit.
 * A "permanent" error means the input was wrong; retrying doesn't help.
 *
 * The rule of thumb: when unsure, treat as PERMANENT. A retry storm of
 * malformed-config errors burns API budget and goes nowhere — but a
 * legitimate transient error that we mis-classified as permanent just
 * lands one extra dead-letter row that a human can manually re-run.
 *
 * Handlers can also tag their own result with `{ transient: true }`
 * (e.g. when they catch a fetch error before throwing). That hint
 * wins over heuristic sniffing.
 */

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const TRANSIENT_NODE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const TRANSIENT_HINT_PATTERNS = [
  /\btimeout\b/i,
  /\bnetwork\b/i,
  /\btemporar/i,
  /\btry again\b/i,
  /\brate limit/i,
  /\boverloaded\b/i,
  /\b5\d\d\b/, // bare 5xx
];

/**
 * @param {Error|string|null|undefined} err
 * @param {{ status?: number; transient?: boolean }} [hints]
 * @returns {boolean}
 */
export function isTransient(err, hints = {}) {
  // Explicit handler hint always wins.
  if (hints && typeof hints.transient === "boolean") return hints.transient;

  // HTTP status hint from a handler.
  if (hints && typeof hints.status === "number") {
    return TRANSIENT_HTTP_STATUSES.has(hints.status);
  }

  if (!err) return false;

  // Errors carry both a `code` (Node net errors) and a `status` (fetch
  // wrappers). Check both before falling back to the message.
  if (typeof err === "object") {
    if (typeof err.code === "string" && TRANSIENT_NODE_ERROR_CODES.has(err.code)) {
      return true;
    }
    if (typeof err.status === "number" && TRANSIENT_HTTP_STATUSES.has(err.status)) {
      return true;
    }
    if (typeof err.statusCode === "number" && TRANSIENT_HTTP_STATUSES.has(err.statusCode)) {
      return true;
    }
  }

  const msg = typeof err === "string" ? err : err.message || String(err);
  return TRANSIENT_HINT_PATTERNS.some((re) => re.test(msg));
}

/**
 * Backoff schedule for retries. attempt is 1-indexed (so attempt=1 means
 * "we just failed for the first time, schedule the second attempt").
 * Capped, exponential-ish — we don't need fractional precision.
 *
 *   attempt 1 → wait 1 minute  before attempt 2
 *   attempt 2 → wait 5 minutes before attempt 3
 *   attempt 3+ → wait 15 minutes
 */
export function backoffMs(attempt) {
  if (attempt <= 1) return 60 * 1000;
  if (attempt === 2) return 5 * 60 * 1000;
  return 15 * 60 * 1000;
}
