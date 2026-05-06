/**
 * Microsoft Graph integration for attachments.
 *
 * Inbound:
 *   - During delta sync we don't yet have an access token wired here, so
 *     `expandAttachmentsForMessage` is called with one passed in.
 *   - `fetchAttachmentBytes(connection, messageGraphId, attGraphId)` pulls
 *     a single attachment's bytes via /attachments/{id}.
 *
 * Outbound:
 *   - `attachFileToGraphMessage(connection, draftMessageId, file)` POSTs a
 *     fileAttachment (inline base64) to the draft message before /send.
 *     Inline mode tops out at ~3 MB; larger files require an upload
 *     session, which is a follow-up.
 */

import { getPool } from "../db.js";
import { graphGet, graphPost } from "./graph-client.js";
import { getValidAccessTokenForConnection } from "./microsoft-auth.js";
import {
  EAGER_FETCH_BYTES,
  MAX_INLINE_BYTES,
  validateAttachment,
  writeBuffer,
} from "./attachments-storage.js";

function basePathForConnection(row) {
  const mtype = row.mailbox_type || "personal";
  const mailbox = String(row.mailbox_email || "").trim();
  if (mtype === "shared" && mailbox) return `/users/${encodeURIComponent(mailbox)}`;
  return "/me";
}

/**
 * Fetch attachment metadata for a Graph message (no bytes). Falls back to
 * a no-op if the message has no attachments. Returns the raw Graph
 * attachment array.
 */
export async function listAttachmentsForMessage(connection, messageGraphId, accessToken) {
  if (!messageGraphId) return [];
  const base = basePathForConnection(connection);
  const url = `${base}/messages/${encodeURIComponent(messageGraphId)}/attachments?$select=id,name,contentType,size,isInline`;
  try {
    const res = await graphGet(url, accessToken);
    return Array.isArray(res?.value) ? res.value : [];
  } catch (e) {
    console.error(
      "[inbox-attach] list failed",
      messageGraphId,
      e.message || e
    );
    return [];
  }
}

/**
 * Fetch a single attachment's bytes (file bytes + filename + contentType).
 * Returns { buffer, filename, contentType, size } or null on failure.
 */
export async function fetchAttachmentBytes(connection, messageGraphId, attGraphId, accessToken) {
  if (!messageGraphId || !attGraphId) return null;
  const base = basePathForConnection(connection);
  // The JSON variant returns contentBytes (base64) for fileAttachment.
  // Anything other than fileAttachment (item / reference) we skip.
  const url = `${base}/messages/${encodeURIComponent(messageGraphId)}/attachments/${encodeURIComponent(attGraphId)}`;
  try {
    const res = await graphGet(url, accessToken);
    if (!res || res["@odata.type"] !== "#microsoft.graph.fileAttachment") return null;
    if (!res.contentBytes) return null;
    return {
      buffer: Buffer.from(res.contentBytes, "base64"),
      filename: res.name,
      contentType: res.contentType || null,
      size: res.size != null ? Number(res.size) : null,
    };
  } catch (e) {
    console.error("[inbox-attach] fetch bytes failed", attGraphId, e.message || e);
    return null;
  }
}

/**
 * Inbound: walk attachments for a freshly-inserted message, persist
 * metadata rows, and (when small enough) eagerly fetch bytes to disk.
 * Idempotent — uses ON CONFLICT (message_id, graph_id) so replays are
 * no-ops.
 *
 * Skips inline attachments (e.g. signature images) because they're
 * already rendered by the email body HTML and we don't want to surface
 * them as standalone files.
 */
