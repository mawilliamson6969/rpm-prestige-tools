/**
 * Compliance layer — single source of truth for "may we send to this agent
 * on this channel right now". EVERY automation action and EVERY ad-hoc
 * send MUST call canSendTo() before transmitting.
 *
 * Returns { allowed: bool, reason: string|null, defer: bool }
 *   - allowed=true : send is permitted right now.
 *   - allowed=false, defer=false : send permanently blocked (DNC, consent missing).
 *     Action should be marked status='skipped'.
 *   - allowed=false, defer=true  : send temporarily blocked (rate limit).
 *     Caller should reschedule scheduled_for and retry.
 */

import { randomBytes } from "node:crypto";
import { getPool } from "../db.js";

let _config = null;
let _configFetchedAt = 0;
const CONFIG_TTL_MS = 30 * 1000; // 30s — config rarely changes; cache aggressively

export async function getSystemConfig({ force = false } = {}) {
  const pool = getPool();
  if (!force && _config && Date.now() - _configFetchedAt < CONFIG_TTL_MS) {
    return _config;
  }
  const { rows } = await pool.query(`SELECT * FROM agent_hub_system_config WHERE id = 1`);
  _config = rows[0] || null;
  _configFetchedAt = Date.now();
  return _config;
}

export function invalidateSystemConfigCache() {
  _config = null;
  _configFetchedAt = 0;
}

/**
 * Per-channel rate limit check. Counts recent successful sends from the
 * agent_hub_send_log and compares to system_config limits.
 */
