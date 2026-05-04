import { getPool } from "./db.js";
import { graphPost } from "./inbox/graph-client.js";
import { getValidAccessTokenForConnection } from "./inbox/microsoft-auth.js";
import { sendSMS, isOpenPhoneConfigured, formatE164 } from "./openphone.js";
import { logActivity, bumpActivity } from "./process-activity.js";
import { buildMergeContext, applyMergeContext } from "./process-merge-fields.js";

/**
 * Phase 3: send emails (Microsoft Graph) and SMS (OpenPhone) from inside a
 * process, log them to process_communications, fire activity events, and
 * bump template counters.
 *
 * Reuses the inbox feature's MS Graph token store (email_connections) and
 * the existing OpenPhone helper.
 */

/* ---------- shared ---------- */

async function pickEmailConnection(senderId) {
  const pool = getPool();
  if (Number.isFinite(Number(senderId))) {
    const { rows } = await pool.query(
      `SELECT * FROM email_connections
       WHERE user_id = $1 AND is_active = true
       ORDER BY id DESC LIMIT 1`,
      [Number(senderId)]
    );
    if (rows.length) return rows[0];
  }
  // Fallback: any active connection (so a system step can still send).
  const { rows } = await pool.query(
    `SELECT * FROM email_connections WHERE is_active = true ORDER BY id ASC LIMIT 1`
  );
  return rows[0] || null;
}

function htmlBody(body) {
  if (!body) return "";
  return body.includes("<") ? body : `<p>${body.replace(/\n/g, "<br>")}</p>`;
}

function plainText(body) {
  if (!body) return "";
  return body.replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim();
}

/* ---------- recipient resolution ---------- */

/**
 * Look up the email/phone for a step based on its recipient_type and the
 * process's linked tenant/owner/role-assignment.
 */
export async function resolveRecipient({ processId, recipientType, recipientValue }) {
  const pool = getPool();
  const ctx = await buildMergeContext(processId, null, pool);
  const tenantEmail =
    ctx.tenant?.primary_tenant_email || ctx.tenant?.email || null;
  const tenantPhone =
    ctx.tenant?.primary_tenant_phone_number ||
    ctx.tenant?.phone_numbers ||
    ctx.tenant?.phone ||
    null;
  const ownerEmail = ctx.owner?.email || ctx.process?.contact_email || null;
  const ownerPhone =
    ctx.owner?.phone || ctx.owner?.phone_number || ctx.process?.contact_phone || null;

  switch (recipientType) {
    case "tenant":
      return { email: tenantEmail, phone: tenantPhone, name: ctx.tenant?.tenant || null };
    case "owner":
      return {
        email: ownerEmail,
        phone: ownerPhone,
        name: ctx.owner?.owner_name || ctx.process?.contact_name || null,
      };
    case "custom_email":
      return { email: recipientValue || null, phone: null, name: null };
    case "custom_phone":
      return { email: null, phone: recipientValue || null, name: null };
    case "assigned_role": {
      if (!recipientValue) return { email: null, phone: null, name: null };
      const { rows } = await pool.query(
        `SELECT u.id, u.display_name, u.username, ec.mailbox_email
         FROM process_role_assignments a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN email_connections ec ON ec.user_id = a.user_id AND ec.is_active = true
         WHERE a.process_id = $1 AND a.role_name = $2
         LIMIT 1`,
        [processId, recipientValue]
      );
      const r = rows[0];
      return {
        email: r?.mailbox_email || null,
        phone: null,
        name: r?.display_name || r?.username || null,
      };
    }
    default:
      return { email: null, phone: null, name: null };
  }
}

/* ---------- email ---------- */

