/**
 * Send SMS via OpenPhone.
 *
 * config: { to, body, from? }   // {{ ... }} placeholders already rendered upstream
 */

const OPENPHONE_URL = "https://api.openphone.com/v1";

function formatE164(phone) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(phone).startsWith("+")) return String(phone).replace(/[^\d+]/g, "");
  return `+${digits}`;
}

export async function runSendSms({ config }) {
  const apiKey = process.env.OPENPHONE_API_KEY?.trim();
  const defaultFrom = process.env.OPENPHONE_FROM_NUMBER?.trim();
  if (!apiKey) {
    return { status: "failed", error: "OPENPHONE_API_KEY is not set in the worker env." };
  }
  const to = formatE164(config.to);
  const from = (config.from || config.from_number || defaultFrom || "").trim();
  const body = String(config.body || "").trim();
  if (!to) return { status: "failed", error: "send_sms: 'to' is required and must be a phone number." };
  if (!from) return { status: "failed", error: "send_sms: no 'from' configured (set OPENPHONE_FROM_NUMBER or pass 'from')." };
  if (!body) return { status: "failed", error: "send_sms: 'body' is required." };

  let res;
  try {
    res = await fetch(`${OPENPHONE_URL}/messages`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: body, from, to: [to] }),
    });
  } catch (err) {
    return { status: "failed", error: `send_sms: network error — ${err.message}` };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || json?.error || `OpenPhone HTTP ${res.status}`;
    return { status: "failed", error: `send_sms: ${msg}` };
  }
  return {
    status: "success",
    output: {
      to,
      from,
      preview: body.length > 80 ? `${body.slice(0, 77)}...` : body,
      openphone_id: json?.id ?? json?.data?.id ?? null,
    },
  };
}
