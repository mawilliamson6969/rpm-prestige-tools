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

function verifyTokenAndAttachUser(req, res, token) {
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return false;
  }
  try {
    const payload = verifyUserToken(token);
    req.user = {
      id: Number(payload.sub),
      username: payload.username,
      role: payload.role,
      displayName: payload.displayName,
    };
    return true;
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
    return false;
  }
}

/**
 * Attaches req.user = { id, username, role, displayName } from JWT.
 */
export function requireAuth(req, res, next) {
  if (!verifyTokenAndAttachUser(req, res, getBearerToken(req))) return;
  next();
}

/**
 * Same as {@link requireAuth} but also accepts `?token=` (JWT) for routes the browser loads
 * without an Authorization header (e.g. HTML5 video, img src). Header wins when both are sent.
 */
export function requireAuthOrQueryToken(req, res, next) {
  let token = getBearerToken(req);
  if (!token) {
    const q = req.query?.token;
    token = typeof q === "string" ? q.trim() : Array.isArray(q) && typeof q[0] === "string" ? q[0].trim() : "";
  }
  if (!verifyTokenAndAttachUser(req, res, token)) return;
  next();
}

export function requireAdminRole(req, res, next) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
}
