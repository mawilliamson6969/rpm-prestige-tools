/**
 * E-signature routes — thin wrapper over a self-hosted Docuseal container.
 *
 * Internal API: http://docuseal:3000/api (compose network).
 * External UI: https://sign.prestigedash.com (nginx → 127.0.0.1:3001).
 *
 * Auth: most routes require JWT (mounted with requireAuth in index.js).
 * The webhook endpoint is intentionally mounted without auth — Docuseal calls it server-to-server.
 */
import { getPool } from "../lib/db.js";

const DOCUSEAL_BASE = process.env.DOCUSEAL_API_URL || "http://docuseal:3000/api";
const DOCUSEAL_KEY = process.env.DOCUSEAL_API_KEY || "";

async function docusealFetch(path, options = {}) {
  if (!DOCUSEAL_KEY) {
    const err = new Error(
      "DOCUSEAL_API_KEY is not set. Generate a key in Docuseal admin (sign.prestigedash.com) and add it to .env."
    );
    err.code = "DOCUSEAL_CONFIG";
    throw err;
  }
  const url = `${DOCUSEAL_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-Auth-Token": DOCUSEAL_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(
      typeof body === "object" && body?.error ? body.error : `Docuseal HTTP ${res.status}`
    );
    err.code = "DOCUSEAL_HTTP";
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function sendDocusealError(res, err) {
  if (err.code === "DOCUSEAL_CONFIG") {
    return res.status(503).json({ error: err.message, code: err.code });
  }
  if (err.code === "DOCUSEAL_HTTP") {
    return res.status(502).json({
      error: err.message,
      code: err.code,
      status: err.status,
      body: err.body,
    });
  }
  console.error("[esign]", err);
  return res.status(500).json({ error: err.message || "Unexpected error" });
}

/** GET /esign/templates — list signing templates from Docuseal. */
export async function getTemplates(_req, res) {
  try {
    const templates = await docusealFetch("/templates");
    res.json(Array.isArray(templates) ? templates : templates?.data || []);
  } catch (err) {
    sendDocusealError(res, err);
  }
}

/** GET /esign/templates/:id — single template detail (fields, roles). */
export async function getTemplate(req, res) {
  try {
    const template = await docusealFetch(`/templates/${encodeURIComponent(req.params.id)}`);
    res.json(template);
  } catch (err) {
    sendDocusealError(res, err);
  }
}

function normalizeSigners(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => ({
      role: typeof s.role === "string" && s.role.trim() ? s.role.trim() : "Signer",
      email: typeof s.email === "string" ? s.email.trim() : "",
      name: typeof s.name === "string" ? s.name.trim() : "",
      fields: s.fields && typeof s.fields === "object" ? s.fields : {},
    }))
    .filter((s) => s.email);
}

function fieldsToSubmitterValues(fields) {
  if (!fields || typeof fields !== "object") return [];
  return Object.entries(fields).map(([name, value]) => ({ name, default_value: value }));
}

/** POST /esign/send — create a Docuseal submission and store a tracking row locally. */
export async function postSend(req, res) {
  try {
    const pool = getPool();
    const {
      templateId,
      templateName,
      processId,
      propertyName,
      signers,
      prefillFields,
    } = req.body || {};

    if (!templateId) {
      return res.status(400).json({ error: "templateId is required" });
    }
    const cleanSigners = normalizeSigners(signers);
    if (!cleanSigners.length) {
      return res.status(400).json({ error: "At least one signer with an email is required" });
    }

    const submitters = cleanSigners.map((s) => ({
      role: s.role,
      email: s.email,
      name: s.name || undefined,
      values: fieldsToSubmitterValues({ ...(prefillFields || {}), ...s.fields }),
    }));

    const submission = await docusealFetch("/submissions", {
      method: "POST",
      body: JSON.stringify({
        template_id: Number(templateId),
        send_email: true,
        submitters,
      }),
    });

    // Docuseal returns either an array of submitters with submission_id, or a single submission object.
    const submissionId = Array.isArray(submission)
      ? submission[0]?.submission_id || submission[0]?.id
      : submission?.id || submission?.submission_id;

    const procIdNum = Number.parseInt(processId, 10);
    const { rows } = await pool.query(
      `INSERT INTO esign_requests
         (docuseal_submission_id, template_id, template_name, process_id, property_name,
          signers, prefill_fields, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', $8, NOW(), NOW())
       RETURNING *`,
      [
        submissionId || null,
        Number(templateId),
        typeof templateName === "string" ? templateName : null,
        Number.isFinite(procIdNum) ? procIdNum : null,
        typeof propertyName === "string" ? propertyName : null,
        JSON.stringify(cleanSigners),
        JSON.stringify(prefillFields || {}),
        req.user?.id || null,
      ]
    );

    if (Number.isFinite(procIdNum)) {
      await pool.query(
        `UPDATE processes
            SET last_activity_at = NOW(),
                last_activity_type = 'esign_sent',
                last_activity_by = $2
          WHERE id = $1`,
        [procIdNum, req.user?.id || null]
      );
    }

    res.status(201).json({ success: true, request: rows[0], docuseal: submission });
  } catch (err) {
    sendDocusealError(res, err);
  }
}

/** GET /esign/requests — list local signing requests with filters. */
export async function getRequests(req, res) {
  try {
    const pool = getPool();
    const { processId, status, search } = req.query;
    const conditions = [];
    const params = [];
    if (processId) {
      params.push(Number(processId));
      conditions.push(`process_id = $${params.length}`);
    }
    if (status && typeof status === "string") {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (search && typeof search === "string" && search.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(property_name ILIKE $${params.length}
          OR template_name ILIKE $${params.length}
          OR signers::text ILIKE $${params.length})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT r.*, p.name AS process_title
         FROM esign_requests r
         LEFT JOIN processes p ON p.id = r.process_id
         ${where}
         ORDER BY r.created_at DESC
         LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("[esign:list]", err);
    res.status(500).json({ error: err.message || "Failed to list signing requests" });
  }
}

function deriveStatus(submission, currentStatus) {
  const submitters = submission?.submitters || [];
  if (submitters.length && submitters.every((s) => s.completed_at || s.status === "completed")) {
    return "completed";
  }
  if (submitters.some((s) => s.declined_at || s.status === "declined")) return "declined";
  if (submitters.some((s) => s.opened_at)) return "viewed";
  return currentStatus || "sent";
}

/** GET /esign/requests/:id/status — refresh from Docuseal and return latest. */
export async function getRequestStatus(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query("SELECT * FROM esign_requests WHERE id = $1", [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const local = rows[0];
    if (!local.docuseal_submission_id) {
      return res.json({ ...local, docusealDetails: null });
    }
    const submission = await docusealFetch(`/submissions/${local.docuseal_submission_id}`);
    const newStatus = deriveStatus(submission, local.status);
    if (newStatus !== local.status) {
      const completedAt = newStatus === "completed" ? new Date() : null;
      const updated = await pool.query(
        `UPDATE esign_requests
            SET status = $1,
                completed_at = COALESCE($2, completed_at),
                updated_at = NOW()
          WHERE id = $3 RETURNING *`,
        [newStatus, completedAt, req.params.id]
      );
      return res.json({ ...updated.rows[0], docusealDetails: submission });
    }
    res.json({ ...local, docusealDetails: submission });
  } catch (err) {
    sendDocusealError(res, err);
  }
}

/** GET /esign/requests/:id/download — return signed document URLs. */
export async function getRequestDownload(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query("SELECT * FROM esign_requests WHERE id = $1", [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!rows[0].docuseal_submission_id) {
      return res.json({ documents: [] });
    }
    const submission = await docusealFetch(`/submissions/${rows[0].docuseal_submission_id}`);
    const documents =
      submission?.documents ||
      submission?.submitters?.flatMap((s) => s.documents || []) ||
      [];
    res.json({ documents, submission });
  } catch (err) {
    sendDocusealError(res, err);
  }
}

/** POST /esign/requests/:id/resend — ask Docuseal to re-email pending signers. */
export async function postRequestResend(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT docuseal_submission_id FROM esign_requests WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length || !rows[0].docuseal_submission_id) {
      return res.status(404).json({ error: "Not found" });
    }
    await docusealFetch(`/submissions/${rows[0].docuseal_submission_id}/resend`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    res.json({ success: true });
  } catch (err) {
    sendDocusealError(res, err);
  }
}

/** DELETE /esign/requests/:id — cancel/archive a signing request. */
export async function deleteRequest(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT docuseal_submission_id FROM esign_requests WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (rows[0].docuseal_submission_id) {
      try {
        await docusealFetch(`/submissions/${rows[0].docuseal_submission_id}`, { method: "DELETE" });
      } catch (e) {
        // If Docuseal already removed it, continue.
        if (e.code !== "DOCUSEAL_HTTP" || e.status !== 404) throw e;
      }
    }
    await pool.query(
      `UPDATE esign_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    sendDocusealError(res, err);
  }
}

