import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../lib/db.js";
import { getReviewSetting, setReviewSetting } from "../lib/reviews-schema.js";
import {
  autoDiscoverAndSave,
  buildGoogleAuthorizeUrl,
  deleteReviewReplyViaApi,
  disconnectGoogle,
  getGoogleAuthRow,
  handleGoogleCallback,
  isGoogleConfigured,
  listGoogleAccounts,
  listGoogleLocations,
  replyToReviewViaApi,
  saveGoogleSelection,
  syncGoogleReviews,
  verifyGoogleOAuthState,
} from "../lib/google-reviews-sync.js";
import { formatE164, isOpenPhoneConfigured, sendSMS } from "../lib/openphone.js";
import { graphPost } from "../lib/inbox/graph-client.js";
import { getValidAccessTokenForConnection } from "../lib/inbox/microsoft-auth.js";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

function frontendBase() {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
}

function trackingBaseUrl() {
  return process.env.REVIEW_TRACKING_BASE_URL?.trim() || `${frontendBase()}/reviews`;
}

function googleReviewUrl() {
  return process.env.GOOGLE_REVIEW_URL?.trim() || "";
}

function generateTrackingToken() {
  return crypto.randomBytes(24).toString("hex");
}

/* ==========================================================
 *  Template helpers
 * ========================================================== */

function firstName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return parts[0] || name || "there";
}

function renderTemplate(body, vars) {
  let out = String(body || "");
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), v ?? "");
  }
  return out;
}

function buildVars({ recipientName, propertyAddress, teamMemberName, reviewUrl }) {
  return {
    name: recipientName || "",
    first_name: firstName(recipientName),
    property_address: propertyAddress || "",
    company_name: "Real Property Management Prestige",
    review_url: reviewUrl,
    team_member_name: teamMemberName || "The RPM Prestige Team",
  };
}

/* ==========================================================
 *  Email + SMS dispatch
 * ========================================================== */

async function findActiveEmailConnection() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id FROM email_connections
     WHERE is_active = true
       AND access_token IS NOT NULL
     ORDER BY id ASC LIMIT 1`
  );
  return rows[0]?.id || null;
}

function buildEmailHtml({ body, trackingToken }) {
  const base = trackingBaseUrl();
  const trackUrl = `${base}/track/${trackingToken}`;
  const optoutUrl = `${base}/optout/${trackingToken}`;
  const pixel = `${base}/pixel/${trackingToken}.png`;

  const escaped = String(body || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withLinks = escaped.replace(
    /(https?:\/\/\S+)/g,
    (url) => `<a href="${url}" style="color:#0098D0;">${url}</a>`
  );
  const withReviewLink = withLinks.split("{{review_url}}").join(`<a href="${trackUrl}" style="color:#0098D0;font-weight:600;">Leave a Google Review</a>`);

  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1B2856;max-width:640px;margin:0 auto;padding:1.25rem;line-height:1.55;">
<div style="white-space:pre-line;">${withReviewLink}</div>
<hr style="border:none;border-top:1px solid rgba(27,40,86,0.15);margin:1.5rem 0;">
<p style="font-size:0.75rem;color:#6A737B;">Prefer not to hear from us? <a href="${optoutUrl}" style="color:#6A737B;">Unsubscribe</a>.</p>
<img src="${pixel}" width="1" height="1" style="display:block;border:0;" alt="">
</body></html>`;
}

async function sendEmailViaGraph({ to, subject, bodyText, trackingToken }) {
  const connId = await findActiveEmailConnection();
  if (!connId) {
    const err = new Error("No active Microsoft email connection is available.");
    err.code = "NO_EMAIL_CONN";
    throw err;
  }
  const { accessToken, connection } = await getValidAccessTokenForConnection(connId);
  const html = buildEmailHtml({ body: bodyText, trackingToken });
  const isShared = connection.mailbox_type === "shared" && connection.mailbox_email;
  const path = isShared
    ? `/users/${encodeURIComponent(connection.mailbox_email)}/sendMail`
    : `/me/sendMail`;
  await graphPost(path, accessToken, {
    message: {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  });
}

async function sendSmsMessage({ to, bodyText, trackingToken }) {
  const base = trackingBaseUrl();
  const trackUrl = `${base}/track/${trackingToken}`;
  const withLink = bodyText.split("{{review_url}}").join(trackUrl);
  return sendSMS(to, withLink);
}

/* ==========================================================
 *  Opt-out guard
 * ========================================================== */

async function isOptedOut({ email, phone }) {
  const pool = getPool();
  const e = email ? email.trim().toLowerCase() : null;
  const p = phone ? formatE164(phone) : null;
  if (!e && !p) return false;
  const { rows } = await pool.query(
    `SELECT id FROM review_optouts
     WHERE ($1::text IS NOT NULL AND lower(email) = $1)
        OR ($2::text IS NOT NULL AND phone = $2)
     LIMIT 1`,
    [e, p]
  );
  return rows.length > 0;
}

async function wasRecentlyRequested({ email, phone, days = 30 }) {
  const pool = getPool();
  const e = email ? email.trim().toLowerCase() : null;
  const p = phone ? formatE164(phone) : null;
  if (!e && !p) return false;
  const { rows } = await pool.query(
    `SELECT id FROM review_requests
     WHERE sent_at >= NOW() - ($3 || ' days')::interval
       AND (
         ($1::text IS NOT NULL AND lower(recipient_email) = $1)
         OR ($2::text IS NOT NULL AND recipient_phone = $2)
       )
     LIMIT 1`,
    [e, p, String(days)]
  );
  return rows.length > 0;
}

/* ==========================================================
 *  Setup / config
 * ========================================================== */

export async function getReviewsSetup(_req, res) {
  try {
    const google = await getGoogleAuthRow();
    const url = googleReviewUrl() || (await getReviewSetting("google_review_url")) || "";
    res.json({
      google: {
        configured: isGoogleConfigured(),
        connected: !!google,
        accountId: google?.account_id || process.env.GOOGLE_BUSINESS_ACCOUNT_ID || null,
        locationId: google?.location_id || process.env.GOOGLE_BUSINESS_LOCATION_ID || null,
        connectedAt: google?.connected_at || null,
      },
      openphone: {
        configured: isOpenPhoneConfigured(),
        fromNumber: process.env.OPENPHONE_FROM_NUMBER || null,
      },
      reviewUrl: url,
      emailConfigured: !!(await findActiveEmailConnection()),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Could not load setup." });
  }
}

export async function putReviewUrl(req, res) {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url || !/^https?:\/\//.test(url)) {
    res.status(400).json({ error: "Invalid review URL." });
    return;
  }
  await setReviewSetting("google_review_url", url);
  res.json({ ok: true, url });
}

export async function getGoogleBusinessConnect(req, res) {
  try {
    const url = buildGoogleAuthorizeUrl(req.user.id);
    res.redirect(302, url);
  } catch (e) {
    if (e.code === "GOOGLE_NOT_CONFIGURED") {
      res.status(503).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e.message || "Could not start OAuth." });
  }
}

export async function postGoogleBusinessAuthorizeUrl(req, res) {
  try {
    const url = buildGoogleAuthorizeUrl(req.user.id);
    res.json({ authorizeUrl: url });
  } catch (e) {
    if (e.code === "GOOGLE_NOT_CONFIGURED") {
      res.status(503).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e.message || "Could not start OAuth." });
  }
}