async function checkRateLimit(channel) {
  const config = await getSystemConfig();
  if (!config) return { allowed: true };
  const perHour =
    channel === "email" ? config.rate_limit_emails_per_hour
    : channel === "sms" ? config.rate_limit_sms_per_hour
    : null;
  const perDay =
    channel === "email" ? config.rate_limit_emails_per_day
    : channel === "sms" ? config.rate_limit_sms_per_day
    : null;
  if (perHour == null && perDay == null) return { allowed: true };
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '1 hour')::int AS hour_count,
       COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '1 day')::int AS day_count
       FROM agent_hub_send_log
      WHERE channel = $1 AND direction = 'outbound' AND delivery_status NOT IN ('failed','bounced')`,
    [channel]
  );
  const r = rows[0];
  if (perHour != null && r.hour_count >= perHour) {
    return { allowed: false, reason: `rate_limit_per_hour:${r.hour_count}/${perHour}` };
  }
  if (perDay != null && r.day_count >= perDay) {
    return { allowed: false, reason: `rate_limit_per_day:${r.day_count}/${perDay}` };
  }
  return { allowed: true };
}

const VALID_CHANNELS = new Set(["email", "sms", "postcard", "letter"]);

export async function canSendTo(agent, channel) {
  if (!agent) {
    return { allowed: false, defer: false, reason: "no_agent" };
  }
  if (!VALID_CHANNELS.has(channel)) {
    return { allowed: false, defer: false, reason: `unknown_channel:${channel}` };
  }

  // 1. Kill switch — instantaneous halt for ALL channels.
  const config = await getSystemConfig();
  if (config?.kill_switch_enabled) {
    // Defer instead of skip: when the switch lifts, queued actions resume.
    return { allowed: false, defer: true, reason: "kill_switch_engaged" };
  }

  // 2-3. Master DNC.
  if (agent.do_not_contact === true) {
    return { allowed: false, defer: false, reason: "agent_do_not_contact" };
  }
  if (agent.status === "dnc" || agent.status === "deleted") {
    return { allowed: false, defer: false, reason: `agent_status:${agent.status}` };
  }

  // 4-5. Channel-specific consent.
  if (channel === "email") {
    if (!agent.consent_to_email) {
      return { allowed: false, defer: false, reason: "no_email_consent" };
    }
    if (!agent.email) {
      return { allowed: false, defer: false, reason: "no_email_address" };
    }
  }
  if (channel === "sms") {
    if (!agent.consent_to_sms) {
      return { allowed: false, defer: false, reason: "no_sms_consent" };
    }
    if (!agent.phone_mobile) {
      return { allowed: false, defer: false, reason: "no_phone_mobile" };
    }
  }
  if (channel === "postcard" || channel === "letter") {
    if (!agent.mailing_address_1 || !agent.city || !agent.state || !agent.zip) {
      return { allowed: false, defer: false, reason: "no_mailing_address" };
    }
  }

  // 6. agent_hub_dnc table — checks for email/phone/agent-level entries.
  const pool = getPool();
  const dncChecks = [];
  if (agent.id) dncChecks.push({ k: "agent_id", v: agent.id });
  if (channel === "email" && agent.email) dncChecks.push({ k: "email_lower", v: String(agent.email).toLowerCase() });
  if (channel === "sms" && agent.phone_mobile) dncChecks.push({ k: "phone", v: agent.phone_mobile });
  if (dncChecks.length) {
    const wheres = [];
    const params = [];
    let p = 1;
    for (const c of dncChecks) {
      if (c.k === "agent_id") { wheres.push(`agent_id = $${p++}`); params.push(c.v); }
      else if (c.k === "email_lower") { wheres.push(`LOWER(email) = $${p++}`); params.push(c.v); }
      else if (c.k === "phone") { wheres.push(`phone = $${p++}`); params.push(c.v); }
    }
    const { rows } = await pool.query(
      `SELECT id, reason FROM agent_hub_dnc WHERE ${wheres.join(" OR ")} LIMIT 1`,
      params
    );
    if (rows.length) {
      return { allowed: false, defer: false, reason: `dnc_list:${rows[0].reason}` };
    }
  }

  // 7. Personal outreach flag — agent replied; Mike handles manually.
  if (agent.personal_outreach_flag === true) {
    return { allowed: false, defer: false, reason: "personal_outreach_flagged" };
  }

  // 8. Rate limit (defer instead of skip — caller can reschedule).
  if (channel === "email" || channel === "sms") {
    const rl = await checkRateLimit(channel);
    if (!rl.allowed) {
      return { allowed: false, defer: true, reason: rl.reason };
    }
  }

  return { allowed: true, defer: false, reason: null };
}

/**
 * Generate a fresh unsubscribe token. Stored in
 * agent_hub_unsubscribe_tokens; used in emails as a one-shot link.
 */
export async function createUnsubscribeToken(agentId, sendLogId = null) {
  const pool = getPool();
  const token = randomBytes(24).toString("base64url"); // 32 chars, URL-safe
  await pool.query(
    `INSERT INTO agent_hub_unsubscribe_tokens (token, agent_id, send_log_id) VALUES ($1, $2, $3)`,
    [token, agentId, sendLogId]
  );
  return token;
}

/**
 * Process an unsubscribe token: marks the agent DNC across all channels.
 * Returns { ok, reason }.
 */
export async function processUnsubscribe(token) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT t.*, a.id AS agent_pk, a.email, a.phone_mobile
         FROM agent_hub_unsubscribe_tokens t
         JOIN agent_hub_agents a ON a.id = t.agent_id
        WHERE t.token = $1
        FOR UPDATE`,
      [token]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_token" };
    }
    const tok = rows[0];
    if (tok.used_at) {
      // Already used — but be friendly: agent is already DNC'd, so report success.
      await client.query("ROLLBACK");
      return { ok: true, reason: "already_unsubscribed" };
    }
    // Mark token used.
    await client.query(`UPDATE agent_hub_unsubscribe_tokens SET used_at = NOW() WHERE id = $1`, [tok.id]);
    // Mark agent DNC. (Phase 1's biconditional CHECK + cascade trigger will
    // sync status='dnc' and unsubscribed_at automatically.)
    await client.query(
      `UPDATE agent_hub_agents
          SET do_not_contact = TRUE,
              status = 'dnc',
              unsubscribed_at = COALESCE(unsubscribed_at, NOW())
        WHERE id = $1`,
      [tok.agent_pk]
    );
    // Add to agent_hub_dnc list (email + phone if present).
    if (tok.email) {
      await client.query(
        `INSERT INTO agent_hub_dnc (agent_id, email, reason, source) VALUES ($1, $2, 'unsubscribed', 'unsubscribe_link')`,
        [tok.agent_pk, tok.email]
      );
    }
    if (tok.phone_mobile) {
      await client.query(
        `INSERT INTO agent_hub_dnc (agent_id, phone, reason, source) VALUES ($1, $2, 'unsubscribed', 'unsubscribe_link')`,
        [tok.agent_pk, tok.phone_mobile]
      );
    }
    if (!tok.email && !tok.phone_mobile) {
      await client.query(
        `INSERT INTO agent_hub_dnc (agent_id, reason, source) VALUES ($1, 'unsubscribed', 'unsubscribe_link')`,
        [tok.agent_pk]
      );
    }
    // Cancel any in-flight automation runs for this agent.
    await client.query(
      `UPDATE agent_hub_automation_runs
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_reason = 'agent_unsubscribed'
        WHERE agent_id = $1 AND status IN ('pending_approval','approved','running')`,
      [tok.agent_pk]
    );
    await client.query("COMMIT");
    return { ok: true, reason: "unsubscribed" };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[agent-hub] processUnsubscribe", e);
    return { ok: false, reason: "internal_error" };
  } finally {
    client.release();
  }
}

/**
 * Validate a template before save. Returns array of errors (empty = ok).
 * Also returns the list of merge fields detected (for cache).
 */
