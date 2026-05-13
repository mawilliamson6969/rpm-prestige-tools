import fs from "fs";
import { getPool } from "../lib/db.js";
import {
  submitMailer,
  confirmPreauth,
  getTracking,
  getSignatureFile,
  getAccountBalance,
  codeToStatus,
  uspsScanCodeToStatus,
} from "../services/letterstream.js";
import { renderLetterPdf, countPdfPages } from "../services/letter-pdf.js";

function rowToMailer(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    letterTitle: row.letter_title,
    letterHtml: row.letter_html,
    mailType: row.mail_type,
    recipientName: row.recipient_name,
    recipientAddress: row.recipient_address,
    recipientCity: row.recipient_city,
    recipientState: row.recipient_state,
    recipientZip: row.recipient_zip,
    propertyAddress: row.property_address,
    ownerName: row.owner_name,
    tenantName: row.tenant_name,
    letterCategory: row.letter_category,
    notes: row.notes,
    senderName: row.sender_name,
    senderAddress: row.sender_address,
    senderCity: row.sender_city,
    senderState: row.sender_state,
    senderZip: row.sender_zip,
    provider: row.provider,
    providerJobId: row.provider_job_id,
    providerDocId: row.provider_doc_id,
    providerTrackingNumber: row.provider_tracking_number,
    providerExpectedDelivery: row.provider_expected_delivery,
    providerAuthcode: row.provider_authcode,
    providerBatchId: row.provider_batch_id,
    quotedCostCents: row.quoted_cost_cents,
    quotedAt: row.quoted_at,
    pageCount: row.page_count,
    costCents: row.cost_cents,
    currentScanStatus: row.current_scan_status,
    currentScanCode: row.current_scan_code,
    lastScannedAt: row.last_scanned_at,
    lastScanFacility: row.last_scan_facility,
    lastScanZip: row.last_scan_zip,
    testMode: !!row.test_mode,
    includeReturnEnvelope: !!row.include_return_envelope,
    signatureFilePath: row.signature_file_path,
    triggeredBy: row.triggered_by,
    triggeredFrom: row.triggered_from,
    sentBy: row.sent_by,
    status: row.status,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    lastStatusCheck: row.last_status_check,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asUser(req) {
  return req.user?.displayName || req.user?.username || "System";
}

/* ============================ CRUD ============================ */

export async function getMailers(req, res) {
  try {
    const pool = getPool();
    const {
      status, mail_type, letter_category, property_address,
      owner_name, tenant_name, from, to, search,
      page = "1", limit = "50",
    } = req.query;

    const where = [];
    const params = [];

    if (status) { params.push(status); where.push(`m.status = $${params.length}::mail_status`); }
    if (mail_type) { params.push(mail_type); where.push(`m.mail_type = $${params.length}::mail_type`); }
    if (letter_category) { params.push(letter_category); where.push(`m.letter_category = $${params.length}`); }
    if (property_address) { params.push(`%${property_address}%`); where.push(`m.property_address ILIKE $${params.length}`); }
    if (owner_name) { params.push(`%${owner_name}%`); where.push(`m.owner_name ILIKE $${params.length}`); }
    if (tenant_name) { params.push(`%${tenant_name}%`); where.push(`m.tenant_name ILIKE $${params.length}`); }
    if (from) { params.push(from); where.push(`m.created_at >= $${params.length}`); }
    if (to) { params.push(to); where.push(`m.created_at <= $${params.length}`); }
    if (search) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      where.push(
        `(m.letter_title ILIKE $${idx} OR m.recipient_name ILIKE $${idx} OR ` +
        `m.property_address ILIKE $${idx} OR m.owner_name ILIKE $${idx} OR m.tenant_name ILIKE $${idx})`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    params.push(limitNum);
    params.push(offset);

    const sql = `
      SELECT m.* FROM mailers m
      ${whereSql}
      ORDER BY m.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const countSql = `SELECT COUNT(*) FROM mailers m ${whereSql}`;
    const countParams = params.slice(0, -2);

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(sql, params),
      pool.query(countSql, countParams),
    ]);

    res.json({
      mailers: rows.map(rowToMailer),
      total: parseInt(countRows[0].count, 10),
      page: pageNum,
      limit: limitNum,
    });
  } catch (e) {
    console.error("[mailers] list", e);
    res.status(500).json({ error: "Could not load mailers." });
  }
}

export async function getMailerById(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const [{ rows }, { rows: events }] = await Promise.all([
      pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]),
      pool.query(`SELECT * FROM mailer_events WHERE mailer_id = $1 ORDER BY event_time ASC`, [id]),
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ mailer: rowToMailer(rows[0]), events });
  } catch (e) {
    console.error("[mailers] get", e);
    res.status(500).json({ error: "Could not load mailer." });
  }
}

export async function postMailer(req, res) {
  try {
    const pool = getPool();
    const b = req.body ?? {};
    const user = asUser(req);

    const required = ["letter_title", "letter_html", "recipient_name", "recipient_address", "recipient_zip"];
    for (const f of required) {
      if (!b[f] || !String(b[f]).trim()) return res.status(400).json({ error: `${f} is required.` });
    }

    const { rows } = await pool.query(
      `INSERT INTO mailers (
        document_id, letter_title, letter_html, mail_type,
        recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
        property_address, owner_name, tenant_name, letter_category, notes,
        sender_name, sender_address, sender_city, sender_state, sender_zip,
        triggered_by, triggered_from, sent_by, include_return_envelope, status
      ) VALUES (
        $1, $2, $3, $4::mail_type,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23, 'draft'
      ) RETURNING *`,
      [
        b.document_id || null,
        b.letter_title.trim(),
        b.letter_html,
        b.mail_type || "certified",
        b.recipient_name.trim(),
        b.recipient_address.trim(),
        b.recipient_city?.trim() || "Houston",
        b.recipient_state?.trim() || "TX",
        b.recipient_zip.trim(),
        b.property_address?.trim() || null,
        b.owner_name?.trim() || null,
        b.tenant_name?.trim() || null,
        b.letter_category?.trim() || null,
        b.notes?.trim() || null,
        b.sender_name?.trim() || "Real Property Management Prestige",
        b.sender_address?.trim() || "4811 Hwy 6 N, Suite B",
        b.sender_city?.trim() || "Houston",
        b.sender_state?.trim() || "TX",
        b.sender_zip?.trim() || "77084",
        b.triggered_by || "manual",
        b.triggered_from || null,
        user,
        !!b.include_return_envelope,
      ]
    );

    const mailer = rows[0];
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'created', 'Mailer draft created', $2)`,
      [mailer.id, user]
    );

    res.status(201).json({ mailer: rowToMailer(mailer) });
  } catch (e) {
    console.error("[mailers] create", e);
    res.status(500).json({ error: "Could not create mailer." });
  }
}

export async function putMailer(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const { rows: existing } = await pool.query(`SELECT status FROM mailers WHERE id = $1`, [id]);
    if (!existing.length) return res.status(404).json({ error: "Not found." });
    if (existing[0].status !== "draft") {
      return res.status(409).json({ error: "Only draft mailers can be edited." });
    }

    const b = req.body ?? {};
    const sets = [];
    const params = [];
    const fields = [
      ["letter_title", "text"], ["letter_html", "text"], ["mail_type", "mail_type"],
      ["recipient_name", "text"], ["recipient_address", "text"], ["recipient_city", "text"],
      ["recipient_state", "text"], ["recipient_zip", "text"], ["property_address", "text"],
      ["owner_name", "text"], ["tenant_name", "text"], ["letter_category", "text"],
      ["notes", "text"], ["sender_name", "text"], ["sender_address", "text"],
      ["sender_city", "text"], ["sender_state", "text"], ["sender_zip", "text"],
      ["include_return_envelope", "bool"],
    ];

    for (const [col, cast] of fields) {
      if (b[col] !== undefined) {
        params.push(b[col]);
        sets.push(`${col} = $${params.length}${cast !== "text" ? `::${cast}` : ""}`);
      }
    }

    if (!sets.length) return res.status(400).json({ error: "No updatable fields supplied." });
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE mailers SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ mailer: rowToMailer(rows[0]) });
  } catch (e) {
    console.error("[mailers] update", e);
    res.status(500).json({ error: "Could not update mailer." });
  }
}