export async function getGoogleBusinessCallback(req, res) {
  const base = frontendBase();
  const code = req.query.code;
  const state = req.query.state;
  const err = req.query.error;
  if (err) {
    res.redirect(`${base}/reviews?gerror=${encodeURIComponent(err)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${base}/reviews?gerror=missing_code`);
    return;
  }
  let ctx;
  try {
    ctx = verifyGoogleOAuthState(state);
  } catch {
    res.redirect(`${base}/reviews?gerror=invalid_state`);
    return;
  }
  try {
    await handleGoogleCallback(code, ctx.userId);
    syncGoogleReviews({ trigger: "post_connect" }).catch((e) =>
      console.error("[reviews] post-connect sync", e.message || e)
    );
    res.redirect(`${base}/reviews?gconnected=1`);
  } catch (e) {
    res.redirect(`${base}/reviews?gerror=${encodeURIComponent(e.message || "oauth_failed")}`);
  }
}

export async function deleteGoogleBusinessConnection(_req, res) {
  await disconnectGoogle();
  res.json({ ok: true });
}

export async function getGoogleAccounts(_req, res) {
  try {
    const accounts = await listGoogleAccounts();
    res.json({ accounts });
  } catch (e) {
    if (e.code === "GOOGLE_NOT_CONNECTED") {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e.code === "GOOGLE_RATE_LIMIT") {
      res.status(429).json({ error: e.message, code: e.code });
      return;
    }
    if (e.code === "GOOGLE_NOT_FOUND" || e.code === "GOOGLE_FORBIDDEN") {
      res.status(e.status || 404).json({ error: e.message, code: e.code });
      return;
    }
    console.error("[reviews] list accounts", e);
    res.status(502).json({ error: e.message || "Could not list Google accounts." });
  }
}

export async function getGoogleLocationsForAccount(req, res) {
  const accountId = String(req.params.accountId || "").trim();
  if (!accountId) {
    res.status(400).json({ error: "accountId is required." });
    return;
  }
  try {
    const locations = await listGoogleLocations(accountId);
    res.json({ locations });
  } catch (e) {
    if (e.code === "GOOGLE_NOT_CONNECTED") {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e.code === "GOOGLE_RATE_LIMIT") {
      res.status(429).json({ error: e.message, code: e.code });
      return;
    }
    if (e.code === "GOOGLE_NOT_FOUND" || e.code === "GOOGLE_FORBIDDEN") {
      res.status(e.status || 404).json({ error: e.message, code: e.code });
      return;
    }
    console.error("[reviews] list locations", e);
    res.status(502).json({ error: e.message || "Could not list Google locations." });
  }
}

export async function postGoogleAutoDiscover(_req, res) {
  try {
    const result = await autoDiscoverAndSave();
    syncGoogleReviews({ trigger: "post_autodiscover" }).catch((e) =>
      console.error("[reviews] post-autodiscover sync", e.message || e)
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.code === "GOOGLE_NOT_CONNECTED") {
      res.status(400).json({ error: e.message, code: e.code });
      return;
    }
    if (e.code === "GOOGLE_RATE_LIMIT") {
      res.status(429).json({ error: e.message, code: e.code });
      return;
    }
    if (e.code === "GOOGLE_NOT_FOUND") {
      res.status(404).json({
        error:
          "Google returned 404. Your Google Cloud project likely needs access to the legacy My Business API v4. Request it at https://support.google.com/business/contact/api_default — v1 APIs are used as a fallback for discovery but the review sync itself requires v4.",
        code: e.code,
        actionUrl: "https://support.google.com/business/contact/api_default",
      });
      return;
    }
    if (e.code === "GOOGLE_FORBIDDEN") {
      res.status(403).json({
        error:
          "Google returned 403. The API may not be enabled on your Google Cloud project, or this Google account doesn't manage any Business Profiles.",
        code: e.code,
      });
      return;
    }
    if (e.code === "GOOGLE_NO_ACCOUNTS" || e.code === "GOOGLE_NO_LOCATIONS") {
      res.status(404).json({ error: e.message, code: e.code });
      return;
    }
    console.error("[reviews] auto-discover", e);
    res.status(502).json({ error: e.message || "Auto-discovery failed.", code: e.code });
  }
}

export async function putGoogleSelection(req, res) {
  const accountId = String(req.body?.accountId || "").trim();
  const locationId = String(req.body?.locationId || "").trim();
  if (!accountId || !locationId) {
    res.status(400).json({ error: "accountId and locationId are required." });
    return;
  }
  try {
    await saveGoogleSelection(accountId, locationId);
    syncGoogleReviews({ trigger: "post_selection" }).catch((e) =>
      console.error("[reviews] post-selection sync", e.message || e)
    );
    res.json({ ok: true, accountId, locationId });
  } catch (e) {
    if (e.code === "GOOGLE_NOT_CONNECTED") {
      res.status(400).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e.message || "Could not save selection." });
  }
}

/* ==========================================================
 *  Reviews: list, detail, actions, sync
 * ========================================================== */

export async function getReviews(req, res) {
  try {
    const pool = getPool();
    const { rating, isRead, hasReply, search, from, to } = req.query;
    const where = [];
    const params = [];
    let n = 1;
    if (rating && rating !== "all") {
      where.push(`star_rating = $${n++}`);
      params.push(Number(rating));
    }
    if (isRead === "false") where.push(`is_read = false`);
    if (isRead === "true") where.push(`is_read = true`);
    if (hasReply === "false") where.push(`reply_comment IS NULL`);
    if (hasReply === "true") where.push(`reply_comment IS NOT NULL`);
    if (search) {
      where.push(`(reviewer_name ILIKE $${n} OR comment ILIKE $${n})`);
      params.push(`%${search}%`);
      n++;
    }
    if (from) {
      where.push(`create_time >= $${n++}`);
      params.push(new Date(String(from)));
    }
    if (to) {
      where.push(`create_time <= $${n++}`);
      params.push(new Date(String(to)));
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT r.*, u.display_name AS replied_by_name
       FROM google_reviews r
       LEFT JOIN users u ON u.id = r.replied_by
       ${whereSql}
       ORDER BY r.create_time DESC NULLS LAST, r.id DESC
       LIMIT 500`,
      params
    );
    res.json({ reviews: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load reviews." });
  }
}

export async function getReviewById(req, res) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT r.*, u.display_name AS replied_by_name
     FROM google_reviews r
     LEFT JOIN users u ON u.id = r.replied_by
     WHERE r.id = $1`,
    [Number(req.params.id)]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  const review = rows[0];
  const { rows: attr } = await pool.query(
    `SELECT rr.*, t.name AS template_name, u.display_name AS team_member_name
     FROM review_requests rr
     LEFT JOIN review_request_templates t ON t.id = rr.template_id
     LEFT JOIN users u ON u.id = rr.team_member_id
     WHERE rr.review_id = $1
     LIMIT 1`,
    [review.id]
  );
  res.json({ review, attribution: attr[0] || null });
}

export async function putReviewRead(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const isRead = req.body?.isRead !== false;
  await pool.query(`UPDATE google_reviews SET is_read = $1 WHERE id = $2`, [isRead, id]);
  res.json({ ok: true });
}

export async function putReviewFlag(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `UPDATE google_reviews SET is_flagged = NOT COALESCE(is_flagged, false) WHERE id = $1 RETURNING is_flagged`,
    [id]
  );
  res.json({ isFlagged: rows[0]?.is_flagged ?? false });
}

export async function putReviewTags(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  await pool.query(`UPDATE google_reviews SET tags = $1::text[] WHERE id = $2`, [tags, id]);
  res.json({ ok: true, tags });
}

export async function putReviewNotes(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
  await pool.query(`UPDATE google_reviews SET internal_notes = $1 WHERE id = $2`, [notes, id]);
  res.json({ ok: true });
}

export async function postReviewReply(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!comment) {
    res.status(400).json({ error: "Reply comment is required." });
    return;
  }
  const { rows } = await pool.query(`SELECT google_review_id FROM google_reviews WHERE id = $1`, [id]);
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  try {
    await replyToReviewViaApi(rows[0].google_review_id, comment);
  } catch (e) {
    if (e.code === "GOOGLE_NOT_CONNECTED") {
      await pool.query(
        `UPDATE google_reviews SET reply_comment = $1, reply_update_time = NOW(),
          replied_by = $2, is_read = true WHERE id = $3`,
        [comment, req.user.id, id]
      );
      res.json({ ok: true, synced: false, warning: "Saved locally; not posted to Google (not connected)." });
      return;
    }
    res.status(500).json({ error: e.message || "Could not post reply." });
    return;
  }
  await pool.query(
    `UPDATE google_reviews SET reply_comment = $1, reply_update_time = NOW(),
      replied_by = $2, is_read = true WHERE id = $3`,
    [comment, req.user.id, id]
  );
  res.json({ ok: true, synced: true });
}

