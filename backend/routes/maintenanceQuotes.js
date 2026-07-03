/**
 * Maintenance Management System — quotes + PrestigeSign (Phase 4).
 *
 * Line-item builder (labor + materials + markup %), owner-approval flow that
 * generates a PrestigeSign (Docuseal) envelope, and — on approval — advances
 * the linked job to `scheduled` and exposes a suggest-only AppFolio bill draft
 * preview (nothing is posted; that depends on the write-back initiative).
 *
 * maint_quotes / maint_quote_lines shipped in 047; 050 added title + lifecycle
 * timestamps. Mounted in backend/index.js under /maintenance/quotes.
 */

import { getPool } from "../lib/db.js";
import { emitEvent } from "../lib/eventBus.js";
import { createEsignEnvelope } from "./esign.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Compute subtotal / markup / total from a subtotal + markup percent. */
function totalsFrom(subtotal, markupPct) {
  const sub = round2(subtotal);
  const markupAmount = round2(sub * (Number(markupPct) || 0) / 100);
  return { subtotal: sub, markupAmount, total: round2(sub + markupAmount) };
}

function mapQuote(r) {
  const t = totalsFrom(r.subtotal ?? 0, r.markup_pct ?? 0);
  return {
    id: r.id,
    jobId: r.job_id,
    jobTitle: r.job_title ?? undefined,
    propertyName: r.property_name ?? undefined,
    title: r.title,
    status: r.status,
    ownerApprovalState: r.owner_approval_state,
    markupPct: r.markup_pct != null ? Number(r.markup_pct) : 0,
    esignRequestId: r.esign_request_id ?? null,
    esignStatus: r.esign_status ?? null,
    notes: r.notes,
    sentAt: r.sent_at ?? null,
    decidedAt: r.decided_at ?? null,
    lineCount: r.line_count != null ? Number(r.line_count) : 0,
    ...t,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapLine(r) {
  const qty = Number(r.qty) || 0;
  const unitCost = Number(r.unit_cost) || 0;
  return {
    id: r.id,
    quoteId: r.quote_id,
    kind: r.kind,
    description: r.description,
    qty,
    unitCost,
    lineTotal: round2(qty * unitCost),
    lineOrder: r.line_order,
  };
}

// Header row + joined job/property + line aggregate + esign status.
const SELECT_QUOTE = `
  SELECT q.*,
         j.title AS job_title,
         p.name  AS property_name,
         e.status AS esign_status,
         COALESCE(l.subtotal, 0)   AS subtotal,
         COALESCE(l.line_count, 0) AS line_count
    FROM maint_quotes q
    JOIN maint_jobs j ON j.id = q.job_id
    JOIN appfolio.properties p ON p.id = j.property_id
    LEFT JOIN esign_requests e ON e.id = q.esign_request_id
    LEFT JOIN (
      SELECT quote_id, SUM(qty * unit_cost) AS subtotal, COUNT(*) AS line_count
        FROM maint_quote_lines GROUP BY quote_id
    ) l ON l.quote_id = q.id
`;

export async function listQuotes(req, res) {
  try {
    const pool = getPool();
    const filters = ["q.archived_at IS NULL"];
    const params = [];
    if (req.query.job_id) {
      params.push(Number(req.query.job_id));
      filters.push(`q.job_id = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      filters.push(`q.status = $${params.length}`);
    }
    const { rows } = await pool.query(
      `${SELECT_QUOTE} WHERE ${filters.join(" AND ")} ORDER BY q.created_at DESC`,
      params
    );
    res.json({ quotes: rows.map(mapQuote) });
  } catch (e) {
    console.error("listQuotes failed", e);
    res.status(500).json({ error: "Could not load quotes." });
  }
}

async function loadQuoteRow(pool, id) {
  const { rows } = await pool.query(`${SELECT_QUOTE} WHERE q.id = $1 AND q.archived_at IS NULL`, [id]);
  return rows[0] || null;
}

export async function getQuote(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid quote id." });
      return;
    }
    const row = await loadQuoteRow(pool, id);
    if (!row) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    const { rows: lines } = await pool.query(
      `SELECT * FROM maint_quote_lines WHERE quote_id = $1 ORDER BY line_order ASC, id ASC`,
      [id]
    );
    res.json({ quote: mapQuote(row), lines: lines.map(mapLine) });
  } catch (e) {
    console.error("getQuote failed", e);
    res.status(500).json({ error: "Could not load quote." });
  }
}

export async function createQuote(req, res) {
  try {
    const pool = getPool();
    const b = req.body ?? {};
    const jobId = Number(b.jobId);
    if (!Number.isInteger(jobId)) {
      res.status(400).json({ error: "jobId is required." });
      return;
    }
    if (b.markupPct != null && !(Number(b.markupPct) >= 0)) {
      res.status(400).json({ error: "markupPct must be a non-negative number." });
      return;
    }
    const { rows: job } = await pool.query(
      `SELECT 1 FROM maint_jobs WHERE id = $1 AND archived_at IS NULL`,
      [jobId]
    );
    if (!job.length) {
      res.status(400).json({ error: "Unknown job." });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO maint_quotes (job_id, title, markup_pct, notes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        jobId,
        b.title?.trim() || null,
        b.markupPct != null ? Number(b.markupPct) : 0,
        b.notes?.trim() || null,
        req.user?.id ?? null,
      ]
    );
    const row = await loadQuoteRow(pool, rows[0].id);
    res.status(201).json({ quote: mapQuote(row), lines: [] });
  } catch (e) {
    console.error("createQuote failed", e);
    res.status(500).json({ error: "Could not create quote." });
  }
}

export async function updateQuote(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid quote id." });
      return;
    }
    const b = req.body ?? {};
    const sets = [];
    const params = [];
    const setField = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (b.title !== undefined) setField("title", b.title?.trim() || null);
    if (b.notes !== undefined) setField("notes", b.notes?.trim() || null);
    if (b.markupPct !== undefined) {
      if (b.markupPct != null && !(Number(b.markupPct) >= 0)) {
        res.status(400).json({ error: "markupPct must be a non-negative number." });
        return;
      }
      setField("markup_pct", Number(b.markupPct) || 0);
    }
    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields provided." });
      return;
    }
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rowCount } = await pool.query(
      `UPDATE maint_quotes SET ${sets.join(", ")} WHERE id = $${params.length} AND archived_at IS NULL`,
      params
    );
    if (!rowCount) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    const row = await loadQuoteRow(pool, id);
    res.json({ quote: mapQuote(row) });
  } catch (e) {
    console.error("updateQuote failed", e);
    res.status(500).json({ error: "Could not update quote." });
  }
}

export async function deleteQuote(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid quote id." });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE maint_quotes SET archived_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteQuote failed", e);
    res.status(500).json({ error: "Could not delete quote." });
  }
}

/* -------------------------------------------------------------- line items */

async function assertDraftQuote(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, status FROM maint_quotes WHERE id = $1 AND archived_at IS NULL`,
    [id]
  );
  return rows[0] || null;
}

export async function addLine(req, res) {
  try {
    const pool = getPool();
    const quoteId = Number(req.params.id);
    if (!Number.isInteger(quoteId)) {
      res.status(400).json({ error: "Invalid quote id." });
      return;
    }
    const q = await assertDraftQuote(pool, quoteId);
    if (!q) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    if (q.status === "approved") {
      res.status(409).json({ error: "Cannot edit line items on an approved quote." });
      return;
    }
    const b = req.body ?? {};
    if (b.kind !== "labor" && b.kind !== "material") {
      res.status(400).json({ error: "kind must be 'labor' or 'material'." });
      return;
    }
    if (!b.description || !String(b.description).trim()) {
      res.status(400).json({ error: "description is required." });
      return;
    }
    const qty = Number(b.qty);
    const unitCost = Number(b.unitCost);
    if (!(qty >= 0) || !(unitCost >= 0)) {
      res.status(400).json({ error: "qty and unitCost must be non-negative numbers." });
      return;
    }
    const { rows: ord } = await pool.query(
      `SELECT COALESCE(MAX(line_order), -1) + 1 AS next FROM maint_quote_lines WHERE quote_id = $1`,
      [quoteId]
    );
    const { rows } = await pool.query(
      `INSERT INTO maint_quote_lines (quote_id, kind, description, qty, unit_cost, line_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [quoteId, b.kind, String(b.description).trim(), qty, unitCost, ord[0].next]
    );
    await pool.query(`UPDATE maint_quotes SET updated_at = NOW() WHERE id = $1`, [quoteId]);
    res.status(201).json({ line: mapLine(rows[0]) });
  } catch (e) {
    console.error("addLine failed", e);
    res.status(500).json({ error: "Could not add line." });
  }
}

export async function updateLine(req, res) {
  try {
    const pool = getPool();
    const quoteId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    if (!Number.isInteger(quoteId) || !Number.isInteger(lineId)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const q = await assertDraftQuote(pool, quoteId);
    if (!q) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    if (q.status === "approved") {
      res.status(409).json({ error: "Cannot edit line items on an approved quote." });
      return;
    }
    const b = req.body ?? {};
    const sets = [];
    const params = [];
    const setField = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (b.kind !== undefined) {
      if (b.kind !== "labor" && b.kind !== "material") {
        res.status(400).json({ error: "kind must be 'labor' or 'material'." });
        return;
      }
      setField("kind", b.kind);
    }
    if (b.description !== undefined) {
      if (!String(b.description).trim()) {
        res.status(400).json({ error: "description cannot be empty." });
        return;
      }
      setField("description", String(b.description).trim());
    }
    if (b.qty !== undefined) {
      if (!(Number(b.qty) >= 0)) {
        res.status(400).json({ error: "qty must be non-negative." });
        return;
      }
      setField("qty", Number(b.qty));
    }
    if (b.unitCost !== undefined) {
      if (!(Number(b.unitCost) >= 0)) {
        res.status(400).json({ error: "unitCost must be non-negative." });
        return;
      }
      setField("unit_cost", Number(b.unitCost));
    }
    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields provided." });
      return;
    }
    params.push(lineId, quoteId);
    const { rows } = await pool.query(
      `UPDATE maint_quote_lines SET ${sets.join(", ")}
        WHERE id = $${params.length - 1} AND quote_id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) {
      res.status(404).json({ error: "Line not found." });
      return;
    }
    await pool.query(`UPDATE maint_quotes SET updated_at = NOW() WHERE id = $1`, [quoteId]);
    res.json({ line: mapLine(rows[0]) });
  } catch (e) {
    console.error("updateLine failed", e);
    res.status(500).json({ error: "Could not update line." });
  }
}

export async function deleteLine(req, res) {
  try {
    const pool = getPool();
    const quoteId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    if (!Number.isInteger(quoteId) || !Number.isInteger(lineId)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const q = await assertDraftQuote(pool, quoteId);
    if (!q) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    if (q.status === "approved") {
      res.status(409).json({ error: "Cannot edit line items on an approved quote." });
      return;
    }
    const { rowCount } = await pool.query(
      `DELETE FROM maint_quote_lines WHERE id = $1 AND quote_id = $2`,
      [lineId, quoteId]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Line not found." });
      return;
    }
    await pool.query(`UPDATE maint_quotes SET updated_at = NOW() WHERE id = $1`, [quoteId]);
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteLine failed", e);
    res.status(500).json({ error: "Could not delete line." });
  }
}

/* --------------------------------------------------- owner-approval / esign */

/**
 * POST /maintenance/quotes/:id/send-esign — generate a PrestigeSign envelope
 * for owner sign-off. Template comes from body.templateId or the
 * MAINT_QUOTE_ESIGN_TEMPLATE_ID env var. Stores esign_request_id and marks the
 * quote sent / pending owner approval.
 */
export async function sendQuoteForSignature(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid quote id." });
      return;
    }
    const row = await loadQuoteRow(pool, id);
    if (!row) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    const b = req.body ?? {};
    const ownerEmail = b.ownerEmail?.trim();
    if (!ownerEmail) {
      res.status(400).json({ error: "ownerEmail is required." });
      return;
    }
    const templateId = b.templateId || process.env.MAINT_QUOTE_ESIGN_TEMPLATE_ID;
    if (!templateId) {
      res.status(400).json({
        error:
          "No e-sign template configured. Set MAINT_QUOTE_ESIGN_TEMPLATE_ID or pass templateId.",
      });
      return;
    }

    const t = totalsFrom(row.subtotal ?? 0, row.markup_pct ?? 0);
    let envelope;
    try {
      envelope = await createEsignEnvelope({
        templateId,
        templateName: b.templateName || "Maintenance Quote Approval",
        propertyName: row.property_name,
        signers: [{ role: "Owner", email: ownerEmail, name: b.ownerName?.trim() || "" }],
        prefillFields: {
          property: row.property_name || "",
          job: row.job_title || "",
          quote_total: `$${t.total.toFixed(2)}`,
        },
        userId: req.user?.id || null,
      });
    } catch (err) {
      if (err.code === "VALIDATION") {
        return res.status(400).json({ error: err.message });
      }
      if (err.code === "DOCUSEAL_CONFIG") {
        return res.status(503).json({ error: "PrestigeSign (Docuseal) is not configured." });
      }
      return res.status(502).json({ error: err.message || "Envelope creation failed." });
    }

    const { rows } = await pool.query(
      `UPDATE maint_quotes
          SET esign_request_id = $2, status = 'sent',
              owner_approval_state = 'pending', sent_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING id`,
      [id, envelope.request.id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    const fresh = await loadQuoteRow(pool, id);
    res.json({ quote: mapQuote(fresh), esignRequest: envelope.request });
  } catch (e) {
    console.error("sendQuoteForSignature failed", e);
    res.status(500).json({ error: "Could not send quote for signature." });
  }
}

/**
 * POST /maintenance/quotes/:id/approve — owner approved. Advances the linked
 * job to `scheduled` (unless already past that) and emits Connect events. The
 * AppFolio bill draft is a separate preview (see getBillDraft) — nothing posts.
 */
export async function approveQuote(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid quote id." });
      return;
    }
    const { rows: qr } = await pool.query(
      `SELECT id, job_id FROM maint_quotes WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!qr.length) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    const jobId = qr[0].job_id;

    await pool.query(
      `UPDATE maint_quotes
          SET status = 'approved', owner_approval_state = 'approved',
              decided_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [id]
    );

    // Advance the job to scheduled if it hasn't progressed past quoting.
    const { rows: jr } = await pool.query(
      `UPDATE maint_jobs
          SET status = 'scheduled', updated_at = NOW()
        WHERE id = $1 AND status IN ('new', 'triaged', 'quoted')
        RETURNING status`,
      [jobId]
    );
    if (jr.length) {
      await emitEvent({
        type: "maintenance.status_changed",
        source: "internal",
        payload: { job_id: jobId, to_status: "scheduled", reason: "quote_approved", quote_id: id },
        externalId: `maintenance_status:${jobId}:scheduled:quote${id}`,
      });
    }
    await emitEvent({
      type: "maintenance.quote_approved",
      source: "internal",
      payload: { quote_id: id, job_id: jobId },
      externalId: `maintenance_quote_approved:${id}`,
    });

    const fresh = await loadQuoteRow(pool, id);
    res.json({ quote: mapQuote(fresh), jobAdvanced: jr.length > 0 });
  } catch (e) {
    console.error("approveQuote failed", e);
    res.status(500).json({ error: "Could not approve quote." });
  }
}

/** POST /maintenance/quotes/:id/decline — owner declined. */
export async function declineQuote(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid quote id." });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE maint_quotes
          SET status = 'rejected', owner_approval_state = 'declined',
              decided_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND archived_at IS NULL RETURNING job_id`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    await emitEvent({
      type: "maintenance.quote_declined",
      source: "internal",
      payload: { quote_id: id, job_id: rows[0].job_id },
      externalId: `maintenance_quote_declined:${id}`,
    });
    const fresh = await loadQuoteRow(pool, id);
    res.json({ quote: mapQuote(fresh) });
  } catch (e) {
    console.error("declineQuote failed", e);
    res.status(500).json({ error: "Could not decline quote." });
  }
}

/**
 * GET /maintenance/quotes/:id/bill-draft — suggest-only AppFolio bill draft
 * preview. Computes what the bill WOULD contain; posts nothing. Actual posting
 * depends on the AppFolio write-back initiative (preview-before-post principle).
 */
export async function getBillDraft(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid quote id." });
      return;
    }
    const row = await loadQuoteRow(pool, id);
    if (!row) {
      res.status(404).json({ error: "Quote not found." });
      return;
    }
    const { rows: lines } = await pool.query(
      `SELECT * FROM maint_quote_lines WHERE quote_id = $1 ORDER BY line_order ASC, id ASC`,
      [id]
    );
    const t = totalsFrom(row.subtotal ?? 0, row.markup_pct ?? 0);
    res.json({
      quoteId: id,
      jobId: row.job_id,
      propertyName: row.property_name,
      approved: row.owner_approval_state === "approved",
      lines: lines.map(mapLine),
      markupPct: Number(row.markup_pct) || 0,
      ...t,
      posted: false,
      suggestOnly: true,
      note: "Preview only — not posted to AppFolio. Posting depends on the AppFolio write-back initiative.",
    });
  } catch (e) {
    console.error("getBillDraft failed", e);
    res.status(500).json({ error: "Could not build bill draft." });
  }
}