export async function deleteMailer(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT status FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    if (rows[0].status !== "draft") {
      return res.status(409).json({ error: "Only draft mailers can be deleted." });
    }
    await pool.query(`DELETE FROM mailers WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[mailers] delete", e);
    res.status(500).json({ error: "Could not delete mailer." });
  }
}

/* ====================== quote → confirm send flow ====================== */

/**
 * POST /api/mailers/:id/quote
 * Generates the PDF, submits to LetterStream as a preauth (price quote).
 * Stores authcode + quoted cost on the mailer, returns them to the frontend.
 */
export async function postMailerQuote(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });

  const pool = getPool();
  let mailer;
  try {
    const { rows } = await pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    mailer = rows[0];
    if (!["draft", "preauth_pending"].includes(mailer.status)) {
      return res.status(409).json({ error: `Cannot quote a mailer with status '${mailer.status}'.` });
    }
  } catch (e) {
    console.error("[mailers] quote lookup", e);
    return res.status(500).json({ error: "Could not load mailer." });
  }

  try {
    const pdfBuffer = await renderLetterPdf(mailer.letter_html, mailer);
    const pageCount = await countPdfPages(pdfBuffer);

    const result = await submitMailer(mailer, { pdfBuffer, pageCount, preauth: true });

    if (!result.success) {
      await pool.query(
        `INSERT INTO mailer_events (mailer_id, event_type, event_detail, raw_payload, created_by)
         VALUES ($1, 'quote_failed', $2, $3, 'system')`,
        [id, result.message || `LetterStream code ${result.code}`, JSON.stringify(result.data || {})]
      );
      return res.status(502).json({ error: result.message || "Quote failed.", code: result.code });
    }

    const data = result.data || {};
    const authcode = data.authcode || null;
    const batchId = data.batch || null;
    const docArr = Array.isArray(data.doc) ? data.doc : [];
    const docEntry = docArr[0] || {};
    const docId = docEntry.id || docEntry.doc_id || null;
    const jobId = docEntry.job || data.job || null;
    const costDollars = parseFloat(String(data.cost ?? docEntry.cost ?? "0")) || 0;
    const costCents = Math.round(costDollars * 100);

    const { rows: updated } = await pool.query(
      `UPDATE mailers SET
         status = 'preauth_pending',
         provider_authcode = $1,
         provider_batch_id = $2,
         provider_doc_id = $3,
         provider_job_id = $4,
         quoted_cost_cents = $5,
         quoted_at = NOW(),
         page_count = $6,
         test_mode = $7
       WHERE id = $8
       RETURNING *`,
      [authcode, batchId, docId, jobId, costCents, pageCount, result.code === "-105", id]
    );

    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, raw_payload, created_by)
       VALUES ($1, 'quoted', $2, $3, $4)`,
      [
        id,
        `Quoted at $${(costCents / 100).toFixed(2)} (${pageCount} page${pageCount === 1 ? "" : "s"})`,
        JSON.stringify(data),
        asUser(req),
      ]
    );

    res.json({
      mailer: rowToMailer(updated[0]),
      quote: {
        authcode,
        costCents,
        costDollars: costCents / 100,
        pageCount,
        testMode: result.code === "-105",
        code: result.code,
      },
    });
  } catch (e) {
    console.error("[mailers] quote", e);
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'quote_failed', $2, 'system')`,
      [id, e.message || "Quote failed"]
    ).catch(() => {});
    res.status(502).json({ error: e.message || "Failed to quote mailer." });
  }
}

/**
 * POST /api/mailers/:id/confirm-send
 * Submits the stored authcode to LetterStream to release the job into production.
 */
export async function postMailerConfirmSend(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });

  const pool = getPool();
  try {
    const { rows } = await pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    const mailer = rows[0];
    if (mailer.status !== "preauth_pending") {
      return res.status(409).json({ error: `Mailer is '${mailer.status}', expected 'preauth_pending'.` });
    }
    if (!mailer.provider_authcode) {
      return res.status(409).json({ error: "No authcode on file. Re-quote required." });
    }

    const result = await confirmPreauth(mailer.provider_authcode);
    if (!result.success) {
      await pool.query(
        `INSERT INTO mailer_events (mailer_id, event_type, event_detail, raw_payload, created_by)
         VALUES ($1, 'send_failed', $2, $3, 'system')`,
        [id, result.message || `LetterStream code ${result.code}`, JSON.stringify(result.data || {})]
      );
      return res.status(502).json({ error: result.message || "Send failed.", code: result.code });
    }

    const newStatus = result.code === "-105" ? "sent_test" : "sent";

    const { rows: updated } = await pool.query(
      `UPDATE mailers SET
         status = $1::mail_status,
         sent_at = NOW(),
         cost_cents = COALESCE(quoted_cost_cents, cost_cents),
         last_status_check = NOW()
       WHERE id = $2
       RETURNING *`,
      [newStatus, id]
    );

    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, raw_payload, created_by)
       VALUES ($1, 'sent', $2, $3, $4)`,
      [id, `Sent via LetterStream${newStatus === "sent_test" ? " (TEST mode)" : ""}`, JSON.stringify(result.data || {}), asUser(req)]
    );

    res.json({ mailer: rowToMailer(updated[0]) });
  } catch (e) {
    console.error("[mailers] confirm-send", e);
    res.status(502).json({ error: e.message || "Failed to confirm send." });
  }
}

