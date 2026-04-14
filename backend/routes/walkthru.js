import { randomUUID } from "crypto";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { promises as fs } from "fs";
import multer from "multer";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { getPool } from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALKTHRU_UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "walkthru");
const FILES_UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "files");
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS_PER_ITEM = 5;

const REPORT_STATUSES = new Set(["in_progress", "completed", "reviewed"]);
const ITEM_STATUSES = new Set(["pending", "no_issues", "has_issues", "not_applicable"]);

const MASTER_BEDROOM_ITEMS = [
  "Ceiling and Walls",
  "Paint and Wallpaper",
  "Doors and Door Stops",
  "Flooring",
  "Lights and Ceiling Fans",
  "Windows and Screens",
  "Window Latches",
  "Drapes Blinds and Shutters",
  "Plugs and Switches",
  "Closet Shelves and Rods",
  "Cabinets",
  "Smoke Alarm",
  "Other",
];

const MASTER_FULL_BATHROOM_ITEMS = [
  "Ceiling and Walls",
  "Paint and Wallpaper",
  "Doors and Door Stops",
  "Flooring",
  "Light Fixtures",
  "Windows and Screens",
  "Window Latches",
  "Drapes Blinds and Shutters",
  "Plugs and Switches",
  "Closet Shelves and Rods",
  "Cabinets and Handles",
  "Countertops",
  "Sinks and Faucets",
  "Tub Shower and Faucets",
  "Heaters and Exhaust Fans",
  "Towel Fixtures",
  "Toilet",
  "Other",
];

const DEFAULT_ROOM_TEMPLATES = [
  {
    roomName: "Living Room",
    items: [
      "Ceiling and Walls",
      "Paint and Wallpaper",
      "Doors and Door Stops",
      "Door Locks and Knobs",
      "Flooring",
      "Lights and Ceiling Fans",
      "Windows and Screens",
      "Window Latches",
      "Drapes Blinds and Shutters",
      "Plugs and Switches",
      "Cabinets",
      "Fireplace",
      "Other",
    ],
  },
  {
    roomName: "Kitchen Area",
    items: [
      "Ceiling and Walls",
      "Paint and Wallpaper",
      "Doors and Door Stops",
      "Door Locks and Knobs",
      "Flooring",
      "Lights and Ceiling Fans",
      "Windows and Screens",
      "Window Latches",
      "Drapes Blinds and Shutters",
      "Plugs and Switches",
      "Pantry and Shelves",
      "Cabinets and Handles",
      "Drawers and Handles",
      "Countertops",
      "Range and Cooktop",
      "Dishwasher",
      "Oven Racks and Knobs",
      "Oven Broiler and Pan",
      "Oven Light Cover and Bulb",
      "Vent Hood Light and Fan",
      "Vent Hood Filter",
      "Garbage Disposal",
      "Sink and Faucet",
      "Refrigerator",
      "Refrigerator Shelves and Drawers",
      "Refrigerator Light Cover and Bulb",
      "Stove",
      "Microwave",
      "Other",
    ],
  },
  {
    roomName: "Breakfast Area",
    items: [
      "Ceiling and Walls",
      "Paint and Wallpaper",
      "Flooring",
      "Lights and Ceiling Fans",
      "Windows and Screens",
      "Drapes Blinds and Shutters",
      "Plugs and Switches",
      "Other",
    ],
  },
  {
    roomName: "Garage",
    items: [
      "Ceiling and Walls",
      "Floor",
      "Auto Door Opener Safety Reversal",
      "Auto Door Opener Remotes",
      "Garage Doors",
      "Exterior Doors and Stops",
      "Storage Room",
      "Other",
    ],
  },
  {
    roomName: "Exterior",
    items: [
      "Mailbox",
      "Fences and Gates",
      "Pool Spa and Equipment",
      "Lawn Trees and Shrubs",
      "Underground Sprinkler",
      "Exterior Faucets",
      "Roofs and Gutters",
      "Driveway",
      "Front Door Door Knob and Lock",
      "Front Door Light and Bulb",
      "Front Door Bell",
      "Back Door Door Knob and Lock",
      "Back Door Light and Bulb",
      "Patio or Deck",
      "Patio Door Door Knob and Lock",
      "Patio Door Light and Bulb",
      "Water Shut-Off Valve",
      "Electrical Breakers",
      "Sprinkler System",
      "Other",
    ],
  },
  { roomName: "Master Bedroom", items: MASTER_BEDROOM_ITEMS },
  { roomName: "Bedroom 2", items: MASTER_BEDROOM_ITEMS },
  { roomName: "Bedroom 3", items: MASTER_BEDROOM_ITEMS },
  { roomName: "Master Full Bathroom", items: MASTER_FULL_BATHROOM_ITEMS },
  { roomName: "Full Bathroom 2", items: MASTER_FULL_BATHROOM_ITEMS },
  {
    roomName: "Hallways",
    items: [
      "Ceiling and Walls",
      "Paint and Wallpaper",
      "Doors and Door Stops",
      "Door Locks and Knobs",
      "Flooring",
      "Light Fixtures",
      "Plugs and Switches",
      "Closet Shelves and Rods",
      "Cabinets",
      "Smoke Alarm",
      "CO Detector",
      "Other",
    ],
  },
  {
    roomName: "Miscellaneous",
    items: ["Air Conditioner Heat Unit", "Water Shut Off", "Electric Panel", "Keys", "Garage Remotes"],
  },
];

