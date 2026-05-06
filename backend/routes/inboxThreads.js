/**
 * Phase 1: thread-first inbox API.
 *
 * The thread is the canonical entity. Mutations land on `threads`; sends
 * still flow through the existing email-send.js path which writes to
 * `tickets` / `ticket_responses` and triggers update the thread aggregates.
 */

import { getPool } from "../lib/db.js";
import { sendTicketReply } from "../lib/inbox/email-send.js";
import { refreshThread as graphRefreshThread } from "../lib/inbox/email-delta-sync.js";
import { getValidAccessTokenForConnection } from "../lib/inbox/microsoft-auth.js";
import {
  getAllowedConnectionIds,
  getUserPermissionOnConnection,
  permissionAtLeast,
} from "../lib/inbox/inbox-permissions.js";

const ACTIVE_STATUSES = ["open", "waiting_on_tenant", "waiting_on_owner", "waiting_on_vendor", "snoozed"];
const VALID_THREAD_STATUSES = new Set([...ACTIVE_STATUSES, "closed"]);
const VALID_PRIORITIES = new Set(["emergency", "high", "normal", "low"]);

const PRIORITY_ORDER_SQL = `CASE priority
  WHEN 'emergency' THEN 4
  WHEN 'high'      THEN 3
  WHEN 'normal'    THEN 2
  WHEN 'low'       THEN 1
  ELSE 0
END`;

/** Translate the existing list-bucket vocabulary into thread filters so the
 *  frontend's existing `useThreadList` query shape works unchanged. */
export function buildThreadWhere(req, allowedConnectionIds) {
  const params = [];
  let n = 1;
  const parts = ["1=1"];
  const bucket = req.query.bucket || "open";

  if (allowedConnectionIds.length) {
    parts.push(`(th.connection_id IS NULL OR th.connection_id = ANY($${n}::int[]))`);
    params.push(allowedConnectionIds);
    n++;
  } else {
    parts.push("FALSE");
  }

  const cidRaw = req.query.connectionId;
  if (cidRaw != null && cidRaw !== "") {
    const cid = Number(cidRaw);
    if (Number.isFinite(cid) && allowedConnectionIds.includes(cid)) {
      parts.push(`th.connection_id = $${n++}`);
      params.push(cid);
    }
  }

  if (req.query.status) {
    parts.push(`th.status = $${n++}`);
    params.push(req.query.status);
  }
  if (req.query.category) {
    parts.push(`th.category = $${n++}`);
    params.push(req.query.category);
  }
  if (req.query.assignedTo) {
    parts.push(`th.assignee_id = $${n++}`);
    params.push(Number(req.query.assignedTo));
  }
  if (req.query.assignedToMe === "1") {
    parts.push(`th.assignee_id = $${n++}`);
    params.push(req.user.id);
  }
  if (req.query.unassigned === "1") {
    parts.push(`th.assignee_id IS NULL`);
  }
  if (req.query.starred === "true" || req.query.isStarred === "true") {
    parts.push(`th.starred = TRUE`);
  }
  if (req.query.has_unread === "true" || req.query.isRead === "false") {
    parts.push(`th.unread_count > 0`);
  }
  if (req.query.priority && VALID_PRIORITIES.has(String(req.query.priority))) {
    parts.push(`th.priority = $${n++}`);
    params.push(String(req.query.priority));
  }
  if (Array.isArray(req.query.priority_in) && req.query.priority_in.length) {
    const list = req.query.priority_in
      .map((p) => String(p))
      .filter((p) => VALID_PRIORITIES.has(p));
    if (list.length) {
      parts.push(`th.priority = ANY($${n++}::text[])`);
      params.push(list);
    }
  }
  if (req.query.sla_breached === "true") {
    parts.push(`th.sla_due_at IS NOT NULL AND th.sla_due_at < NOW() AND th.sla_paused = FALSE`);
  }
  if (req.query.search || req.query.q) {
    const term = `%${String(req.query.search || req.query.q).trim()}%`;
    parts.push(
      `(th.subject ILIKE $${n} OR th.linked_property_name ILIKE $${n} OR th.linked_tenant_name ILIKE $${n} OR th.linked_owner_name ILIKE $${n})`
    );
    params.push(term);
    n++;
  }
  if (req.query.startDate) {
    parts.push(`th.last_message_at >= $${n++}::date`);
    params.push(req.query.startDate);
  }
  if (req.query.endDate) {
    parts.push(`th.last_message_at < ($${n++}::date + interval '1 day')`);
    params.push(req.query.endDate);
  }

  // Bucket presets — applied only when the caller hasn't pinned an exact
  // status. Active = anything not closed.
  if (!req.query.status) {
    if (bucket === "all") {
      /* no implicit status filter */
    } else if (bucket === "starred") {
      parts.push(`th.starred = TRUE`);
    } else if (bucket === "unread") {
      parts.push(`th.unread_count > 0`);
      parts.push(`th.status <> 'closed'`);
    } else if (bucket === "assignedToMe") {
      parts.push(`th.assignee_id = $${n++}`);
      params.push(req.user.id);
      parts.push(`th.status <> 'closed'`);
    } else if (bucket === "unassigned") {
      parts.push(`th.assignee_id IS NULL`);
      parts.push(`th.status <> 'closed'`);
    } else {
      // "open" — show every active thread.
      parts.push(`th.status <> 'closed'`);
    }
  }

  return { where: parts.join(" AND "), params };
}

