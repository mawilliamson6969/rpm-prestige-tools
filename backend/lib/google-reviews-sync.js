import jwt from "jsonwebtoken";
import { getPool } from "./db.js";

const GOOGLE_OAUTH_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "openid",
  "email",
].join(" ");
const GMB_BASE = "https://mybusiness.googleapis.com/v4";

function jwtSecret() {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) throw new Error("JWT_SECRET is not configured.");
  return s;
}

function googleEnv() {
  const clientId = process.env.GOOGLE_BUSINESS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET?.trim();
  const redirectUri = (
    process.env.GOOGLE_BUSINESS_REDIRECT_URI ||
    `${(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "")}/api/auth/google-business/callback`
  ).trim();
  if (!clientId || !clientSecret) {
    const err = new Error("Google Business Profile OAuth is not configured.");
    err.code = "GOOGLE_NOT_CONFIGURED";
    throw err;
  }
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleConfigured() {
  try {
    googleEnv();
    return true;
  } catch {
    return false;
  }
}

export function signGoogleOAuthState(userId) {
  return jwt.sign({ purpose: "google_business_oauth", uid: userId }, jwtSecret(), {
    expiresIn: "15m",
  });
}

export function verifyGoogleOAuthState(state) {
  const payload = jwt.verify(state, jwtSecret());
  if (payload.purpose !== "google_business_oauth" || payload.uid == null) {
    throw new Error("Invalid OAuth state.");
  }
  return { userId: Number(payload.uid) };
}

export function buildGoogleAuthorizeUrl(userId) {
  const { clientId, redirectUri } = googleEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state: signGoogleOAuthState(userId),
  });
  return `${GOOGLE_OAUTH_AUTHORIZE}?${params.toString()}`;
}

async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = googleEnv();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token exchange failed (${res.status})`);
  return json;
}

async function refreshTokens(refreshToken) {
  const { clientId, clientSecret } = googleEnv();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Refresh failed (${res.status})`);
  return json;
}

export async function handleGoogleCallback(code, userId) {
  const tokens = await exchangeCode(code);
  const expiresIn = Number(tokens.expires_in) || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const accountId = process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() || null;
  const locationId = process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() || null;

  const pool = getPool();
  const existing = await pool.query(`SELECT id FROM google_auth_tokens ORDER BY id ASC LIMIT 1`);
  if (existing.rows.length) {
    await pool.query(
      `UPDATE google_auth_tokens SET access_token = $1, refresh_token = COALESCE($2, refresh_token),
        token_expires_at = $3, scope = $4, connected_by = $5, updated_at = NOW(),
        account_id = COALESCE($6, account_id), location_id = COALESCE($7, location_id)
       WHERE id = $8`,
      [
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        tokens.scope || null,
        userId,
        accountId,
        locationId,
        existing.rows[0].id,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO google_auth_tokens
        (access_token, refresh_token, token_expires_at, scope, connected_by,
         account_id, location_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        tokens.scope || null,
        userId,
        accountId,
        locationId,
      ]
    );
  }
  return { ok: true };
}

export async function getGoogleAuthRow() {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM google_auth_tokens ORDER BY id ASC LIMIT 1`);
  return rows[0] || null;
}

export async function getValidGoogleAccessToken() {
  const row = await getGoogleAuthRow();
  if (!row) {
    const err = new Error("Google Business Profile is not connected.");
    err.code = "GOOGLE_NOT_CONNECTED";
    throw err;
  }
  const now = Date.now();
  const exp = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (row.access_token && exp > now + 120_000) return row.access_token;
  if (!row.refresh_token) {
    const err = new Error("Google Business refresh token missing; reconnect.");
    err.code = "GOOGLE_NOT_CONNECTED";
    throw err;
  }
  const tokens = await refreshTokens(row.refresh_token);
  const expiresIn = Number(tokens.expires_in) || 3600;
  const expiresAt = new Date(now + expiresIn * 1000);
  const pool = getPool();
  await pool.query(
    `UPDATE google_auth_tokens SET access_token = $1, token_expires_at = $2, updated_at = NOW() WHERE id = $3`,
    [tokens.access_token, expiresAt, row.id]
  );
  return tokens.access_token;
}

async function accountLocation() {
  const envRow = process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim();
  const envLoc = process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim();
  if (envRow && envLoc) return { accountId: envRow, locationId: envLoc };
  const row = await getGoogleAuthRow();
  if (row?.account_id && row?.location_id) {
    return { accountId: row.account_id, locationId: row.location_id };
  }
  const err = new Error(
    "Google Business account/location not selected. Pick one on the Setup page."
  );
  err.code = "GOOGLE_NOT_CONFIGURED";
  throw err;
}

function stripPrefix(name, prefix) {
  if (!name) return "";
  const s = String(name);
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

export async function listGoogleAccounts() {
  const accessToken = await getValidGoogleAccessToken();
  const url = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Google API error ${res.status}`);
  }
  const accounts = Array.isArray(json.accounts) ? json.accounts : [];
  return accounts.map((a) => ({
    id: stripPrefix(a.name, "accounts/"),
    name: a.accountName || a.name || "",
    type: a.type || null,
    role: a.role || null,
  }));
}