const CUSTOM_ROOM_DEFAULT_ITEMS = [
  "Ceiling and Walls",
  "Flooring",
  "Lights",
  "Plugs and Switches",
  "Other",
];

function frontendOrigin() {
  return (process.env.FRONTEND_URL || "https://dashboard.prestigedash.com").replace(/\/$/, "");
}

function formsOrigin() {
  return (process.env.WALKTHRU_FORMS_URL || "https://forms.prestigedash.com").replace(/\/$/, "");
}

function reportAccessUrls(accessToken) {
  return {
    formUrl: `${formsOrigin()}/walkthru/${accessToken}`,
    dashboardUrl: `${frontendOrigin()}/walkthru/${accessToken}`,
  };
}

function normalizeStatus(status) {
  const v = String(status || "").trim().toLowerCase();
  return v || null;
}

function escapeLike(s) {
  return String(s).replace(/[%_]/g, "");
}

async function ensureReportUploadDir(reportId) {
  const dir = path.join(WALKTHRU_UPLOAD_ROOT, String(reportId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function mapItem(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    itemName: row.item_name,
    itemOrder: row.item_order,
    status: row.status,
    comment: row.comment || "",
    photoFilenames: Array.isArray(row.photo_filenames) ? row.photo_filenames : [],
    updatedAt: row.updated_at,
  };
}

function mapRoom(row) {
  return {
    id: row.id,
    reportId: row.report_id,
    roomName: row.room_name,
    roomOrder: row.room_order,
    isCustom: Boolean(row.is_custom),
    createdAt: row.created_at,
    items: [],
  };
}

function mapReport(row) {
  const token = row.access_token;
  return {
    id: row.id,
    reportType: row.report_type,
    status: row.status,
    propertyAddress: row.property_address,
    unitNumber: row.unit_number,
    residentName: row.resident_name,
    residentEmail: row.resident_email,
    residentPhone: row.resident_phone,
    leaseStartDate: row.lease_start_date,
    leaseEndDate: row.lease_end_date,
    reportDate: row.report_date,
    accessToken: token,
    ...reportAccessUrls(token),
    signatureData: row.signature_data,
    signedAt: row.signed_at,
    pdfFilename: row.pdf_filename,
    linkedFileId: row.linked_file_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

async function getReportWithRooms(pool, reportId) {
  const { rows: reportRows } = await pool.query(`SELECT * FROM walkthru_reports WHERE id = $1`, [reportId]);
  const reportRow = reportRows[0];
  if (!reportRow) return null;

  const { rows: roomRows } = await pool.query(
    `SELECT * FROM walkthru_rooms WHERE report_id = $1 ORDER BY room_order ASC, id ASC`,
    [reportId]
  );
  const roomMap = new Map();
  for (const room of roomRows) {
    roomMap.set(room.id, mapRoom(room));
  }

  const { rows: itemRows } = await pool.query(
    `SELECT i.*
     FROM walkthru_items i
     JOIN walkthru_rooms r ON r.id = i.room_id
     WHERE r.report_id = $1
     ORDER BY r.room_order ASC, i.item_order ASC, i.id ASC`,
    [reportId]
  );
  for (const item of itemRows) {
    const room = roomMap.get(item.room_id);
    if (room) room.items.push(mapItem(item));
  }

  return {
    report: mapReport(reportRow),
    rooms: Array.from(roomMap.values()),
  };
}

function validateReportType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "move_out") return "move_out";
  return "move_in";
}

async function seedReportTemplate(client, reportId) {
  let roomOrder = 1;
  for (const room of DEFAULT_ROOM_TEMPLATES) {
    const { rows } = await client.query(
      `INSERT INTO walkthru_rooms (report_id, room_name, room_order, is_custom)
       VALUES ($1, $2, $3, false)
       RETURNING id`,
      [reportId, room.roomName, roomOrder++]
    );
    const roomId = rows[0].id;
    let itemOrder = 1;
    for (const itemName of room.items) {
      await client.query(
        `INSERT INTO walkthru_items (room_id, item_name, item_order, status)
         VALUES ($1, $2, $3, 'pending')`,
        [roomId, itemName, itemOrder++]
      );
    }
  }
}

const uploadPhotoMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

function extractDataUrlBase64(dataUrl) {
  const s = String(dataUrl || "").trim();
  const match = s.match(/^data:image\/png;base64,([\s\S]+)$/i);
  if (match) return match[1];
  return null;
}

async function generatePdf(reportData) {
  const { report, rooms } = reportData;
  const outDir = await ensureReportUploadDir(report.id);
  const pdfPath = path.join(outDir, "report.pdf");

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 40 });
    const stream = createWriteStream(pdfPath);
    doc.pipe(stream);

    const navy = "#1B2856";
    const lightBlue = "#0098D0";
    const grey = "#6A737B";
    const offWhite = "#F5F5F5";

    doc.rect(0, 0, doc.page.width, 72).fill(navy);
    doc.fillColor("#FFFFFF").fontSize(20).text("Tenant Inventory & Condition Report", 40, 24);
    doc.fontSize(11).text("Walk-Thru Report", 40, 49);

    doc.fillColor("#111111");
    doc.fontSize(11);
    doc.text(`Property: ${report.propertyAddress}${report.unitNumber ? ` Unit ${report.unitNumber}` : ""}`, 40, 90);
    doc.text("Manager: Real Property Management Prestige", 40, 106);
    doc.text("Phone: 281-984-7463", 40, 122);

    doc.text(`Resident: ${report.residentName}`, 320, 90);
    doc.text(`Lease Start: ${report.leaseStartDate || "-"}`, 320, 106);
    doc.text(`Report Date: ${report.reportDate || "-"}`, 320, 122);
    doc.text(`Status: ${report.status.replace(/_/g, " ")}`, 320, 138);

    doc.moveTo(40, 160).lineTo(572, 160).lineWidth(1).strokeColor("#d9d9d9").stroke();
    let y = 174;

    doc.fillColor(lightBlue).fontSize(13).text("SUMMARY OF PHOTOS AND COMMENTS", 40, y);
    y += 24;

    const issues = [];
    for (const room of rooms) {
      for (const item of room.items) {
        if (item.status !== "has_issues") continue;
        if (!item.comment && (!item.photoFilenames || item.photoFilenames.length === 0)) continue;
        issues.push({ roomName: room.roomName, item });
      }
    }

    if (!issues.length) {
      doc.fillColor(grey).fontSize(10).text("No issues were documented in this walk-thru report.", 40, y);
      y += 20;
    } else {
      for (const issue of issues) {
        if (y > 700) {
          doc.addPage();
          y = 40;
        }
        doc.fillColor(navy).fontSize(10).text(`${issue.roomName} — ${issue.item.itemName}`, 40, y);
        y += 14;
        if (issue.item.comment) {
          doc.fillColor("#222222").fontSize(9).text(issue.item.comment, 48, y, { width: 520 });
          y = doc.y + 8;
        }
        const photos = Array.isArray(issue.item.photoFilenames) ? issue.item.photoFilenames : [];
        if (photos.length) {
          let x = 48;
          let rowHeight = 0;
          for (const filename of photos) {
            const photoPath = path.join(WALKTHRU_UPLOAD_ROOT, String(report.id), filename);
            if (!existsSync(photoPath)) continue;
            if (x > 480) {
              x = 48;
              y += rowHeight + 8;
              rowHeight = 0;
            }
            try {
              doc.image(photoPath, x, y, { fit: [96, 72], align: "center", valign: "center" });
              x += 104;
              rowHeight = Math.max(rowHeight, 72);
            } catch {
              // Skip unreadable images.
            }
          }
          y += rowHeight + 10;
        }
        doc.fillColor(grey).fontSize(8).text(`Date: ${new Date().toLocaleDateString()}`, 48, y);
        y += 18;
      }
    }

    if (y > 620) {
      doc.addPage();
      y = 40;
    }
    doc.fillColor(lightBlue).fontSize(13).text("ROOM DETAILS", 40, y);
    y += 20;

    for (const room of rooms) {
      if (y > 700) {
        doc.addPage();
        y = 40;
      }
      doc.fillColor(navy).fontSize(11).text(room.roomName, 40, y);
      y += 16;

      doc.fillColor("#FFFFFF").rect(40, y, 532, 18).fill(navy);
      doc.fillColor("#FFFFFF").fontSize(8);
      doc.text("Item Name", 46, y + 5, { width: 260 });
      doc.text("No Issues Observed", 314, y + 5, { width: 85, align: "center" });
      doc.text("Not Applicable", 406, y + 5, { width: 70, align: "center" });
      doc.text("Photo Taken", 487, y + 5, { width: 75, align: "center" });
      y += 18;

      for (const item of room.items) {
        if (y > 740) {
          doc.addPage();
          y = 40;
        }
        const striped = item.itemOrder % 2 === 0;
        doc.rect(40, y, 532, 16).fill(striped ? offWhite : "#FFFFFF");
        doc.fillColor("#1f2937").fontSize(8);
        doc.text(item.itemName, 46, y + 4, { width: 260, ellipsis: true });
        doc.text(item.status === "no_issues" ? "✓" : "✕", 342, y + 4, { width: 30, align: "center" });
        doc.text(item.status === "not_applicable" ? "✓" : "✕", 430, y + 4, { width: 30, align: "center" });
        doc.text(
          Array.isArray(item.photoFilenames) && item.photoFilenames.length > 0 ? "✓" : "✕",
          513,
          y + 4,
          { width: 30, align: "center" }
        );
        y += 16;
      }
      y += 10;
    }

    if (y > 660) {
      doc.addPage();
      y = 40;
    }
    doc.fillColor(lightBlue).fontSize(13).text("Resident Signature", 40, y);
    y += 16;

    if (report.signatureData) {
      const b64 = extractDataUrlBase64(report.signatureData);
      if (b64) {
        try {
          const buf = Buffer.from(b64, "base64");
          doc.rect(40, y, 350, 110).lineWidth(1).strokeColor("#c7c7c7").stroke();
          doc.image(buf, 46, y + 6, { fit: [338, 98], align: "center", valign: "center" });
          y += 118;
        } catch {
          doc.fillColor(grey).fontSize(9).text("Signature image could not be rendered.", 40, y);
          y += 20;
        }
      }
    } else {
      doc.fillColor(grey).fontSize(9).text("No signature provided.", 40, y);
      y += 20;
    }

    doc.fillColor(navy).fontSize(10).text("END OF REPORT", 40, y + 10, { align: "center", width: 532 });
    doc.end();

    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return pdfPath;
}