export async function ingestInboundAttachments({ connectionRow, messageId, threadId, messageGraphId }) {
  if (!messageGraphId) return { metadata: 0, fetched: 0 };
  const pool = getPool();
  const { accessToken } = await getValidAccessTokenForConnection(connectionRow.id);
  const list = await listAttachmentsForMessage(connectionRow, messageGraphId, accessToken);
  let metadata = 0;
  let fetched = 0;

  for (const att of list) {
    if (att.isInline) continue;
    if (!att.id || !att.name) continue;

    // Validate before allocating any storage. Reject blocked ext outright.
    const validation = validateAttachment({
      filename: att.name,
      contentType: att.contentType,
      size: att.size,
    });
    if (!validation.ok) {
      // Still record a metadata row so the user sees the file existed in
      // the original message — but we never write bytes to disk.
      try {
        await pool.query(
          `INSERT INTO attachments
             (message_id, thread_id, filename, content_type, size_bytes,
              graph_id, direction, is_inline, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'inbound', FALSE, NULL)
           ON CONFLICT (message_id, graph_id) DO NOTHING`,
          [
            messageId,
            threadId,
            String(att.name).slice(0, 500),
            att.contentType ?? null,
            att.size ?? null,
            att.id,
          ]
        );
        metadata += 1;
      } catch (e) {
        console.error("[inbox-attach] meta insert failed", att.id, e.message || e);
      }
      continue;
    }

    // Insert metadata row first (no storage_path yet).
    let attRowId = null;
    try {
      const ins = await pool.query(
        `INSERT INTO attachments
           (message_id, thread_id, filename, content_type, size_bytes,
            graph_id, direction, is_inline, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'inbound', FALSE, NULL)
         ON CONFLICT (message_id, graph_id) DO NOTHING
         RETURNING id`,
        [
          messageId,
          threadId,
          String(att.name).slice(0, 500),
          att.contentType ?? null,
          att.size ?? null,
          att.id,
        ]
      );
      attRowId = ins.rows[0]?.id ?? null;
      if (attRowId) metadata += 1;
    } catch (e) {
      console.error("[inbox-attach] meta insert failed", att.id, e.message || e);
      continue;
    }
    if (!attRowId) continue;

    // Eager fetch only for small files.
    const sizeOk = att.size != null && Number(att.size) <= EAGER_FETCH_BYTES;
    if (!sizeOk) continue;
    try {
      const bytes = await fetchAttachmentBytes(connectionRow, messageGraphId, att.id, accessToken);
      if (!bytes?.buffer) continue;
      const rel = await writeBuffer({
        threadId: threadId || "_unknown",
        filename: att.name,
        buffer: bytes.buffer,
      });
      await pool.query(
        `UPDATE attachments SET storage_path = $1, fetched_at = NOW() WHERE id = $2`,
        [rel, attRowId]
      );
      fetched += 1;
    } catch (e) {
      console.error("[inbox-attach] eager fetch failed", att.id, e.message || e);
    }
  }
  return { metadata, fetched };
}

/**
 * Lazy fetch: pull bytes for any attachments on this thread that don't
 * have storage_path yet. Called from the thread-detail endpoint.
 */
export async function fetchPendingAttachmentsForThread(threadId) {
  if (!threadId) return { fetched: 0 };
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.id, a.message_id, a.graph_id, a.filename, t.external_id AS msg_graph_id, t.connection_id
       FROM attachments a
       JOIN tickets t ON t.id = a.message_id
      WHERE a.thread_id = $1
        AND a.direction = 'inbound'
        AND a.storage_path IS NULL
        AND a.graph_id IS NOT NULL
        AND t.external_id IS NOT NULL
      LIMIT 50`,
    [threadId]
  );
  if (!rows.length) return { fetched: 0 };

  // Group by connection_id so we share a token + connection row.
  const byConn = new Map();
  for (const r of rows) {
    if (!r.connection_id) continue;
    if (!byConn.has(r.connection_id)) byConn.set(r.connection_id, []);
    byConn.get(r.connection_id).push(r);
  }

  let fetched = 0;
  for (const [connectionId, items] of byConn.entries()) {
    let accessToken;
    let connection;
    try {
      const v = await getValidAccessTokenForConnection(connectionId);
      accessToken = v.accessToken;
      connection = v.connection;
    } catch (e) {
      console.error("[inbox-attach] token fetch failed", connectionId, e.message || e);
      continue;
    }
    for (const it of items) {
      try {
        const bytes = await fetchAttachmentBytes(
          connection,
          it.msg_graph_id,
          it.graph_id,
          accessToken
        );
        if (!bytes?.buffer) continue;
        const rel = await writeBuffer({
          threadId,
          filename: it.filename,
          buffer: bytes.buffer,
        });
        await pool.query(
          `UPDATE attachments SET storage_path = $1, fetched_at = NOW() WHERE id = $2`,
          [rel, it.id]
        );
        fetched += 1;
      } catch (e) {
        console.error("[inbox-attach] lazy fetch failed", it.id, e.message || e);
      }
    }
  }
  return { fetched };
}

/**
 * Outbound: attach a single file (already on disk in our storage layout)
 * to a draft Graph message before /send. Caller handles the loop + size
 * caps; this just does the Graph POST.
 */
export async function attachFileToDraft({ connection, accessToken, draftMessageId, filename, contentType, buffer }) {
  if (!buffer || !buffer.length) throw new Error("attachment buffer is empty");
  if (buffer.length > MAX_INLINE_BYTES) {
    const e = new Error(
      `${filename} is ${(buffer.length / 1024 / 1024).toFixed(1)} MB. Inline attachments cap at ${MAX_INLINE_BYTES / 1024 / 1024} MB; upload-session protocol not yet implemented.`
    );
    e.code = "ATTACHMENT_TOO_LARGE_FOR_INLINE";
    throw e;
  }
  const base = basePathForConnection(connection);
  const url = `${base}/messages/${encodeURIComponent(draftMessageId)}/attachments`;
  const body = {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: filename.slice(0, 250),
    contentType: contentType || "application/octet-stream",
    contentBytes: buffer.toString("base64"),
  };
  return graphPost(url, accessToken, body);
}
