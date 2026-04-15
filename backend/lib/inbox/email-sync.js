import { getPool } from "../db.js";
import { classifyTicket } from "./ai-classifier.js";
import { graphGet } from "./graph-client.js";
import { getValidAccessTokenForConnection } from "./microsoft-auth.js";

function iso(d) {
  return d.toISOString();
}

function parseRecipients(msg) {
  const to = msg.toRecipients || [];
  return to
    .map((r) => r.emailAddress?.address)
    .filter(Boolean)
    .join(", ");
}

function bodyFromMessage(msg) {
  const b = msg.body;
  if (!b) return { preview: "", html: "" };
  const content = b.content || "";
  const prev = msg.bodyPreview || String(content).replace(/<[^>]+>/g, " ").slice(0, 500);
  return { preview: prev, html: b.contentType === "html" ? content : `<pre>${escapeHtml(content)}</pre>` };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function messagesPathForConnection(row) {
  const mtype = row.mailbox_type || "personal";
  const mailbox = String(row.mailbox_email || "").trim();
  if (mtype === "shared" && mailbox) {
    return `/users/${encodeURIComponent(mailbox)}/messages`;
  }
  return "/me/messages";
}

export async function syncConnection(connectionRow) {
  const pool = getPool();
  const connId = connectionRow.id;
  const userId = connectionRow.user_id;

  const { accessToken } = await getValidAccessTokenForConnection(connId);

  let since = new Date(Date.now() - 7 * 86400000);
  let lastMessageReceived = null;
  if (connectionRow.sync_last_message_at) {
    since = new Date(new Date(connectionRow.sync_last_message_at).getTime() - 60_000);
    lastMessageReceived = new Date(connectionRow.sync_last_message_at);
  } else {
    const { rows: st } = await pool.query(`SELECT * FROM email_sync_state WHERE user_id = $1`, [userId]);
    if (st[0]?.last_message_received_at) {
      since = new Date(new Date(st[0].last_message_received_at).getTime() - 60_000);
      lastMessageReceived = new Date(st[0].last_message_received_at);
    }
  }

  const sinceIso = iso(since).replace(/\.\d{3}Z$/, "Z");
  const filter = `receivedDateTime ge ${sinceIso}`;
  const basePath = messagesPathForConnection(connectionRow);
  const q = `${basePath}?$orderby=receivedDateTime desc&$top=50&$filter=${encodeURIComponent(filter)}&$select=id,subject,bodyPreview,body,from,toRecipients,receivedDateTime,conversationId,hasAttachments,isRead`;

  await pool.query(
    `INSERT INTO email_sync_state (user_id, sync_status, messages_synced, error_log)
     VALUES ($1, 'running', 0, NULL)
     ON CONFLICT (user_id) DO UPDATE SET sync_status = 'running', error_log = NULL`,
    [userId]
  );

  let data;
  try {
    data = await graphGet(q, accessToken);
  } catch (e) {
    await pool.query(`UPDATE email_sync_state SET sync_status = 'error', error_log = $2 WHERE user_id = $1`, [
      userId,
      e.message || String(e),
    ]);
    throw e;
  }

  const messages = data.value || [];
  let synced = 0;
  let newest = lastMessageReceived;

  for (const msg of messages) {
    const extId = msg.id;
    if (!extId) continue;
    const received = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
    if (!newest || received > newest) newest = received;

    const from = msg.from?.emailAddress || {};
    const senderName = from.name || "";
    const senderEmail = from.address || "";
    const { preview, html } = bodyFromMessage(msg);
    const recipients = parseRecipients(msg);

    try {
      const ins = await pool.query(
        `INSERT INTO tickets (
          channel, external_id, thread_id, subject, body_preview, body_html,
          sender_name, sender_email, recipient_emails, has_attachments, is_read,
          received_at, source_user_id, connection_id, status
        ) VALUES (
          'email', $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, 'open'
        )
        ON CONFLICT (external_id) DO NOTHING
        RETURNING id`,
        [
          extId,
          msg.conversationId || null,
          (msg.subject || "").slice(0, 500),
          preview,
          html,
          senderName.slice(0, 255),
          senderEmail.slice(0, 255),
          recipients,
          !!msg.hasAttachments,
          msg.isRead !== false,
          received,
          userId,
          connId,
        ]
      );

      if (ins.rows.length) {
        synced += 1;
        const ticketId = ins.rows[0].id;
        classifyTicket(ticketId).catch((err) => console.error("[inbox] classify", ticketId, err.message));
      }
    } catch (e) {
      if (e.code === "23505") continue;
      throw e;
    }
  }

  await pool.query(
    `UPDATE email_connections SET last_sync_at = NOW(), sync_last_message_at = COALESCE($2::timestamptz, sync_last_message_at) WHERE id = $1`,
    [connId, newest]
  );
  await pool.query(
    `UPDATE email_sync_state SET
       last_sync_at = NOW(),
       last_message_received_at = COALESCE($2::timestamptz, last_message_received_at),
       sync_status = 'idle',
       messages_synced = $3,
       error_log = NULL
     WHERE user_id = $1`,
    [userId, newest, synced]
  );

  return { synced, total: messages.length };
}

/** ON CONFLICT DO NOTHING requires UNIQUE on external_id - we have partial unique index */
export async function runEmailSyncOnce() {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM email_connections WHERE is_active = true`);
  if (!rows.length) return [];
  const results = [];
  for (const row of rows) {
    try {
      const r = await syncConnection(row);
      results.push({ connectionId: row.id, ...r });
    } catch (e) {
      console.error("[inbox] sync connection", row.id, e.message || e);
      results.push({ connectionId: row.id, error: e.message });
    }
  }
  return results;
}