/** GET /inbox/threads — thread list, paginated. */
export async function getInboxThreads(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 40, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const sort = req.query.sort || "newest";
    const pool = getPool();
    const allowedConnectionIds = await getAllowedConnectionIds(pool, req.user.id);
    if (!allowedConnectionIds.length) {
      res.json({ threads: [], total: 0, limit, offset });
      return;
    }
    const { where, params } = buildThreadWhere(req, allowedConnectionIds);

    let orderBy = "th.last_message_at DESC NULLS LAST";
    if (sort === "oldest") orderBy = "th.last_message_at ASC NULLS LAST";
    if (sort === "priority") orderBy = `${PRIORITY_ORDER_SQL} DESC, th.last_message_at DESC`;
    if (sort === "updated") orderBy = "th.updated_at DESC";

    const q = `
      SELECT th.*,
             u.username AS assignee_username,
             u.display_name AS assignee_name,
             ec.display_name AS mailbox_display_name,
             ec.mailbox_email AS mailbox_email,
             ec.mailbox_type AS mailbox_type,
             ip.permission AS my_permission,
             EXISTS (
               SELECT 1 FROM ticket_ai_drafts tad
               JOIN tickets t2 ON t2.id = tad.ticket_id
               WHERE t2.thread_id = th.thread_id AND tad.used_at IS NULL
             ) AS has_ai_draft_ready,
             (
               SELECT id FROM tickets
                WHERE thread_id = th.thread_id
                  AND deleted_at IS NULL
                  AND direction = 'inbound'
                ORDER BY received_at DESC NULLS LAST, id DESC
                LIMIT 1
             ) AS seed_ticket_id,
             (
               SELECT json_build_object(
                 'sender_name', tt.sender_name,
                 'sender_email', tt.sender_email,
                 'body_preview', tt.body_preview
               )
               FROM tickets tt
               WHERE tt.thread_id = th.thread_id
                 AND tt.deleted_at IS NULL
               ORDER BY tt.received_at DESC NULLS LAST, tt.id DESC
               LIMIT 1
             ) AS latest_message
        FROM threads th
        LEFT JOIN users u ON u.id = th.assignee_id
        LEFT JOIN email_connections ec ON ec.id = th.connection_id
        LEFT JOIN inbox_permissions ip
          ON ip.connection_id = th.connection_id AND ip.user_id = $${params.length + 1}
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`;
    const finalParams = [...params, req.user.id];
    const { rows } = await pool.query(q, finalParams);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM threads th WHERE ${where}`,
      params
    );
    res.json({ threads: rows, total: countRows[0].c, limit, offset });
  } catch (e) {
    console.error("[inbox] threads list", e);
    res.status(500).json({ error: "Could not load threads." });
  }
}

async function userCanViewThread(pool, userId, thread) {
  if (!thread) return false;
  const allowed = await getAllowedConnectionIds(pool, userId);
  if (thread.connection_id) return allowed.includes(Number(thread.connection_id));
  // No connection on the thread row — fall back to looking through tickets.
  const { rows } = await pool.query(
    `SELECT 1 FROM tickets t
       INNER JOIN inbox_permissions ip ON ip.connection_id = t.connection_id AND ip.user_id = $1
       WHERE t.thread_id = $2
       LIMIT 1`,
    [userId, thread.thread_id]
  );
  return rows.length > 0;
}

/** GET /inbox/threads/:thread_id — thread + chronological messages. */
export async function getInboxThread(req, res) {
  try {
    const threadId = String(req.params.thread_id || "").trim();
    if (!threadId) {
      res.status(400).json({ error: "thread_id is required." });
      return;
    }
    const pool = getPool();
    const { rows: tRows } = await pool.query(
      `SELECT th.*,
              u.username AS assignee_username,
              u.display_name AS assignee_name,
              ec.display_name AS mailbox_display_name,
              ec.mailbox_email AS mailbox_email,
              ec.mailbox_type AS mailbox_type,
              ip.permission AS my_permission,
              EXISTS (
                SELECT 1 FROM ticket_ai_drafts tad
                JOIN tickets t2 ON t2.id = tad.ticket_id
                WHERE t2.thread_id = th.thread_id AND tad.used_at IS NULL
              ) AS has_ai_draft_ready
         FROM threads th
         LEFT JOIN users u ON u.id = th.assignee_id
         LEFT JOIN email_connections ec ON ec.id = th.connection_id
         LEFT JOIN inbox_permissions ip
           ON ip.connection_id = th.connection_id AND ip.user_id = $1
        WHERE th.thread_id = $2`,
      [req.user.id, threadId]
    );
    const thread = tRows[0];
    if (!thread) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    if (!(await userCanViewThread(pool, req.user.id, thread))) {
      res.status(403).json({ error: "You don't have access to this mailbox." });
      return;
    }

    const { rows: messages } = await pool.query(
      `SELECT id, external_id, direction, subject, body_preview, body_html,
              sender_name, sender_email, recipient_emails,
              received_at, is_read, has_attachments, ai_summary,
              category, priority
         FROM tickets
        WHERE thread_id = $1 AND deleted_at IS NULL
        ORDER BY received_at ASC NULLS LAST, id ASC`,
      [threadId]
    );

    const { rows: responses } = await pool.query(
      `SELECT tr.id, tr.response_type, tr.body, tr.body_html, tr.sent_via, tr.created_at,
              tr.graph_id, tr.send_status, tr.send_error, tr.sent_at,
              tr.responded_by, u.display_name AS responded_by_name
         FROM ticket_responses tr
         LEFT JOIN users u ON u.id = tr.responded_by
        WHERE tr.ticket_id IN (SELECT id FROM tickets WHERE thread_id = $1)
        ORDER BY COALESCE(tr.sent_at, tr.created_at) ASC, tr.id ASC`,
      [threadId]
    );

    // AI draft seed: latest unused draft on the most recent inbound ticket.
    const { rows: draftRows } = await pool.query(
      `SELECT tad.ticket_id, tad.draft_text, tad.context_used, tad.created_at
         FROM ticket_ai_drafts tad
         JOIN tickets t ON t.id = tad.ticket_id
        WHERE t.thread_id = $1 AND tad.used_at IS NULL
        ORDER BY tad.created_at DESC
        LIMIT 1`,
      [threadId]
    );
    const aiDraft = draftRows[0]
      ? {
          ticket_id: draftRows[0].ticket_id,
          draft_text: draftRows[0].draft_text,
          context_used: draftRows[0].context_used,
          created_at: draftRows[0].created_at,
        }
      : null;

    // Seed ticket id for downstream actions that are still ticket-scoped
    // (AI draft generate/dismiss live on /inbox/tickets/:id/ai-draft).
    const seedTicketId = messages.length
      ? messages.filter((m) => m.direction !== "outbound").slice(-1)[0]?.id ?? messages[0].id
      : null;

    res.json({ thread, messages, responses, ai_draft: aiDraft, seed_ticket_id: seedTicketId });
  } catch (e) {
    console.error("[inbox] thread detail", e);
    res.status(500).json({ error: "Could not load thread." });
  }
}

/** POST /inbox/threads/:thread_id/read — mark every message in a thread as
 *  read. Updates the underlying tickets; the trigger recomputes unread_count. */
export async function postInboxThreadMarkRead(req, res) {
  try {
    const threadId = String(req.params.thread_id || "").trim();
    if (!threadId) {
      res.status(400).json({ error: "thread_id is required." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM threads WHERE thread_id = $1`, [threadId]);
    if (!rows.length) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    if (!(await userCanViewThread(pool, req.user.id, rows[0]))) {
      res.status(403).json({ error: "You don't have access to this mailbox." });
      return;
    }
    await pool.query(
      `UPDATE tickets SET is_read = TRUE, updated_at = NOW()
        WHERE thread_id = $1 AND is_read = FALSE`,
      [threadId]
    );
    // Recompute unread_count on the thread (the trigger doesn't fire on
    // is_read updates with no thread_id change).
    await pool.query(
      `UPDATE threads
         SET unread_count = (
               SELECT COUNT(*) FROM tickets
                WHERE thread_id = $1 AND is_read = FALSE AND deleted_at IS NULL
             ),
             updated_at = NOW()
       WHERE thread_id = $1`,
      [threadId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[inbox] mark thread read", e);
    res.status(500).json({ error: "Could not mark thread as read." });
  }
}