/* ============================ ancillary ============================ */

export async function postMailerCancel(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT status FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    if (!["draft", "queued", "preauth_pending"].includes(rows[0].status)) {
      return res.status(409).json({ error: "Only draft, queued, or preauth_pending mailers can be cancelled." });
    }
    const { rows: updated } = await pool.query(
      `UPDATE mailers SET status = 'cancelled', provider_authcode = NULL WHERE id = $1 RETURNING *`,
      [id]
    );
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'cancelled', 'Mailer cancelled (authcode invalidated; LetterStream preauth will expire on their end)', $2)`,
      [id, asUser(req)]
    );
    res.json({ mailer: rowToMailer(updated[0]) });
  } catch (e) {
    console.error("[mailers] cancel", e);
    res.status(500).json({ error: "Could not cancel mailer." });
  }
}

export async function postMailerResend(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    const user = asUser(req);

    const { rows: newRows } = await pool.query(
      `INSERT INTO mailers (
        document_id, letter_title, letter_html, mail_type,
        recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
        property_address, owner_name, tenant_name, letter_category, notes,
        sender_name, sender_address, sender_city, sender_state, sender_zip,
        triggered_by, triggered_from, sent_by, include_return_envelope, status
      ) SELECT
        document_id, letter_title || ' (Resend)', letter_html, mail_type,
        recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
        property_address, owner_name, tenant_name, letter_category, notes,
        sender_name, sender_address, sender_city, sender_state, sender_zip,
        'manual', $1, $2, include_return_envelope, 'draft'
      FROM mailers WHERE id = $3
      RETURNING *`,
      [`resend of #${id}`, user, id]
    );
    const newMailer = newRows[0];
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'created', $2, $3)`,
      [newMailer.id, `Resend of mailer #${id}`, user]
    );
    res.status(201).json({ mailer: rowToMailer(newMailer) });
  } catch (e) {
    console.error("[mailers] resend", e);
    res.status(500).json({ error: "Could not resend mailer." });
  }
}