/**
 * POST /esign/webhook — public endpoint Docuseal hits on submission lifecycle events.
 * On completion: mark the local row complete, advance the linked process step, bump activity.
 */
export async function postWebhook(req, res) {
  try {
    const pool = getPool();
    const { event_type, data } = req.body || {};
    const submissionId =
      data?.submission_id || data?.id || data?.submission?.id || null;

    if (!submissionId) {
      return res.json({ received: true, ignored: "no submission id" });
    }

    const isCompleted =
      event_type === "submission.completed" ||
      event_type === "form.completed" ||
      event_type === "submission.signed";
    const isDeclined = event_type === "submission.declined" || event_type === "form.declined";
    const isViewed = event_type === "submission.viewed" || event_type === "form.viewed";

    let nextStatus = null;
    if (isCompleted) nextStatus = "completed";
    else if (isDeclined) nextStatus = "declined";
    else if (isViewed) nextStatus = "viewed";

    if (!nextStatus) {
      return res.json({ received: true });
    }

    const { rows } = await pool.query(
      `UPDATE esign_requests
          SET status = $1,
              completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
              updated_at = NOW()
        WHERE docuseal_submission_id = $2
        RETURNING *`,
      [nextStatus, submissionId]
    );

    const row = rows[0];
    if (row && nextStatus === "completed" && row.process_id) {
      // Auto-complete the matching e-signature step on the linked process, if any.
      const userId = row.created_by || null;
      await pool.query(
        `UPDATE process_steps
            SET status = 'completed',
                completed_at = NOW(),
                completed_by = $1,
                updated_at = NOW()
          WHERE id = (
              SELECT id FROM process_steps
                WHERE process_id = $2
                  AND status NOT IN ('completed','skipped')
                  AND (task_type = 'esign' OR LOWER(name) LIKE '%sign%')
                ORDER BY sort_order ASC, id ASC
                LIMIT 1
            )`,
        [userId, row.process_id]
      );
      await pool.query(
        `UPDATE processes
            SET last_activity_at = NOW(),
                last_activity_type = 'esign_completed',
                last_activity_by = $2
          WHERE id = $1`,
        [row.process_id, userId]
      );
    }

    res.json({ received: true, status: nextStatus });
  } catch (err) {
    console.error("[esign:webhook]", err);
    res.status(200).json({ received: true, error: err.message });
  }
}