export async function listGoogleLocations(accountId) {
  const accessToken = await getValidGoogleAccessToken();
  const clean = stripPrefix(accountId, "accounts/");
  const readMask = encodeURIComponent("name,title,storefrontAddress,websiteUri,phoneNumbers");
  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(
    clean
  )}/locations?readMask=${readMask}&pageSize=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Google API error ${res.status}`);
  }
  const locations = Array.isArray(json.locations) ? json.locations : [];
  return locations.map((l) => {
    const addr = l.storefrontAddress || {};
    const lines = Array.isArray(addr.addressLines) ? addr.addressLines.join(" ") : "";
    const address = [lines, addr.locality, addr.administrativeArea].filter(Boolean).join(", ");
    return {
      id: stripPrefix(l.name, "locations/"),
      title: l.title || l.name || "",
      address,
    };
  });
}

export async function saveGoogleSelection(accountId, locationId) {
  const pool = getPool();
  const row = await getGoogleAuthRow();
  if (!row) {
    const err = new Error("Google Business Profile is not connected.");
    err.code = "GOOGLE_NOT_CONNECTED";
    throw err;
  }
  await pool.query(
    `UPDATE google_auth_tokens SET account_id = $1, location_id = $2, updated_at = NOW() WHERE id = $3`,
    [String(accountId).trim(), String(locationId).trim(), row.id]
  );
  return { ok: true };
}

async function googleGet(path, accessToken) {
  const res = await fetch(`${GMB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google API error ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function googlePut(path, accessToken, payload) {
  const res = await fetch(`${GMB_BASE}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google API error ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function googleDelete(path, accessToken) {
  const res = await fetch(`${GMB_BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google API error ${res.status}: ${txt.slice(0, 200)}`);
  }
  return true;
}

function mapStarRating(str) {
  if (typeof str === "number") return str;
  const map = { FIVE: 5, FOUR: 4, THREE: 3, TWO: 2, ONE: 1, STAR_RATING_UNSPECIFIED: 0 };
  return map[String(str || "").toUpperCase()] ?? 0;
}

export async function syncGoogleReviews({ trigger = "manual" } = {}) {
  const pool = getPool();
  let accessToken;
  try {
    accessToken = await getValidGoogleAccessToken();
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || "ERR" };
  }
  const { accountId, locationId } = await accountLocation();

  let pageToken = null;
  let totalSeen = 0;
  let totalUpserted = 0;
  const newIds = [];
  const newNegativeIds = [];

  do {
    const q = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}&pageSize=50` : `?pageSize=50`;
    const path = `/accounts/${accountId}/locations/${locationId}/reviews${q}`;
    let data;
    try {
      data = await googleGet(path, accessToken);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const list = Array.isArray(data.reviews) ? data.reviews : [];
    totalSeen += list.length;

    for (const r of list) {
      const reviewId = r.reviewId || (r.name || "").split("/").pop();
      if (!reviewId) continue;
      const rating = mapStarRating(r.starRating);
      const reply = r.reviewReply || null;
      const photo = r.reviewer?.profilePhotoUrl || null;
      const name = r.reviewer?.displayName || "Anonymous";
      const createTime = r.createTime ? new Date(r.createTime) : null;
      const updateTime = r.updateTime ? new Date(r.updateTime) : null;
      const replyComment = reply?.comment || null;
      const replyUpdate = reply?.updateTime ? new Date(reply.updateTime) : null;

      const existing = await pool.query(
        `SELECT id FROM google_reviews WHERE google_review_id = $1`,
        [reviewId]
      );
      const isNew = existing.rows.length === 0;

      const result = await pool.query(
        `INSERT INTO google_reviews
          (google_review_id, reviewer_name, reviewer_photo_url, star_rating, comment,
           create_time, update_time, reply_comment, reply_update_time, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (google_review_id) DO UPDATE SET
          reviewer_name = EXCLUDED.reviewer_name,
          reviewer_photo_url = EXCLUDED.reviewer_photo_url,
          star_rating = EXCLUDED.star_rating,
          comment = EXCLUDED.comment,
          update_time = EXCLUDED.update_time,
          reply_comment = EXCLUDED.reply_comment,
          reply_update_time = EXCLUDED.reply_update_time,
          synced_at = NOW()
         RETURNING id, star_rating`,
        [reviewId, name, photo, rating, r.comment || null, createTime, updateTime, replyComment, replyUpdate]
      );
      totalUpserted++;
      if (isNew) {
        newIds.push(result.rows[0].id);
        if (rating > 0 && rating <= 2) newNegativeIds.push(result.rows[0].id);
      }
    }

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  await attributeNewReviews(newIds);

  return {
    ok: true,
    trigger,
    seen: totalSeen,
    upserted: totalUpserted,
    newReviews: newIds.length,
    newNegative: newNegativeIds.length,
  };
}

export async function replyToReviewViaApi(reviewGoogleId, comment) {
  const accessToken = await getValidGoogleAccessToken();
  const { accountId, locationId } = await accountLocation();
  const path = `/accounts/${accountId}/locations/${locationId}/reviews/${reviewGoogleId}/reply`;
  return googlePut(path, accessToken, { comment });
}

export async function deleteReviewReplyViaApi(reviewGoogleId) {
  const accessToken = await getValidGoogleAccessToken();
  const { accountId, locationId } = await accountLocation();
  const path = `/accounts/${accountId}/locations/${locationId}/reviews/${reviewGoogleId}/reply`;
  return googleDelete(path, accessToken);
}

/**
 * Fuzzy match Google reviewers to recent review_requests and stamp attribution.
 * A review matches a request if the reviewer's last token (last name) appears in
 * recipient_name and the request was sent in the last 14 days.
 */
async function attributeNewReviews(reviewIds) {
  if (!reviewIds.length) return;
  const pool = getPool();
  const { rows: reviews } = await pool.query(
    `SELECT id, reviewer_name, star_rating, create_time FROM google_reviews WHERE id = ANY($1::int[])`,
    [reviewIds]
  );
  for (const rev of reviews) {
    const parts = String(rev.reviewer_name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const last = parts[parts.length - 1].toLowerCase();
    if (last.length < 2) continue;

    const { rows: matches } = await pool.query(
      `SELECT id, team_member_id FROM review_requests
       WHERE review_received = false
         AND sent_at >= NOW() - INTERVAL '14 days'
         AND lower(recipient_name) LIKE '%' || $1 || '%'
       ORDER BY sent_at DESC
       LIMIT 1`,
      [last]
    );
    if (!matches.length) continue;
    const match = matches[0];
    await pool.query(
      `UPDATE review_requests SET
        review_received = true,
        review_received_at = NOW(),
        review_id = $1,
        review_rating = $2
       WHERE id = $3`,
      [rev.id, rev.star_rating, match.id]
    );
    await pool.query(
      `UPDATE review_request_templates t SET review_count = review_count + 1
       FROM review_requests r WHERE r.id = $1 AND r.template_id = t.id`,
      [match.id]
    );
  }
}

/** Disconnect and wipe stored tokens. */
export async function disconnectGoogle() {
  const pool = getPool();
  await pool.query(`DELETE FROM google_auth_tokens`);
  return { ok: true };
}