export async function deleteReviewReply(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const { rows } = await pool.query(`SELECT google_review_id FROM google_reviews WHERE id = $1`, [id]);
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  try {
    await deleteReviewReplyViaApi(rows[0].google_review_id);
  } catch (e) {
    if (e.code !== "GOOGLE_NOT_CONNECTED") {
      res.status(500).json({ error: e.message || "Could not delete reply." });
      return;
    }
  }
  await pool.query(
    `UPDATE google_reviews SET reply_comment = NULL, reply_update_time = NULL, replied_by = NULL WHERE id = $1`,
    [id]
  );
  res.json({ ok: true });
}

export async function postReviewAiSuggest(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT reviewer_name, star_rating, comment FROM google_reviews WHERE id = $1`,
    [id]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  const review = rows[0];
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    res.status(503).json({ error: "AI is not configured." });
    return;
  }
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const prompt = `You are a professional property management company (RPM Prestige in Houston, TX). Write a brief, warm, professional reply to this Google review. If positive, thank them sincerely. If negative, acknowledge their concern, apologize, and offer to resolve it. Keep it under 100 words. Sign as "The RPM Prestige Team".

Reviewer: ${review.reviewer_name || "Anonymous"}
Rating: ${review.star_rating} stars
Review: ${review.comment || "(no comment provided)"}

Return only the reply text, no quotes or preface.`;
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content?.[0];
    const text = block?.type === "text" ? block.text.trim() : "";
    res.json({ reply: text });
  } catch (e) {
    res.status(500).json({ error: e.message || "AI error." });
  }
}

export async function getReviewStats(_req, res) {
  const pool = getPool();
  const { rows: totals } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COALESCE(AVG(star_rating), 0)::numeric(3,2) AS avg_rating,
            SUM(CASE WHEN star_rating = 5 THEN 1 ELSE 0 END)::int AS five,
            SUM(CASE WHEN star_rating = 4 THEN 1 ELSE 0 END)::int AS four,
            SUM(CASE WHEN star_rating = 3 THEN 1 ELSE 0 END)::int AS three,
            SUM(CASE WHEN star_rating = 2 THEN 1 ELSE 0 END)::int AS two,
            SUM(CASE WHEN star_rating = 1 THEN 1 ELSE 0 END)::int AS one,
            SUM(CASE WHEN reply_comment IS NOT NULL THEN 1 ELSE 0 END)::int AS replied,
            SUM(CASE WHEN is_read = false THEN 1 ELSE 0 END)::int AS unread,
            SUM(CASE WHEN reply_comment IS NULL THEN 1 ELSE 0 END)::int AS needs_reply
       FROM google_reviews`
  );
  const { rows: rt } = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (reply_update_time - create_time)) / 3600) AS hrs
       FROM google_reviews
       WHERE reply_update_time IS NOT NULL AND create_time IS NOT NULL`
  );
  const t = totals[0] || {};
  const responseRate = t.total ? Math.round((t.replied / t.total) * 1000) / 10 : 0;
  res.json({
    total: t.total || 0,
    avgRating: Number(t.avg_rating) || 0,
    ratingDistribution: { 5: t.five || 0, 4: t.four || 0, 3: t.three || 0, 2: t.two || 0, 1: t.one || 0 },
    replied: t.replied || 0,
    unread: t.unread || 0,
    needsReply: t.needs_reply || 0,
    responseRate,
    avgResponseTimeHours: Number(rt[0]?.hrs) || 0,
  });
}

export async function postReviewSync(_req, res) {
  const result = await syncGoogleReviews({ trigger: "manual" });
  res.json(result);
}

/* ==========================================================
 *  Templates
 * ========================================================== */

export async function getTemplates(_req, res) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT t.*, u.display_name AS created_by_name,
      CASE WHEN t.send_count > 0 THEN ROUND(t.review_count::numeric * 100.0 / t.send_count, 1) ELSE 0 END AS conversion_rate
     FROM review_request_templates t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.is_active = true
     ORDER BY t.is_default DESC, t.name`
  );
  res.json({ templates: rows });
}

export async function getTemplate(req, res) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM review_request_templates WHERE id = $1`,
    [Number(req.params.id)]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json({ template: rows[0] });
}

function validateTemplatePayload(b) {
  const name = (b.name || "").trim();
  const channel = (b.channel || "email").toLowerCase();
  const recipient_type = (b.recipientType || b.recipient_type || "tenant").toLowerCase();
  const body = (b.body || "").trim();
  const subject = (b.subject || "").trim() || null;
  if (!name) return { error: "Name is required." };
  if (!["email", "sms", "both"].includes(channel)) return { error: "Invalid channel." };
  if (!["tenant", "owner", "vendor", "any"].includes(recipient_type)) return { error: "Invalid recipient type." };
  if (!body) return { error: "Body is required." };
  return { name, channel, recipient_type, body, subject };
}

export async function postTemplate(req, res) {
  const v = validateTemplatePayload(req.body || {});
  if (v.error) {
    res.status(400).json({ error: v.error });
    return;
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO review_request_templates
      (name, channel, subject, body, recipient_type, is_default, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     RETURNING *`,
    [v.name, v.channel, v.subject, v.body, v.recipient_type, !!req.body.isDefault, req.user.id]
  );
  res.status(201).json({ template: rows[0] });
}

export async function putTemplate(req, res) {
  const v = validateTemplatePayload(req.body || {});
  if (v.error) {
    res.status(400).json({ error: v.error });
    return;
  }
  const pool = getPool();
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `UPDATE review_request_templates SET
      name = $1, channel = $2, subject = $3, body = $4, recipient_type = $5,
      is_default = $6, updated_at = NOW()
     WHERE id = $7 RETURNING *`,
    [v.name, v.channel, v.subject, v.body, v.recipient_type, !!req.body.isDefault, id]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json({ template: rows[0] });
}

