/**
 * Send email via SMTP. Uses the same env vars (SMTP_HOST, SMTP_PORT,
 * SMTP_USER, SMTP_PASS, SMTP_FROM) the backend already uses for the
 * legacy form-automation path — keeps the surface area small for now.
 *
 * config: { to, subject, body, cc?, bcc?, from? }
 */

import nodemailer from "nodemailer";

let cachedTransport;

function buildTransport() {
  if (cachedTransport) return cachedTransport;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user) return null;
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cachedTransport;
}

export async function runSendEmail({ config }) {
  const to = String(config.to || "").trim();
  const subject = String(config.subject || "").trim();
  const bodyRaw = String(config.body || "").trim();
  if (!to) return { status: "failed", error: "send_email: 'to' is required." };
  if (!subject) return { status: "failed", error: "send_email: 'subject' is required." };
  if (!bodyRaw) return { status: "failed", error: "send_email: 'body' is required." };

  const transport = buildTransport();
  const from = (config.from || process.env.SMTP_FROM || "").trim();
  if (!transport || !from) {
    return {
      status: "failed",
      error: "send_email: SMTP not configured (set SMTP_HOST/SMTP_USER/SMTP_FROM in the worker env).",
    };
  }

  const isHtml = /<[a-z][\s\S]*>/i.test(bodyRaw);
  const html = isHtml ? bodyRaw : `<p>${bodyRaw.replace(/\n/g, "<br>")}</p>`;
  const text = isHtml ? bodyRaw.replace(/<[^>]+>/g, "") : bodyRaw;

  try {
    const info = await transport.sendMail({
      from,
      to,
      cc: config.cc ? String(config.cc).trim() || undefined : undefined,
      bcc: config.bcc ? String(config.bcc).trim() || undefined : undefined,
      subject,
      html,
      text,
    });
    return {
      status: "success",
      output: {
        to,
        from,
        subject,
        message_id: info.messageId ?? null,
      },
    };
  } catch (err) {
    return { status: "failed", error: `send_email: ${err.message}` };
  }
}