async function addPdfToPropertyFolder(pool, { reportId, propertyAddress, pdfPath, userId }) {
  const exact = await pool.query(
    `SELECT id
     FROM file_folders
     WHERE folder_type = 'property'
       AND (
         lower(name) = lower($1)
         OR lower(linked_property_name) = lower($1)
       )
     ORDER BY id ASC
     LIMIT 1`,
    [propertyAddress]
  );
  let folderId = exact.rows[0]?.id ?? null;

  if (!folderId) {
    const fuzzy = await pool.query(
      `SELECT id
       FROM file_folders
       WHERE folder_type = 'property'
         AND (
           name ILIKE $1
           OR linked_property_name ILIKE $1
         )
       ORDER BY id ASC
       LIMIT 1`,
      [`%${escapeLike(propertyAddress)}%`]
    );
    folderId = fuzzy.rows[0]?.id ?? null;
  }
  if (!folderId) return null;

  const storedFilename = `${randomUUID()}.pdf`;
  const originalFilename = `walkthru-report-${reportId}.pdf`;
  const destDir = path.join(FILES_UPLOAD_ROOT, String(folderId));
  const destPath = path.join(destDir, storedFilename);
  await fs.mkdir(destDir, { recursive: true });
  await fs.copyFile(pdfPath, destPath);
  const stat = await fs.stat(destPath);

  const { rows } = await pool.query(
    `INSERT INTO files (
       folder_id, original_filename, stored_filename, file_size_bytes, mime_type, file_type,
       description, tags, uploaded_by, visibility
     ) VALUES ($1, $2, $3, $4, 'application/pdf', 'pdf', $5, $6, $7, 'private')
     RETURNING id`,
    [
      folderId,
      originalFilename,
      storedFilename,
      stat.size,
      "Tenant move-in / move-out walk-thru report",
      ["walkthru", "inspection", "tenant"],
      Number.isFinite(Number(userId)) ? Number(userId) : null,
    ]
  );

  return rows[0]?.id ?? null;
}

