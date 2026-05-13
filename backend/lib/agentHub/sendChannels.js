/**
 * Channel adapters: actual transmission via Microsoft Graph (email),
 * OpenPhone (SMS), and the manual print queue (postcard).
 *
 * EVERY caller MUST have already called canSendTo() before reaching here.
 * These functions assume the compliance check passed.
 *
 * Each adapter:
 *   - Returns { external_id, delivery_status, body, subject? } on success.
 *   - Throws on failure (action executor catches and marks the row failed).
 *   - Logs to agent_hub_send_log (idempotent via uq_agent_hub_send_log_external).
 */

import { getPool } from "../db.js";
import { graphPost } from "../inbox/graph-client.js";
import {
  getValidAccessTokenForConnection,
  pickEmailConnection,
} from "../inbox/microsoft-auth.js";
import { sendSMS as openPhoneSendSMS } from "../openphone.js";
import { createUnsubscribeToken, renderTemplate, buildMergeContext, getSystemConfig } from "./compliance.js";

const SEND_LOG_DEFAULTS = {
  delivery_status: "sent",
  direction: "outbound",
};

async function logSend(pool, fields) {
  const cols = Object.keys({ ...SEND_LOG_DEFAULTS, ...fields });
  const vals = cols.map((k) => (fields[k] !== undefined ? fields[k] : SEND_LOG_DEFAULTS[k]));
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  try {
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_send_log (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
      vals
    );
    return rows[0].id;
  } catch (e) {
    if (e.code === "23505") {
      // Duplicate external_id — find the existing row, return its id (idempotent).
      const { rows } = await pool.query(
        `SELECT id FROM agent_hub_send_log WHERE channel = $1 AND external_id = $2 LIMIT 1`,
        [fields.channel, fields.external_id]
      );
      return rows[0]?.id ?? null;
    }
    throw e;
  }
}

/**
 * Send an email via Microsoft Graph.
 *
 * @param {object} args
 * @param {object} args.agent - Full agent row.
 * @param {object} args.template - { id, subject, body, body_html }
 * @param {number} args.senderUserId - users.id whose Graph mailbox to use.
 * @param {object} args.context - Pre-built merge context (or undefined; we'll build).
 * @param {object} args.linkRefs - { automation_run_id?, action_queue_id?, sent_by? }
 * @returns {Promise<{ send_log_id, external_id, subject, body, body_html }>}
 */
export async function sendEmail({ agent, template, senderUserId, context, linkRefs = {} }) {
  if (!agent?.email) throw new Error("Agent has no email address.");
  const pool = getPool();
  const ctx = context || (await buildMergeContext(agent.id));

  // Generate the unsubscribe token NOW so the rendered body has a real link.
  // We pre-create the send_log row id-only (with empty body) AFTER send,
  // since send_log_id is needed for the token. We resolve this by:
  //   1. Create token without send_log_id first.
  //   2. Render with token URL.
  //   3. Send.
  //   4. Insert send_log row.
  //   5. Backfill the token with send_log_id.
  // (Simpler than a circular dep, and safe: the token is single-use and
  // can be invalidated even before the send_log row exists.)
  const config = await getSystemConfig();
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || "https://prestigedash.com";
  const token = await createUnsubscribeToken(agent.id, null);
  ctx.unsubscribe_link = `${baseUrl}/api/agent-hub/unsubscribe?token=${encodeURIComponent(token)}`;

  const subject = renderTemplate(template.subject || "", ctx);
  const body = renderTemplate(template.body || "", ctx);
  const bodyHtml = template.body_html ? renderTemplate(template.body_html, ctx) : null;

  const conn = await pickEmailConnection(senderUserId);
  if (!conn) {
    throw Object.assign(new Error("No active Microsoft email connection."), { code: "NO_EMAIL_CONNECTION" });
  }
  const { accessToken } = await getValidAccessTokenForConnection(conn.id);
  const path =
    conn.mailbox_type === "shared" && conn.mailbox_email
      ? `/users/${encodeURIComponent(conn.mailbox_email)}/sendMail`
      : "/me/sendMail";

  // Microsoft Graph /sendMail does NOT return the sent message id; we have
  // to look it up from the Sent folder. Phase 3 simplification: we mint a
  // synthetic external_id locally and store it in metadata so reply
  // detection can match by the In-Reply-To header (which Graph includes).
  // Better: construct an Internet-Message-ID header ourselves so replies
  // thread correctly.
  const messageId = `<agent-hub-${linkRefs.automation_run_id || "ad"}-${linkRefs.action_queue_id || Date.now()}-${agent.id}@${(config?.default_sender_email || "agent-hub").split("@")[1] || "rpmprestige.local"}>`;

  await graphPost(path, accessToken, {
    message: {
      subject: subject || "(no subject)",
      body: { contentType: bodyHtml ? "HTML" : "Text", content: bodyHtml || body },
      toRecipients: [
        { emailAddress: { address: agent.email, name: agent.full_name || undefined } },
      ],
      internetMessageHeaders: [
        // Custom header so reply detector can match. Graph allows X-* headers.
        { name: "x-agent-hub-message-id", value: messageId },
      ],
    },
    saveToSentItems: true,
  });

  const sendLogId = await logSend(pool, {
    agent_id: agent.id,
    channel: "email",
    automation_run_id: linkRefs.automation_run_id || null,
    action_queue_id: linkRefs.action_queue_id || null,
    template_id: template.id || null,
    sent_by: linkRefs.sent_by || null,
    to_address: agent.email,
    subject,
    body,
    external_id: messageId,
    delivery_status: "sent",
  });

  // Backfill token with send_log_id so the unsubscribe handler can audit it.
  if (sendLogId) {
    await pool.query(
      `UPDATE agent_hub_unsubscribe_tokens SET send_log_id = $1 WHERE token = $2 AND send_log_id IS NULL`,
      [sendLogId, token]
    );
  }

  return { send_log_id: sendLogId, external_id: messageId, subject, body, body_html: bodyHtml };
}