export async function deleteTemplate(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  await pool.query(
    `UPDATE review_request_templates SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [id]
  );
  res.json({ ok: true });
}

export async function postTemplateDuplicate(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const { rows: orig } = await pool.query(
    `SELECT * FROM review_request_templates WHERE id = $1`,
    [id]
  );
  if (!orig.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  const t = orig[0];
  const { rows } = await pool.query(
    `INSERT INTO review_request_templates
      (name, channel, subject, body, recipient_type, is_default, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, false, true, $6)
     RETURNING *`,
    [`${t.name} (copy)`, t.channel, t.subject, t.body, t.recipient_type, req.user.id]
  );
  res.status(201).json({ template: rows[0] });
}

/* ==========================================================
 *  Sending requests
 * ========================================================== */

async function teamMemberName(userId) {
  if (!userId) return null;
  const pool = getPool();
  const { rows } = await pool.query(`SELECT display_name FROM users WHERE id = $1`, [userId]);
  return rows[0]?.display_name || null;
}

async function sendOneRequest({
  template,
  recipientName,
  recipientEmail,
  recipientPhone,
  recipientType,
  channel,
  propertyName,
  propertyId,
  teamMemberId,
  triggeredBy = "manual",
  triggeredById = null,
  automationId = null,
  createdBy = null,
}) {
  const pool = getPool();
  const teamMember = await teamMemberName(teamMemberId);
  const trackingToken = generateTrackingToken();
  const vars = buildVars({
    recipientName,
    propertyAddress: propertyName || "",
    teamMemberName: teamMember || "The RPM Prestige Team",
    reviewUrl: `${trackingBaseUrl()}/track/${trackingToken}`,
  });
  const bodyText = renderTemplate(template.body, vars);
  const subject = template.subject ? renderTemplate(template.subject, vars) : null;

  const optedOut = await isOptedOut({ email: recipientEmail, phone: recipientPhone });
  if (optedOut) {
    const { rows } = await pool.query(
      `INSERT INTO review_requests
        (template_id, recipient_name, recipient_email, recipient_phone, recipient_type, channel,
         property_name, property_id, message_content, status, triggered_by, triggered_by_id,
         team_member_id, automation_id, tracking_token, created_by, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'failed',$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        template.id, recipientName, recipientEmail || null, formatE164(recipientPhone || ""),
        recipientType, channel, propertyName || null, propertyId || null, bodyText,
        triggeredBy, triggeredById, teamMemberId || null, automationId, trackingToken,
        createdBy, "Recipient has opted out",
      ]
    );
    return { ok: false, id: rows[0].id, error: "opted_out" };
  }

  const sendEmail = channel === "email" || channel === "both";
  const sendSms = channel === "sms" || channel === "both";
  const errors = [];

  if (sendEmail && recipientEmail) {
    try {
      const subj = subject || "We'd love your feedback";
      await sendEmailViaGraph({
        to: recipientEmail,
        subject: subj,
        bodyText,
        trackingToken,
      });
    } catch (e) {
      errors.push(`email: ${e.message}`);
    }
  } else if (sendEmail && !recipientEmail) {
    errors.push("email: no recipient email");
  }

  if (sendSms && recipientPhone) {
    try {
      await sendSmsMessage({ to: recipientPhone, bodyText, trackingToken });
    } catch (e) {
      errors.push(`sms: ${e.message}`);
    }
  } else if (sendSms && !recipientPhone) {
    errors.push("sms: no recipient phone");
  }

  const status = errors.length && errors.length === (sendEmail ? 1 : 0) + (sendSms ? 1 : 0) ? "failed" : "sent";
  const { rows } = await pool.query(
    `INSERT INTO review_requests
      (template_id, recipient_name, recipient_email, recipient_phone, recipient_type, channel,
       property_name, property_id, message_content, status, triggered_by, triggered_by_id,
       team_member_id, automation_id, tracking_token, created_by, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      template.id, recipientName, recipientEmail || null, formatE164(recipientPhone || ""),
      recipientType, channel, propertyName || null, propertyId || null, bodyText,
      status, triggeredBy, triggeredById, teamMemberId || null, automationId, trackingToken,
      createdBy, errors.join("; ") || null,
    ]
  );
  if (status === "sent") {
    await pool.query(
      `UPDATE review_request_templates SET send_count = send_count + 1, updated_at = NOW() WHERE id = $1`,
      [template.id]
    );
    if (automationId) {
      await pool.query(
        `UPDATE review_automations SET send_count = send_count + 1 WHERE id = $1`,
        [automationId]
      );
    }
  }
  return { ok: status === "sent", id: rows[0].id, status, errors };
}

export async function postSendRequest(req, res) {
  const b = req.body || {};
  const templateId = Number(b.templateId);
  if (!templateId) {
    res.status(400).json({ error: "templateId is required." });
    return;
  }
  const pool = getPool();
  const { rows: tmpl } = await pool.query(
    `SELECT * FROM review_request_templates WHERE id = $1 AND is_active = true`,
    [templateId]
  );
  if (!tmpl.length) {
    res.status(404).json({ error: "Template not found." });
    return;
  }
  const template = tmpl[0];
  const channel = (b.channel || template.channel).toLowerCase();

  const result = await sendOneRequest({
    template,
    recipientName: (b.recipientName || "").trim(),
    recipientEmail: b.recipientEmail ? String(b.recipientEmail).trim() : null,
    recipientPhone: b.recipientPhone ? String(b.recipientPhone).trim() : null,
    recipientType: (b.recipientType || template.recipient_type || "tenant").toLowerCase(),
    channel,
    propertyName: b.propertyName || null,
    propertyId: b.propertyId ? Number(b.propertyId) : null,
    teamMemberId: b.teamMemberId ? Number(b.teamMemberId) : req.user.id,
    createdBy: req.user.id,
    triggeredBy: "manual",
  });
  res.json(result);
}

export async function postSendBulk(req, res) {
  const b = req.body || {};
  const templateId = Number(b.templateId);
  const recipients = Array.isArray(b.recipients) ? b.recipients : [];
  if (!templateId || !recipients.length) {
    res.status(400).json({ error: "templateId and recipients[] are required." });
    return;
  }
  const pool = getPool();
  const { rows: tmpl } = await pool.query(
    `SELECT * FROM review_request_templates WHERE id = $1 AND is_active = true`,
    [templateId]
  );
  if (!tmpl.length) {
    res.status(404).json({ error: "Template not found." });
    return;
  }
  const template = tmpl[0];
  const channel = (b.channel || template.channel).toLowerCase();
  const teamMemberId = b.teamMemberId ? Number(b.teamMemberId) : req.user.id;
  const skipDedupe = b.skipDedupe === true;
  const triggeredBy = b.triggeredBy === "manual_test" ? "manual_test" : "manual_bulk";

  const results = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of recipients) {
    const name = (r.name || "").trim();
    if (!name) {
      skipped++;
      results.push({ name, skipped: true, reason: "no_name" });
      continue;
    }
    if (!skipDedupe && (await wasRecentlyRequested({ email: r.email, phone: r.phone, days: 30 }))) {
      skipped++;
      results.push({ name, skipped: true, reason: "recently_requested" });
      continue;
    }
    const one = await sendOneRequest({
      template,
      recipientName: name,
      recipientEmail: r.email || null,
      recipientPhone: r.phone || null,
      recipientType: r.recipientType || template.recipient_type || "tenant",
      channel,
      propertyName: r.propertyName || null,
      propertyId: r.propertyId ? Number(r.propertyId) : null,
      teamMemberId,
      createdBy: req.user.id,
      triggeredBy,
    });
    if (one.ok) sent++;
    else failed++;
    results.push({ name, ...one });
  }
  res.json({ sent, failed, skipped, total: recipients.length, results });
}

async function loadAppfolioRecipients(source, pool) {
  if (source === "current_tenants") {
    const { rows } = await pool.query(
      `SELECT
        appfolio_data->>'tenant' AS name,
        appfolio_data->>'tenant_email' AS email,
        appfolio_data->>'tenant_phone_number' AS phone,
        appfolio_data->>'property_name' AS propertyName,
        (appfolio_data->>'property_id')::int AS propertyId
       FROM cached_rent_roll
       WHERE appfolio_data->>'status' = 'Current'
         AND appfolio_data->>'tenant_email' IS NOT NULL
         AND appfolio_data->>'tenant_email' <> ''`
    );
    return rows.filter((r) => r.name && r.email);
  }
  if (source === "owners") {
    const { rows } = await pool.query(
      `SELECT
        appfolio_data->>'name' AS name,
        appfolio_data->>'email' AS email,
        (appfolio_data->>'phone_numbers') AS phone,
        appfolio_data->>'properties_owned' AS propertyName
       FROM cached_owners
       WHERE appfolio_data->>'email' IS NOT NULL
         AND appfolio_data->>'email' <> ''`
    );
    return rows.filter((r) => r.name && r.email);
  }
  if (source === "recently_completed_wo") {
    const { rows } = await pool.query(
      `SELECT
        appfolio_data->>'primary_tenant' AS name,
        appfolio_data->>'primary_tenant_email' AS email,
        appfolio_data->>'primary_tenant_phone_number' AS phone,
        appfolio_data->>'property_name' AS propertyName
       FROM cached_work_orders
       WHERE appfolio_data->>'status' = 'Completed'
         AND (appfolio_data->>'completed_on')::date >= (NOW() - INTERVAL '30 days')::date
         AND appfolio_data->>'primary_tenant_email' IS NOT NULL`
    );
    const seen = new Set();
    const dedup = [];
    for (const r of rows) {
      const key = (r.email || r.phone || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      dedup.push(r);
    }
    return dedup;
  }
  if (source === "lease_renewals") {
    const { rows } = await pool.query(
      `SELECT
        appfolio_data->>'tenant' AS name,
        appfolio_data->>'tenant_email' AS email,
        appfolio_data->>'tenant_phone_number' AS phone,
        appfolio_data->>'property_name' AS propertyName
       FROM cached_lease_expirations
       WHERE appfolio_data->>'status' IN ('Renewed', 'Renewing')
         AND appfolio_data->>'tenant_email' IS NOT NULL`
    );
    return rows.filter((r) => r.name && r.email);
  }
  return [];
}

export async function postSendFromAppfolio(req, res) {
  const b = req.body || {};
  const templateId = Number(b.templateId);
  const source = (b.source || "").toLowerCase();
  if (!templateId || !source) {
    res.status(400).json({ error: "templateId and source are required." });
    return;
  }
  const pool = getPool();
  const { rows: tmpl } = await pool.query(
    `SELECT * FROM review_request_templates WHERE id = $1 AND is_active = true`,
    [templateId]
  );
  if (!tmpl.length) {
    res.status(404).json({ error: "Template not found." });
    return;
  }
  const recipients = await loadAppfolioRecipients(source, pool);
  if (b.preview) {
    const filtered = [];
    let dedupeExcluded = 0;
    for (const r of recipients) {
      if (await wasRecentlyRequested({ email: r.email, phone: r.phone, days: 30 })) {
        dedupeExcluded++;
        continue;
      }
      filtered.push(r);
    }
    res.json({ total: recipients.length, dedupeExcluded, recipients: filtered.slice(0, 500) });
    return;
  }
  req.body.recipients = recipients;
  return postSendBulk(req, res);
}

/* ==========================================================
 *  Request listing
 * ========================================================== */

export async function getRequests(req, res) {
  const pool = getPool();
  const { status, channel, recipientType, teamMember, template, from, to, search } = req.query;
  const where = [];
  const params = [];
  let n = 1;
  if (status) {
    where.push(`rr.status = $${n++}`);
    params.push(String(status));
  }
  if (channel) {
    where.push(`rr.channel = $${n++}`);
    params.push(String(channel));
  }
  if (recipientType) {
    where.push(`rr.recipient_type = $${n++}`);
    params.push(String(recipientType));
  }
  if (teamMember) {
    where.push(`rr.team_member_id = $${n++}`);
    params.push(Number(teamMember));
  }
  if (template) {
    where.push(`rr.template_id = $${n++}`);
    params.push(Number(template));
  }
  if (from) {
    where.push(`rr.sent_at >= $${n++}`);
    params.push(new Date(String(from)));
  }
  if (to) {
    where.push(`rr.sent_at <= $${n++}`);
    params.push(new Date(String(to)));
  }
  if (search) {
    where.push(`(rr.recipient_name ILIKE $${n} OR rr.recipient_email ILIKE $${n} OR rr.property_name ILIKE $${n})`);
    params.push(`%${search}%`);
    n++;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT rr.*, t.name AS template_name, u.display_name AS team_member_name
     FROM review_requests rr
     LEFT JOIN review_request_templates t ON t.id = rr.template_id
     LEFT JOIN users u ON u.id = rr.team_member_id
     ${whereSql}
     ORDER BY rr.sent_at DESC
     LIMIT 500`,
    params
  );
  res.json({ requests: rows });
}

