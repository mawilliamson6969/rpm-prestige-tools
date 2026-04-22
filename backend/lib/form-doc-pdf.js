import PDFDocument from "pdfkit";
import { createWriteStream, statSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { replaceFormVariables } from "./form-automations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORMS_UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "forms");

const NAVY = "#1B2856";
const LIGHT_BLUE = "#0098D0";
const GREY = "#6A737B";
const BLACK = "#111111";

/**
 * Render a document template to PDF. The template is treated as mostly-plain-text
 * with {{variables}}, optional markdown-like lines:
 *   # Heading
 *   ## Sub-heading
 *   **bold**
 *   ---   (horizontal rule)
 *   [sig:signature_field_key]   (render a signature image)
 * Paragraphs are separated by blank lines.
 */
function slugifyForFilename(s) {
  return String(s || "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "document";
}

function processInlineBold(doc, line, x, y, maxWidth) {
  // Split on **bold** markers and render inline. We approximate width by
  // using heightOfString for multi-line wrap handling; here we just write line.
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  // We can't easily mix fonts in a single doc.text line while preserving wrap.
  // Fall back to stripping ** markers and rendering the line bold-aware only
  // if the whole line is wrapped in **.
  const stripped = line.replace(/\*\*/g, "");
  return stripped;
}

export async function renderDocumentTemplatePdf({ template, form, submission, fields, submissionData, user }) {
  const ctx = {
    formName: form.name,
    submissionId: submission.id,
    contactName: submission.contact_name,
    contactEmail: submission.contact_email,
    submissionData,
  };

  // Expose extra template variables
  const extras = {
    date: new Date().toLocaleDateString(),
    datetime: new Date().toLocaleString(),
    submission_date: new Date(submission.submitted_at).toLocaleString(),
    property_name: submission.property_name || "",
    property_id: submission.property_id || "",
    form_name: form.name,
  };

  const resolveLine = (raw) => {
    let out = replaceFormVariables(raw, ctx);
    // Extra placeholders our automation engine doesn't handle
    out = out.replace(/\{\{(date|datetime|submission_date|property_name|property_id|form_name)\}\}/g, (_m, k) => extras[k] ?? "");
    return out;
  };

  const raw = template.template_content || "";
  const lines = raw.split(/\r?\n/);

  const outDir = path.join(FORMS_UPLOAD_ROOT, String(form.id), "documents", String(submission.id));
  await fs.mkdir(outDir, { recursive: true });
  const datePart = new Date().toISOString().slice(0, 10);
  const fileName = `${slugifyForFilename(template.name)}_${slugifyForFilename(submission.contact_name || `sub${submission.id}`)}_${datePart}.pdf`;
  const filePath = path.join(outDir, fileName);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54, bufferPages: true });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);

    // Header band
    doc.rect(0, 0, doc.page.width, 56).fill(NAVY);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(14)
      .text("Real Property Management Prestige", 54, 20);

    doc.moveDown(1.2);
    doc.y = 80;
    doc.fillColor(BLACK).font("Helvetica").fontSize(11);

    const fieldsByKey = new Map((fields || []).map((f) => [f.field_key, f]));

    let paragraphBuf = [];

    const flushParagraph = () => {
      if (!paragraphBuf.length) return;
      const text = paragraphBuf.join(" ");
      doc.fillColor(BLACK).font("Helvetica").fontSize(11);
      doc.text(resolveLine(text), { width: doc.page.width - 108 });
      doc.moveDown(0.6);
      paragraphBuf = [];
    };

    for (const lineRaw of lines) {
      const line = lineRaw.trimEnd();
      if (!line.trim()) {
        flushParagraph();
        continue;
      }
      if (line.startsWith("# ")) {
        flushParagraph();
        doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(16)
          .text(resolveLine(line.slice(2)), { width: doc.page.width - 108 });
        doc.moveDown(0.35);
        continue;
      }
      if (line.startsWith("## ")) {
        flushParagraph();
        doc.fillColor(LIGHT_BLUE).font("Helvetica-Bold").fontSize(13)
          .text(resolveLine(line.slice(3)), { width: doc.page.width - 108 });
        doc.moveDown(0.3);
        continue;
      }
      if (line.trim() === "---") {
        flushParagraph();
        const y = doc.y;
        doc.moveTo(54, y).lineTo(doc.page.width - 54, y)
          .strokeColor("#e5e7eb").lineWidth(1).stroke();
        doc.moveDown(0.5);
        continue;
      }
      const sigMatch = line.trim().match(/^\[sig:([a-z0-9_]+)\]$/i);
      if (sigMatch) {
        flushParagraph();
        const key = sigMatch[1];
        const v = submissionData?.[key];
        if (typeof v === "string" && v.startsWith("data:image")) {
          try {
            const base64 = v.split(",")[1];
            const buf = Buffer.from(base64, "base64");
            doc.image(buf, 54, doc.y, { fit: [220, 80] });
            doc.y += 82;
          } catch {
            doc.fillColor(GREY).fontSize(10).text("[signature]", { width: 220 });
          }
        } else {
          doc.fillColor(GREY).fontSize(10).text("[no signature]");
        }
        doc.moveDown(0.4);
        continue;
      }
      // Treat as paragraph text; collapse wrapping runs.
      paragraphBuf.push(processInlineBold(doc, line));
    }
    flushParagraph();

    // Footer
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(GREY).font("Helvetica").text(
        "Real Property Management Prestige  •  281-984-7463  •  prestigerpm.com",
        54, doc.page.height - 30, { width: doc.page.width - 108, align: "center" }
      );
    }

    doc.end();
  });

  const size = statSync(filePath).size;
  return { filePath, fileName, size };
}