/**
 * Send an SMS via OpenPhone.
 */
export async function sendSms({ agent, template, context, linkRefs = {} }) {
  if (!agent?.phone_mobile) throw new Error("Agent has no mobile phone.");
  const pool = getPool();
  const ctx = context || (await buildMergeContext(agent.id));
  const body = renderTemplate(template.body || "", ctx);
  const result = await openPhoneSendSMS(agent.phone_mobile, body);
  // OpenPhone returns { id, ... } per their API.
  const externalId = result?.id || result?.data?.id || null;

  const sendLogId = await logSend(pool, {
    agent_id: agent.id,
    channel: "sms",
    automation_run_id: linkRefs.automation_run_id || null,
    action_queue_id: linkRefs.action_queue_id || null,
    template_id: template.id || null,
    sent_by: linkRefs.sent_by || null,
    to_address: agent.phone_mobile,
    subject: null,
    body,
    external_id: externalId,
    delivery_status: "sent",
  });

  return { send_log_id: sendLogId, external_id: externalId, body };
}

/**
 * Queue a postcard for manual fulfillment by Lori. Snapshots the mailing
 * address at queue time so address edits later don't change the rendered
 * postcard.
 */
export async function queuePostcard({ agent, template, context, linkRefs = {} }) {
  if (!agent?.mailing_address_1) throw new Error("Agent has no mailing address.");
  const pool = getPool();
  const ctx = context || (await buildMergeContext(agent.id));
  const subject = renderTemplate(template.subject || "", ctx);
  const body = renderTemplate(template.body || "", ctx);
  const mailingAddress = {
    address_1: agent.mailing_address_1,
    address_2: agent.mailing_address_2,
    city: agent.city,
    state: agent.state,
    zip: agent.zip,
    name: agent.full_name,
  };
  const { rows } = await pool.query(
    `INSERT INTO agent_hub_postcard_print_queue
       (agent_id, automation_run_id, template_id, rendered_subject, rendered_body, mailing_address)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [
      agent.id,
      linkRefs.automation_run_id || null,
      template.id || null,
      subject || null,
      body,
      JSON.stringify(mailingAddress),
    ]
  );
  // Also log to send_log so postcards show in the agent timeline send count.
  const sendLogId = await logSend(pool, {
    agent_id: agent.id,
    channel: "postcard",
    automation_run_id: linkRefs.automation_run_id || null,
    action_queue_id: linkRefs.action_queue_id || null,
    template_id: template.id || null,
    sent_by: linkRefs.sent_by || null,
    to_address: `${mailingAddress.address_1}, ${mailingAddress.city} ${mailingAddress.state} ${mailingAddress.zip}`,
    subject,
    body,
    external_id: `postcard-queue-${rows[0].id}`,
    delivery_status: "sent",
  });
  return { send_log_id: sendLogId, postcard_queue_id: rows[0].id, body, subject };
}