export async function postMailerNote(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });
  const note = String(req.body?.note || "").trim();
  if (!note) return res.status(400).json({ error: "Note text is required." });
  try {
    const pool = getPool();
    const { rows: existing } = await pool.query(`SELECT id FROM mailers WHERE id = $1`, [id]);
    if (!existing.length) return res.status(404).json({ error: "Not found." });
    const { rows } = await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'note_added', $2, $3) RETURNING *`,
      [id, note, asUser(req)]
    );
    res.status(201).json({ event: rows[0] });
  } catch (e) {
    console.error("[mailers] note", e);
    res.status(500).json({ error: "Could not add note." });
  }
}

/* ============================ tracking, signature, balance ============================ */

/**
 * GET /api/mailers/:id/tracking
 * On-demand pull from LetterStream; updates the mailer + inserts an event if status changed.
 */
export async function getMailerTracking(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });
  const pool = getPool();
  try {
    const { rows } = await pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    const mailer = rows[0];
    if (!mailer.provider_doc_id) {
      return res.status(409).json({ error: "Mailer has no LetterStream doc_id yet." });
    }

    const result = await getTracking(mailer.provider_doc_id);
    if (!result.success) {
      return res.status(502).json({ error: result.message || "Tracking lookup failed.", code: result.code });
    }

    const data = result.data || {};
    const mapped = codeToStatus(result.code);
    const trackingNum = data.tracking_number || data.tracking_id || data.usps_tracking_number || null;

    let newStatus = mailer.status;
    if (mapped?.status && mapped.status !== "deleted" && mapped.status !== "unknown") {
      // Only escalate to "later" statuses — don't downgrade
      const order = [
        "draft", "preauth_pending", "queued", "sent_test", "sent",
        "in_production", "mailed", "in_transit", "out_for_delivery",
        "attempted", "delivered", "returned", "failed", "needs_attention",
      ];
      const curIdx = order.indexOf(mailer.status);
      const newIdx = order.indexOf(mapped.status);
      if (newIdx > curIdx) newStatus = mapped.status;
    }

    const statusChanged = newStatus !== mailer.status;
    const { rows: updated } = await pool.query(
      `UPDATE mailers SET
         last_status_check = NOW(),
         provider_tracking_number = COALESCE($1, provider_tracking_number),
         status = $2::mail_status,
         delivered_at = CASE WHEN $2 = 'delivered' AND delivered_at IS NULL THEN NOW() ELSE delivered_at END
       WHERE id = $3
       RETURNING *`,
      [trackingNum, newStatus, id]
    );

    if (statusChanged) {
      await pool.query(
        `INSERT INTO mailer_events (mailer_id, event_type, event_detail, raw_payload, created_by)
         VALUES ($1, $2, $3, $4, 'system')`,
        [id, newStatus, `Status updated via on-demand tracking: ${mailer.status} → ${newStatus}`, JSON.stringify(data)]
      );
    }

    res.json({ mailer: rowToMailer(updated[0]), tracking: data, code: result.code });
  } catch (e) {
    console.error("[mailers] tracking", e);
    res.status(500).json({ error: e.message || "Could not load tracking." });
  }
}

/**
 * GET /api/mailers/:id/signature
 * Streams the LetterStream-hosted signature PDF for a delivered certified mailer.
 */
export async function getMailerSignature(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id." });
  const pool = getPool();
  try {
    const { rows } = await pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    const mailer = rows[0];
    if (!mailer.provider_tracking_number) {
      return res.status(409).json({ error: "No tracking number yet." });
    }
    if (mailer.mail_type !== "certified_return_receipt" && mailer.mail_type !== "certified") {
      return res.status(409).json({ error: "Signature only available for certified mail." });
    }

    // Fetch (or re-use cached file)
    let filePath = mailer.signature_file_path;
    if (!filePath || !fs.existsSync(filePath)) {
      const result = await getSignatureFile(mailer.provider_tracking_number);
      if (!result.success) {
        return res.status(502).json({ error: result.message || "Could not retrieve signature.", code: result.code });
      }
      filePath = result.data.path;
      await pool.query(`UPDATE mailers SET signature_file_path = $1 WHERE id = $2`, [filePath, id]);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="signature-${mailer.provider_tracking_number}.pdf"`
    );
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error("[mailers] signature", e);
    res.status(500).json({ error: e.message || "Could not load signature." });
  }
}

