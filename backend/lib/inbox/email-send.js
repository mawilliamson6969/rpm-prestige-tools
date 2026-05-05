import { getPool } from "../db.js";
import { graphGet, graphPatch, graphPost } from "./graph-client.js";
import { refreshThread } from "./email-delta-sync.js";
import { getUserPermissionOnConnection, permissionAtLeast } from "./inbox-permissions.js";
import { getValidAccessTokenForConnection } from "./microsoft-auth.js";

/**
 * Reply via Microsoft Graph and capture the canonical Graph message id so
 * the reply appears as a real message in the thread within seconds rather
 * than waiting for the next delta cron tick.
 *
 * Flow:
 *   1. Insert a ticket_responses row with send_status = 'pending'.
 *   2. POST createReply → returns a draft message we own (has Graph id).
 *   3. PATCH the body to our HTML (overrides the auto-generated quote).
 *   4. POST /send to dispatch.
 *   5. Stamp graph_id, send_status='sent', sent_at on the row.
 *   6. Fire-and-forget refreshThread to pull the just-sent message + any
 *      out-of-band replies back into the local store.
 *
 * On Graph failure we mark the row send_status='failed', store the error,
 * and rethrow with the message string so the route layer can surface it.
 */

async function resolveConnectionIdForTicket(ticket) {
  const pool = getPool();
  if (ticket.connection_id) return Number(ticket.connection_id);
  const uid = ticket.source_user_id;
  if (!uid) throw new Error("Ticket has no mailbox source.");
  const { rows } = await pool.query(
    `SELECT id FROM email_connections WHERE user_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1`,
    [uid]
  );
  if (!rows.length) throw new Error("No active Microsoft connection for this mailbox.");
  return rows[0].id;
}

function basePathForConnection(row) {
  const mtype = row.mailbox_type || "personal";
  const mailbox = String(row.mailbox_email || "").trim();
  if (mtype === "shared" && mailbox) return `/users/${encodeURIComponent(mailbox)}`;
  return "/me";
}

function isHtml(s) {
  return /<[a-z][\s\S]*>/i.test(s || "");
}

export async function sendTicketReply({ ticketId, body, userId }) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]);
  if (!rows.length) throw new Error("Ticket not found.");
  const ticket = rows[0];
  if (!ticket.external_id) throw new Error("Ticket has no Graph message id.");

  const connId = await resolveConnectionIdForTicket(ticket);
  const perm = await getUserPermissionOnConnection(pool, userId, connId);
  if (!permissionAtLeast(perm, "reply")) {
    const e = new Error("You have read-only access to this mailbox.");
    e.code = "FORBIDDEN";
    throw e;
  }

  const { accessToken, connection } = await getValidAccessTokenForConnection(connId);
  const base = basePathForConnection(connection);
  const mid = encodeURIComponent(ticket.external_id);

  // 1) Stage a pending row so the UI has something to show / track even if
  //    the network call hangs partway through.
  const insert = await pool.query(
    `INSERT INTO ticket_responses (ticket_id, response_type, body, sent_via, responded_by, send_status)
     VALUES ($1, 'reply', $2, 'graph', $3, 'pending')
     RETURNING id`,
    [ticketId, body, userId]
  );
  const responseId = insert.rows[0].id;

  let graphId = null;
  let sentAt = null;
  try {
    // 2) createReply gives us a draft we own — that's where the Graph id comes from.
    const draft = await graphPost(`${base}/messages/${mid}/createReply`, accessToken, {});
    graphId = draft?.id;
    if (!graphId) throw new Error("Graph did not return a draft message id.");

    // 3) Replace the auto-generated body with our HTML/text.
    if (body && body.trim()) {
      await graphPatch(`${base}/messages/${encodeURIComponent(graphId)}`, accessToken, {
        body: { contentType: isHtml(body) ? "html" : "text", content: body },
      });
    }

    // 4) Send. Returns 202 with no body.
    await graphPost(`${base}/messages/${encodeURIComponent(graphId)}/send`, accessToken, undefined);

    // 5) Refresh the draft to pick up the canonical sentDateTime.
    sentAt = new Date();
    try {
      const sent = await graphGet(
        `${base}/messages/${encodeURIComponent(graphId)}?$select=sentDateTime`,
        accessToken
      );
      if (sent?.sentDateTime) sentAt = new Date(sent.sentDateTime);
    } catch {
      // Non-fatal — we'll just use NOW() locally.
    }
  } catch (e) {
    const msg = e.message || String(e);
    await pool.query(
      `UPDATE ticket_responses
         SET send_status = 'failed', send_error = $2, sent_at = NOW()
       WHERE id = $1`,
      [responseId, msg]
    );
    const wrapped = new Error(msg);
    wrapped.code = "SEND_FAILED";
    wrapped.responseId = responseId;
    throw wrapped;
  }

  await pool.query(
    `UPDATE ticket_responses
       SET graph_id = $2, send_status = 'sent', sent_at = $3, send_error = NULL
     WHERE id = $1`,
    [responseId, graphId, sentAt]
  );

  await pool.query(
    `UPDATE tickets
       SET first_response_at = COALESCE(first_response_at, NOW()),
           updated_at = NOW(),
           status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
     WHERE id = $1`,
    [ticketId]
  );

  await pool.query(
    `UPDATE ticket_ai_drafts SET used_at = NOW() WHERE ticket_id = $1 AND used_at IS NULL`,
    [ticketId]
  );

  // 6) Fire-and-forget thread refresh so the just-sent message + any
  //    out-of-band replies appear quickly in the UI.
  const conversationId = ticket.thread_id || null;
  if (conversationId) {
    refreshThread(connection, conversationId).catch((err) =>
      console.error("[email-send] post-send refresh failed", err.message || err)
    );
  }

  return { ok: true, responseId, graphId, sentAt };
}
