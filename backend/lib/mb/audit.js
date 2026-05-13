/**
 * AppFolio API audit logger for the mb_ (Monday-style board) module.
 *
 * Every outbound call to the AppFolio Database API writes a row to
 * mb_api_log so we can prove what we did, when, by whose action, and
 * with what response — both for debugging and for compliance.
 *
 * Errors here are logged but do NOT fail the parent request — audit is
 * best-effort. A missing audit row is better than a blocked legitimate
 * write. Same posture as lib/agentHub/audit.js.
 */

import { getPool } from "../db.js";

/**
 * @typedef {Object} ApiLogEntry
 * @property {number|null} userId
 * @property {string} method
 * @property {string} endpoint
 * @property {object|null} requestPayload
 * @property {number|null} responseStatus
 * @property {object|null} responseBody
 * @property {number|null} durationMs
 * @property {string|null} errorMessage
 * @property {number|null} triggeredByItemId
 * @property {number|null} triggeredBySubitemId
 */

/**
 * Persist one AppFolio API call to mb_api_log.
 *
 * Response bodies can be large; the caller is expected to truncate or
 * elide if needed. We persist whatever is passed in.
 */
export async function logApiCall(entry) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO mb_api_log
         (user_id, method, endpoint, request_payload, response_status,
          response_body, duration_ms, error_message,
          triggered_by_item_id, triggered_by_subitem_id)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10)`,
      [
        entry.userId ?? null,
        entry.method,
        entry.endpoint,
        entry.requestPayload === undefined || entry.requestPayload === null
          ? null
          : JSON.stringify(entry.requestPayload),
        entry.responseStatus ?? null,
        entry.responseBody === undefined || entry.responseBody === null
          ? null
          : JSON.stringify(entry.responseBody),
        entry.durationMs ?? null,
        entry.errorMessage ?? null,
        entry.triggeredByItemId ?? null,
        entry.triggeredBySubitemId ?? null,
      ]
    );
  } catch (e) {
    console.error("[mb] api log write failed", {
      endpoint: entry.endpoint,
      error: e.message,
    });
  }
}