/**
 * GET /api/mailers/account-balance
 * 5-minute cached LetterStream prepaid balance.
 */
let _balanceCache = null; // { fetchedAt, data }
export async function getMailerAccountBalance(req, res) {
  try {
    const now = Date.now();
    if (_balanceCache && now - _balanceCache.fetchedAt < 5 * 60 * 1000) {
      return res.json({ ...(_balanceCache.data || {}), cached: true });
    }
    const result = await getAccountBalance();
    if (!result.success) {
      return res.status(502).json({ error: result.message || "Could not load balance.", code: result.code });
    }
    _balanceCache = { fetchedAt: now, data: { balance: result.data.balance, balanceCents: result.data.balanceCents } };
    res.json({ ..._balanceCache.data, cached: false });
  } catch (e) {
    console.error("[mailers] balance", e);
    res.status(500).json({ error: e.message || "Could not load balance." });
  }
}

/* ============================ webhook ============================ */

/**
 * POST /api/mailers/webhook/letterstream
 * LetterStream pushes tracking scans every ~4 hours.
 * Form body: { key, api_version, timestamp, json } where `json` is a JSON-encoded array.
 *
 * Public route — no auth middleware. Verifies the shared `key` matches LETTERSTREAM_WEBHOOK_KEY.
 * Always responds 200 (LetterStream resends on 5xx, which can cascade).
 */
