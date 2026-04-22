import archiver from "archiver";
import ExcelJS from "exceljs";
import { getPool } from "./db.js";
import { generateSubmissionPdf } from "./form-pdf.js";

const NON_INPUT_TYPES = new Set(["heading", "paragraph", "divider", "spacer"]);

function formatCell(field, value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === "object") {
      return value.map((v) => v?.originalName || v?.filename || "file").join("; ");
    }
    return value.join("; ");
  }
  if (typeof value === "object") {
    if (field.field_type === "address") {
      const v = value;
      return [[v.street, v.street2].filter(Boolean).join(", "), v.city, v.state, v.zip]
        .filter(Boolean).join(", ");
    }
    if (field.field_type === "fullname") {
      return [value.prefix, value.first, value.middle, value.last, value.suffix]
        .filter(Boolean).join(" ");
    }
    return JSON.stringify(value);
  }
  if (field.field_type === "signature") {
    return typeof value === "string" && value.startsWith("data:image") ? "Signed" : "Not signed";
  }
  return String(value);
}

async function loadFormForExport(formId, filters = {}) {
  const pool = getPool();
  const { rows: formRows } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [formId]);
  if (!formRows.length) throw new Error("Form not found.");
  const form = formRows[0];

  const { rows: allFields } = await pool.query(
    `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`, [formId]
  );
  const fields = allFields.filter((f) => !NON_INPUT_TYPES.has(f.field_type) && f.field_type !== "hidden");

  const where = [`form_id = $1`];
  const vals = [formId];
  let n = 2;
  if (filters.status) { where.push(`status = $${n++}`); vals.push(filters.status); }
  if (filters.from) { where.push(`submitted_at >= $${n++}::date`); vals.push(filters.from); }
  if (filters.to) { where.push(`submitted_at <= ($${n++}::date + INTERVAL '1 day')`); vals.push(filters.to); }
  if (Array.isArray(filters.ids) && filters.ids.length) {
    where.push(`id = ANY($${n++}::int[])`);
    vals.push(filters.ids);
  }
  const { rows: submissions } = await pool.query(
    `SELECT * FROM form_submissions WHERE ${where.join(" AND ")} ORDER BY submitted_at DESC`,
    vals
  );
  return { form, fields, submissions };
}

export async function exportSubmissionsCsv(formId, filters = {}) {
  const { form, fields, submissions } = await loadFormForExport(formId, filters);
  const headers = ["Submission #", "Submitted", "Status", "Contact Name", "Contact Email"];
  for (const f of fields) headers.push(f.label);

  const esc = (s) => {
    if (s == null) return "";
    const t = String(s);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [headers.map(esc).join(",")];
  for (const s of submissions) {
    const row = [
      s.id,
      new Date(s.submitted_at).toISOString(),
      s.status,
      s.contact_name || "",
      s.contact_email || "",
    ];
    for (const f of fields) row.push(formatCell(f, (s.submission_data || {})[f.field_key]));
    lines.push(row.map(esc).join(","));
  }
  return {
    buffer: Buffer.from(lines.join("\n"), "utf8"),
    contentType: "text/csv; charset=utf-8",
    filename: `${form.name.replace(/[^\w]+/g, "_")}_submissions.csv`,
  };
}

export async function exportSubmissionsXlsx(formId, filters = {}) {
  const { form, fields, submissions } = await loadFormForExport(formId, filters);
  const wb = new ExcelJS.Workbook();
  wb.creator = "RPM Prestige";
  wb.created = new Date();
  const sheet = wb.addWorksheet(form.name.slice(0, 31));

  const columns = [
    { header: "Submission #", key: "id", width: 14 },
    { header: "Submitted", key: "submitted_at", width: 20 },
    { header: "Status", key: "status", width: 12 },
    { header: "Contact Name", key: "contact_name", width: 22 },
    { header: "Contact Email", key: "contact_email", width: 28 },
  ];
  for (const f of fields) {
    columns.push({ header: f.label, key: `f_${f.id}`, width: Math.min(40, Math.max(14, f.label.length + 4)) });
  }
  sheet.columns = columns;

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2856" } };
  header.alignment = { vertical: "middle" };
  header.height = 22;
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const s of submissions) {
    const row = {
      id: s.id,
      submitted_at: new Date(s.submitted_at),
      status: s.status,
      contact_name: s.contact_name,
      contact_email: s.contact_email,
    };
    for (const f of fields) row[`f_${f.id}`] = formatCell(f, (s.submission_data || {})[f.field_key]);
    sheet.addRow(row);
  }
  sheet.getColumn("submitted_at").numFmt = "yyyy-mm-dd hh:mm";

  const buf = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buf),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: `${form.name.replace(/[^\w]+/g, "_")}_submissions.xlsx`,
  };
}

/** Returns a readable ZIP stream of individual submission PDFs. */
export async function exportSubmissionsPdfZip(formId, filters = {}, res) {
  const { form, submissions } = await loadFormForExport(formId, filters);
  const zipName = `${form.name.replace(/[^\w]+/g, "_")}_PDFs_${new Date().toISOString().slice(0, 10)}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("[export zip]", err);
    try { res.end(); } catch {/* ignore */}
  });
  archive.pipe(res);
  for (const s of submissions) {
    try {
      const pdf = await generateSubmissionPdf(s.id);
      archive.file(pdf.filePath, { name: pdf.fileName });
    } catch (e) {
      console.error(`[export zip] failed submission ${s.id}:`, e?.message || e);
    }
  }
  await archive.finalize();
}