/** PATCH /inbox/threads/:thread_id — update status / assignee / category /
 *  priority / starred. Records last_touched_by/at. */
export async function patchInboxThread(req, res) {
  try {
    const threadId = String(req.params.thread_id || "").trim();
    if (!threadId) {
      res.status(400).json({ error: "thread_id is required." });
      return;
    }
    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT * FROM threads WHERE thread_id = $1`,
      [threadId]
    );
    if (!existing.length) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    if (!(await userCanViewThread(pool, req.user.id, existing[0]))) {
      res.status(403).json({ error: "You don't have access to this mailbox." });
      return;
    }

    const sets = [];
    const vals = [];
    let n = 1;
    const body = req.body ?? {};

    if (body.status !== undefined) {
      if (!VALID_THREAD_STATUSES.has(String(body.status))) {
        res.status(400).json({
          error: `status must be one of: ${[...VALID_THREAD_STATUSES].join(", ")}.`,
        });
        return;
      }
      sets.push(`status = $${n++}`);
      vals.push(String(body.status));
    }
    if (body.assignee_id !== undefined || body.assignedTo !== undefined) {
      const raw = body.assignee_id !== undefined ? body.assignee_id : body.assignedTo;
      if (raw === null || raw === "") {
        sets.push(`assignee_id = NULL`);
      } else {
        const n2 = Number(raw);
        if (!Number.isFinite(n2)) {
          res.status(400).json({ error: "assignee_id must be a user id or null." });
          return;
        }
        sets.push(`assignee_id = $${n++}`);
        vals.push(n2);
      }
    }
    if (body.category !== undefined) {
      if (body.category === null) {
        sets.push(`category = NULL`);
      } else {
        sets.push(`category = $${n++}`);
        vals.push(String(body.category));
      }
    }
    if (body.priority !== undefined) {
      if (!VALID_PRIORITIES.has(String(body.priority))) {
        res.status(400).json({
          error: `priority must be one of: ${[...VALID_PRIORITIES].join(", ")}.`,
        });
        return;
      }
      sets.push(`priority = $${n++}`);
      vals.push(String(body.priority));
    }
    if (body.starred !== undefined || body.isStarred !== undefined) {
      const v = body.starred !== undefined ? body.starred : body.isStarred;
      sets.push(`starred = $${n++}`);
      vals.push(!!v);
    }

    if (!sets.length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }

    sets.push(`last_touched_by = $${n++}`);
    vals.push(req.user.id);
    sets.push(`last_touched_at = NOW()`);
    sets.push(`updated_at = NOW()`);
    vals.push(threadId);

    const { rows } = await pool.query(
      `UPDATE threads SET ${sets.join(", ")}
        WHERE thread_id = $${n}
        RETURNING *`,
      vals
    );

    // Mirror status / assignment back onto the underlying tickets so existing
    // message-level views stay coherent. The "starred" flag is intentionally
    // not mirrored — it's a thread-level attribute now.
    const finalRow = rows[0];
    const ticketStatus = threadStatusToTicketStatus(finalRow.status);
    if (body.status !== undefined && ticketStatus) {
      await pool.query(
        `UPDATE tickets SET status = $1, updated_at = NOW()
          WHERE thread_id = $2 AND deleted_at IS NULL`,
        [ticketStatus, threadId]
      );
    }
    if (body.assignee_id !== undefined || body.assignedTo !== undefined) {
      await pool.query(
        `UPDATE tickets SET assigned_to = $1, updated_at = NOW()
          WHERE thread_id = $2 AND deleted_at IS NULL`,
        [finalRow.assignee_id, threadId]
      );
    }

    res.json({ thread: finalRow });
  } catch (e) {
    console.error("[inbox] patch thread", e);
    res.status(500).json({ error: "Could not update thread." });
  }
}

function threadStatusToTicketStatus(s) {
  if (s === "open") return "open";
  if (s === "closed") return "resolved";
  if (s && s.startsWith("waiting_on_")) return "waiting";
  if (s === "snoozed") return "waiting";
  return null;
}

/** POST /inbox/threads/:thread_id/messages — send a reply on the thread.
 *  Routes through the existing email-send path so Graph IDs / SLA hooks
 *  / triggers all run. The seed message is the most-recent inbound ticket
 *  on the thread. */
export async function postInboxThreadReply(req, res) {
  try {
    const threadId = String(req.params.thread_id || "").trim();
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!threadId) {
      res.status(400).json({ error: "thread_id is required." });
      return;
    }
    if (!body) {
      res.status(400).json({ error: "body is required." });
      return;
    }
    const pool = getPool();
    const { rows: tRows } = await pool.query(
      `SELECT * FROM threads WHERE thread_id = $1`,
      [threadId]
    );
    const thread = tRows[0];
    if (!thread) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    if (!(await userCanViewThread(pool, req.user.id, thread))) {
      res.status(403).json({ error: "You don't have access to this mailbox." });
      return;
    }

    // Find the most-recent inbound ticket on the thread; that's the message
    // we'll reply to via Graph.
    const { rows: ticketRows } = await pool.query(
      `SELECT id, external_id, connection_id
         FROM tickets
        WHERE thread_id = $1 AND deleted_at IS NULL AND external_id IS NOT NULL
        ORDER BY received_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [threadId]
    );
    if (!ticketRows.length) {
      res.status(409).json({ error: "Thread has no message to reply to." });
      return;
    }
    const seed = ticketRows[0];

    const result = await sendTicketReply({ ticketId: seed.id, body, userId: req.user.id });
    res.json({ ok: true, response: result });
  } catch (e) {
    if (e.code === "FORBIDDEN") {
      res.status(403).json({ error: e.message });
      return;
    }
    if (e.code === "SEND_FAILED") {
      res.status(502).json({
        error: e.message || "Microsoft Graph rejected the message.",
        responseId: e.responseId ?? null,
      });
      return;
    }
    console.error("[inbox] thread reply", e);
    res.status(500).json({ error: e.message || "Could not send reply." });
  }
}

