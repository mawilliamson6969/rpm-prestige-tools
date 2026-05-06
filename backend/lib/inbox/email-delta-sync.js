/**
 * Microsoft Graph delta-based mailbox sync.
 *
 * Replaces the old timestamp-window approach. Per-mailbox state lives in
 * `mailbox_sync_state.delta_link`; on the first run we bootstrap (initial
 * sync) and on subsequent runs we follow the saved delta link.
 *
 * Failure modes handled here:
 *   - 410 Gone (delta token expired ~30 days idle) → clear link, re-bootstrap
 *   - Per-message upsert errors → log and continue (don't abort the run)
 *   - Network/Graph 5xx → record on mailbox_sync_state.last_error and rethrow
 *     so the caller's notification surface picks it up
 *
 * Inbound only: outbound replies live in `ticket_responses` and are written
 * by `email-send.js`. After a send, `refreshThread` (this file) fetches the
 * conversation and reconciles.
 */

import { getPool } from "../db.js";
import { classifyTicket } from "./ai-classifier.js";
import { ingestInboundAttachments } from "./attachments-graph.js";
import { graphGet } from "./graph-client.js";
import { getValidAccessTokenForConnection } from "./microsoft-auth.js";

const DELTA_PAGE_SIZE = 50;
/** Fields fetched from Graph for both delta and conversation refresh. */
const SELECT_FIELDS =
  "id,subject,bodyPreview,body,from,toRecipients,receivedDateTime,sentDateTime,conversationId,hasAttachments,isRead";

function basePathForConnection(row) {
  const mtype = row.mailbox_type || "personal";
  const mailbox = String(row.mailbox_email || "").trim();
  if (mtype === "shared" && mailbox) return `/users/${encodeURIComponent(mailbox)}`;
  return "/me";
}

/** Inbox-folder delta endpoint. We scope to Inbox so move/archive doesn't
 *  resurface old mail; sent items are picked up by refreshThread on send. */
function deltaBootstrapUrl(row) {
  return `${basePathForConnection(row)}/mailFolders/Inbox/messages/delta?$select=${SELECT_FIELDS}&$top=${DELTA_PAGE_SIZE}`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bodyFromMessage(msg) {
  const b = msg.body;
  if (!b) return { preview: msg.bodyPreview || "", html: "" };
  const content = b.content || "";
  const prev = msg.bodyPreview || String(content).replace(/<[^>]+>/g, " ").slice(0, 500);
  return { preview: prev, html: b.contentType === "html" ? content : `<pre>${escapeHtml(content)}</pre>` };
}

function parseRecipients(msg) {
  return (msg.toRecipients || [])
    .map((r) => r.emailAddress?.address)
    .filter(Boolean)
    .join(", ");
}

async function getSyncState(pool, connectionId) {
  await pool.query(
    `INSERT INTO mailbox_sync_state (connection_id) VALUES ($1) ON CONFLICT (connection_id) DO NOTHING`,
    [connectionId]
  );
  const { rows } = await pool.query(
    `SELECT * FROM mailbox_sync_state WHERE connection_id = $1`,
    [connectionId]
  );
  return rows[0];
}

/** Idempotent message upsert. ON CONFLICT (external_id) means a Graph message
 *  appearing both in delta and a later refreshThread is a no-op. Returns
 *  `{ inserted: boolean, ticketId: number | null }`. */
async function upsertInboundMessage(pool, connectionRow, msg) {
  const extId = msg.id;
  if (!extId) return { inserted: false, ticketId: null };

  const received = msg.receivedDateTime
    ? new Date(msg.receivedDateTime)
    : msg.sentDateTime
      ? new Date(msg.sentDateTime)
      : new Date();
  const from = msg.from?.emailAddress || {};
  const senderName = String(from.name || "").slice(0, 255);
  const senderEmail = String(from.address || "").slice(0, 255);
  const { preview, html } = bodyFromMessage(msg);

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
      senderName,
      senderEmail,
      parseRecipients(msg),
      !!msg.hasAttachments,
      msg.isRead !== false,
      received,
      connectionRow.user_id,
      connectionRow.id,
    ]
  );
  return { inserted: ins.rows.length > 0, ticketId: ins.rows[0]?.id ?? null };
}

