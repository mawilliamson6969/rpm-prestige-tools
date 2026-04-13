import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

function jwtSecret() {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) throw new Error("JWT_SECRET is not configured.");
  return s;
}

function msEnv() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const tenantId = process.env.MICROSOFT_TENANT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI?.trim();
  if (!clientId || !tenantId || !clientSecret || !redirectUri) {
    const err = new Error("Microsoft OAuth is not configured.");
    err.code = "MS_NOT_CONFIGURED";
    throw err;
  }
  return { clientId, tenantId, clientSecret, redirectUri };
}

const SCOPES =
  "openid email Mail.Read Mail.ReadWrite Mail.Read.Shared Mail.ReadWrite.Shared Mail.Send User.Read offline_access";

/**
 * @param {number} userId
 * @param {{ flow?: "personal" | "shared"; sharedMailbox?: string | null; displayName?: string | null }} [opts]
 */
export function signOAuthState(userId, opts = {}) {
  const flow = opts.flow === "shared" ? "shared" : "personal";
  const sharedMailbox =
    typeof opts.sharedMailbox === "string" ? opts.sharedMailbox.trim().toLowerCase() : null;
  const displayName = typeof opts.displayName === "string" ? opts.displayName.trim().slice(0, 255) : null;
  return jwt.sign(
    {
      purpose: "microsoft_oauth",
      uid: userId,
      flow,
      smb: flow === "shared" ? sharedMailbox : null,
      dn: displayName || null,
    },
    jwtSecret(),
    { expiresIn: "15m" }
  );
}

/** @returns {{ userId: number; flow: "personal" | "shared"; sharedMailbox: string | null; displayName: string | null }} */
export function verifyOAuthState(state) {
  const payload = jwt.verify(state, jwtSecret());
  if (payload.purpose !== "microsoft_oauth" || payload.uid == null) {
    throw new Error("Invalid OAuth state.");
  }
  const flow = payload.flow === "shared" ? "shared" : "personal";
  const sharedMailbox = typeof payload.smb === "string" && payload.smb.trim() ? payload.smb.trim().toLowerCase() : null;
  const displayName = typeof payload.dn === "string" && payload.dn.trim() ? payload.dn.trim().slice(0, 255) : null;
  return {
    userId: Number(payload.uid),
    flow,
    sharedMailbox: flow === "shared" ? sharedMailbox : null,
    displayName,
  };
}

/**
 * @param {number} userId
 * @param {{ flow?: "personal" | "shared"; sharedMailbox?: string | null; displayName?: string | null }} [opts]
 */
export function buildMicrosoftAuthorizeUrl(userId, opts = {}) {
  const { clientId, tenantId, redirectUri } = msEnv();
  const state = signOAuthState(userId, opts);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
  });
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(code) {
  const { clientId, tenantId, clientSecret, redirectUri } = msEnv();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: SCOPES,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Token exchange failed (${res.status})`);
  }
  return json;
}

export async function refreshMicrosoftTokens(refreshToken) {
  const { clientId, tenantId, clientSecret } = msEnv();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: SCOPES,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Refresh failed (${res.status})`);
  }
  return json;
}

export async function fetchGraphMe(accessToken) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || "Could not read Microsoft profile.");
  return json;
}

export async function getValidAccessTokenForConnection(connectionId) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM email_connections WHERE id = $1 AND is_active = true`, [
    connectionId,
  ]);
  if (!rows.length) throw new Error("Email connection not found.");
  const row = rows[0];
  const now = Date.now();
  const exp = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (row.access_token && exp > now + 120_000) {
    return { accessToken: row.access_token, connection: row };
  }
  if (!row.refresh_token) throw new Error("No refresh token; reconnect Microsoft account.");
  const tokens = await refreshMicrosoftTokens(row.refresh_token);
  const expiresIn = Number(tokens.expires_in) || 3600;
  const tokenExpiresAt = new Date(now + expiresIn * 1000);
  await pool.query(
    `UPDATE email_connections SET access_token = $1, refresh_token = COALESCE($2, refresh_token),
      token_expires_at = $3, updated_at = NOW() WHERE id = $4`,
    [tokens.access_token, tokens.refresh_token || null, tokenExpiresAt, connectionId]
  );
  const { rows: again } = await pool.query(`SELECT * FROM email_connections WHERE id = $1`, [connectionId]);
  return { accessToken: tokens.access_token, connection: again[0] };
}
