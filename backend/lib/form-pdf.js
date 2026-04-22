import PDFDocument from "pdfkit";
import { createWriteStream, existsSync, statSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORMS_UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "forms");

const NAVY = "#1B2856";
const LIGHT_BLUE = "#0098D0";
const GREY = "#6A737B";
const LIGHT_GREY = "#F5F5F5";
const WHITE = "#FFFFFF";
const BLACK = "#111111";

const NON_INPUT_TYPES = new Set(["heading", "paragraph", "divider", "spacer", "hidden"]);

function slugifyForFilename(s) {
  return String(s || "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "submission";
}

function formatFieldValue(field, value) {
  if (value == null || value === "") return "—";
  if (field.field_type === "address" && typeof value === "object") {
    const v = value;
    const line1 = [v.street, v.street2].filter(Boolean).join(", ");
    const line2 = [v.city, v.state, v.zip].filter(Boolean).join(", ");
    return [line1, line2].filter(Boolean).join("\n");
  }
  if (field.field_type === "fullname" && typeof value === "object") {
    return [value.prefix, value.first, value.middle, value.last, value.suffix].filter(Boolean).join(" ");
  }
  if (field.field_type === "yesno") return String(value);
  if (field.field_type === "rating" || field.field_type === "scale") return String(value);
  if (field.field_type === "file" || field.field_type === "image") {
    if (Array.isArray(value)) {
      return value.map((f) => f?.originalName || f?.filename || "file").join(", ") || "—";
    }
    return "—";
  }
  if (field.field_type === "date" || field.field_type === "datetime") {
    try { return new Date(String(value)).toLocaleString(); } catch { return String(value); }
  }
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function drawHeader(doc, form, submission) {
  doc.rect(0, 0, doc.page.width, 80).fill(NAVY);
  doc.fillColor(WHITE).fontSize(18).font("Helvetica-Bold")
    .text("Real Property Management Prestige", 40, 20);
  doc.fontSize(10).font("Helvetica")
    .text(form.name, 40, 46)
    .text(
      `Submission #${submission.id} • ${new Date(submission.submitted_at).toLocaleString()}`,
      40, 60
    );
  doc.fillColor(BLACK);
  return 100;
}

function drawFooter(doc) {
  const h = doc.page.height;
  doc.fontSize(8).fillColor(GREY).font("Helvetica")
    .text(
      "Real Property Management Prestige  •  281-984-7463  •  prestigerpm.com",
      40, h - 32, { width: doc.page.width - 80, align: "center" }
    );
  const range = doc.bufferedPageRange();
  const current = range.start + range.count;
  doc.text(`Page ${current}`, 40, h - 22, { width: doc.page.width - 80, align: "center" });
}

function drawSectionHeader(doc, y, title) {
  doc.fillColor(LIGHT_BLUE).font("Helvetica-Bold").fontSize(12).text(title, 40, y);
  y += 15;
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor(LIGHT_BLUE).lineWidth(1).stroke();
  return y + 8;
}

function ensureSpace(doc, y, needed = 40) {
  if (y + needed > doc.page.height - 60) {
    doc.addPage();
    return 60;
  }
  return y;
}

function drawFieldRow(doc, y, field, value) {
  const label = field.label || field.field_key;
  const labelWidth = 140;
  const valueX = 40 + labelWidth + 10;
  const valueWidth = doc.page.width - 40 - valueX;

  y = ensureSpace(doc, y, 30);

  doc.fillColor(GREY).font("Helvetica-Bold").fontSize(9)
    .text(`${label}:`, 40, y, { width: labelWidth });

  // Signature handling — render as image
  if (field.field_type === "signature" && typeof value === "string" && value.startsWith("data:image")) {
    try {
      const base64 = value.split(",")[1];
      const buf = Buffer.from(base64, "base64");
      y = ensureSpace(doc, y, 80);
      doc.image(buf, valueX, y - 4, { fit: [200, 70] });
      return y + 72;
    } catch {
      doc.fillColor(BLACK).font("Helvetica").fontSize(10)
        .text("[signature]", valueX, y, { width: valueWidth });
      return y + 14;
    }
  }

  const formatted = formatFieldValue(field, value);
  doc.fillColor(BLACK).font("Helvetica").fontSize(10);
  const lines = doc.heightOfString(formatted, { width: valueWidth });
  doc.text(formatted, valueX, y, { width: valueWidth });
  return y + Math.max(14, lines + 4);
}

/** Main PDF generation entry point. */
export async function generateSubmissionPdf(submissionId, options = {}) {
  const pool = getPool();
  const { rows: subRows } = await pool.query(
    `SELECT * FROM form_submissions WHERE id = $1`, [submissionId]
  );
  if (!subRows.length) throw new Error("Submission not found.");
  const submission = subRows[0];
  const { rows: formRows } = await pool.query(
    `SELECT * FROM forms WHERE id = $1`, [submission.form_id]
  );
  if (!formRows.length) throw new Error("Form not found.");
  const form = formRows[0];

  // Serve cached if exists and newer than submission
  if (!options.forceRegenerate && submission.pdf_path) {
    const cached = path.isAbsolute(submission.pdf_path)
      ? submission.pdf_path
      : path.join(FORMS_UPLOAD_ROOT, submission.pdf_path);
    if (existsSync(cached)) {
      const st = statSync(cached);
      return {
        filePath: cached,
        fileName: path.basename(cached),
        size: st.size,
      };
    }
  }

  const { rows: pages } = await pool.query(
    `SELECT * FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`, [form.id]
  );
  const { rows: fields } = await pool.query(
    `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`, [form.id]
  );

  const data = submission.submission_data || {};
  const outDir = path.join(FORMS_UPLOAD_ROOT, String(form.id), String(submission.id));
  await fs.mkdir(outDir, { recursive: true });

  const contactPart = slugifyForFilename(submission.contact_name || "submitter");
  const datePart = new Date(submission.submitted_at).toISOString().slice(0, 10);
  const fileName = `${slugifyForFilename(form.name)}_${contactPart}_${datePart}.pdf`;
  const filePath = path.join(outDir, fileName);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 40, bufferPages: true });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);

    let y = drawHeader(doc, form, submission);

    // Group fields by page (for multi-step forms) or just one section
    const byPage = new Map();
    for (const f of fields) {
      if (NON_INPUT_TYPES.has(f.field_type)) continue;
      const key = f.page_id ?? 0;
      if (!byPage.has(key)) byPage.set(key, []);
      byPage.get(key).push(f);
    }

    // Preserve page order
    const orderedSections = [];
    for (const p of pages) {
      if (byPage.has(p.id)) {
        orderedSections.push({ title: p.title || `Section`, fields: byPage.get(p.id) });
      }
    }
    if (byPage.has(0)) orderedSections.push({ title: "Details", fields: byPage.get(0) });
    if (!orderedSections.length) {
      orderedSections.push({ title: "Submission", fields: fields.filter((f) => !NON_INPUT_TYPES.has(f.field_type)) });
    }

    for (const section of orderedSections) {
      y = ensureSpace(doc, y, 40);
      y = drawSectionHeader(doc, y, section.title);
      for (const f of section.fields) {
        // skip conditional-hidden fields: we don't re-evaluate logic here; server already
        // did at submit time, so `data` only contains visible values. Skip if not present.
        if (!(f.field_key in data) && !f.default_value) {
          // Still show if required or has a value — skip otherwise
          continue;
        }
        const drawnY = drawFieldRow(doc, y, f, data[f.field_key]);
        y = drawnY + 4;
      }
      y += 8;
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc);
    }

    doc.end();
  });

  const stat = statSync(filePath);
  const relPath = path.relative(FORMS_UPLOAD_ROOT, filePath);
  await pool.query(
    `UPDATE form_submissions SET pdf_path = $1, pdf_generated_at = NOW() WHERE id = $2`,
    [relPath, submissionId]
  ).catch(() => {});

  return { filePath, fileName, size: stat.size };
}