export async function postLetterStreamWebhook(req, res) {
  try {
    const expected = process.env.LETTERSTREAM_WEBHOOK_KEY || "";
    const provided = String(req.body?.key || req.query?.key || "");
    if (!expected) {
      console.warn("[letterstream webhook] LETTERSTREAM_WEBHOOK_KEY not set; rejecting all webhooks");
      return res.status(200).json({ success: false, reason: "Server-side webhook key not configured" });
    }
    if (provided !== expected) {
      return res.status(401).json({ success: false, reason: "Invalid webhook key" });
    }

    let payload = req.body?.json;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch (e) {
        console.warn("[letterstream webhook] could not parse json:", e.message);
        return res.status(200).json({ success: false, reason: "Invalid json payload" });
      }
    }
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.scans) ? payload.scans : [];
    if (!items.length) {
      return res.status(200).json({ success: true, reason: "No scans in payload" });
    }

    const pool = getPool();
    let processed = 0;
    for (const item of items) {
      try {
        await processWebhookScan(pool, item);
        processed++;
      } catch (e) {
        console.error("[letterstream webhook] item error:", e.message, item);
      }
    }
    console.log(`[letterstream webhook] processed ${processed}/${items.length} scans`);
    res.status(200).json({ success: true, reason: "Received data", processed });
  } catch (e) {
    // Log but always 200 so LetterStream doesn't put us in infinite retry
    console.error("[letterstream webhook] fatal:", e);
    res.status(200).json({ success: false, reason: "Internal error (logged)" });
  }
}

async function processWebhookScan(pool, item) {
  const docId = String(item.doc_id || item.docId || "").trim();
  const jobId = String(item.job_id || item.jobId || "").trim();
  const batchId = String(item.batch_id || item.batchId || "").trim();
  const trackingId = String(item.tracking_id || item.tracking_number || "").trim();
  const scanCode = String(item.scan_code || item.scanCode || "").trim();
  const scanStatus = String(item.scan_status || item.scanStatus || "").trim();
  const scanFacility = String(item.scan_facility || item.scanFacility || "").trim();
  const scanZip = String(item.scan_zip || item.scanZip || "").trim();
  const scanDate = item.scan_date || item.scanDate || null;

  // Match by doc_id first, fall back to job_id, finally tracking
  let mailerRow = null;
  if (docId) {
    const { rows } = await pool.query(`SELECT id, status FROM mailers WHERE provider_doc_id = $1 LIMIT 1`, [docId]);
    if (rows.length) mailerRow = rows[0];
  }
  if (!mailerRow && jobId) {
    const { rows } = await pool.query(`SELECT id, status FROM mailers WHERE provider_job_id = $1 LIMIT 1`, [jobId]);
    if (rows.length) mailerRow = rows[0];
  }
  if (!mailerRow && trackingId) {
    const { rows } = await pool.query(`SELECT id, status FROM mailers WHERE provider_tracking_number = $1 LIMIT 1`, [trackingId]);
    if (rows.length) mailerRow = rows[0];
  }
  if (!mailerRow) {
    console.warn(`[letterstream webhook] no mailer for doc_id=${docId} job_id=${jobId}`);
    return;
  }

  // Insert event
  await pool.query(
    `INSERT INTO mailer_events (
      mailer_id, event_type, event_detail, raw_payload, created_by,
      scan_batch_id, scan_job_id, scan_doc_id, scan_tracking_id,
      scan_date, scan_zip, scan_facility, scan_code, scan_status
    ) VALUES ($1, 'scan', $2, $3, 'letterstream-webhook',
              $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      mailerRow.id,
      scanStatus || `Scan code ${scanCode}`,
      JSON.stringify(item),
      batchId || null, jobId || null, docId || null, trackingId || null,
      scanDate ? new Date(scanDate) : null,
      scanZip || null, scanFacility || null, scanCode || null, scanStatus || null,
    ]
  );

  // Map scan code to status
  const newStatus = uspsScanCodeToStatus(scanCode);
  const isDelivery = newStatus === "delivered";
  const isReturn = newStatus === "returned" || newStatus === "failed";

  await pool.query(
    `UPDATE mailers SET
       current_scan_status = $1,
       current_scan_code = $2,
       last_scanned_at = COALESCE($3::timestamptz, NOW()),
       last_scan_facility = $4,
       last_scan_zip = $5,
       provider_tracking_number = COALESCE(NULLIF($6, ''), provider_tracking_number),
       status = CASE
         WHEN $7::boolean THEN 'delivered'::mail_status
         WHEN $8::boolean THEN $9::mail_status
         WHEN status IN ('sent','sent_test','in_production','mailed','in_transit')
           THEN $9::mail_status
         ELSE status
       END,
       delivered_at = CASE
         WHEN $7::boolean AND delivered_at IS NULL THEN COALESCE($3::timestamptz, NOW())
         ELSE delivered_at
       END
     WHERE id = $10`,
    [
      scanStatus || null, scanCode || null,
      scanDate ? new Date(scanDate) : null,
      scanFacility || null, scanZip || null,
      trackingId,
      isDelivery, isReturn, newStatus,
      mailerRow.id,
    ]
  );
}

/* ============================ stats / suggestions ============================ */

export async function getMailerStats(req, res) {
  try {
    const pool = getPool();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [{ rows: totals }, { rows: byType }, { rows: byCategory }, { rows: recent }] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('draft','cancelled','preauth_pending')) AS total_sent,
          COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
          COUNT(*) FILTER (WHERE status IN ('sent','sent_test','in_production','mailed','in_transit','out_for_delivery')) AS in_transit,
          COUNT(*) FILTER (WHERE status IN ('failed','failed_funding','returned','attempted','needs_attention')) AS failed_returned,
          SUM(cost_cents) FILTER (WHERE sent_at >= $1 AND status NOT IN ('draft','cancelled','preauth_pending')) AS cost_this_month,
          SUM(cost_cents) FILTER (WHERE status NOT IN ('draft','cancelled','preauth_pending')) AS cost_all_time
        FROM mailers
      `, [startOfMonth]),
      pool.query(`
        SELECT mail_type, COUNT(*) AS count, SUM(cost_cents) AS total_cost
        FROM mailers
        WHERE status NOT IN ('draft', 'cancelled', 'preauth_pending')
        GROUP BY mail_type
      `),
      pool.query(`
        SELECT letter_category, COUNT(*) AS count
        FROM mailers
        WHERE status NOT IN ('draft', 'cancelled', 'preauth_pending') AND letter_category IS NOT NULL
        GROUP BY letter_category
      `),
      pool.query(`
        SELECT me.*, m.letter_title, m.recipient_name
        FROM mailer_events me
        JOIN mailers m ON m.id = me.mailer_id
        ORDER BY me.event_time DESC
        LIMIT 10
      `),
    ]);

    const t = totals[0];
    res.json({
      totalSent: parseInt(t.total_sent, 10) || 0,
      delivered: parseInt(t.delivered, 10) || 0,
      inTransit: parseInt(t.in_transit, 10) || 0,
      failedReturned: parseInt(t.failed_returned, 10) || 0,
      totalCostThisMonth: parseInt(t.cost_this_month, 10) || 0,
      totalCostAllTime: parseInt(t.cost_all_time, 10) || 0,
      breakdownByType: byType,
      breakdownByCategory: byCategory,
      recentActivity: recent,
    });
  } catch (e) {
    console.error("[mailers] stats", e);
    res.status(500).json({ error: "Could not load stats." });
  }
}