async function createAndStorePdf(pool, reportId, overrideUserId = null) {
  const reportData = await getReportWithRooms(pool, reportId);
  if (!reportData) throw new Error("Report not found.");
  const pdfPath = await generatePdf(reportData);

  const linkedFileId = await addPdfToPropertyFolder(pool, {
    reportId,
    propertyAddress: reportData.report.propertyAddress,
    pdfPath,
    userId: overrideUserId ?? reportData.report.createdBy,
  });

  await pool.query(
    `UPDATE walkthru_reports
     SET pdf_filename = $1, linked_file_id = $2, updated_at = NOW()
     WHERE id = $3`,
    [path.basename(pdfPath), linkedFileId, reportId]
  );

  return { pdfPath, linkedFileId };
}

async function sendWalkthruLinkEmail({ to, residentName, url }) {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || "no-reply@prestigedash.com";
  if (!host || !user || !pass || !to) {
    return { sent: false, reason: "SMTP not configured." };
  }

  const transport = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: port === 465,
    auth: { user, pass },
  });
  const name = residentName || "Resident";
  await transport.sendMail({
    from,
    to,
    subject: "Your Tenant Walk-Thru Report Link",
    text: `Hi ${name},\n\nPlease complete your walk-thru report using this secure link:\n${url}\n\nReal Property Management Prestige`,
    html: `<p>Hi ${name},</p><p>Please complete your walk-thru report using this secure link:</p><p><a href="${url}">${url}</a></p><p>Real Property Management Prestige</p>`,
  });
  return { sent: true };
}

