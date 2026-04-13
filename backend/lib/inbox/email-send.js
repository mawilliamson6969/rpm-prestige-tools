import { getPool } from "../db.js";
import { graphPost } from "./graph-client.js";
import { getUserPermissionOnConnection, permissionAtLeast } from "./inbox-permissions.js";
import { getValidAccessTokenForConnection } from "./microsoft-auth.js";

/**
 * Resolve connection id for a ticket (prefers connection_id, then legacy source_user_id mailbox).
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

function replyGraphPath(connectionRow, messageId) {
  const mid = encodeURIComponent(messageId);
  const mtype = connectionRow.mailbox_type || "personal";
  const mailbox = String(connectionRow.mailbox_email || "").trim();
  if (mtype === "shared" && mailbox) {
    return `/users/${encodeURIComponent(mailbox)}/messages/${mid}/reply`;
  }
  return `/me/messages/${mid}/reply`;
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
    throw new Error("You have read-only access to this mailbox.");
  }

  const { accessToken, connection } = await getValidAccessTokenForConnection(connId);
  const path = replyGraphPath(connection, ticket.external_id);

  await graphPost(path, accessToken, {
    comment: body,
  });

  await pool.query(
    `INSERT INTO ticket_responses (ticket_id, response_type, body, sent_via, responded_by)
     VALUES ($1, 'reply', $2, 'graph', $3)`,
    [ticketId, body, userId]
  );

  await pool.query(
    `UPDATE tickets SET first_response_at = COALESCE(first_response_at, NOW()), updated_at = NOW(), status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END WHERE id = $1`,
    [ticketId]
  );

  await pool.query(`UPDATE ticket_ai_drafts SET used_at = NOW() WHERE ticket_id = $1 AND used_at IS NULL`, [ticketId]);

  return { ok: true };
}
