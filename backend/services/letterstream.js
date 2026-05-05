/**
 * LetterStream integration service.
 * Handles PDF generation (Puppeteer/chromium) and LetterStream API calls.
 */
import { createRequire } from "module";
import { getPool } from "../lib/db.js";

const BASE_URL = process.env.LETTERSTREAM_BASE_URL || "https://api.letterstream.com";
const API_KEY = () => process.env.LETTERSTREAM_API_KEY || "";
const ACCOUNT_ID = () => process.env.LETTERSTREAM_ACCOUNT_ID || "";

// LetterStream mail_type → their API mail class codes
const MAIL_CLASS_MAP = {
  certified: "USPS_CERTIFIED",
  certified_return_receipt: "USPS_CERTIFIED_RR",
  first_class: "USPS_FIRST_CLASS",
  priority: "USPS_PRIORITY",
  postcard: "USPS_POSTCARD",
  marketing: "USPS_MARKETING",
};

// LetterStream status → our mail_status enum
const STATUS_MAP = {
  created: "queued",
  accepted: "queued",
  mailed: "sent",
  "in-transit": "in_transit",
  "in-local-area": "out_for_delivery",
  delivered: "delivered",
  "delivery-attempted": "attempted",
  returned: "returned",
  error: "failed",
};

function authHeaders() {
  const key = `${ACCOUNT_ID()}:${API_KEY()}`;
  return {
    Authorization: `Basic ${Buffer.from(key).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

/**
 * Generate PDF buffer from letter HTML, wrapped in RPM Prestige letterhead.
 * Requires puppeteer-core + chromium on the system ($CHROMIUM_PATH).
 */
export async function wrapLetterForMail(html, mailer) {
  const fullHtml = buildLetterHtml(html, mailer);

  let browser;
  try {
    // Dynamic import so startup doesn't fail when puppeteer isn't installed
    const { default: puppeteer } = await import("puppeteer-core");
    const chromiumPath =
      process.env.CHROMIUM_PATH ||
      "/usr/bin/chromium-browser" ||
      "/usr/bin/chromium";
    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      headless: "new",
    });
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      margin: { top: "0.5in", right: "0.75in", bottom: "0.75in", left: "0.75in" },
      printBackground: true,
    });
    return pdfBuffer;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function buildLetterHtml(bodyHtml, mailer) {
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const recipientBlock = [
    mailer.recipient_name,
    mailer.recipient_address,
    `${mailer.recipient_city}, ${mailer.recipient_state} ${mailer.recipient_zip}`,
  ]
    .filter(Boolean)
    .join("<br>");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #222; background: #fff; }
  .letterhead { border-bottom: 3px solid #1B2856; padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
  .lh-brand { font-size: 17pt; font-weight: bold; color: #1B2856; letter-spacing: -0.5px; }
  .lh-address { font-size: 9pt; color: #6A737B; margin-top: 4px; line-height: 1.4; }
  .lh-date { font-size: 10pt; color: #6A737B; text-align: right; white-space: nowrap; }
  .recipient { margin-bottom: 24px; font-size: 11pt; line-height: 1.6; }
  .body { line-height: 1.6; }
  .body h1, .body h2, .body h3 { color: #1B2856; margin-top: 16px; margin-bottom: 8px; }
  .body p { margin-bottom: 10px; }
  .body ul, .body ol { padding-left: 20px; margin-bottom: 10px; }
  .body li { margin-bottom: 4px; }
  .body blockquote { border-left: 3px solid #0098D0; padding-left: 12px; color: #555; margin: 12px 0; }
  .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 9pt; color: #6A737B; text-align: center; }
</style>
</head>
<body>
<div class="letterhead">
  <div>
    <div class="lh-brand">Real Property Management Prestige</div>
    <div class="lh-address">
      ${mailer.sender_address || "4811 Hwy 6 N, Suite B"}<br>
      ${mailer.sender_city || "Houston"}, ${mailer.sender_state || "TX"} ${mailer.sender_zip || "77084"}
    </div>
  </div>
  <div class="lh-date">${date}</div>
</div>
<div class="recipient">${recipientBlock}</div>
<div class="body">${bodyHtml}</div>
<div class="footer">Real Property Management Prestige &nbsp;|&nbsp; Houston, TX &nbsp;|&nbsp; (281) 984-7463</div>
</body>
</html>`;
}

/**
 * Send a mailer via LetterStream API.
 * Updates the mailers row and inserts a mailer_events record on success.
 */
export async function sendLetter(mailer) {
  const key = API_KEY();
  if (!key) throw new Error("LETTERSTREAM_API_KEY is not configured.");

  // 1. Generate PDF
  const pdfBuffer = await wrapLetterForMail(mailer.letter_html, mailer);
  const pdfBase64 = pdfBuffer.toString("base64");

  // 2. POST to LetterStream
  const mailClass = MAIL_CLASS_MAP[mailer.mail_type] || "USPS_CERTIFIED";
  const payload = {
    mail_class: mailClass,
    electronic_return_receipt: mailer.mail_type === "certified_return_receipt",
    recipient: {
      name: mailer.recipient_name,
      address1: mailer.recipient_address,
      city: mailer.recipient_city,
      state: mailer.recipient_state,
      zip: mailer.recipient_zip,
    },
    sender: {
      name: mailer.sender_name || "Real Property Management Prestige",
      address1: mailer.sender_address || "4811 Hwy 6 N, Suite B",
      city: mailer.sender_city || "Houston",
      state: mailer.sender_state || "TX",
      zip: mailer.sender_zip || "77084",
    },
    file: pdfBase64,
    file_type: "pdf",
    description: mailer.letter_title,
  };

  const resp = await fetch(`${BASE_URL}/v1/letters`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LetterStream API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const jobId = data.id || data.job_id || data.letter_id;
  const trackingNum = data.tracking_number || data.usps_tracking_number || null;
  const expectedDelivery = data.expected_delivery_date || null;
  const costCents = data.price_cents || data.cost_cents || null;

  // 3. Update mailers row
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE mailers SET
       status = 'sent',
       provider_job_id = $1,
       provider_tracking_number = $2,
       provider_expected_delivery = $3,
       cost_cents = $4,
       sent_at = NOW(),
       last_status_check = NOW()
     WHERE id = $5
     RETURNING *`,
    [jobId, trackingNum, expectedDelivery, costCents, mailer.id]
  );

  // 4. Insert event
  await pool.query(
    `INSERT INTO mailer_events (mailer_id, event_type, event_detail, raw_payload, created_by)
     VALUES ($1, 'sent', 'Letter submitted to LetterStream', $2, 'system')`,
    [mailer.id, JSON.stringify(data)]
  );

  return rows[0];
}

/**
 * Poll LetterStream for the current status of a mailer.
 * Called by cron — updates mailers table and inserts event if status changed.
 */
export async function pollTrackingStatus(mailer) {
  const key = API_KEY();
  if (!key || !mailer.provider_job_id) return null;

  const resp = await fetch(`${BASE_URL}/v1/letters/${mailer.provider_job_id}`, {
    headers: authHeaders(),
  });

  if (!resp.ok) {
    console.warn(`[letterstream] poll ${mailer.id} → HTTP ${resp.status}`);
    return null;
  }

  const data = await resp.json();
  const rawStatus = (data.status || "").toLowerCase().replace(/_/g, "-");
  const newStatus = STATUS_MAP[rawStatus] || null;
  const trackingNum = data.tracking_number || data.usps_tracking_number || mailer.provider_tracking_number;
  const expectedDelivery = data.expected_delivery_date || mailer.provider_expected_delivery;

  const pool = getPool();
  const statusChanged = newStatus && newStatus !== mailer.status;

  const { rows } = await pool.query(
    `UPDATE mailers SET
       last_status_check = NOW(),
       provider_tracking_number = COALESCE($1, provider_tracking_number),
       provider_expected_delivery = COALESCE($2::date, provider_expected_delivery)
       ${statusChanged ? `, status = $3::mail_status` : ""}
       ${newStatus === "delivered" ? ", delivered_at = NOW()" : ""}
     WHERE id = $${statusChanged ? 4 : 3}
     RETURNING *`,
    statusChanged
      ? [trackingNum, expectedDelivery, newStatus, mailer.id]
      : [trackingNum, expectedDelivery, mailer.id]
  );

  if (statusChanged) {
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, raw_payload, created_by)
       VALUES ($1, $2, $3, $4, 'system')`,
      [mailer.id, newStatus, `Status updated: ${mailer.status} → ${newStatus}`, JSON.stringify(data)]
    );
  }

  return rows[0] || null;
}

/**
 * Poll all mailers that need a status check (called by cron every 4 hours).
 */
export async function pollAllPendingMailers() {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT * FROM mailers
    WHERE status IN ('sent', 'in_transit', 'out_for_delivery')
      AND (last_status_check IS NULL OR last_status_check < NOW() - INTERVAL '4 hours')
    ORDER BY sent_at ASC
    LIMIT 100
  `);

  let updated = 0;
  for (const mailer of rows) {
    try {
      await pollTrackingStatus(mailer);
      await pool.query(`UPDATE mailers SET last_status_check = NOW() WHERE id = $1`, [mailer.id]);
      updated++;
    } catch (e) {
      console.error(`[letterstream] poll error mailer ${mailer.id}:`, e.message);
    }
  }
  console.log(`[letterstream] polled ${rows.length} mailers, updated ${updated}`);
}