export async function getRequestById(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT rr.*, t.name AS template_name, u.display_name AS team_member_name
     FROM review_requests rr
     LEFT JOIN review_request_templates t ON t.id = rr.template_id
     LEFT JOIN users u ON u.id = rr.team_member_id
     WHERE rr.id = $1`,
    [id]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json({ request: rows[0] });
}

/* ==========================================================
 *  Public tracking + opt-out + pixel
 * ========================================================== */

export async function getPublicTrack(req, res) {
  const token = String(req.params.token || "");
  const pool = getPool();
  await pool.query(
    `UPDATE review_requests SET clicked_at = COALESCE(clicked_at, NOW()),
      status = CASE WHEN status = 'sent' THEN 'clicked' ELSE status END
     WHERE tracking_token = $1`,
    [token]
  );
  const url = googleReviewUrl() || (await getReviewSetting("google_review_url"));
  if (!url) {
    res.status(404).send("Review link is not configured.");
    return;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting…</title>
<meta http-equiv="refresh" content="1;url=${url}">
<style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;color:#1B2856;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.box{background:#fff;padding:2rem 2.5rem;border-radius:12px;box-shadow:0 8px 24px rgba(27,40,86,0.12);text-align:center;max-width:420px;}
h1{font-size:1.15rem;margin:0 0 0.5rem;color:#1B2856;}p{margin:0;color:#6A737B;font-size:0.9rem;}
.brand{color:#0098D0;font-weight:700;}</style></head>
<body><div class="box"><h1>Taking you to leave a review for <span class="brand">RPM Prestige</span>…</h1>
<p>If you're not redirected, <a href="${url}" style="color:#0098D0;">click here</a>.</p></div></body></html>`;
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}

export async function getPublicOptOut(req, res) {
  const token = String(req.params.token || "");
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT recipient_email, recipient_phone FROM review_requests WHERE tracking_token = $1`,
    [token]
  );
  if (rows.length) {
    const { recipient_email, recipient_phone } = rows[0];
    await pool.query(
      `INSERT INTO review_optouts (email, phone) VALUES ($1, $2)`,
      [recipient_email ? recipient_email.toLowerCase() : null, recipient_phone || null]
    );
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
<style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;color:#1B2856;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.box{background:#fff;padding:2rem 2.5rem;border-radius:12px;box-shadow:0 8px 24px rgba(27,40,86,0.12);text-align:center;max-width:520px;}
h1{font-size:1.2rem;margin:0 0 0.75rem;color:#1B2856;}p{margin:0 0 0.35rem;color:#6A737B;font-size:0.9rem;line-height:1.5;}
.brand{color:#0098D0;font-weight:700;}</style></head>
<body><div class="box"><h1>You've been unsubscribed.</h1>
<p>You will no longer receive review request messages from <span class="brand">RPM Prestige</span>.</p>
<p style="margin-top:1rem;font-size:0.82rem;">If this was a mistake, contact us at <a href="mailto:info@prestigerpm.com" style="color:#0098D0;">info@prestigerpm.com</a>.</p></div></body></html>`;
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}

const TRANSPARENT_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

export async function getPublicPixel(req, res) {
  const raw = String(req.params.token || "").replace(/\.png$/i, "");
  const pool = getPool();
  await pool.query(
    `UPDATE review_requests SET opened_at = COALESCE(opened_at, NOW()),
      status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
     WHERE tracking_token = $1`,
    [raw]
  );
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.send(TRANSPARENT_PIXEL);
}

/* ==========================================================
 *  Leaderboard
 * ========================================================== */

function periodStartFor(period, date = new Date()) {
  const d = new Date(date);
  if (period === "weekly") {
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === "monthly") return new Date(d.getFullYear(), d.getMonth(), 1);
  if (period === "quarterly") {
    const q = Math.floor(d.getMonth() / 3);
    return new Date(d.getFullYear(), q * 3, 1);
  }
  if (period === "yearly") return new Date(d.getFullYear(), 0, 1);
  return new Date(2000, 0, 1);
}

