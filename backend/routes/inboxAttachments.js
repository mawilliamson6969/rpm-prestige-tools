/**
 * Phase 5: attachment download / preview / lazy-fetch endpoints, plus the
 * multipart variant of the thread reply endpoint.
 *
 * Permission model: a user can download an attachment iff they have any
 * inbox permission on the connection that owns the underlying message
 * (same gate as `userCanViewThread`). We share the helper with
 * inboxThreads via inbox-permissions.
 */

import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { getPool } from "../lib/db.js";
import { getAllowedConnectionIds } from "../lib/inbox/inbox-permissions.js";
import {
  fetchAttachmentBytes,
  fetchPendingAttachmentsForThread,
} from "../lib/inbox/attachments-graph.js";
import {
  absolutePathFor,
  adoptFile,
  ensureRoot,
  rootDir,
  MAX_TOTAL_BYTES,
  validateAttachment,
} from "../lib/inbox/attachments-storage.js";
import { getValidAccessTokenForConnection } from "../lib/inbox/microsoft-auth.js";

// ---- Multer ----------------------------------------------------------------

const tempStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureRoot();
      const tmp = path.join(rootDir(), "_inbox-tmp");
      await fs.mkdir(tmp, { recursive: true });
      cb(null, tmp);
    } catch (e) {
      cb(e);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const inboxAttachmentUpload = multer({
  storage: tempStorage,
  limits: { fileSize: MAX_TOTAL_BYTES, files: 10 },
}).array("attachments", 10);

// ---- Permission gate -------------------------------------------------------

async function loadAttachmentForUser(pool, attachmentId, userId) {
  const { rows } = await pool.query(
    `SELECT a.*, t.connection_id, t.thread_id AS msg_thread_id, t.external_id AS msg_graph_id
       FROM attachments a
       LEFT JOIN tickets t ON t.id = a.message_id
      WHERE a.id = $1`,
    [attachmentId]
  );
  if (!rows.length) return { error: "Attachment not found.", status: 404 };
  const row = rows[0];
  const allowed = await getAllowedConnectionIds(pool, userId);
  if (row.connection_id && !allowed.includes(Number(row.connection_id))) {
    return { error: "You don't have access to this mailbox.", status: 403 };
  }
  if (!row.connection_id) {
    // Legacy / orphan: fall back to checking via the thread.
    const { rows: tRows } = await pool.query(
      `SELECT 1 FROM tickets t
         INNER JOIN inbox_permissions ip ON ip.connection_id = t.connection_id AND ip.user_id = $1
         WHERE t.thread_id = $2 LIMIT 1`,
      [userId, row.thread_id]
    );
    if (!tRows.length) return { error: "You don't have access to this attachment.", status: 403 };
  }
  return { row };
}

// ---- Inline / lazy fetch on demand ----------------------------------------

async function ensureBytesOnDisk(row) {
  if (row.storage_path) return row;
  if (row.direction !== "inbound") {
    throw Object.assign(new Error("No bytes for outbound attachment without a storage_path."), { http: 410 });
  }
  if (!row.graph_id || !row.msg_graph_id || !row.connection_id) {
    throw Object.assign(new Error("Cannot fetch — attachment is missing Graph metadata."), { http: 410 });
  }
  const { accessToken, connection } = await getValidAccessTokenForConnection(row.connection_id);
  const bytes = await fetchAttachmentBytes(connection, row.msg_graph_id, row.graph_id, accessToken);
  if (!bytes?.buffer) {
    throw Object.assign(new Error("Microsoft Graph returned no bytes for this attachment."), { http: 502 });
  }
  // We stream to disk via writeBuffer to keep the storage layout consistent.
  const { writeBuffer } = await import("../lib/inbox/attachments-storage.js");
  const rel = await writeBuffer({
    threadId: row.msg_thread_id || "_unknown",
    filename: row.filename,
    buffer: bytes.buffer,
  });
  const pool = getPool();
  await pool.query(
    `UPDATE attachments SET storage_path = $1, fetched_at = NOW() WHERE id = $2`,
    [rel, row.id]
  );
  return { ...row, storage_path: rel };
}

// ---- Streaming helpers -----------------------------------------------------

function streamAttachment(res, row, { inline }) {
  if (!row.storage_path) {
    res.status(409).json({ error: "Attachment bytes not available — try again in a few seconds." });
    return;
  }
  let absolute;
  try {
    absolute = absolutePathFor(row.storage_path);
  } catch (e) {
    console.error("[inbox-attach] path escape", row.id, e.message || e);
    res.status(500).json({ error: "Could not resolve attachment path." });
    return;
  }
  res.setHeader("Content-Type", row.content_type || "application/octet-stream");
  if (row.size_bytes != null) res.setHeader("Content-Length", String(row.size_bytes));
  const safeFilename = String(row.filename || "attachment").replace(/"/g, "");
  const disposition = inline ? "inline" : "attachment";
  res.setHeader("Content-Disposition", `${disposition}; filename="${safeFilename}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const stream = createReadStream(absolute);
  stream.on("error", (e) => {
    console.error("[inbox-attach] stream error", row.id, e.message || e);
    if (!res.headersSent) res.status(500).end();
  });
  stream.pipe(res);
}

// ---- Routes ----------------------------------------------------------------

export async function getInboxAttachmentDownload(req, res) {
  await streamForRequest(req, res, { inline: false });
}

export async function getInboxAttachmentPreview(req, res) {
  await streamForRequest(req, res, { inline: true });
}

async function streamForRequest(req, res, { inline }) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid attachment id." });
      return;
    }
    const pool = getPool();
    const loaded = await loadAttachmentForUser(pool, id, req.user.id);
    if (loaded.error) {
      res.status(loaded.status).json({ error: loaded.error });
      return;
    }
    let row = loaded.row;
    if (!row.storage_path) {
      try {
        row = await ensureBytesOnDisk(row);
      } catch (e) {
        const status = e.http || 500;
        res.status(status).json({ error: e.message || "Could not fetch attachment bytes." });
        return;
      }
    }
    streamAttachment(res, row, { inline });
  } catch (e) {
    console.error("[inbox-attach] stream", e);
    if (!res.headersSent) res.status(500).json({ error: "Could not stream attachment." });
  }
}

/** POST /inbox/threads/:thread_id/messages-with-attachments
 *  Multipart variant of the thread reply endpoint. Files arrive as the
 *  `attachments` field; the reply body comes in as `body`. We delegate the
 *  Graph send to email-send.js after collecting + validating files. */
export async function postInboxThreadReplyWithAttachments(req, res) {
  const cleanups = (req.files || []).map((f) => f.path);
  const cleanupTemp = async () => {
    for (const p of cleanups) {
      try {
        await fs.unlink(p);
      } catch {
        /* ignore */
      }
    }
  };
  try {
    const threadId = String(req.params.thread_id || "").trim();
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!threadId) {
      res.status(400).json({ error: "thread_id is required." });
      await cleanupTemp();
      return;
    }
    if (!body && (!req.files || !req.files.length)) {
      res.status(400).json({ error: "body or attachments required." });
      await cleanupTemp();
      return;
    }
    const files = req.files || [];
    let total = 0;
    for (const f of files) {
      const v = validateAttachment({
        filename: f.originalname,
        contentType: f.mimetype,
        size: f.size,
      });
      if (!v.ok) {
        res.status(400).json({ error: v.error });
        await cleanupTemp();
        return;
      }
      total += f.size;
    }
    if (total > MAX_TOTAL_BYTES) {
      res.status(400).json({
        error: `Total attachment size ${(total / 1024 / 1024).toFixed(1)} MB exceeds the 25 MB cap.`,
      });
      await cleanupTemp();
      return;
    }

    // Delegate to the existing send path, then attach files between
    // createReply and /send. The send helper accepts a hook for that.
    const { sendTicketReplyWithAttachments } = await import("../lib/inbox/email-send.js");
    const pool = getPool();
    const { rows: tRows } = await pool.query(`SELECT * FROM threads WHERE thread_id = $1`, [threadId]);
    const thread = tRows[0];
    if (!thread) {
      res.status(404).json({ error: "Thread not found." });
      await cleanupTemp();
      return;
    }
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
      await cleanupTemp();
      return;
    }

    const seedTicket = ticketRows[0];
    const result = await sendTicketReplyWithAttachments({
      ticketId: seedTicket.id,
      body,
      userId: req.user.id,
      attachments: files.map((f) => ({
        absolutePath: f.path,
        filename: f.originalname,
        contentType: f.mimetype,
        size: f.size,
      })),
    });

    // After Graph confirms the send, adopt the temp files into canonical
    // storage and persist outbound rows.
    if (result.ok && result.responseId) {
      for (const f of files) {
        try {
          const buffer = await fs.readFile(f.path);
          const rel = await adoptFile({
            threadId,
            filename: f.originalname,
            srcAbsolutePath: f.path,
          });
          await pool.query(
            `INSERT INTO attachments
               (message_id, thread_id, filename, content_type, size_bytes,
                storage_path, storage_kind, direction, fetched_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'disk', 'outbound', NOW())`,
            [
              seedTicket.id,
              threadId,
              f.originalname.slice(0, 500),
              f.mimetype || null,
              buffer.length,
              rel,
            ]
          );
        } catch (e) {
          console.error("[inbox-attach] persist outbound failed", f.originalname, e.message || e);
        }
      }
    }
    res.json({ ok: true, response: result });
  } catch (e) {
    if (e.code === "FORBIDDEN") {
      res.status(403).json({ error: e.message });
      await cleanupTemp();
      return;
    }
    if (e.code === "SEND_FAILED") {
      res.status(502).json({
        error: e.message || "Microsoft Graph rejected the message.",
        responseId: e.responseId ?? null,
      });
      await cleanupTemp();
      return;
    }
    if (e.code === "ATTACHMENT_TOO_LARGE_FOR_INLINE") {
      res.status(400).json({ error: e.message });
      await cleanupTemp();
      return;
    }
    console.error("[inbox-attach] reply with attachments", e);
    if (!res.headersSent) res.status(500).json({ error: e.message || "Could not send reply." });
    await cleanupTemp();
  }
}

/** POST /inbox/threads/:thread_id/fetch-attachments
 *  Manual lazy-fetch trigger. The thread detail endpoint already kicks
 *  this off automatically; this is here so the frontend can re-poll
 *  after a few seconds and the operator can request a refresh. */
export async function postInboxThreadFetchAttachments(req, res) {
  try {
    const threadId = String(req.params.thread_id || "").trim();
    if (!threadId) {
      res.status(400).json({ error: "thread_id is required." });
      return;
    }
    const pool = getPool();
    const allowed = await getAllowedConnectionIds(pool, req.user.id);
    const { rows } = await pool.query(`SELECT connection_id FROM threads WHERE thread_id = $1`, [threadId]);
    if (!rows.length) return res.status(404).json({ error: "Thread not found." });
    if (rows[0].connection_id && !allowed.includes(Number(rows[0].connection_id))) {
      return res.status(403).json({ error: "You don't have access to this mailbox." });
    }
    const result = await fetchPendingAttachmentsForThread(threadId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("[inbox-attach] manual fetch", e);
    res.status(500).json({ error: e.message || "Could not fetch attachments." });
  }
}
