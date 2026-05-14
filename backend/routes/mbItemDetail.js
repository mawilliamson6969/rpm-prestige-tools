/**
 * Phase 4: item detail — updates feed, mentions, reactions, attachments,
 * AppFolio context, related items.
 *
 * Builds on top of the Phase 1 mb_item_updates table (extended in
 * migration 032). All endpoints require auth. Admin guard is applied
 * only where the spec calls for it (delete-any-comment); read endpoints
 * and own-comment edit/delete are open to any authenticated user.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import multer from "multer";

import { getPool } from "../lib/db.js";
import { vIntId, vStringOpt } from "../lib/mb/validators.js";
import { sanitizeUpdateHtml } from "../lib/mb/sanitizeHtml.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Stored outside the static-served `uploads/` tree. Same pattern as
// agentHubActivities — no public read access; downloads gated by the
// /mb/attachments/:id route below which checks the user can see the
// parent item.
export const MB_ATTACH_ROOT = path.join(
  __dirname,
  "..",
  "uploads-private",
  "mb-updates"
);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);
const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".pdf",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv",
]);
const DISALLOWED_EXT = new Set([
  ".html", ".htm", ".svg", ".js", ".mjs", ".php",
  ".exe", ".bat", ".sh", ".cmd",
]);

async function ensureAttachRoot() {
  await fs.mkdir(MB_ATTACH_ROOT, { recursive: true });
}

const attachStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureAttachRoot();
      cb(null, MB_ATTACH_ROOT);
    } catch (e) {
      cb(e);
    }
  },
  filename: (_req, file, cb) => {
    // Server-generated UUID. NEVER use the client filename as a path —
    // would open path traversal. Keep just the extension for type sniffing.
    const ext = (path.extname(file.originalname || "") || "").toLowerCase();
    const safeExt = ALLOWED_EXT.has(ext) && !DISALLOWED_EXT.has(ext) ? ext : "";
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

export const uploadMbAttachmentMiddleware = multer({
  storage: attachStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || "") || "").toLowerCase();
    if (DISALLOWED_EXT.has(ext)) {
      return cb(new Error("File type not allowed."));
    }
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error("File type not allowed."));
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("File MIME type not allowed."));
    }
    cb(null, true);
  },
}).single("file");

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const COALESCE_WINDOW_MS = 60 * 1000;
const ALLOWED_EMOJI = new Set(["👍", "❤️", "😄", "🎉", "😢", "🚀"]);

// ============================================================
// Helpers
// ============================================================

function isAdmin(user) {
  return user?.role === "admin" || user?.role === "owner";
}

async function attachUpdateExtras(pool, updates) {
  if (updates.length === 0) return updates;
  const ids = updates.map((u) => u.id);

  const [reactionsRes, mentionsRes, attachmentsRes] = await Promise.all([
    pool.query(
      `SELECT r.update_id, r.emoji, r.user_id, u.display_name
         FROM mb_update_reactions r
         LEFT JOIN users u ON u.id = r.user_id
        WHERE r.update_id = ANY($1::int[])`,
      [ids]
    ),
    pool.query(
      `SELECT m.update_id, m.mentioned_user_id, m.seen_at,
              u.display_name AS user_display_name
         FROM mb_update_mentions m
         LEFT JOIN users u ON u.id = m.mentioned_user_id
        WHERE m.update_id = ANY($1::int[])`,
      [ids]
    ),
    pool.query(
      `SELECT id, update_id, filename, storage_path, mime_type,
              size_bytes, uploaded_by, created_at
         FROM mb_update_attachments
        WHERE update_id = ANY($1::int[])`,
      [ids]
    ),
  ]);

  // Bucket reactions by update id, then by emoji.
  const reactionsByUpdate = new Map();
  for (const r of reactionsRes.rows) {
    let bucket = reactionsByUpdate.get(r.update_id);
    if (!bucket) {
      bucket = new Map();
      reactionsByUpdate.set(r.update_id, bucket);
    }
    let row = bucket.get(r.emoji);
    if (!row) {
      row = { emoji: r.emoji, count: 0, users: [] };
      bucket.set(r.emoji, row);
    }
    row.count += 1;
    row.users.push({
      user_id: r.user_id,
      display_name: r.display_name,
    });
  }

  const mentionsByUpdate = new Map();
  for (const m of mentionsRes.rows) {
    const arr = mentionsByUpdate.get(m.update_id) ?? [];
    arr.push({
      mentioned_user_id: m.mentioned_user_id,
      seen_at: m.seen_at,
      display_name: m.user_display_name,
    });
    mentionsByUpdate.set(m.update_id, arr);
  }

  const attachmentsByUpdate = new Map();
  for (const a of attachmentsRes.rows) {
    const arr = attachmentsByUpdate.get(a.update_id) ?? [];
    arr.push({
      id: a.id,
      filename: a.filename,
      mime_type: a.mime_type,
      size_bytes: Number(a.size_bytes),
      uploaded_by: a.uploaded_by,
      created_at: a.created_at,
      // storage_path intentionally NOT exposed to clients
    });
    attachmentsByUpdate.set(a.update_id, arr);
  }

  return updates.map((u) => ({
    ...u,
    reactions: Array.from(reactionsByUpdate.get(u.id)?.values() ?? []),
    mentions: mentionsByUpdate.get(u.id) ?? [],
    attachments: attachmentsByUpdate.get(u.id) ?? [],
  }));
}

// ============================================================
// GET /mb/items/:id/updates
// ============================================================
//
// Returns top-level + replies in one payload, ordered by created_at DESC
// among top-level, with replies grouped under each parent (asc order).
// The client renders the tree without further fetches.

export async function listItemUpdates(req, res) {
  try {
    // Phase 7 rekey: :id is now a process id. Internally we filter by
    // u.process_id (was u.item_id pre-unification).
    const processId = vIntId(req.params.id, "process id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT u.id, u.process_id, u.parent_update_id, u.user_id,
              u.body, u.body_html, u.update_type, u.metadata,
              u.created_at, u.edited_at, u.deleted_at,
              usr.display_name AS user_display_name,
              usr.username     AS user_username
         FROM mb_item_updates u
         LEFT JOIN users usr ON usr.id = u.user_id
        WHERE u.process_id = $1
        ORDER BY
          COALESCE(u.parent_update_id, u.id) DESC,
          u.parent_update_id NULLS FIRST,
          u.created_at ASC,
          u.id ASC
        LIMIT 1000`,
      [processId]
    );
    const enriched = await attachUpdateExtras(pool, rows);
    res.json({ updates: enriched });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] list updates", e);
    res.status(500).json({ error: "Could not load updates." });
  }
}

// ============================================================
// POST /mb/items/:id/updates
// ============================================================

export async function createItemUpdate(req, res) {
  try {
    // Phase 7 rekey: :id is a process id; column is now process_id.
    const processId = vIntId(req.params.id, "process id");
    const body = req.body ?? {};
    const rawHtml = typeof body.body_html === "string" ? body.body_html : "";
    if (!rawHtml.trim() && !Array.isArray(body.attachment_ids)) {
      return res.status(400).json({ error: "Comment body cannot be empty." });
    }
    const { html, text, mentionedUserIds } = sanitizeUpdateHtml(rawHtml);
    if (!text.trim() && (!Array.isArray(body.attachment_ids) || body.attachment_ids.length === 0)) {
      return res.status(400).json({ error: "Comment body cannot be empty." });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO mb_item_updates
           (process_id, user_id, body, body_html, update_type, metadata)
         VALUES ($1, $2, $3, $4, 'comment', '{}'::jsonb)
         RETURNING *`,
        [processId, req.user.id, text, html]
      );
      const update = rows[0];

      // Persist mentions (skip self-mentions for "unseen badge" purposes).
      if (mentionedUserIds.length > 0) {
        await client.query(
          `INSERT INTO mb_update_mentions (update_id, mentioned_user_id)
             SELECT $1, u.id
               FROM users u
              WHERE u.id = ANY($2::int[])
                AND u.active = TRUE
                AND u.id <> $3
           ON CONFLICT (update_id, mentioned_user_id) DO NOTHING`,
          [update.id, mentionedUserIds, req.user.id]
        );
      }

      await client.query("COMMIT");

      const enriched = await attachUpdateExtras(pool, [
        { ...update, user_display_name: req.user.displayName, user_username: req.user.username },
      ]);
      res.status(201).json({ update: enriched[0] });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23503") {
      return res.status(404).json({ error: "Item not found." });
    }
    console.error("[mb] create update", e);
    res.status(500).json({ error: "Could not post comment." });
  }
}

// ============================================================
// POST /mb/updates/:id/replies
// ============================================================

export async function createReply(req, res) {
  try {
    const parentId = vIntId(req.params.id, "update id");
    const body = req.body ?? {};
    const rawHtml = typeof body.body_html === "string" ? body.body_html : "";
    const { html, text, mentionedUserIds } = sanitizeUpdateHtml(rawHtml);
    if (!text.trim() && (!Array.isArray(body.attachment_ids) || body.attachment_ids.length === 0)) {
      return res.status(400).json({ error: "Reply body cannot be empty." });
    }

    const pool = getPool();
    const { rows: parent } = await pool.query(
      `SELECT id, process_id, parent_update_id FROM mb_item_updates WHERE id = $1`,
      [parentId]
    );
    if (!parent.length) return res.status(404).json({ error: "Parent comment not found." });
    if (parent[0].parent_update_id != null) {
      return res.status(400).json({
        error: "Cannot reply to a reply. Only one level of nesting is allowed.",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO mb_item_updates
           (process_id, parent_update_id, user_id, body, body_html, update_type, metadata)
         VALUES ($1, $2, $3, $4, $5, 'comment', '{}'::jsonb)
         RETURNING *`,
        [parent[0].process_id, parentId, req.user.id, text, html]
      );
      const reply = rows[0];

      if (mentionedUserIds.length > 0) {
        await client.query(
          `INSERT INTO mb_update_mentions (update_id, mentioned_user_id)
             SELECT $1, u.id
               FROM users u
              WHERE u.id = ANY($2::int[])
                AND u.active = TRUE
                AND u.id <> $3
           ON CONFLICT (update_id, mentioned_user_id) DO NOTHING`,
          [reply.id, mentionedUserIds, req.user.id]
        );
      }

      await client.query("COMMIT");

      const enriched = await attachUpdateExtras(pool, [
        { ...reply, user_display_name: req.user.displayName, user_username: req.user.username },
      ]);
      res.status(201).json({ update: enriched[0] });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      // Trigger error from "no nested replies" trigger surfaces as 23514.
      if (e.code === "23514") {
        return res
          .status(400)
          .json({ error: "Cannot reply to a reply. Only one level of nesting is allowed." });
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] create reply", e);
    res.status(500).json({ error: "Could not post reply." });
  }
}

// ============================================================
// PATCH /mb/updates/:id  (edit own comment within 15 min)
// ============================================================

export async function updateOwnComment(req, res) {
  try {
    const id = vIntId(req.params.id, "update id");
    const body = req.body ?? {};
    const rawHtml = typeof body.body_html === "string" ? body.body_html : null;
    if (rawHtml == null) {
      return res.status(400).json({ error: "body_html is required." });
    }
    const { html, text, mentionedUserIds } = sanitizeUpdateHtml(rawHtml);
    if (!text.trim()) {
      return res.status(400).json({ error: "Comment body cannot be empty." });
    }

    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT id, user_id, created_at, deleted_at, update_type
         FROM mb_item_updates WHERE id = $1`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ error: "Comment not found." });
    const row = existing[0];
    if (row.deleted_at) return res.status(400).json({ error: "Comment has been deleted." });
    if (row.user_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "You can only edit your own comments." });
    }
    if (row.update_type !== "comment") {
      return res.status(400).json({ error: "Only comments can be edited." });
    }
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > EDIT_WINDOW_MS) {
      return res
        .status(403)
        .json({ error: "Edit window has closed (15 minutes after posting)." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: updated } = await client.query(
        `UPDATE mb_item_updates
            SET body = $1, body_html = $2, edited_at = NOW()
          WHERE id = $3
          RETURNING *`,
        [text, html, id]
      );

      // Diff mentions: delete removed ones, insert added ones.
      await client.query(
        `DELETE FROM mb_update_mentions
          WHERE update_id = $1
            AND mentioned_user_id <> ALL($2::int[])`,
        [id, mentionedUserIds.length > 0 ? mentionedUserIds : [0]]
      );
      if (mentionedUserIds.length > 0) {
        await client.query(
          `INSERT INTO mb_update_mentions (update_id, mentioned_user_id)
             SELECT $1, u.id
               FROM users u
              WHERE u.id = ANY($2::int[])
                AND u.active = TRUE
                AND u.id <> $3
           ON CONFLICT (update_id, mentioned_user_id) DO NOTHING`,
          [id, mentionedUserIds, req.user.id]
        );
      }

      await client.query("COMMIT");
      const enriched = await attachUpdateExtras(pool, [
        { ...updated[0], user_display_name: req.user.displayName, user_username: req.user.username },
      ]);
      res.json({ update: enriched[0] });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] update comment", e);
    res.status(500).json({ error: "Could not edit comment." });
  }
}

// ============================================================
// DELETE /mb/updates/:id  (own anytime, admin anyone)
// ============================================================

export async function deleteOwnComment(req, res) {
  try {
    const id = vIntId(req.params.id, "update id");
    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT id, user_id, update_type, deleted_at
         FROM mb_item_updates WHERE id = $1`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ error: "Comment not found." });
    const row = existing[0];
    if (row.deleted_at) return res.status(400).json({ error: "Comment already deleted." });
    if (row.update_type !== "comment") {
      return res.status(400).json({ error: "Only comments can be deleted." });
    }
    if (row.user_id !== req.user.id && !isAdmin(req.user)) {
      return res
        .status(403)
        .json({ error: "You can only delete your own comments." });
    }

    // Soft-delete: keep the row so thread structure (replies under this
    // comment) doesn't collapse, but blank out the body.
    await pool.query(
      `UPDATE mb_item_updates
          SET deleted_at = NOW(),
              body = '',
              body_html = ''
        WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] delete comment", e);
    res.status(500).json({ error: "Could not delete comment." });
  }
}

// ============================================================
// Reactions
// ============================================================

export async function addReaction(req, res) {
  try {
    const updateId = vIntId(req.params.id, "update id");
    const emoji = String(req.body?.emoji ?? "");
    if (!ALLOWED_EMOJI.has(emoji)) {
      return res.status(400).json({ error: "Emoji not allowed." });
    }
    const pool = getPool();

    // Reject reactions on replies (per scope).
    const { rows: target } = await pool.query(
      `SELECT id, parent_update_id, deleted_at FROM mb_item_updates WHERE id = $1`,
      [updateId]
    );
    if (!target.length) return res.status(404).json({ error: "Comment not found." });
    if (target[0].parent_update_id != null) {
      return res
        .status(400)
        .json({ error: "Reactions are not available on replies." });
    }
    if (target[0].deleted_at) {
      return res.status(400).json({ error: "Cannot react to a deleted comment." });
    }

    await pool.query(
      `INSERT INTO mb_update_reactions (update_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (update_id, user_id, emoji) DO NOTHING`,
      [updateId, req.user.id, emoji]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] add reaction", e);
    res.status(500).json({ error: "Could not add reaction." });
  }
}

export async function removeReaction(req, res) {
  try {
    const updateId = vIntId(req.params.id, "update id");
    const emoji = String(req.body?.emoji ?? "");
    if (!ALLOWED_EMOJI.has(emoji)) {
      return res.status(400).json({ error: "Emoji not allowed." });
    }
    const pool = getPool();
    await pool.query(
      `DELETE FROM mb_update_reactions
         WHERE update_id = $1 AND user_id = $2 AND emoji = $3`,
      [updateId, req.user.id, emoji]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[mb] remove reaction", e);
    res.status(500).json({ error: "Could not remove reaction." });
  }
}

// ============================================================
// Attachments
// ============================================================

export async function createAttachment(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }
  // Multer's fileFilter has already validated extension/MIME.
  try {
    const updateId = vIntId(req.params.id, "update id");
    const pool = getPool();

    // Confirm the update exists + the user is the author (own attachments
    // only) or an admin.
    const { rows: existing } = await pool.query(
      `SELECT id, user_id, deleted_at FROM mb_item_updates WHERE id = $1`,
      [updateId]
    );
    if (!existing.length) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Update not found." });
    }
    if (existing[0].user_id !== req.user.id && !isAdmin(req.user)) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: "Cannot attach files to another user's comment." });
    }
    if (existing[0].deleted_at) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: "Cannot attach to a deleted comment." });
    }

    const storageBasename = path.basename(req.file.filename);
    const { rows } = await pool.query(
      `INSERT INTO mb_update_attachments
         (update_id, filename, storage_path, mime_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, update_id, filename, mime_type, size_bytes, uploaded_by, created_at`,
      [
        updateId,
        String(req.file.originalname || "file").slice(0, 200),
        storageBasename,
        String(req.file.mimetype || "application/octet-stream"),
        Number(req.file.size || 0),
        req.user.id,
      ]
    );
    res.status(201).json({ attachment: rows[0] });
  } catch (e) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] create attachment", e);
    res.status(500).json({ error: "Could not save attachment." });
  }
}

export async function deleteAttachment(req, res) {
  try {
    const id = vIntId(req.params.id, "attachment id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.id, a.storage_path, a.update_id, u.user_id
         FROM mb_update_attachments a
         JOIN mb_item_updates u ON u.id = a.update_id
        WHERE a.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Attachment not found." });
    const att = rows[0];
    if (att.user_id !== req.user.id && !isAdmin(req.user)) {
      return res.status(403).json({ error: "Not allowed." });
    }
    await pool.query(`DELETE FROM mb_update_attachments WHERE id = $1`, [id]);
    const filePath = path.join(MB_ATTACH_ROOT, att.storage_path);
    await fs.unlink(filePath).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    console.error("[mb] delete attachment", e);
    res.status(500).json({ error: "Could not delete attachment." });
  }
}

/**
 * Auth-gated file serving. The storage path on disk is composed from
 * the row's storage_path column (server-generated UUID) ONLY — the
 * request-provided id is just a row lookup. No part of the path comes
 * from the client.
 */