async function markMessageDeleted(pool, externalId) {
  if (!externalId) return;
  await pool.query(
    `UPDATE tickets SET deleted_at = NOW(), updated_at = NOW()
     WHERE external_id = $1 AND deleted_at IS NULL`,
    [externalId]
  );
}

async function recordSyncError(pool, connectionId, message) {
  await pool.query(
    `INSERT INTO mailbox_sync_state (connection_id, last_error, last_error_at, last_synced_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (connection_id) DO UPDATE SET
       last_error = EXCLUDED.last_error,
       last_error_at = EXCLUDED.last_error_at,
       last_synced_at = EXCLUDED.last_synced_at`,
    [connectionId, message]
  );
}

async function recordSyncSuccess(pool, connectionId, deltaLink, processed) {
  await pool.query(
    `UPDATE mailbox_sync_state SET
       delta_link = $2,
       last_synced_at = NOW(),
       last_success_at = NOW(),
       last_error = NULL,
       last_error_at = NULL,
       full_sync_in_progress = FALSE,
       messages_processed = messages_processed + $3
     WHERE connection_id = $1`,
    [connectionId, deltaLink, processed]
  );
}

function isExpiredDeltaTokenError(err) {
  if (!err) return false;
  if (err.status === 410) return true;
  // Graph occasionally returns 400 with code "syncStateNotFound" / "syncStateInvalid".
  const code = String(err.graphCode || "").toLowerCase();
  return code.includes("syncstate") || code === "resyncrequired";
}

/**
 * Run delta sync against one mailbox. Returns
 *   { processed: number, removed: number, bootstrapped: boolean }.
 * Throws on unrecoverable Graph error after recording it on mailbox_sync_state.
 */
export async function syncConnection(connectionRow) {
  const pool = getPool();
  const connId = connectionRow.id;
  const { accessToken } = await getValidAccessTokenForConnection(connId);

  let state = await getSyncState(pool, connId);
  let bootstrapped = false;
  let url = state.delta_link;
  if (!url) {
    bootstrapped = true;
    url = deltaBootstrapUrl(connectionRow);
    await pool.query(
      `UPDATE mailbox_sync_state SET full_sync_in_progress = TRUE WHERE connection_id = $1`,
      [connId]
    );
  }

  let processed = 0;
  let removed = 0;
  let nextDeltaLink = null;

  while (url) {
    let response;
    try {
      response = await graphGet(url, accessToken);
    } catch (err) {
      if (isExpiredDeltaTokenError(err) && !bootstrapped) {
        // Token aged out — clear and bootstrap from scratch on next run.
        await pool.query(
          `UPDATE mailbox_sync_state SET delta_link = NULL, full_sync_in_progress = TRUE WHERE connection_id = $1`,
          [connId]
        );
        bootstrapped = true;
        url = deltaBootstrapUrl(connectionRow);
        continue;
      }
      const msg = err.message || String(err);
      await recordSyncError(pool, connId, msg);
      throw err;
    }

    for (const msg of response.value || []) {
      try {
        if (msg["@removed"]) {
          await markMessageDeleted(pool, msg.id);
          removed += 1;
        } else {
          const { inserted, ticketId } = await upsertInboundMessage(pool, connectionRow, msg);
          processed += 1;
          if (inserted && ticketId) {
            classifyTicket(ticketId).catch((e) =>
              console.error("[delta-sync] classify failed", ticketId, e.message || e)
            );
            if (msg.hasAttachments) {
              ingestInboundAttachments({
                connectionRow,
                messageId: ticketId,
                threadId: msg.conversationId || null,
                messageGraphId: msg.id,
              }).catch((e) =>
                console.error("[delta-sync] attachment ingest failed", ticketId, e.message || e)
              );
            }
          }
        }
      } catch (e) {
        // Per-message failure is non-fatal — log and keep going so a single
        // bad row doesn't strand the rest of the batch.
        console.error("[delta-sync] upsert failed", msg.id, e.message || e);
      }
    }

    if (response["@odata.nextLink"]) {
      url = response["@odata.nextLink"];
    } else if (response["@odata.deltaLink"]) {
      nextDeltaLink = response["@odata.deltaLink"];
      url = null;
    } else {
      url = null;
    }
  }

  if (!nextDeltaLink) {
    // Defensive: every page should yield either nextLink or deltaLink. If we
    // got neither, keep the previous delta_link so we don't lose our place.
    nextDeltaLink = state.delta_link ?? null;
  }
  await recordSyncSuccess(pool, connId, nextDeltaLink, processed);

  // Mirror legacy fields used by the existing settings UI.
  await pool.query(
    `UPDATE email_connections SET last_sync_at = NOW() WHERE id = $1`,
    [connId]
  );

  return { processed, removed, bootstrapped };
}

