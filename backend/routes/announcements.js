import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import { getPool } from "../lib/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "..", "uploads", "announcements");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

function wrapUpload(req, res, next) {
  uploadMiddleware.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "File too large (max 8MB)." });
        return;
      }
      res.status(400).json({ error: err.message || "Upload failed." });
      return;
    }
    next();
  });
}

export { wrapUpload as uploadAnnouncementMiddleware };

export async function uploadAnnouncementFile(req, res) {
  if (!req.file) {
    res.status(400).json({ error: "No file received." });
    return;
  }
  const rel = `/uploads/announcements/${req.file.filename}`;
  res.status(201).json({
    url: rel,
    filename: req.file.originalname,
  });
}

function parsePageLimit(q) {
  const page = Number.parseInt(String(q.page ?? ""), 10);
  const limit = Number.parseInt(String(q.limit ?? ""), 10);
  const usePage = Number.isFinite(page) && page > 0;
  const useLimit = Number.isFinite(limit) && limit > 0 && limit <= 200;
  return {
    page: usePage ? page : 1,
    limit: useLimit ? limit : null,
    paginate: usePage && useLimit,
  };
}

/**
 * Default (no status / status=active, no allDates): active rows, last 14 days, newest first.
 * ?status=all — every announcement (library “All”)
 * ?status=archived — archived only
 * ?status=active&allDates=1 — active, any date (library “Active”)
 * ?sort=oldest|newest  ?search=  ?page=&limit=
 */
export async function getAnnouncements(req, res) {
  try {
    const pool = getPool();
    const statusParam = (typeof req.query.status === "string" ? req.query.status : "").trim().toLowerCase();
    const allDates =
      req.query.allDates === "1" || req.query.allDates === "true" || req.query.allDates === "yes";
    const sort = (typeof req.query.sort === "string" ? req.query.sort : "newest").trim().toLowerCase();
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const { page, limit, paginate } = parsePageLimit(req.query);
    const orderDir = sort === "oldest" ? "ASC" : "DESC";

    const whereParts = [`is_active = true`];
    const params = [];
    let n = 1;

    if (statusParam === "all") {
      /* no status filter */
    } else if (statusParam === "archived") {
      whereParts.push(`status = 'archived'`);
    } else {
      whereParts.push(`status = 'active'`);
      const hubWindow = !allDates && (statusParam === "" || statusParam === "active");
      if (hubWindow) {
        whereParts.push(`created_at >= NOW() - INTERVAL '14 days'`);
      }
    }

    if (search) {
      whereParts.push(`(title ILIKE $${n} OR content ILIKE $${n})`);
      params.push(`%${search}%`);
      n++;
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*)::int AS c FROM announcements ${whereSql}`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = countRows[0]?.c ?? 0;

    let listSql = `
      SELECT id, title, content, created_at, is_active, attachment_url, attachment_label, status, archived_at
      FROM announcements
      ${whereSql}
      ORDER BY created_at ${orderDir}
    `;
    const listParams = [...params];
    if (paginate && limit != null) {
      listSql += ` LIMIT $${n++} OFFSET $${n++}`;
      listParams.push(limit, (page - 1) * limit);
    } else if (statusParam === "all") {
      listSql += ` LIMIT 2000`;
    }

    const { rows } = await pool.query(listSql, listParams);
    const payload = { announcements: rows };
    if (paginate && limit != null) {
      payload.total = total;
      payload.page = page;
      payload.perPage = limit;
    }
    res.json(payload);
  } catch (err) {
    if (err?.message === "DATABASE_URL is not set") {
      res.json({ announcements: [] });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not load announcements." });
  }
}

export async function postAnnouncement(req, res) {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!title || !content) {
    res.status(400).json({ error: "title and content are required." });
    return;
  }
  const is_active = req.body?.is_active === false ? false : true;
  let attachment_url =
    typeof req.body?.attachment_url === "string" ? req.body.attachment_url.trim() : "";
  let attachment_label =
    typeof req.body?.attachment_label === "string" ? req.body.attachment_label.trim() : "";
  attachment_url = attachment_url || null;
  attachment_label = attachment_label || null;
  try {
    const p = getPool();
    const { rows } = await p.query(
      `INSERT INTO announcements (title, content, is_active, attachment_url, attachment_label, status, archived_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NULL)
       RETURNING id, title, content, created_at, is_active, attachment_url, attachment_label, status, archived_at`,
      [title, content, is_active, attachment_url, attachment_label]
    );
    res.status(201).json({ announcement: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create announcement." });
  }
}

export async function archiveAnnouncement(req, res) {
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `UPDATE announcements
       SET status = 'archived', archived_at = NOW()
       WHERE id = $1::uuid AND is_active = true
       RETURNING id, title, content, created_at, is_active, attachment_url, attachment_label, status, archived_at`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Announcement not found." });
      return;
    }
    res.json({ announcement: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not archive announcement." });
  }
}

export async function restoreAnnouncement(req, res) {
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `UPDATE announcements
       SET status = 'active', archived_at = NULL
       WHERE id = $1::uuid AND is_active = true
       RETURNING id, title, content, created_at, is_active, attachment_url, attachment_label, status, archived_at`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Announcement not found." });
      return;
    }
    res.json({ announcement: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not restore announcement." });
  }
}

export async function deleteAnnouncement(req, res) {
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const p = getPool();
    const { rowCount } = await p.query(`DELETE FROM announcements WHERE id = $1::uuid`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Announcement not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete announcement." });
  }
}