function nextPeriodStart(period, start) {
  const d = new Date(start);
  if (period === "weekly") d.setDate(d.getDate() + 7);
  else if (period === "monthly") d.setMonth(d.getMonth() + 1);
  else if (period === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (period === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setFullYear(d.getFullYear() + 100);
  return d;
}

export async function recalculateLeaderboardPeriod(period, date = new Date()) {
  const pool = getPool();
  const start = periodStartFor(period, date);
  const end = nextPeriodStart(period, start);
  const { rows } = await pool.query(
    `SELECT rr.team_member_id AS user_id,
            COUNT(*)::int AS requests_sent,
            SUM(CASE WHEN rr.review_received THEN 1 ELSE 0 END)::int AS reviews_received,
            SUM(CASE WHEN rr.review_rating = 5 THEN 1 ELSE 0 END)::int AS five_star,
            SUM(CASE WHEN rr.review_rating = 4 THEN 1 ELSE 0 END)::int AS four_star,
            SUM(CASE WHEN rr.review_rating = 3 THEN 1 ELSE 0 END)::int AS three_star,
            SUM(CASE WHEN rr.review_rating = 2 THEN 1 ELSE 0 END)::int AS two_star,
            SUM(CASE WHEN rr.review_rating = 1 THEN 1 ELSE 0 END)::int AS one_star,
            COALESCE(AVG(NULLIF(rr.review_rating, 0)), 0)::numeric(3,2) AS avg_rating
     FROM review_requests rr
     WHERE rr.team_member_id IS NOT NULL
       AND rr.sent_at >= $1
       AND rr.sent_at < $2
     GROUP BY rr.team_member_id`,
    [start, end]
  );
  for (const r of rows) {
    const conv = r.requests_sent
      ? Math.round((r.reviews_received * 10000) / r.requests_sent) / 100
      : 0;
    await pool.query(
      `INSERT INTO review_leaderboard
        (user_id, period, period_start, requests_sent, reviews_received,
         five_star_count, four_star_count, three_star_count, two_star_count, one_star_count,
         avg_rating, conversion_rate, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
       ON CONFLICT (user_id, period, period_start) DO UPDATE SET
         requests_sent = EXCLUDED.requests_sent,
         reviews_received = EXCLUDED.reviews_received,
         five_star_count = EXCLUDED.five_star_count,
         four_star_count = EXCLUDED.four_star_count,
         three_star_count = EXCLUDED.three_star_count,
         two_star_count = EXCLUDED.two_star_count,
         one_star_count = EXCLUDED.one_star_count,
         avg_rating = EXCLUDED.avg_rating,
         conversion_rate = EXCLUDED.conversion_rate,
         updated_at = NOW()`,
      [
        r.user_id, period, start.toISOString().slice(0, 10),
        r.requests_sent, r.reviews_received,
        r.five_star, r.four_star, r.three_star, r.two_star, r.one_star,
        r.avg_rating, conv,
      ]
    );
  }
}

export async function recalculateAllLeaderboards() {
  for (const p of ["weekly", "monthly", "quarterly", "yearly"]) {
    await recalculateLeaderboardPeriod(p);
  }
}

export async function getLeaderboard(req, res) {
  const period = String(req.query.period || "monthly");
  const date = req.query.date ? new Date(String(req.query.date)) : new Date();
  await recalculateLeaderboardPeriod(period, date);
  const start = periodStartFor(period, date);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT lb.*, u.display_name, u.username
     FROM review_leaderboard lb
     JOIN users u ON u.id = lb.user_id
     WHERE lb.period = $1 AND lb.period_start = $2
     ORDER BY lb.reviews_received DESC, lb.avg_rating DESC, lb.conversion_rate DESC`,
    [period, start.toISOString().slice(0, 10)]
  );
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  res.json({ period, periodStart: start.toISOString().slice(0, 10), leaderboard: ranked });
}

/* ==========================================================
 *  Analytics
 * ========================================================== */

export async function getAnalytics(req, res) {
  const pool = getPool();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();

  const [overviewQ, byTemplateQ, byChannelQ, byTypeQ, overTimeQ, dowQ, hourQ] = await Promise.all([
    pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM google_reviews WHERE create_time >= $1 AND create_time <= $2) AS total_reviews,
        (SELECT COALESCE(AVG(star_rating),0)::numeric(3,2) FROM google_reviews WHERE create_time >= $1 AND create_time <= $2) AS avg_rating,
        (SELECT COUNT(*)::int FROM review_requests WHERE sent_at >= $1 AND sent_at <= $2) AS total_requests,
        (SELECT SUM(CASE WHEN review_received THEN 1 ELSE 0 END)::int FROM review_requests WHERE sent_at >= $1 AND sent_at <= $2) AS reviews_from_requests,
        (SELECT SUM(CASE WHEN reply_comment IS NOT NULL THEN 1 ELSE 0 END)::int FROM google_reviews WHERE create_time >= $1 AND create_time <= $2) AS replied,
        (SELECT COUNT(*)::int FROM google_reviews WHERE create_time >= $1 AND create_time <= $2 AND star_rating = 5) AS five,
        (SELECT COUNT(*)::int FROM google_reviews WHERE create_time >= $1 AND create_time <= $2 AND star_rating = 4) AS four,
        (SELECT COUNT(*)::int FROM google_reviews WHERE create_time >= $1 AND create_time <= $2 AND star_rating = 3) AS three,
        (SELECT COUNT(*)::int FROM google_reviews WHERE create_time >= $1 AND create_time <= $2 AND star_rating = 2) AS two,
        (SELECT COUNT(*)::int FROM google_reviews WHERE create_time >= $1 AND create_time <= $2 AND star_rating = 1) AS one,
        (SELECT AVG(EXTRACT(EPOCH FROM (reply_update_time - create_time)) / 3600)
           FROM google_reviews WHERE create_time >= $1 AND create_time <= $2 AND reply_update_time IS NOT NULL) AS avg_resp_hours`,
      [from, to]
    ),
    pool.query(
      `SELECT t.id, t.name, COUNT(rr.id)::int AS sent,
              SUM(CASE WHEN rr.review_received THEN 1 ELSE 0 END)::int AS reviews,
              COALESCE(AVG(NULLIF(rr.review_rating, 0)),0)::numeric(3,2) AS avg_rating
         FROM review_request_templates t
         LEFT JOIN review_requests rr ON rr.template_id = t.id AND rr.sent_at >= $1 AND rr.sent_at <= $2
         GROUP BY t.id, t.name
         ORDER BY reviews DESC NULLS LAST, sent DESC`,
      [from, to]
    ),
    pool.query(
      `SELECT channel,
              COUNT(*)::int AS sent,
              SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END)::int AS opened,
              SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END)::int AS clicked,
              SUM(CASE WHEN review_received THEN 1 ELSE 0 END)::int AS reviews
         FROM review_requests
         WHERE sent_at >= $1 AND sent_at <= $2
         GROUP BY channel`,
      [from, to]
    ),
    pool.query(
      `SELECT recipient_type,
              COUNT(*)::int AS sent,
              SUM(CASE WHEN review_received THEN 1 ELSE 0 END)::int AS reviews,
              COALESCE(AVG(NULLIF(review_rating, 0)),0)::numeric(3,2) AS avg_rating
         FROM review_requests
         WHERE sent_at >= $1 AND sent_at <= $2
         GROUP BY recipient_type`,
      [from, to]
    ),
    pool.query(
      `SELECT date_trunc('day', rr.sent_at)::date AS date,
              COUNT(rr.id)::int AS sent,
              SUM(CASE WHEN rr.review_received THEN 1 ELSE 0 END)::int AS reviews,
              COALESCE(AVG(NULLIF(rr.review_rating, 0)),0)::numeric(3,2) AS avg_rating
         FROM review_requests rr
         WHERE rr.sent_at >= $1 AND rr.sent_at <= $2
         GROUP BY 1
         ORDER BY 1`,
      [from, to]
    ),
    pool.query(
      `SELECT EXTRACT(DOW FROM sent_at)::int AS dow,
              COUNT(*)::int AS sent,
              SUM(CASE WHEN review_received THEN 1 ELSE 0 END)::int AS reviews
         FROM review_requests
         WHERE sent_at >= $1 AND sent_at <= $2
         GROUP BY 1
         ORDER BY 1`,
      [from, to]
    ),
    pool.query(
      `SELECT EXTRACT(HOUR FROM sent_at)::int AS hour,
              COUNT(*)::int AS sent,
              SUM(CASE WHEN review_received THEN 1 ELSE 0 END)::int AS reviews
         FROM review_requests
         WHERE sent_at >= $1 AND sent_at <= $2
         GROUP BY 1
         ORDER BY 1`,
      [from, to]
    ),
  ]);

  const ov = overviewQ.rows[0] || {};
  const overallConversion = ov.total_requests
    ? Math.round((Number(ov.reviews_from_requests || 0) * 10000) / Number(ov.total_requests)) / 100
    : 0;
  const responseRate = ov.total_reviews
    ? Math.round((Number(ov.replied || 0) * 1000) / Number(ov.total_reviews)) / 10
    : 0;

  const byTemplate = byTemplateQ.rows.map((r) => ({
    templateId: r.id,
    name: r.name,
    sent: r.sent,
    reviews: r.reviews || 0,
    conversion: r.sent ? Math.round((Number(r.reviews || 0) * 10000) / r.sent) / 100 : 0,
    avgRating: Number(r.avg_rating) || 0,
  }));

  const byChannel = { email: null, sms: null, both: null };
  for (const r of byChannelQ.rows) byChannel[r.channel] = r;

  const byRecipientType = { tenant: null, owner: null, vendor: null };
  for (const r of byTypeQ.rows) byRecipientType[r.recipient_type] = r;

  // Best day / best hour
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let bestDay = null;
  let bestDayConv = -1;
  for (const r of dowQ.rows) {
    if (r.sent < 5) continue;
    const conv = r.reviews / r.sent;
    if (conv > bestDayConv) {
      bestDayConv = conv;
      bestDay = dayNames[r.dow];
    }
  }
  let bestHour = null;
  let bestHourConv = -1;
  for (const r of hourQ.rows) {
    if (r.sent < 5) continue;
    const conv = r.reviews / r.sent;
    if (conv > bestHourConv) {
      bestHourConv = conv;
      bestHour = r.hour;
    }
  }
  const bestTemplate = byTemplate
    .filter((t) => t.sent >= 10)
    .sort((a, b) => b.conversion - a.conversion)[0] || null;

  let bestChannel = null;
  let bestChannelConv = -1;
  for (const ch of Object.keys(byChannel)) {
    const r = byChannel[ch];
    if (!r || r.sent < 5) continue;
    const conv = r.reviews / r.sent;
    if (conv > bestChannelConv) {
      bestChannelConv = conv;
      bestChannel = ch;
    }
  }

  let bestRecipientType = null;
  let bestRecipientConv = -1;
  for (const rt of Object.keys(byRecipientType)) {
    const r = byRecipientType[rt];
    if (!r || r.sent < 5) continue;
    const conv = r.reviews / r.sent;
    if (conv > bestRecipientConv) {
      bestRecipientConv = conv;
      bestRecipientType = rt;
    }
  }

  res.json({
    overview: {
      totalReviews: Number(ov.total_reviews) || 0,
      avgRating: Number(ov.avg_rating) || 0,
      totalRequests: Number(ov.total_requests) || 0,
      overallConversion,
      responseRate,
      avgResponseTimeHours: Number(ov.avg_resp_hours) || 0,
      ratingDistribution: {
        5: Number(ov.five) || 0,
        4: Number(ov.four) || 0,
        3: Number(ov.three) || 0,
        2: Number(ov.two) || 0,
        1: Number(ov.one) || 0,
      },
    },
    byTemplate,
    byChannel,
    byRecipientType,
    overTime: overTimeQ.rows,
    bestPerforming: {
      bestTemplate,
      bestChannel,
      bestDayOfWeek: bestDay,
      bestTimeOfDay: bestHour != null ? `${bestHour}:00` : null,
      bestRecipientType,
    },
  });
}

