import bcrypt from "bcryptjs";
import { getPool } from "../lib/db.js";

function mapRow(r) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    email: r.email,
    created_at: r.created_at,
  };
}

export async function listUsers(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, username, display_name, role, email, created_at
       FROM users
       ORDER BY lower(username) ASC`
    );
    res.json({ users: rows.map(mapRow) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load users." });
  }
}

export async function createUser(req, res) {
  const usernameRaw = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName =
    typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim() || null : null;
  const role = req.body?.role;

  if (!usernameRaw) {
    res.status(400).json({ error: "username is required." });
    return;
  }
  if (usernameRaw.length > 64) {
    res.status(400).json({ error: "username must be at most 64 characters." });
    return;
  }
  if (!displayName) {
    res.status(400).json({ error: "displayName is required." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters." });
    return;
  }
  if (role !== "admin" && role !== "viewer") {
    res.status(400).json({ error: "role must be admin or viewer." });
    return;
  }

  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, role, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, display_name, role, email, created_at`,
      [usernameRaw, hash, displayName, role, email]
    );
    res.status(201).json({ user: mapRow(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not create user." });
  }
}

export async function updateUser(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id." });
    return;
  }

  const body = req.body ?? {};
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }

  try {
    const { rows: existing } = await pool.query(
      `SELECT id, username, display_name, role, email, created_at FROM users WHERE id = $1`,
      [id]
    );
    if (!existing.length) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const current = existing[0];

    if (id === req.user.id && body.role === "viewer" && current.role === "admin") {
      res.status(403).json({ error: "Cannot demote yourself from admin." });
      return;
    }

    const sets = [];
    const vals = [];
    let n = 1;

    if (typeof body.displayName === "string") {
      const d = body.displayName.trim();
      if (!d) {
        res.status(400).json({ error: "displayName cannot be empty." });
        return;
      }
      sets.push(`display_name = $${n++}`);
      vals.push(d);
    }

    if (body.role !== undefined && body.role !== null) {
      if (body.role !== "admin" && body.role !== "viewer") {
        res.status(400).json({ error: "role must be admin or viewer." });
        return;
      }
      sets.push(`role = $${n++}`);
      vals.push(body.role);
    }

    if (typeof body.email === "string") {
      sets.push(`email = $${n++}`);
      vals.push(body.email.trim() || null);
    }

    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length < 8) {
        res.status(400).json({ error: "password must be at least 8 characters." });
        return;
      }
      const hash = await bcrypt.hash(body.password, 12);
      sets.push(`password_hash = $${n++}`);
      vals.push(hash);
    }

    if (!sets.length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${n}
       RETURNING id, username, display_name, role, email, created_at`,
      vals
    );
    res.json({ user: mapRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update user." });
  }
}

export async function deleteUser(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id." });
    return;
  }
  if (id === req.user.id) {
    res.status(403).json({ error: "Cannot delete your own account." });
    return;
  }

  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }

  try {
    const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete user." });
  }
}