/** POST /inbox/threads/:thread_id/sync — manual refresh of one thread (pulls
 *  latest messages from Graph by conversationId; idempotent upsert). */
export async function postInboxThreadSync(req, res) {
  try {
    const threadId = String(req.params.thread_id || "").trim();
    if (!threadId) {
      res.status(400).json({ error: "thread_id is required." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM threads WHERE thread_id = $1`, [threadId]);
    const thread = rows[0];
    if (!thread) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    if (!(await userCanViewThread(pool, req.user.id, thread))) {
      res.status(403).json({ error: "You don't have access to this mailbox." });
      return;
    }
    if (!thread.connection_id) {
      res.status(409).json({ error: "Thread has no connected mailbox to sync from." });
      return;
    }
    const perm = await getUserPermissionOnConnection(pool, req.user.id, thread.connection_id);
    if (!permissionAtLeast(perm, "read")) {
      res.status(403).json({ error: "You don't have access to this mailbox." });
      return;
    }
    const { rows: connRows } = await pool.query(
      `SELECT * FROM email_connections WHERE id = $1`,
      [thread.connection_id]
    );
    if (!connRows.length) {
      res.status(404).json({ error: "Mailbox not found." });
      return;
    }
    // Touch token so refreshThread doesn't have to fail open on auth errors.
    await getValidAccessTokenForConnection(thread.connection_id);
    const result = await graphRefreshThread(connRows[0], threadId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("[inbox] thread sync", e);
    res.status(500).json({ error: e.message || "Could not refresh thread." });
  }
}

/** GET /inbox/thread-stats — thread-level sidebar counts. Replaces the
 *  message-level /inbox/stats counts that were one-row-per-message. */
export async function getInboxThreadStats(req, res) {
  try {
    const pool = getPool();
    const allowed = await getAllowedConnectionIds(pool, req.user.id);
    if (!allowed.length) {
      res.json({
        totalOpen: 0,
        unread: 0,
        assignedToMe: 0,
        unassigned: 0,
        starred: 0,
        byCategory: {},
      });
      return;
    }
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status <> 'closed')::int AS total_open,
         COUNT(*) FILTER (WHERE unread_count > 0 AND status <> 'closed')::int AS unread,
         COUNT(*) FILTER (WHERE assignee_id = $2 AND status <> 'closed')::int AS assigned_to_me,
         COUNT(*) FILTER (WHERE assignee_id IS NULL AND status <> 'closed')::int AS unassigned,
         COUNT(*) FILTER (WHERE starred = TRUE)::int AS starred
       FROM threads
       WHERE connection_id = ANY($1::int[]) OR connection_id IS NULL`,
      [allowed, req.user.id]
    );
    const { rows: catRows } = await pool.query(
      `SELECT COALESCE(category, 'other') AS category, COUNT(*)::int AS c
         FROM threads
        WHERE (connection_id = ANY($1::int[]) OR connection_id IS NULL)
          AND status <> 'closed'
        GROUP BY 1`,
      [allowed]
    );
    const byCategory = {};
    for (const r of catRows) byCategory[r.category] = r.c;
    res.json({
      totalOpen: rows[0]?.total_open ?? 0,
      unread: rows[0]?.unread ?? 0,
      assignedToMe: rows[0]?.assigned_to_me ?? 0,
      unassigned: rows[0]?.unassigned ?? 0,
      starred: rows[0]?.starred ?? 0,
      byCategory,
    });
  } catch (e) {
    console.error("[inbox] thread stats", e);
    res.status(500).json({ error: "Could not load stats." });
  }
}