/**
 * Refresh a single conversation by Graph filter. Used immediately after a
 * send so the just-sent message + any new replies appear within seconds.
 *
 * Skips outbound messages (from = our mailbox) — those are tracked on
 * `ticket_responses` by the send flow, and inserting them into `tickets`
 * would confuse the inbound list view.
 */
export async function refreshThread(connectionRow, conversationId) {
  if (!conversationId) return { processed: 0, linked: 0 };
  const pool = getPool();
  const { accessToken } = await getValidAccessTokenForConnection(connectionRow.id);
  const ourMailbox = String(connectionRow.mailbox_email || "").toLowerCase().trim();

  const filter = `conversationId eq '${String(conversationId).replace(/'/g, "''")}'`;
  const path = `${basePathForConnection(connectionRow)}/messages?$filter=${encodeURIComponent(
    filter
  )}&$top=100&$select=${SELECT_FIELDS}`;

  let response;
  try {
    response = await graphGet(path, accessToken);
  } catch (e) {
    console.error("[refreshThread] graph failed", conversationId, e.message || e);
    return { processed: 0, linked: 0, error: e.message || String(e) };
  }

  let processed = 0;
  let linked = 0;
  for (const msg of response.value || []) {
    const fromEmail = String(msg.from?.emailAddress?.address || "").toLowerCase().trim();
    if (ourMailbox && fromEmail === ourMailbox) {
      // Outbound — link to a pending ticket_responses row by graph_id, or by
      // (thread + close-in-time) for the legacy case where graph_id wasn't
      // captured at send time.
      const linkedRow = await reconcileOutboundResponse(pool, connectionRow, msg);
      if (linkedRow) linked += 1;
      continue;
    }
    try {
      await upsertInboundMessage(pool, connectionRow, msg);
      processed += 1;
    } catch (e) {
      console.error("[refreshThread] upsert failed", msg.id, e.message || e);
    }
  }
  return { processed, linked };
}

/** Match a Graph outbound message to an existing ticket_responses row.
 *  Returns true if linked. */
async function reconcileOutboundResponse(pool, connectionRow, msg) {
  // 1) Already linked? Done.
  const exists = await pool.query(
    `SELECT 1 FROM ticket_responses WHERE graph_id = $1 LIMIT 1`,
    [msg.id]
  );
  if (exists.rowCount) return false;

  // 2) Find a recently-sent response on this thread that hasn't been linked
  //    yet. We restrict to the same connection's tickets via `ticket_id`.
  const sentAt = msg.sentDateTime
    ? new Date(msg.sentDateTime)
    : msg.receivedDateTime
      ? new Date(msg.receivedDateTime)
      : new Date();
  const { rows } = await pool.query(
    `SELECT tr.id
       FROM ticket_responses tr
       JOIN tickets t ON t.id = tr.ticket_id
      WHERE tr.graph_id IS NULL
        AND tr.response_type = 'reply'
        AND tr.send_status = 'sent'
        AND t.thread_id = $1
        AND t.connection_id = $2
        AND tr.sent_at IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (tr.sent_at - $3::timestamptz))) < 300
      ORDER BY ABS(EXTRACT(EPOCH FROM (tr.sent_at - $3::timestamptz))) ASC
      LIMIT 1`,
    [msg.conversationId || null, connectionRow.id, sentAt]
  );
  if (!rows.length) return false;
  await pool.query(
    `UPDATE ticket_responses SET graph_id = $1 WHERE id = $2`,
    [msg.id, rows[0].id]
  );
  return true;
}

/** Iterate every active connection. Per-connection failures are isolated so
 *  one broken mailbox doesn't black out the others. */
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
      console.error("[delta-sync] connection failed", row.id, e.message || e);
      results.push({ connectionId: row.id, error: e.message || String(e) });
    }
  }
  return results;
}
