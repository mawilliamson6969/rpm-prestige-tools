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

export function adminTokenFromRequest(req) {
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const raw = req.headers["x-admin-api-secret"];
  return typeof raw === "string" ? raw : "";
}

function requireAdmin(req, res) {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Admin API not configured (ADMIN_API_SECRET)." });
    return false;
  }
  if (adminTokenFromRequest(req) !== secret) {
    res.status(401).json({ error: "Unauthorized." });
    return false;
  }
  return true;
}

export function requireAdminMiddleware(req, res, next) {
  if (!requireAdmin(req, res)) return;
  next();
}

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

export async function getAnnouncements(req, res) {
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, title, content, created_at, is_active, attachment_url, attachment_label
       FROM announcements
       WHERE is_active = true
       ORDER BY created_at DESC`
    );
    res.json({ announcements: rows });
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
  if (!requireAdmin(req, res)) return;
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
      `INSERT INTO announcements (title, content, is_active, attachment_url, attachment_label)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, content, created_at, is_active, attachment_url, attachment_label`,
      [title, content, is_active, attachment_url, attachment_label]
    );
    res.status(201).json({ announcement: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create announcement." });
  }
}
