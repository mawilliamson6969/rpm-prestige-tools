import jwt from "jsonwebtoken";

export function getBearerToken(req) {
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}

function jwtSecret() {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) return null;
  return s;
}

export function signUserToken(user) {
  const secret = jwtSecret();
  if (!secret) {
    const err = new Error("JWT_SECRET is not configured.");
    err.code = "JWT_CONFIG";
    throw err;
  }
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      displayName: user.display_name ?? user.displayName,
    },
    secret,
    { expiresIn: "24h" }
  );
}

export function verifyUserToken(token) {
  const secret = jwtSecret();
  if (!secret) {
    const err = new Error("JWT_SECRET is not configured.");
    err.code = "JWT_CONFIG";
    throw err;
  }
  return jwt.verify(token, secret);
}

/**
 * Attaches req.user = { id, username, role, displayName } from JWT.
 */
export function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  try {
    const payload = verifyUserToken(token);
    req.user = {
      id: Number(payload.sub),
      username: payload.username,
      role: payload.role,
      displayName: payload.displayName,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

export function requireAdminRole(req, res, next) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
}