/* ==========================================================
 *  Automations (CRUD)
 * ========================================================== */

export async function getAutomations(_req, res) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.*, t.name AS template_name
     FROM review_automations a
     LEFT JOIN review_request_templates t ON t.id = a.template_id
     ORDER BY a.created_at DESC`
  );
  res.json({ automations: rows });
}

export async function getAutomationById(req, res) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.*, t.name AS template_name FROM review_automations a
     LEFT JOIN review_request_templates t ON t.id = a.template_id
     WHERE a.id = $1`,
    [Number(req.params.id)]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json({ automation: rows[0] });
}

function validateAutomation(b) {
  const name = (b.name || "").trim();
  const triggerType = (b.triggerType || "").trim();
  if (!name) return { error: "Name is required." };
  if (!triggerType) return { error: "Trigger type is required." };
  return {
    name,
    description: b.description || null,
    trigger_type: triggerType,
    trigger_config: b.triggerConfig || {},
    template_id: b.templateId ? Number(b.templateId) : null,
    channel: (b.channel || "email").toLowerCase(),
    delay_hours: Number(b.delayHours ?? 72),
    recipient_type: (b.recipientType || "tenant").toLowerCase(),
    is_active: b.isActive !== false,
    conditions: b.conditions || { dedupe_days: 30, max_per_day: 50 },
  };
}

export async function postAutomation(req, res) {
  const v = validateAutomation(req.body || {});
  if (v.error) {
    res.status(400).json({ error: v.error });
    return;
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO review_automations
      (name, description, trigger_type, trigger_config, template_id, channel,
       delay_hours, recipient_type, is_active, conditions, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      v.name, v.description, v.trigger_type, JSON.stringify(v.trigger_config), v.template_id,
      v.channel, v.delay_hours, v.recipient_type, v.is_active,
      JSON.stringify(v.conditions), req.user.id,
    ]
  );
  res.status(201).json({ automation: rows[0] });
}

