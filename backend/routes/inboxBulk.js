/**
 * Phase 7: bulk triage actions on threads.
 *
 *   POST /inbox/threads/bulk
 *   Body: { thread_ids: string[], op: <one-of-the-ops-below>, ...payload }
 *
 * One DB transaction per call — partial failures roll back, so the
 * client can show "47 updated" or "nothing changed" cleanly.
 *
 *   ops:
 *     - assign            { assignee_id: number | null }
 *     - set_status        { status: 'open' | 'snoozed' | 'closed' }
 *     - snooze            { until?: ISO }     (alias for status=snoozed)
 *     - reopen                                (alias for status=open)
 *     - close                                 (alias for status=closed)
 *     - add_tags          { tags: string[] }
 *     - remove_tags       { tags: string[] }
 *     - mark_read
 *     - mark_unread
 *
 * Permission scoping: every thread must be in a mailbox the caller has
 * access to. Mixed batches with one inaccessible thread return 403 — by
 * design, since the operator likely picked them by accident.
 */

import { getPool } from "../lib/db.js";
import { getAllowedConnectionIds } from "../lib/inbox/inbox-permissions.js";

const VALID_OPS = new Set([
  "assign",
  "set_status",
  "snooze",
  "reopen",
  "close",
  "add_tags",
  "remove_tags",
  "mark_read",
  "mark_unread",
]);

const D0_STATUSES = new Set(["open", "snoozed", "closed"]);

/** Cap bulk size to keep the transaction from blowing up triggers (one
 *  trigger fire per row). 200 is plenty for human-driven triage. */
const MAX_BULK_SIZE = 200;

function cleanTagList(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0 && t.length <= 64);
}

