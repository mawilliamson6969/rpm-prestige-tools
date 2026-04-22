const OPENPHONE_URL = "https://api.openphone.com/v1";

export function isOpenPhoneConfigured() {
  return Boolean(process.env.OPENPHONE_API_KEY?.trim() && process.env.OPENPHONE_FROM_NUMBER?.trim());
}

export function formatE164(phone) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

export async function sendSMS(to, content) {
  const apiKey = process.env.OPENPHONE_API_KEY?.trim();
  const from = process.env.OPENPHONE_FROM_NUMBER?.trim();
  if (!apiKey || !from) {
    const err = new Error("OpenPhone is not configured.");
    err.code = "OPENPHONE_NOT_CONFIGURED";
    throw err;
  }
  const toE164 = formatE164(to);
  if (!toE164) {
    const err = new Error("Invalid phone number.");
    err.code = "OPENPHONE_BAD_NUMBER";
    throw err;
  }
  const res = await fetch(`${OPENPHONE_URL}/messages`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      from,
      to: [toE164],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || json?.error || `OpenPhone error ${res.status}`;
    const err = new Error(msg);
    err.code = "OPENPHONE_HTTP";
    err.status = res.status;
    throw err;
  }
  return json;
}