export async function putAutomation(req, res) {
  const v = validateAutomation(req.body || {});
  if (v.error) {
    res.status(400).json({ error: v.error });
    return;
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE review_automations SET
      name = $1, description = $2, trigger_type = $3, trigger_config = $4,
      template_id = $5, channel = $6, delay_hours = $7, recipient_type = $8,
      is_active = $9, conditions = $10, updated_at = NOW()
     WHERE id = $11 RETURNING *`,
    [
      v.name, v.description, v.trigger_type, JSON.stringify(v.trigger_config), v.template_id,
      v.channel, v.delay_hours, v.recipient_type, v.is_active,
      JSON.stringify(v.conditions), Number(req.params.id),
    ]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json({ automation: rows[0] });
}

export async function deleteAutomation(req, res) {
  const pool = getPool();
  await pool.query(`DELETE FROM review_automations WHERE id = $1`, [Number(req.params.id)]);
  res.json({ ok: true });
}

export async function putAutomationToggle(req, res) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE review_automations SET is_active = NOT COALESCE(is_active, false), updated_at = NOW()
     WHERE id = $1 RETURNING is_active`,
    [Number(req.params.id)]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json({ isActive: rows[0].is_active });
}

export async function postAutomationTest(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM review_automations WHERE id = $1`, [id]);
  if (!rows.length) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  const auto = rows[0];
  const { rows: tmplRow } = await pool.query(
    `SELECT * FROM review_request_templates WHERE id = $1`,
    [auto.template_id]
  );
  if (!tmplRow.length) {
    res.status(400).json({ error: "Template missing." });
    return;
  }
  const { rows: u } = await pool.query(`SELECT display_name, email FROM users WHERE id = $1`, [req.user.id]);
  const email = u[0]?.email;
  if (!email) {
    res.status(400).json({ error: "Your user has no email set." });
    return;
  }
  const out = await sendOneRequest({
    template: tmplRow[0],
    recipientName: u[0].display_name || "Test",
    recipientEmail: email,
    recipientPhone: req.body?.phone || null,
    recipientType: auto.recipient_type || "tenant",
    channel: auto.channel || "email",
    propertyName: "Sample Property, Houston, TX",
    teamMemberId: req.user.id,
    createdBy: req.user.id,
    triggeredBy: "automation_test",
    automationId: auto.id,
  });
  res.json(out);
}

/* ==========================================================
 *  Automation engine: cron runners
 * ========================================================== */

export async function processPendingRequests() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM review_requests
     WHERE status = 'pending' AND scheduled_send_at <= NOW()
     LIMIT 100`
  );
  for (const r of rows) {
    const { rows: tmpl } = await pool.query(
      `SELECT * FROM review_request_templates WHERE id = $1`,
      [r.template_id]
    );
    if (!tmpl.length) {
      await pool.query(
        `UPDATE review_requests SET status = 'failed', error_message = 'Template missing' WHERE id = $1`,
        [r.id]
      );
      continue;
    }
    const template = tmpl[0];
    const channel = r.channel || template.channel;
    const errors = [];
    const sendEmail = channel === "email" || channel === "both";
    const sendSms = channel === "sms" || channel === "both";

    if (sendEmail && r.recipient_email) {
      try {
        await sendEmailViaGraph({
          to: r.recipient_email,
          subject: template.subject || "We'd love your feedback",
          bodyText: r.message_content || template.body,
          trackingToken: r.tracking_token,
        });
      } catch (e) { errors.push(`email: ${e.message}`); }
    }
    if (sendSms && r.recipient_phone) {
      try {
        await sendSmsMessage({
          to: r.recipient_phone,
          bodyText: r.message_content || template.body,
          trackingToken: r.tracking_token,
        });
      } catch (e) { errors.push(`sms: ${e.message}`); }
    }
    const status = errors.length ? "failed" : "sent";
    await pool.query(
      `UPDATE review_requests SET status = $1, sent_at = NOW(),
        error_message = $2 WHERE id = $3`,
      [status, errors.join("; ") || null, r.id]
    );
    if (status === "sent") {
      await pool.query(
        `UPDATE review_request_templates SET send_count = send_count + 1 WHERE id = $1`,
        [template.id]
      );
      if (r.automation_id) {
        await pool.query(
          `UPDATE review_automations SET send_count = send_count + 1 WHERE id = $1`,
          [r.automation_id]
        );
      }
      await pool.query(
        `INSERT INTO review_automation_log (automation_id, request_id, trigger_event, result)
         VALUES ($1, $2, $3, 'sent')`,
        [r.automation_id, r.id, r.triggered_by]
      );
    } else {
      await pool.query(
        `INSERT INTO review_automation_log (automation_id, request_id, trigger_event, result, error_message)
         VALUES ($1, $2, $3, 'failed', $4)`,
        [r.automation_id, r.id, r.triggered_by, errors.join("; ")]
      );
    }
  }
  return { processed: rows.length };
}

/**
 * Event-based trigger: called from process/WO completion hooks. Creates a
 * PENDING request for delayed sending.
 */
export async function scheduleAutomationRequest({
  triggerType,
  triggerId,
  recipientName,
  recipientEmail,
  recipientPhone,
  propertyName,
  propertyId,
  teamMemberId,
}) {
  const pool = getPool();
  const { rows: autos } = await pool.query(
    `SELECT * FROM review_automations WHERE trigger_type = $1 AND is_active = true`,
    [triggerType]
  );
  const results = [];
  for (const auto of autos) {
    const cond = auto.conditions || {};
    const dedupeDays = Number(cond.dedupe_days ?? 30);
    if (await wasRecentlyRequested({ email: recipientEmail, phone: recipientPhone, days: dedupeDays })) {
      results.push({ automationId: auto.id, skipped: "recently_requested" });
      continue;
    }
    if (await isOptedOut({ email: recipientEmail, phone: recipientPhone })) {
      results.push({ automationId: auto.id, skipped: "opted_out" });
      continue;
    }
    const { rows: tmpl } = await pool.query(
      `SELECT * FROM review_request_templates WHERE id = $1`,
      [auto.template_id]
    );
    if (!tmpl.length) {
      results.push({ automationId: auto.id, skipped: "no_template" });
      continue;
    }
    const template = tmpl[0];
    const scheduledSendAt = new Date(Date.now() + (auto.delay_hours || 0) * 3600 * 1000);
    const trackingToken = generateTrackingToken();
    const tm = await teamMemberName(teamMemberId);
    const vars = buildVars({
      recipientName,
      propertyAddress: propertyName || "",
      teamMemberName: tm || "The RPM Prestige Team",
      reviewUrl: `${trackingBaseUrl()}/track/${trackingToken}`,
    });
    const bodyText = renderTemplate(template.body, vars);
    const { rows: inserted } = await pool.query(
      `INSERT INTO review_requests
        (template_id, recipient_name, recipient_email, recipient_phone, recipient_type,
         channel, property_name, property_id, message_content, status,
         scheduled_send_at, triggered_by, triggered_by_id, team_member_id, automation_id,
         tracking_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        template.id, recipientName, recipientEmail || null, formatE164(recipientPhone || ""),
        auto.recipient_type || "tenant", auto.channel || template.channel,
        propertyName || null, propertyId || null, bodyText,
        scheduledSendAt, triggerType, triggerId || null, teamMemberId || null, auto.id,
        trackingToken,
      ]
    );
    results.push({ automationId: auto.id, requestId: inserted[0].id, scheduledSendAt });
  }
  return results;
}

export async function processScheduledAutomations() {
  const pool = getPool();
  const now = new Date();
  const { rows: autos } = await pool.query(
    `SELECT * FROM review_automations WHERE is_active = true AND trigger_type = 'scheduled'`
  );
  for (const auto of autos) {
    const cfg = auto.trigger_config || {};
    const freq = cfg.frequency || "monthly";
    const dom = Number(cfg.day_of_month || 1);
    const maxPer = Number(cfg.max_per_batch || 20);
    const source = cfg.source || "current_tenants";
    const dayOk =
      freq === "weekly" ? now.getDay() === 1 :
      freq === "monthly" ? now.getDate() === dom :
      freq === "quarterly" ? (now.getDate() === dom && now.getMonth() % 3 === 0) : false;
    if (!dayOk) continue;

    const { rows: tmpl } = await pool.query(
      `SELECT * FROM review_request_templates WHERE id = $1`,
      [auto.template_id]
    );
    if (!tmpl.length) continue;
    const template = tmpl[0];
    const recipients = await loadAppfolioRecipients(source, pool);
    let created = 0;
    for (const r of recipients) {
      if (created >= maxPer) break;
      if (await wasRecentlyRequested({ email: r.email, phone: r.phone, days: 30 })) continue;
      if (await isOptedOut({ email: r.email, phone: r.phone })) continue;
      await scheduleAutomationRequest({
        triggerType: "scheduled",
        triggerId: null,
        recipientName: r.name,
        recipientEmail: r.email,
        recipientPhone: r.phone,
        propertyName: r.propertyName,
        propertyId: r.propertyId,
        teamMemberId: null,
      });
      created++;
    }
    await pool.query(
      `INSERT INTO review_automation_log (automation_id, trigger_event, result, trigger_details)
       VALUES ($1, 'scheduled', 'queued', $2)`,
      [auto.id, JSON.stringify({ created })]
    );
  }
}