export async function postInboxThreadsBulk(req, res) {
  const body = req.body ?? {};
  const op = String(body.op || "").trim();
  const idsRaw = Array.isArray(body.thread_ids) ? body.thread_ids : null;

  if (!VALID_OPS.has(op)) {
    return res.status(400).json({
      error: `op must be one of: ${[...VALID_OPS].join(", ")}.`,
    });
  }
  if (!idsRaw || !idsRaw.length) {
    return res.status(400).json({ error: "thread_ids[] must contain at least one id." });
  }
  if (idsRaw.length > MAX_BULK_SIZE) {
    return res.status(400).json({
      error: `thread_ids[] is capped at ${MAX_BULK_SIZE} per call (${idsRaw.length} given).`,
    });
  }
  const threadIds = idsRaw.map((s) => String(s)).filter(Boolean);
  if (!threadIds.length) {
    return res.status(400).json({ error: "thread_ids[] contained no valid ids." });
  }

  const pool = getPool();
  const allowed = await getAllowedConnectionIds(pool, req.user.id);
  if (!allowed.length) {
    return res.status(403).json({ error: "No mailboxes accessible." });
  }

  // Permission guardrail: every requested thread must be in an allowed
  // mailbox (or have a NULL connection_id, which means it predates the
  // multi-mailbox split — admins can still touch those).
  const { rows: scopeRows } = await pool.query(
    `SELECT thread_id, connection_id
       FROM threads
      WHERE thread_id = ANY($1::text[])`,
    [threadIds]
  );
  if (scopeRows.length !== threadIds.length) {
    return res.status(404).json({ error: "One or more thread_ids not found." });
  }
  const allowedSet = new Set(allowed);
  for (const r of scopeRows) {
    if (r.connection_id != null && !allowedSet.has(r.connection_id)) {
      return res.status(403).json({
        error: `You don't have access to one or more selected mailboxes.`,
      });
    }
  }

  // Validate op-specific payload up front so the txn never opens on bad input.
  let payload;
  try {
    payload = validatePayload(op, body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await applyBulkOp(client, op, payload, threadIds, req.user.id);

    await client.query("COMMIT");
    res.json({
      op,
      requested: threadIds.length,
      updated: result.updated,
      thread_ids: result.thread_ids,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error("[inbox] bulk", op, e);
    res.status(500).json({ error: e.message || "Bulk op failed." });
  } finally {
    client.release();
  }
}

function validatePayload(op, body) {
  switch (op) {
    case "assign": {
      const raw = body.assignee_id;
      if (raw === null || raw === undefined || raw === "") return { assignee_id: null };
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error("assignee_id must be a user id or null.");
      return { assignee_id: n };
    }
    case "set_status": {
      const s = String(body.status || "");
      if (!D0_STATUSES.has(s)) {
        throw new Error(`status must be one of: ${[...D0_STATUSES].join(", ")}.`);
      }
      return { status: s };
    }
    case "snooze": {
      let untilIso = null;
      if (body.until) {
        const d = new Date(body.until);
        if (!Number.isFinite(d.getTime())) throw new Error("until must be an ISO date string.");
        untilIso = d.toISOString();
      }
      return { until: untilIso };
    }
    case "reopen":
    case "close":
    case "mark_read":
    case "mark_unread":
      return {};
    case "add_tags":
    case "remove_tags": {
      const tags = cleanTagList(body.tags);
      if (!tags.length) throw new Error("tags[] must contain at least one tag.");
      return { tags };
    }
    default:
      throw new Error("Unknown op.");
  }
}

async function applyBulkOp(client, op, payload, threadIds, userId) {
  switch (op) {
    case "assign": {
      const { rows } = await client.query(
        `UPDATE threads
            SET assignee_id = $1,
                last_touched_by = $2,
                last_touched_at = NOW(),
                updated_at = NOW()
          WHERE thread_id = ANY($3::text[])
          RETURNING thread_id`,
        [payload.assignee_id, userId, threadIds]
      );
      // Mirror on tickets so message-level views stay coherent.
      await client.query(
        `UPDATE tickets SET assigned_to = $1, updated_at = NOW()
          WHERE thread_id = ANY($2::text[]) AND deleted_at IS NULL`,
        [payload.assignee_id, threadIds]
      );
      return { updated: rows.length, thread_ids: rows.map((r) => r.thread_id) };
    }
    case "set_status":
    case "reopen":
    case "close": {
      const status =
        op === "reopen" ? "open" : op === "close" ? "closed" : payload.status;
      const { rows } = await client.query(
        `UPDATE threads
            SET status = $1,
                last_touched_by = $2,
                last_touched_at = NOW(),
                updated_at = NOW()
          WHERE thread_id = ANY($3::text[])
          RETURNING thread_id`,
        [status, userId, threadIds]
      );
      return { updated: rows.length, thread_ids: rows.map((r) => r.thread_id) };
    }
    case "snooze": {
      const untilTag = payload.until ? `snooze:until:${payload.until}` : null;
      const { rows } = await client.query(
        `UPDATE threads
            SET status = 'snoozed',
                tags = CASE
                  WHEN $1::text IS NULL THEN tags
                  WHEN $1 = ANY(tags) THEN tags
                  ELSE array_append(
                    COALESCE(
                      (SELECT array_agg(t) FROM unnest(tags) AS t WHERE t NOT LIKE 'snooze:until:%'),
                      ARRAY[]::TEXT[]
                    ),
                    $1
                  )
                END,
                last_touched_by = $2,
                last_touched_at = NOW(),
                updated_at = NOW()
          WHERE thread_id = ANY($3::text[])
          RETURNING thread_id`,
        [untilTag, userId, threadIds]
      );
      return { updated: rows.length, thread_ids: rows.map((r) => r.thread_id) };
    }
    case "add_tags": {
      // Append each tag if not already present. Done as a single query
      // per thread is slower; instead build the merged set in SQL.
      const { rows } = await client.query(
        `UPDATE threads th
            SET tags = (
                  SELECT ARRAY(
                    SELECT DISTINCT t FROM unnest(th.tags || $1::text[]) AS t
                  )
                ),
                last_touched_by = $2,
                last_touched_at = NOW(),
                updated_at = NOW()
          WHERE thread_id = ANY($3::text[])
          RETURNING thread_id`,
        [payload.tags, userId, threadIds]
      );
      return { updated: rows.length, thread_ids: rows.map((r) => r.thread_id) };
    }
    case "remove_tags": {
      const { rows } = await client.query(
        `UPDATE threads th
            SET tags = COALESCE(
                  (SELECT array_agg(t) FROM unnest(th.tags) AS t WHERE NOT (t = ANY($1::text[]))),
                  ARRAY[]::TEXT[]
                ),
                last_touched_by = $2,
                last_touched_at = NOW(),
                updated_at = NOW()
          WHERE thread_id = ANY($3::text[])
          RETURNING thread_id`,
        [payload.tags, userId, threadIds]
      );
      return { updated: rows.length, thread_ids: rows.map((r) => r.thread_id) };
    }
    case "mark_read":
    case "mark_unread": {
      const flag = op === "mark_read";
      await client.query(
        `UPDATE tickets
            SET is_read = $1, updated_at = NOW()
          WHERE thread_id = ANY($2::text[]) AND deleted_at IS NULL`,
        [flag, threadIds]
      );
      // Recompute unread_count on the threads. The per-message trigger
      // doesn't fire on is_read-only changes.
      const { rows } = await client.query(
        `UPDATE threads th
            SET unread_count = (
                  SELECT COUNT(*) FROM tickets
                   WHERE thread_id = th.thread_id
                     AND is_read = FALSE
                     AND deleted_at IS NULL
                ),
                last_touched_by = $1,
                last_touched_at = NOW(),
                updated_at = NOW()
          WHERE thread_id = ANY($2::text[])
          RETURNING thread_id`,
        [userId, threadIds]
      );
      return { updated: rows.length, thread_ids: rows.map((r) => r.thread_id) };
    }
    default:
      throw new Error(`Unknown op ${op}.`);
  }
}
