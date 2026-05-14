/**
 * Letter PDF generation — wraps letter HTML in a customizable letterhead and
 * renders to PDF via Puppeteer (headless Chromium). Also counts pages via pdf-lib.
 *
 * Letterhead is controlled by mailer.letterhead_* columns:
 *   logo_url, primary_color, show_letterhead, show_footer, footer_text.
 * Falls back to the RPM Prestige defaults when not set.
 */

function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildLetterHtml(bodyHtml, mailer) {
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const showLetterhead = mailer.letterhead_show_letterhead !== false;
  const showFooter = mailer.letterhead_show_footer !== false;
  const primaryColor = mailer.letterhead_primary_color || "#1B2856";
  const logoUrl = mailer.letterhead_logo_url || null;

  const senderName = mailer.sender_name || "Real Property Management Prestige";
  const senderAddr = mailer.sender_address || "4811 Hwy 6 N, Suite B";
  const senderCity = mailer.sender_city || "Houston";
  const senderState = mailer.sender_state || "TX";
  const senderZip = mailer.sender_zip || "77084";

  const defaultFooter = `${senderName}  |  ${senderCity}, ${senderState}  |  (281) 984-7463`;
  const footerText = mailer.letterhead_footer_text || defaultFooter;

  const recipientBlock = [
    escapeHtml(mailer.recipient_name),
    escapeHtml(mailer.recipient_address),
    `${escapeHtml(mailer.recipient_city || "Houston")}, ${escapeHtml(mailer.recipient_state || "TX")} ${escapeHtml(mailer.recipient_zip || "")}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const letterheadBlock = showLetterhead
    ? `
    <div class="letterhead">
      <div class="lh-brand-block">
        ${logoUrl ? `<img class="lh-logo" src="${escapeHtml(logoUrl)}" alt="" />` : ""}
        <div>
          <div class="lh-brand">${escapeHtml(senderName)}</div>
          <div class="lh-address">${escapeHtml(senderAddr)}<br>${escapeHtml(senderCity)}, ${escapeHtml(senderState)} ${escapeHtml(senderZip)}</div>
        </div>
      </div>
      <div class="lh-date">${escapeHtml(date)}</div>
    </div>`
    : "";

  const footerBlock = showFooter
    ? `<div class="footer">${escapeHtml(footerText)}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #222; background: #fff; }
  .letterhead { border-bottom: 3px solid ${primaryColor}; padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .lh-brand-block { display: flex; align-items: flex-start; gap: 12px; }
  .lh-logo { max-height: 60px; max-width: 160px; object-fit: contain; }
  .lh-brand { font-size: 17pt; font-weight: bold; color: ${primaryColor}; letter-spacing: -0.5px; }
  .lh-address { font-size: 9pt; color: #6A737B; margin-top: 4px; line-height: 1.4; }
  .lh-date { font-size: 10pt; color: #6A737B; text-align: right; white-space: nowrap; }
  .recipient { margin-bottom: 24px; font-size: 11pt; line-height: 1.6; }
  .body { line-height: 1.6; }
  .body h1, .body h2, .body h3 { color: ${primaryColor}; margin-top: 16px; margin-bottom: 8px; font-family: Arial, sans-serif; }
  .body p { margin-bottom: 10px; }
  .body ul, .body ol { padding-left: 20px; margin-bottom: 10px; }
  .body li { margin-bottom: 4px; }
  .body blockquote { border-left: 3px solid #0098D0; padding-left: 12px; color: #555; margin: 12px 0; }
  .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 9pt; color: #6A737B; text-align: center; }
</style>
</head>
<body>
${letterheadBlock}
<div class="recipient">${recipientBlock}</div>
<div class="body">${bodyHtml}</div>
${footerBlock}
</body>
</html>`;
}

export async function renderLetterPdf(html, mailer) {
  const fullHtml = buildLetterHtml(html, mailer);
  let browser;
  try {
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

export async function countPdfPages(pdfBuffer) {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch (_e) {
    // Fallback: scan for "/Type /Page" occurrences (rough)
    const text = pdfBuffer.toString("binary");
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 1;
  }
}