async function reportByToken(pool, token) {
  const { rows } = await pool.query(`SELECT * FROM walkthru_reports WHERE access_token = $1`, [token]);
  return rows[0] || null;
}

async function reportById(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM walkthru_reports WHERE id = $1`, [id]);
  return rows[0] || null;
}

function parseIntParam(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

export async function postWalkthruReport(req, res) {
  const reportType = validateReportType(req.body?.reportType);
  const propertyAddress = String(req.body?.propertyAddress || "").trim();
  const unitNumber = String(req.body?.unitNumber || "").trim();
  const residentName = String(req.body?.residentName || "").trim();
  const residentEmail = String(req.body?.residentEmail || "").trim();
  const residentPhone = String(req.body?.residentPhone || "").trim();
  const leaseStartDate = String(req.body?.leaseStartDate || "").trim();
  const leaseEndDate = String(req.body?.leaseEndDate || "").trim();

  if (!propertyAddress || !residentName) {
    res.status(400).json({ error: "propertyAddress and residentName are required." });
    return;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const token = randomUUID().replace(/-/g, "");
    const { rows } = await client.query(
      `INSERT INTO walkthru_reports (
         report_type, status, property_address, unit_number, resident_name, resident_email, resident_phone,
         lease_start_date, lease_end_date, access_token, created_by
       ) VALUES ($1, 'in_progress', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        reportType,
        propertyAddress,
        unitNumber || null,
        residentName,
        residentEmail || null,
        residentPhone || null,
        leaseStartDate || null,
        leaseEndDate || null,
        token,
        req.user?.id ?? null,
      ]
    );
    const report = rows[0];
    await seedReportTemplate(client, report.id);
    await client.query("COMMIT");

    const full = await getReportWithRooms(pool, report.id);
    res.status(201).json(full);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Could not create walk-thru report." });
  } finally {
    client.release();
  }
}