export async function sendProcessEmail({
  processId,
  templateId = null,
  to,
  toName = null,
  subject = "",
  body = "",
  senderId,
  bodyText = null,
}) {
  const pool = getPool();

  let resolvedSubject = subject || "";
  let resolvedBody = body || "";
  if (Number.isFinite(Number(templateId))) {
    const { rows } = await pool.query(
      `SELECT * FROM process_email_templates WHERE id = $1`,
      [Number(templateId)]
    );
    if (!rows.length) throw new Error("Email template not found.");
    resolvedSubject = rows[0].subject || "";
    resolvedBody = rows[0].body_html || "";
  }

  const ctx = await buildMergeContext(processId, senderId, pool);
  resolvedSubject = applyMergeContext(resolvedSubject, ctx);
  resolvedBody = applyMergeContext(resolvedBody, ctx);

  if (!to || !String(to).includes("@")) {
    throw new Error("A valid recipient email is required.");
  }

  const conn = await pickEmailConnection(senderId);
  if (!conn) {
    const err = new Error(
      "No active Microsoft email connection. Connect an account from the Inbox settings before sending."
    );
    err.code = "NO_EMAIL_CONNECTION";
    throw err;
  }
  const { accessToken } = await getValidAccessTokenForConnection(conn.id);
  const path =
    conn.mailbox_type === "shared" && conn.mailbox_email
      ? `/users/${encodeURIComponent(conn.mailbox_email)}/sendMail`
      : "/me/sendMail";

  await graphPost(path, accessToken, {
    message: {
      subject: resolvedSubject || "(no subject)",
      body: { contentType: "HTML", content: htmlBody(resolvedBody) },
      toRecipients: [
        {
          emailAddress: { address: String(to).trim(), name: toName || undefined },
        },
      ],
    },
    saveToSentItems: true,
  });

  const { rows: commRows } = await pool.query(
    `INSERT INTO process_communications
       (process_id, channel, direction, subject, body, from_address, to_address,
        status, email_template_id, sent_by)
     VALUES ($1, 'email', 'outbound', $2, $3, $4, $5, 'sent', $6, $7)
     RETURNING *`,
    [
      processId,
      resolvedSubject,
      bodyText || plainText(resolvedBody),
      conn.mailbox_email || null,
      String(to).trim(),
      Number.isFinite(Number(templateId)) ? Number(templateId) : null,
      Number.isFinite(Number(senderId)) ? Number(senderId) : null,
    ]
  );
  const communication = commRows[0];

  if (Number.isFinite(Number(templateId))) {
    await pool.query(
      `UPDATE process_email_templates
       SET total_sends = COALESCE(total_sends, 0) + 1, updated_at = NOW()
       WHERE id = $1`,
      [Number(templateId)]
    );
  }

  await logActivity(processId, {
    actionType: "email_sent",
    description: `Sent email: ${resolvedSubject || "(no subject)"}`,
    metadata: { communicationId: communication.id, to: String(to).trim() },
    actor: { id: Number(senderId) || null },
  });
  await bumpActivity(processId, { type: "email_sent", userId: senderId });

  return { communication, resolvedSubject, resolvedBody };
}

/* ---------- SMS ---------- */

export async function sendProcessSMS({
  processId,
  templateId = null,
  to,
  body = "",
  senderId,
}) {
  const pool = getPool();
  let resolvedBody = body || "";
  if (Number.isFinite(Number(templateId))) {
    const { rows } = await pool.query(
      `SELECT * FROM process_text_templates WHERE id = $1`,
      [Number(templateId)]
    );
    if (!rows.length) throw new Error("Text template not found.");
    resolvedBody = rows[0].body || "";
  }
  const ctx = await buildMergeContext(processId, senderId, pool);
  resolvedBody = applyMergeContext(resolvedBody, ctx);

  if (!resolvedBody.trim()) throw new Error("SMS body is empty after merge resolution.");
  if (!to || !String(to).trim()) throw new Error("Recipient phone is required.");

  if (!isOpenPhoneConfigured()) {
    const err = new Error("OpenPhone is not configured (set OPENPHONE_API_KEY + OPENPHONE_FROM_NUMBER).");
    err.code = "OPENPHONE_NOT_CONFIGURED";
    throw err;
  }

  const result = await sendSMS(String(to).trim(), resolvedBody);
  const e164 = formatE164(to);
  const externalId =
    (result && (result.id || result?.data?.id || result?.message?.id)) || null;

  const { rows: commRows } = await pool.query(
    `INSERT INTO process_communications
       (process_id, channel, direction, body, from_address, to_address,
        status, text_template_id, external_id, sent_by)
     VALUES ($1, 'sms', 'outbound', $2, $3, $4, 'sent', $5, $6, $7)
     RETURNING *`,
    [
      processId,
      resolvedBody,
      process.env.OPENPHONE_FROM_NUMBER || null,
      e164 || String(to).trim(),
      Number.isFinite(Number(templateId)) ? Number(templateId) : null,
      externalId ? String(externalId) : null,
      Number.isFinite(Number(senderId)) ? Number(senderId) : null,
    ]
  );
  const communication = commRows[0];

  if (Number.isFinite(Number(templateId))) {
    await pool.query(
      `UPDATE process_text_templates
       SET total_sends = COALESCE(total_sends, 0) + 1, updated_at = NOW()
       WHERE id = $1`,
      [Number(templateId)]
    );
  }

  await logActivity(processId, {
    actionType: "text_sent",
    description: `Sent text to ${e164 || to}`,
    metadata: { communicationId: communication.id, to: e164 || String(to).trim() },
    actor: { id: Number(senderId) || null },
  });
  await bumpActivity(processId, { type: "text_sent", userId: senderId });

  return { communication, resolvedBody };
}

