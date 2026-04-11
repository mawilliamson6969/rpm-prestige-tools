import { getPool } from "../lib/db.js";

function adminTokenFromRequest(req) {
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

export async function getAnnouncements(req, res) {
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, title, content, created_at, is_active
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
  try {
    const p = getPool();
    const { rows } = await p.query(
      `INSERT INTO announcements (title, content, is_active)
       VALUES ($1, $2, $3)
       RETURNING id, title, content, created_at, is_active`,
      [title, content, is_active]
    );
    res.status(201).json({ announcement: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create announcement." });
  }
}