export async function getMailerSuggestions(req, res) {
  const field = req.query.field;
  const q = String(req.query.q || "").trim();
  if (!field || !q) return res.json({ suggestions: [] });
  const allowed = ["property_address", "owner_name", "tenant_name"];
  if (!allowed.includes(field)) return res.status(400).json({ error: "Invalid field." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT DISTINCT ${field} AS value FROM mailers
       WHERE ${field} ILIKE $1 AND ${field} IS NOT NULL
       ORDER BY value LIMIT 10`,
      [`%${q}%`]
    );
    res.json({ suggestions: rows.map((r) => r.value) });
  } catch (e) {
    console.error("[mailers] suggestions", e);
    res.status(500).json({ error: "Could not load suggestions." });
  }
}

export async function getMailerVolumeByWeek(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT DATE_TRUNC('week', sent_at) AS week, mail_type, COUNT(*) AS count
      FROM mailers
      WHERE sent_at >= NOW() - INTERVAL '8 weeks'
        AND status NOT IN ('draft', 'cancelled', 'preauth_pending')
      GROUP BY week, mail_type ORDER BY week, mail_type
    `);
    res.json({ volume: rows });
  } catch (e) {
    console.error("[mailers] volume", e);
    res.status(500).json({ error: "Could not load volume." });
  }
}

/* ============================ deprecated alias ============================ */

/**
 * @deprecated Use postMailerQuote + postMailerConfirmSend instead.
 * Kept as alias for any old frontend bundles still calling /send.
 * Will quote + auto-confirm if `auto_confirm=true` in body.
 */
export async function postMailerSend(req, res) {
  // Forward to quote; frontend should follow up with /confirm-send
  return postMailerQuote(req, res);
}