export function validateTemplate({ channel, subject, body, body_html }) {
  const errors = [];
  const fieldsFound = new Set();

  if (!body || !body.trim()) {
    errors.push("body is required.");
  }
  if (channel === "email") {
    if (!subject || !subject.trim()) {
      errors.push("subject is required for email templates.");
    }
    // CAN-SPAM: BOTH body AND body_html (when present) MUST contain the
    // merge fields independently. sendEmail picks body_html over body when
    // body_html is non-empty, so a body that's compliant doesn't save a
    // non-compliant body_html.
    const requireBoth = (txt, label) => {
      if (!txt) return;
      if (!txt.includes("{{unsubscribe_link}}")) {
        errors.push(`${label} must include {{unsubscribe_link}} (CAN-SPAM).`);
      }
      if (!txt.includes("{{physical_address}}")) {
        errors.push(`${label} must include {{physical_address}} (CAN-SPAM).`);
      }
    };
    requireBoth(body || "", "Email body");
    if (body_html && body_html.trim()) {
      requireBoth(body_html, "Email body_html");
    }
  }

  // Detect all merge fields used (for the merge_fields_used cache column).
  const re = /\{\{([a-z0-9_]+)\}\}/gi;
  const allText = [subject || "", body || "", body_html || ""].join("\n");
  let m;
  while ((m = re.exec(allText)) !== null) {
    fieldsFound.add(m[1].toLowerCase());
  }

  return { errors, fieldsUsed: Array.from(fieldsFound).sort() };
}

/**
 * Build the merge context for an agent. Pulls from:
 *   - agent_hub_agents (first_name, etc.)
 *   - agent_hub_personal_details (birthday, spouse — if available)
 *   - agent_hub_system_config (physical_address, referral_fee_offer_text)
 *   - per-render extras (e.g. property_address from a referral_id)
 *
 * Phase 3 keeps this read-heavy on purpose. Optimization is Phase 4 if needed.
 */
export async function buildMergeContext(agentId, extras = {}) {
  const pool = getPool();
  const config = await getSystemConfig();
  const { rows: agentRows } = await pool.query(
    `SELECT a.*, b.name AS brokerage_name_resolved
       FROM agent_hub_agents a
       LEFT JOIN agent_hub_brokerages b ON b.id = a.brokerage_id
      WHERE a.id = $1`,
    [agentId]
  );
  const agent = agentRows[0];
  if (!agent) return { agent_id: agentId, ...extras };

  const ctx = {
    first_name: agent.first_name || agent.full_name?.split(/\s+/)[0] || "",
    last_name: agent.last_name || "",
    full_name: agent.full_name || "",
    preferred_name: agent.preferred_name || agent.first_name || "",
    email: agent.email || "",
    brokerage_name: agent.brokerage_name || agent.brokerage_name_resolved || "",
    physical_address: config?.physical_address || "",
    referral_fee_offer_text: config?.referral_fee_offer_text || "",
    referral_fee_landing_url: config?.referral_fee_landing_url || "",
    referral_fee_payment_window_days: 30, // Static for now; could be configurable.
    mike_email: config?.default_sender_email || "",
    mike_direct_phone: "", // Filled by config in a future enhancement
    quarter: getQuarterLabel(new Date()),
    ...extras,
  };
  // Optional personal_details merge fields (no permission gate here — the
  // template author is responsible for not putting sensitive fields in
  // emails sent without consent. Phase 4 may enforce.)
  const { rows: pdRows } = await pool.query(
    `SELECT * FROM agent_hub_personal_details WHERE agent_id = $1`,
    [agentId]
  );
  if (pdRows.length) {
    ctx.spouse_name = pdRows[0].spouse_name || "";
  }
  return ctx;
}

function getQuarterLabel(d) {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

/**
 * Render a template with merge context. Replaces {{field}} with ctx[field].
 * Unknown fields render as empty string (gives a missing-data warning hook
 * for callers that want it — see `renderTemplateStrict`).
 */
export function renderTemplate(text, ctx) {
  if (!text) return "";
  return String(text).replace(/\{\{([a-z0-9_]+)\}\}/gi, (_m, key) => {
    const v = ctx[key.toLowerCase()];
    return v == null ? "" : String(v);
  });
}

/**
 * Strict variant — returns { rendered, missing } where missing[] lists any
 * merge fields that resolved to empty. Used by simulator + preview.
 */
export function renderTemplateStrict(text, ctx) {
  const missing = [];
  if (!text) return { rendered: "", missing };
  const rendered = String(text).replace(/\{\{([a-z0-9_]+)\}\}/gi, (_m, key) => {
    const k = key.toLowerCase();
    const v = ctx[k];
    if (v == null || v === "") missing.push(k);
    return v == null ? "" : String(v);
  });
  return { rendered, missing };
}