export async function getWalkthruReports(req, res) {
  const status = normalizeStatus(req.query.status);
  const reportType = normalizeStatus(req.query.reportType);
  const propertyAddress = String(req.query.propertyAddress || "").trim();
  const search = String(req.query.search || "").trim();

  if (status && !REPORT_STATUSES.has(status)) {
    res.status(400).json({ error: "Invalid status filter." });
    return;
  }
  if (reportType && !["move_in", "move_out"].includes(reportType)) {
    res.status(400).json({ error: "Invalid reportType filter." });
    return;
  }

  try {
    const pool = getPool();
    const conds = [];
    const params = [];
    let i = 1;
    if (status) {
      conds.push(`r.status = $${i++}`);
      params.push(status);
    }
    if (reportType) {
      conds.push(`r.report_type = $${i++}`);
      params.push(reportType);
    }
    if (propertyAddress) {
      conds.push(`r.property_address ILIKE $${i++}`);
      params.push(`%${escapeLike(propertyAddress)}%`);
    }
    if (search) {
      const p = `$${i++}`;
      conds.push(`(r.property_address ILIKE ${p} OR r.resident_name ILIKE ${p} OR COALESCE(r.resident_email, '') ILIKE ${p})`);
      params.push(`%${escapeLike(search)}%`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT
         r.*,
         COALESCE(items.total_items, 0)::int AS total_items,
         COALESCE(items.completed_items, 0)::int AS completed_items
       FROM walkthru_reports r
       LEFT JOIN (
         SELECT
           wr.report_id,
           COUNT(wi.id)::int AS total_items,
           COUNT(*) FILTER (WHERE wi.status <> 'pending')::int AS completed_items
         FROM walkthru_rooms wr
         JOIN walkthru_items wi ON wi.room_id = wr.id
         GROUP BY wr.report_id
       ) items ON items.report_id = r.id
       ${where}
       ORDER BY r.created_at DESC`,
      params
    );
    res.json({
      reports: rows.map((row) => ({
        ...mapReport(row),
        totalItems: Number(row.total_items || 0),
        completedItems: Number(row.completed_items || 0),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load walk-thru reports." });
  }
}

export async function getWalkthruReportById(req, res) {
  const reportId = parseIntParam(req.params.id);
  if (!reportId) {
    res.status(400).json({ error: "Invalid report id." });
    return;
  }
  try {
    const data = await getReportWithRooms(getPool(), reportId);
    if (!data) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load report." });
  }
}

export async function putWalkthruReportStatus(req, res) {
  const reportId = parseIntParam(req.params.id);
  const status = normalizeStatus(req.body?.status);
  if (!reportId || !status || !REPORT_STATUSES.has(status)) {
    res.status(400).json({ error: "Invalid report id or status." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE walkthru_reports
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, reportId]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    res.json({ report: mapReport(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update status." });
  }
}

export async function deleteWalkthruReport(req, res) {
  const reportId = parseIntParam(req.params.id);
  if (!reportId) {
    res.status(400).json({ error: "Invalid report id." });
    return;
  }
  try {
    const pool = getPool();
    const report = await reportById(pool, reportId);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    await pool.query(`DELETE FROM walkthru_reports WHERE id = $1`, [reportId]);
    await fs.rm(path.join(WALKTHRU_UPLOAD_ROOT, String(reportId)), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete report." });
  }
}

export async function postWalkthruSendLink(req, res) {
  const reportId = parseIntParam(req.params.id);
  if (!reportId) {
    res.status(400).json({ error: "Invalid report id." });
    return;
  }
  try {
    const pool = getPool();
    const report = await reportById(pool, reportId);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    const { formUrl, dashboardUrl } = reportAccessUrls(report.access_token);
    if (!report.resident_email) {
      res.json({ sent: false, reason: "No resident email on report.", formUrl, dashboardUrl });
      return;
    }
    try {
      const delivery = await sendWalkthruLinkEmail({
        to: report.resident_email,
        residentName: report.resident_name,
        url: formUrl,
      });
      if (!delivery.sent) {
        res.json({ sent: false, reason: delivery.reason, formUrl, dashboardUrl });
        return;
      }
      res.json({ sent: true, formUrl, dashboardUrl });
    } catch (err) {
      console.error(err);
      res.json({ sent: false, reason: "Email provider unavailable.", formUrl, dashboardUrl });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not send link." });
  }
}

export async function getWalkthruReportPdf(req, res) {
  const reportId = parseIntParam(req.params.id);
  if (!reportId) {
    res.status(400).json({ error: "Invalid report id." });
    return;
  }
  try {
    const pool = getPool();
    const report = await reportById(pool, reportId);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    const reportDir = await ensureReportUploadDir(reportId);
    const pdfPath = path.join(reportDir, "report.pdf");
    let exists = false;
    try {
      await fs.access(pdfPath);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      await createAndStorePdf(pool, reportId, req.user?.id ?? null);
    }
    const filename = `walkthru-report-${reportId}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Could not generate PDF." });
  }
}

export async function postWalkthruAdminRoom(req, res) {
  const reportId = parseIntParam(req.params.id);
  const roomName = String(req.body?.roomName || "").trim();
  if (!reportId || !roomName) {
    res.status(400).json({ error: "Invalid report id or roomName." });
    return;
  }
  try {
    const pool = getPool();
    const report = await reportById(pool, reportId);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    const { rows: maxRows } = await pool.query(
      `SELECT COALESCE(MAX(room_order), 0)::int AS max_order FROM walkthru_rooms WHERE report_id = $1`,
      [reportId]
    );
    const nextOrder = Number(maxRows[0]?.max_order || 0) + 1;
    const { rows: roomRows } = await pool.query(
      `INSERT INTO walkthru_rooms (report_id, room_name, room_order, is_custom)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [reportId, roomName.slice(0, 100), nextOrder]
    );
    const room = roomRows[0];
    let itemOrder = 1;
    for (const itemName of CUSTOM_ROOM_DEFAULT_ITEMS) {
      await pool.query(
        `INSERT INTO walkthru_items (room_id, item_name, item_order, status)
         VALUES ($1, $2, $3, 'pending')`,
        [room.id, itemName, itemOrder++]
      );
    }
    await pool.query(`UPDATE walkthru_reports SET updated_at = NOW() WHERE id = $1`, [reportId]);
    res.status(201).json({ room: mapRoom(room) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add room." });
  }
}

export async function deleteWalkthruAdminRoom(req, res) {
  const reportId = parseIntParam(req.params.id);
  const roomId = parseIntParam(req.params.roomId);
  if (!reportId || !roomId) {
    res.status(400).json({ error: "Invalid report id or room id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM walkthru_rooms WHERE id = $1 AND report_id = $2`,
      [roomId, reportId]
    );
    const room = rows[0];
    if (!room) {
      res.status(404).json({ error: "Room not found." });
      return;
    }
    if (!room.is_custom) {
      res.status(400).json({ error: "Only custom rooms can be removed." });
      return;
    }
    await pool.query(`DELETE FROM walkthru_rooms WHERE id = $1`, [roomId]);
    await pool.query(`UPDATE walkthru_reports SET updated_at = NOW() WHERE id = $1`, [reportId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove room." });
  }
}

export async function getWalkthruPublic(req, res) {
  const token = String(req.params.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "Invalid token." });
    return;
  }
  try {
    const pool = getPool();
    const report = await reportByToken(pool, token);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    const data = await getReportWithRooms(pool, report.id);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load report." });
  }
}

async function getTokenBoundItem(pool, token, itemId) {
  const { rows } = await pool.query(
    `SELECT
       i.*,
       r.report_id,
       wr.status AS report_status
     FROM walkthru_items i
     JOIN walkthru_rooms r ON r.id = i.room_id
     JOIN walkthru_reports wr ON wr.id = r.report_id
     WHERE i.id = $1 AND wr.access_token = $2`,
    [itemId, token]
  );
  return rows[0] || null;
}

export async function putWalkthruPublicItem(req, res) {
  const token = String(req.params.token || "").trim();
  const itemId = parseIntParam(req.params.itemId);
  const status = normalizeStatus(req.body?.status);
  const comment = req.body?.comment != null ? String(req.body.comment).trim() : null;
  if (!token || !itemId || !status || !ITEM_STATUSES.has(status)) {
    res.status(400).json({ error: "Invalid token, item id, or status." });
    return;
  }
  try {
    const pool = getPool();
    const item = await getTokenBoundItem(pool, token, itemId);
    if (!item) {
      res.status(404).json({ error: "Item not found." });
      return;
    }
    if (item.report_status !== "in_progress") {
      res.status(409).json({ error: "This report can no longer be edited." });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE walkthru_items
       SET status = $1, comment = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, comment || null, itemId]
    );
    await pool.query(`UPDATE walkthru_reports SET updated_at = NOW() WHERE id = $1`, [item.report_id]);
    res.json({ item: mapItem(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update item." });
  }
}

export const uploadWalkthruPhotoMiddleware = uploadPhotoMiddleware.single("photo");

export async function postWalkthruPublicItemPhoto(req, res) {
  const token = String(req.params.token || "").trim();
  const itemId = parseIntParam(req.params.itemId);
  if (!token || !itemId) {
    res.status(400).json({ error: "Invalid token or item id." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Upload field "photo" is required.' });
    return;
  }
  try {
    const pool = getPool();
    const item = await getTokenBoundItem(pool, token, itemId);
    if (!item) {
      res.status(404).json({ error: "Item not found." });
      return;
    }
    if (item.report_status !== "in_progress") {
      res.status(409).json({ error: "This report can no longer be edited." });
      return;
    }
    const existing = Array.isArray(item.photo_filenames) ? item.photo_filenames : [];
    if (existing.length >= MAX_PHOTOS_PER_ITEM) {
      res.status(400).json({ error: `Maximum ${MAX_PHOTOS_PER_ITEM} photos per item.` });
      return;
    }
    const reportDir = await ensureReportUploadDir(item.report_id);
    const filename = `${itemId}-${randomUUID()}.jpg`;
    const destPath = path.join(reportDir, filename);
    const compressed = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    await fs.writeFile(destPath, compressed);

    const nextPhotos = [...existing, filename];
    const { rows } = await pool.query(
      `UPDATE walkthru_items
       SET photo_filenames = $1, status = CASE WHEN status = 'pending' THEN 'has_issues' ELSE status END, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [nextPhotos, itemId]
    );
    await pool.query(`UPDATE walkthru_reports SET updated_at = NOW() WHERE id = $1`, [item.report_id]);
    res.status(201).json({ item: mapItem(rows[0]), photoUrl: `/uploads/walkthru/${item.report_id}/${filename}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not upload photo." });
  }
}

export async function deleteWalkthruPublicItemPhoto(req, res) {
  const token = String(req.params.token || "").trim();
  const itemId = parseIntParam(req.params.itemId);
  const photoIndex = parseIntParam(req.params.photoIndex);
  if (!token || !itemId || photoIndex == null) {
    res.status(400).json({ error: "Invalid token, item id, or photo index." });
    return;
  }
  try {
    const pool = getPool();
    const item = await getTokenBoundItem(pool, token, itemId);
    if (!item) {
      res.status(404).json({ error: "Item not found." });
      return;
    }
    if (item.report_status !== "in_progress") {
      res.status(409).json({ error: "This report can no longer be edited." });
      return;
    }
    const photos = Array.isArray(item.photo_filenames) ? [...item.photo_filenames] : [];
    if (photoIndex < 0 || photoIndex >= photos.length) {
      res.status(400).json({ error: "Invalid photo index." });
      return;
    }
    const [removed] = photos.splice(photoIndex, 1);
    await pool.query(
      `UPDATE walkthru_items
       SET photo_filenames = $1, updated_at = NOW()
       WHERE id = $2`,
      [photos, itemId]
    );
    const fp = path.join(WALKTHRU_UPLOAD_ROOT, String(item.report_id), removed);
    try {
      await fs.unlink(fp);
    } catch {
      // Ignore missing file.
    }
    await pool.query(`UPDATE walkthru_reports SET updated_at = NOW() WHERE id = $1`, [item.report_id]);
    res.json({ ok: true, photoFilenames: photos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove photo." });
  }
}

export async function postWalkthruPublicRoom(req, res) {
  const token = String(req.params.token || "").trim();
  const roomName = String(req.body?.roomName || "").trim();
  if (!token || !roomName) {
    res.status(400).json({ error: "Invalid token or room name." });
    return;
  }
  try {
    const pool = getPool();
    const report = await reportByToken(pool, token);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    if (report.status !== "in_progress") {
      res.status(409).json({ error: "This report can no longer be edited." });
      return;
    }

    const { rows: maxRows } = await pool.query(
      `SELECT COALESCE(MAX(room_order), 0)::int AS max_order FROM walkthru_rooms WHERE report_id = $1`,
      [report.id]
    );
    const { rows: roomRows } = await pool.query(
      `INSERT INTO walkthru_rooms (report_id, room_name, room_order, is_custom)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [report.id, roomName.slice(0, 100), Number(maxRows[0].max_order) + 1]
    );
    const room = roomRows[0];
    let order = 1;
    for (const itemName of CUSTOM_ROOM_DEFAULT_ITEMS) {
      await pool.query(
        `INSERT INTO walkthru_items (room_id, item_name, item_order, status)
         VALUES ($1, $2, $3, 'pending')`,
        [room.id, itemName, order++]
      );
    }
    await pool.query(`UPDATE walkthru_reports SET updated_at = NOW() WHERE id = $1`, [report.id]);
    res.status(201).json({ room: mapRoom(room) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add custom room." });
  }
}

export async function postWalkthruPublicComplete(req, res) {
  const token = String(req.params.token || "").trim();
  const signatureData = String(req.body?.signatureData || "").trim();
  if (!token || !signatureData) {
    res.status(400).json({ error: "token and signatureData are required." });
    return;
  }
  try {
    const pool = getPool();
    const report = await reportByToken(pool, token);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    if (report.status !== "in_progress") {
      res.status(409).json({ error: "This report has already been submitted." });
      return;
    }
    await pool.query(
      `UPDATE walkthru_reports
       SET status = 'completed',
           signature_data = $1,
           signed_at = NOW(),
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [signatureData, report.id]
    );
    await createAndStorePdf(pool, report.id, report.created_by ?? null);
    const data = await getReportWithRooms(pool, report.id);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not submit report." });
  }
}
