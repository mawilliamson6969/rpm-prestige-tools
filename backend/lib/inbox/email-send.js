import { getPool } from "../db.js";
import { graphPost } from "./graph-client.js";
import { getValidAccessTokenForConnection } from "./microsoft-auth.js";

/**
 * Find active email connection for mailbox owner (source_user_id on ticket).
 */
async function getConnectionForTicket(ticket) {
  const pool = getPool();
  const uid = ticket.source_user_id;
  if (!uid) throw new Error("Ticket has no mailbox source.");
  const { rows } = await pool.query(
    `SELECT id FROM email_connections WHERE user_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1`,
    [uid]
  );
  if (!rows.length) throw new Error("No active Microsoft connection for this mailbox.");
  return rows[0].id;
}

export async function sendTicketReply({ ticketId, body, userId }) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]);
  if (!rows.length) throw new Error("Ticket not found.");
  const ticket = rows[0];
  if (!ticket.external_id) throw new Error("Ticket has no Graph message id.");

  const connId = await getConnectionForTicket(ticket);
  const { accessToken } = await getValidAccessTokenForConnection(connId);

  await graphPost(`/me/messages/${encodeURIComponent(ticket.external_id)}/reply`, accessToken, {
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

  return { ok: true };
}
