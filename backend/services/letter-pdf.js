/**
 * Letter PDF generation — wraps letter HTML in RPM Prestige letterhead and
 * renders to PDF via Puppeteer (headless Chromium). Also counts pages via pdf-lib.
 */

export function buildLetterHtml(bodyHtml, mailer) {
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const recipientBlock = [
    mailer.recipient_name,
    mailer.recipient_address,
    `${mailer.recipient_city || "Houston"}, ${mailer.recipient_state || "TX"} ${mailer.recipient_zip}`,
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
  .body h1, .body h2, .body h3 { color: #1B2856; margin-top: 16px; margin-bottom: 8px; font-family: Arial, sans-serif; }
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
  } catch (e) {
    // Fallback: scan for "/Type /Page" occurrences (rough)
    const text = pdfBuffer.toString("binary");
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 1;
  }
}