export async function downloadAttachment(req, res) {
  try {
    const id = vIntId(req.params.id, "attachment id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.filename, a.storage_path, a.mime_type
         FROM mb_update_attachments a
        WHERE a.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Attachment not found." });
    const att = rows[0];
    // Guard: storage_path must be a single basename (no separators).
    if (
      att.storage_path.includes("/") ||
      att.storage_path.includes("\\") ||
      att.storage_path === "." ||
      att.storage_path === ".."
    ) {
      return res.status(500).json({ error: "Attachment path is malformed." });
    }
    const filePath = path.join(MB_ATTACH_ROOT, att.storage_path);
    // Final sanity check: resolved path is still inside the attach root.
    if (!path.resolve(filePath).startsWith(path.resolve(MB_ATTACH_ROOT) + path.sep)) {
      return res.status(500).json({ error: "Path escape attempt blocked." });
    }
    res.setHeader("Content-Type", att.mime_type);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${att.filename.replace(/"/g, "")}"`
    );
    res.sendFile(filePath);
  } catch (e) {
    console.error("[mb] download attachment", e);
    res.status(500).json({ error: "Could not load attachment." });
  }
}

// ============================================================
// Mentions
// ============================================================

export async function markMentionsSeen(req, res) {
  try {
    // Phase 7 rekey: :id is a process id; column is process_id.
    const processId = vIntId(req.params.id, "process id");
    const pool = getPool();
    await pool.query(
      `UPDATE mb_update_mentions
          SET seen_at = NOW()
        WHERE seen_at IS NULL
          AND mentioned_user_id = $1
          AND update_id IN (
            SELECT id FROM mb_item_updates WHERE process_id = $2
          )`,
      [req.user.id, processId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[mb] mark mentions seen", e);
    res.status(500).json({ error: "Could not mark mentions seen." });
  }
}

export async function listUnseenMentions(req, res) {
  try {
    const pool = getPool();
    // by_process map (renamed from by_item in Phase 7; the client used
    // it as a generic "id → count" lookup, so existing callers keep
    // working if they read by_item — we publish both.)
    const { rows } = await pool.query(
      `SELECT u.process_id, COUNT(*)::int AS n
         FROM mb_update_mentions m
         JOIN mb_item_updates u ON u.id = m.update_id
        WHERE m.mentioned_user_id = $1
          AND m.seen_at IS NULL
          AND u.deleted_at IS NULL
          AND u.process_id IS NOT NULL
        GROUP BY u.process_id`,
      [req.user.id]
    );
    const byProcess = Object.fromEntries(rows.map((r) => [r.process_id, r.n]));
    const total = rows.reduce((s, r) => s + r.n, 0);
    res.json({ total, by_process: byProcess, by_item: byProcess });
  } catch (e) {
    console.error("[mb] list unseen mentions", e);
    res.status(500).json({ error: "Could not load unseen mentions." });
  }
}

// ============================================================
// AppFolio context (tenant + property)
// ============================================================

function safeJsonField(obj, key) {
  if (!obj || typeof obj !== "object") return null;
  const v = obj[key];
  if (v == null || v === "") return null;
  return v;
}

export async function getItemContext(req, res) {
  try {
    const itemId = vIntId(req.params.id, "item id");
    const pool = getPool();
    const { rows: itemRows } = await pool.query(
      `SELECT id, board_id, title, appfolio_id, appfolio_resource_type,
              values, created_at, updated_at
         FROM mb_items WHERE id = $1`,
      [itemId]
    );
    if (!itemRows.length) return res.status(404).json({ error: "Item not found." });
    const item = itemRows[0];

    // Seed items (and items not yet linked) get the "not linked" state.
    const linked =
      item.appfolio_id != null &&
      item.appfolio_resource_type != null &&
      item.appfolio_resource_type !== "seed";

    // Pull latest cached sync timestamps so the UI can show "Last synced".
    const { rows: syncRows } = await pool.query(
      `SELECT MAX(synced_at) AS rent_roll_synced FROM cached_rent_roll`
    );
    const rentRollSyncedAt = syncRows[0]?.rent_roll_synced ?? null;
    const { rows: propSyncRows } = await pool.query(
      `SELECT MAX(synced_at) AS properties_synced FROM cached_properties`
    );
    const propertiesSyncedAt = propSyncRows[0]?.properties_synced ?? null;

    if (!linked) {
      // For seed/unlinked items we still show what the item knows about
      // its own tenant/property text fields (Renewals stores these in
      // mb_items.values as static strings).
      const v = item.values ?? {};
      return res.json({
        linked: false,
        tenant: {
          linked: false,
          name: safeJsonField(v, "tenant_name"),
          synced_at: null,
        },
        property: {
          linked: false,
          address: safeJsonField(v, "property"),
          synced_at: null,
        },
      });
    }

    // Linked: try to find a matching rent-roll row by appfolio id. The
    // cached_rent_roll table stores rows whose `appfolio_data` JSONB
    // includes an `id` (AppFolio's tenant id). Real-data integration is
    // a Phase 2 concern — until then, this branch is reachable only by
    // test fixtures.
    const { rows: rentRoll } = await pool.query(
      `SELECT appfolio_data, synced_at
         FROM cached_rent_roll
        WHERE appfolio_data ->> 'id' = $1
        ORDER BY synced_at DESC
        LIMIT 1`,
      [String(item.appfolio_id)]
    );
    let tenantPanel = {
      linked: false,
      synced_at: rentRollSyncedAt,
    };
    if (rentRoll.length) {
      const d = rentRoll[0].appfolio_data || {};
      tenantPanel = {
        linked: true,
        synced_at: rentRoll[0].synced_at,
        name: d.tenant || d.name || null,
        phone: d.phone || d.mobile_phone || null,
        email: d.email || null,
        lease_from: d.lease_from || d.lease_from_date || null,
        lease_to: d.lease_to || d.lease_to_date || null,
        rent: d.rent || null,
        balance: d.balance || null,
      };
    }

    // Property lookup uses the rent-roll's property fields. If we don't
    // have a rent-roll match we still try the properties table directly.
    const propertyAppfolioId =
      rentRoll[0]?.appfolio_data?.property_id ||
      rentRoll[0]?.appfolio_data?.property?.id ||
      null;
    let propertyPanel = {
      linked: false,
      synced_at: propertiesSyncedAt,
    };
    if (propertyAppfolioId) {
      const { rows: propRows } = await pool.query(
        `SELECT appfolio_data, synced_at
           FROM cached_properties
          WHERE appfolio_data ->> 'id' = $1
          ORDER BY synced_at DESC
          LIMIT 1`,
        [String(propertyAppfolioId)]
      );
      if (propRows.length) {
        const p = propRows[0].appfolio_data || {};
        propertyPanel = {
          linked: true,
          synced_at: propRows[0].synced_at,
          address: p.address || p.property_address || null,
          city: p.city || null,
          state: p.state || null,
          property_type: p.property_type || p.type || null,
          owner_name: p.owner_name || p.primary_owner || null,
          owner_email: p.owner_email || null,
          owner_phone: p.owner_phone || null,
          unit_count: p.unit_count || p.units || null,
          occupied_count: p.occupied_count || null,
        };
      }
    }

    res.json({
      linked: true,
      tenant: tenantPanel,
      property: propertyPanel,
    });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] get item context", e);
    res.status(500).json({ error: "Could not load context." });
  }
}

// ============================================================
// Related items
// ============================================================

/**
 * Other mb_items that share the same tenant_name or property value.
 * For seed items we match on the text in values; for real items
 * Phase 2 should fill mb_items.appfolio_id and we can match on that.
 * Until Phase 2 lands the text match is the only useful signal.
 */
export async function getRelatedItems(req, res) {
  try {
    const itemId = vIntId(req.params.id, "item id");
    const pool = getPool();
    const { rows: itemRows } = await pool.query(
      `SELECT id, board_id, values FROM mb_items WHERE id = $1`,
      [itemId]
    );
    if (!itemRows.length) return res.status(404).json({ error: "Item not found." });
    const item = itemRows[0];
    const v = item.values ?? {};
    const tenant = typeof v.tenant_name === "string" ? v.tenant_name.trim() : "";
    const property = typeof v.property === "string" ? v.property.trim() : "";

    if (!tenant && !property) {
      return res.json({ items: [] });
    }

    const { rows } = await pool.query(
      `SELECT i.id, i.board_id, i.title, i.values, b.name AS board_name, b.slug AS board_slug
         FROM mb_items i
         JOIN mb_boards b ON b.id = i.board_id
        WHERE i.id <> $1
          AND i.archived_at IS NULL
          AND (
            ($2 <> '' AND i.values ->> 'tenant_name' = $2)
            OR
            ($3 <> '' AND i.values ->> 'property'    = $3)
          )
        ORDER BY i.updated_at DESC
        LIMIT 20`,
      [itemId, tenant || "", property || ""]
    );

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        board_id: r.board_id,
        board_name: r.board_name,
        board_slug: r.board_slug,
        title: r.title,
        tenant_name: r.values?.tenant_name ?? null,
        property: r.values?.property ?? null,
        status: r.values?.status ?? null,
      })),
    });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] related items", e);
    res.status(500).json({ error: "Could not load related items." });
  }
}

// ============================================================
// System-event recording (called by mbItems.updateItem)
// ============================================================

/**
 * Called from updateItem when item.values changes. Records a
 * `kind='system'` row for each changed column. Coalesces rapid edits:
 * if the same user changed the same column within COALESCE_WINDOW_MS,
 * we UPDATE the most recent entry's metadata in place instead of
 * inserting a new row.
 *
 * `columns` is a list of `{key, name}` so the entries can render with
 * the human-readable column name even if the column is later renamed.
 */
export async function recordValueChangeSystemEvents({
  pool,
  itemId,
  userId,
  changes,
  columns,
}) {
  if (!Array.isArray(changes) || changes.length === 0) return;
  const colByKey = new Map(columns.map((c) => [c.key, c]));
  const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS).toISOString();
  for (const change of changes) {
    const meta = colByKey.get(change.key);
    const metadata = {
      kind: "value_change",
      column_key: change.key,
      column_name: meta?.name ?? change.key,
      column_type: meta?.column_type ?? null,
      before: change.before ?? null,
      after: change.after ?? null,
    };
    const body = `${meta?.name ?? change.key}: ${formatChange(change)}`;

    // Try to coalesce.
    const { rows: prev } = await pool.query(
      `SELECT id FROM mb_item_updates
        WHERE item_id = $1
          AND user_id = $2
          AND update_type = 'system'
          AND metadata ->> 'column_key' = $3
          AND created_at >= $4
        ORDER BY created_at DESC
        LIMIT 1`,
      [itemId, userId, change.key, cutoff]
    );
    if (prev.length) {
      // Merge: keep the original `before`, advance `after`.
      await pool.query(
        `UPDATE mb_item_updates
            SET body = $1,
                metadata = jsonb_set(metadata, '{after}', $2::jsonb, true),
                created_at = NOW()
          WHERE id = $3`,
        [body, JSON.stringify(change.after ?? null), prev[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO mb_item_updates
           (item_id, user_id, body, update_type, metadata)
         VALUES ($1, $2, $3, 'system', $4::jsonb)`,
        [itemId, userId, body, JSON.stringify(metadata)]
      );
    }
  }
}

function formatChange(change) {
  const a = change.before == null || change.before === "" ? "(empty)" : String(change.before);
  const b = change.after == null || change.after === "" ? "(empty)" : String(change.after);
  return `${a} → ${b}`;
}