/* ---------- auto-send on stage entry ---------- */

/**
 * After a process enters a new stage, walk its template steps for that stage
 * that are typed email/sms with send_timing='immediately' and send them.
 * Steps with delayed timing get scheduled_send_at stamped for a future cron.
 *
 * This is best-effort — never throws back to the caller; failures are logged
 * to process_steps.automation_error.
 */
export async function executeImmediateSendsForStage(
  processId,
  templateStageId,
  { actorUserId = null } = {}
) {
  if (!Number.isFinite(Number(processId)) || !Number.isFinite(Number(templateStageId))) {
    return { processed: 0 };
  }
  const pool = getPool();
  const { rows: steps } = await pool.query(
    `SELECT s.*
     FROM process_steps s
     JOIN process_template_steps ts ON ts.id = s.template_step_id
     WHERE s.process_id = $1
       AND ts.stage_id = $2
       AND s.status NOT IN ('completed','skipped')
       AND s.sent_at IS NULL
       AND COALESCE(s.task_type, ts.task_type, 'todo') IN ('email','sms')`,
    [Number(processId), Number(templateStageId)]
  );

  let processed = 0;
  for (const step of steps) {
    const taskType = step.task_type || "todo";
    const timing = step.send_timing || "immediately";
    if (timing !== "immediately") {
      const delayMs = computeDelayMs(step);
      if (delayMs > 0) {
        await pool.query(
          `UPDATE process_steps
           SET scheduled_send_at = NOW() + ($1 || ' milliseconds')::interval, updated_at = NOW()
           WHERE id = $2`,
          [String(delayMs), step.id]
        );
      }
      continue;
    }
    try {
      const recipient = await resolveRecipient({
        processId,
        recipientType: step.recipient_type || "tenant",
        recipientValue: step.recipient_value,
      });
      let result = null;
      if (taskType === "email") {
        if (!recipient.email) throw new Error("No recipient email available for this step.");
        result = await sendProcessEmail({
          processId,
          templateId: step.email_template_id,
          to: recipient.email,
          toName: recipient.name,
          senderId: actorUserId,
        });
      } else if (taskType === "sms") {
        if (!recipient.phone) throw new Error("No recipient phone available for this step.");
        result = await sendProcessSMS({
          processId,
          templateId: step.text_template_id,
          to: recipient.phone,
          senderId: actorUserId,
        });
      }
      if (result?.communication) {
        await pool.query(
          `UPDATE process_steps
           SET status = 'completed',
               completed_at = NOW(),
               sent_at = NOW(),
               sent_communication_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [result.communication.id, step.id]
        );
        processed += 1;
      }
    } catch (err) {
      console.warn(`[messaging] auto-send step ${step.id} failed:`, err.message);
      try {
        await pool.query(
          `UPDATE process_steps
           SET automation_status = 'failed', automation_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [String(err.message || err).slice(0, 500), step.id]
        );
      } catch {
        /* ignore */
      }
    }
  }
  return { processed };
}

function computeDelayMs(step) {
  const amount = Number(step.delay_amount) || 0;
  const unit = String(step.delay_unit || "days").toLowerCase();
  if (amount <= 0) return 0;
  if (unit === "hours") return amount * 60 * 60 * 1000;
  if (unit === "minutes") return amount * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000; // days default
}
