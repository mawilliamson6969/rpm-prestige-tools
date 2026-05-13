import bcrypt from "bcryptjs";
import { getPool } from "../lib/db.js";
import { getUserPermissions, signUserToken } from "../lib/auth.js";

export async function postLogin(req, res) {
  if (!process.env.JWT_SECRET?.trim()) {
    res.status(503).json({ error: "Login is not configured (JWT_SECRET)." });
    return;
  }
  const username =
    typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password) {
    res.status(400).json({ error: "username and password are required." });
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
    const { rows } = await pool.query(
      `SELECT id, username, password_hash, display_name, role, email, active
       FROM users WHERE lower(username) = $1`,
      [username]
    );
    if (!rows.length) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
    const row = rows[0];
    if (row.active === false) {
      res.status(401).json({ error: "Account is inactive." });
      return;
    }
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
    const token = signUserToken(row);
    pool
      .query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [row.id])
      .catch(() => {});
    const permissions = await getUserPermissions(row.id);
    res.json({
      token,
      user: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        permissions,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not sign in." });
  }
}

export async function getMe(req, res) {
  const permissions = await getUserPermissions(req.user.id);
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.displayName,
      role: req.user.role,
      permissions,
    },
  });
}

export async function postChangePassword(req, res) {
  const currentPassword =
    typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required." });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters." });
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
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
    if (!rows.length) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update password." });
  }
}
