import { randomBytes } from "crypto";
import { createReadStream, statSync } from "fs";
import nodemailer from "nodemailer";
import path from "path";
import { getPool } from "../lib/db.js";
import { renderDocumentTemplatePdf } from "../lib/form-doc-pdf.js";
import { listVersions, getVersion, restoreVersion, snapshotFormVersion } from "../lib/form-versions.js";
import { replaceFormVariables } from "../lib/form-automations.js";

function getSmtp() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  if (!host || !user || !pass || !from) return null;
  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE ?? "true") !== "false",
      auth: { user, pass },
    }),
  };
}

function getBaseUrl() {
  return process.env.PUBLIC_APP_URL?.replace(/\/$/, "") || "https://dashboard.prestigedash.com";
}

/** ---------- Versions ---------- */
export async function getVersions(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const versions = await listVersions(id);
    res.json({ versions });
  } catch (e) {
    console.error("[versions list]", e);
    res.status(500).json({ error: "Could not load versions." });
  }
}

export async function getVersionById(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const versionId = Number.parseInt(req.params.versionId, 10);
  if (!Number.isFinite(id) || !Number.isFinite(versionId)) return res.status(400).json({ error: "Invalid ids." });
  try {
    const v = await getVersion(id, versionId);
    if (!v) return res.status(404).json({ error: "Version not found." });
    res.json({ version: v });
  } catch (e) {
    console.error("[versions get]", e);
    res.status(500).json({ error: "Could not load version." });
  }
}

export async function postRestoreVersion(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const versionId = Number.parseInt(req.params.versionId, 10);
  if (!Number.isFinite(id) || !Number.isFinite(versionId)) return res.status(400).json({ error: "Invalid ids." });
  try {
    const v = await restoreVersion(id, versionId, req.user?.id ?? null);
    res.json({ version: v });
  } catch (e) {
    console.error("[versions restore]", e);
    res.status(500).json({ error: "Could not restore version." });
  }
}

/** Replacement publish handler — snapshots version on publish. */
export async function putFormPublishWithVersion(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE forms SET status = 'published', is_active = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Form not found." });
    try {
      await snapshotFormVersion(id, req.user?.id ?? null, req.body?.changeSummary);
    } catch (err) {
      console.error("[publish snapshot]", err?.message || err);
    }
    const { rows: fresh } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [id]);
    res.json({ form: mapFormBasic(fresh[0]) });
  } catch (e) {
    console.error("[publish with version]", e);
    res.status(500).json({ error: "Could not publish form." });
  }
}

function mapFormBasic(r) {
  return {
    id: r.id, name: r.name, slug: r.slug, status: r.status,
    isActive: r.is_active, submissionsCount: r.submissions_count,
    viewsCount: r.views_count, currentVersion: r.current_version,
  };
}

/** ---------- Scheduling / access middleware ---------- */
export async function checkFormAccess(req, res, next) {
  const slug = req.params.slug;
  const pool = getPool();
  try {
    const { rows } = await pool.query(`SELECT * FROM forms WHERE slug = $1`, [slug]);
    if (!rows.length) return next();
    const form = rows[0];

    const now = new Date();
    if (form.opens_at && new Date(form.opens_at) > now) {
      return res.status(423).json({
        error: "This form is not yet open.",
        reason: "not_open",
        opensAt: form.opens_at,
      });
    }
    if (form.closes_at && new Date(form.closes_at) < now) {
      return res.status(423).json({
        error: form.closed_message || "This form is no longer accepting responses.",
        reason: "closed",
      });
    }
    if (form.max_submissions && form.submissions_count >= form.max_submissions) {
      return res.status(423).json({
        error: "This form has reached its maximum number of responses.",
        reason: "capacity",
      });
    }
    if (form.require_password) {
      const supplied = req.headers["x-form-password"] || req.query.password || req.body?.password;
      const correct = String(form.form_password || "");
      if (!supplied || String(supplied) !== correct) {
        return res.status(401).json({
          error: "Password required.",
          reason: "password_required",
        });
      }
    }
    // ip_limit + one_submission_per_email: only enforce on submit, not view.
    if (req.method === "POST" && req.path.endsWith("/submit")) {
      if (form.one_submission_per_email) {
        // Check submitted_data for email; we pre-parse body
        const data = req.body?.data || {};
        // Find an email-like string anywhere in the submission
        let email = null;
        for (const v of Object.values(data)) {
          if (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { email = v; break; }
        }
        if (email) {
          const { rows: prior } = await pool.query(
            `SELECT COUNT(*)::int AS c FROM form_submissions WHERE form_id = $1 AND contact_email = $2`,
            [form.id, email]
          );
          if (prior[0].c > 0) {
            return res.status(409).json({
              error: "This form only allows one submission per email address.",
              reason: "duplicate_email",
            });
          }
        }
      }
      if (form.ip_limit) {
        const ip = (req.ip || "").slice(0, 45);
        if (ip) {
          const { rows: ipPrior } = await pool.query(
            `SELECT COUNT(*)::int AS c FROM form_submissions WHERE form_id = $1 AND ip_address = $2`,
            [form.id, ip]
          );
          if (ipPrior[0].c >= form.ip_limit) {
            return res.status(429).json({
              error: "Submission limit for your network reached.",
              reason: "ip_limit",
            });
          }
        }
      }
    }
    return next();
  } catch (e) {
    console.error("[checkFormAccess]", e);
    return next();
  }
}

/** ---------- Approvals ---------- */
export async function getMyApprovals(req, res) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Not authenticated." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.*, s.contact_name, s.contact_email, s.submitted_at, s.status AS submission_status,
              f.name AS form_name, f.id AS form_id, f.slug AS form_slug
       FROM form_submission_approvals a
       JOIN form_submissions s ON s.id = a.submission_id
       JOIN forms f ON f.id = s.form_id
       WHERE a.approver_user_id = $1 AND a.status = 'pending'
       ORDER BY s.submitted_at DESC`,
      [userId]
    );
    res.json({ approvals: rows });
  } catch (e) {
    console.error("[my approvals]", e);
    res.status(500).json({ error: "Could not load approvals." });
  }
}

async function advanceApproval(pool, submissionId) {
  // Called after a decision. Checks if all required approvers have acted.
  const { rows: approvals } = await pool.query(
    `SELECT * FROM form_submission_approvals WHERE submission_id = $1 ORDER BY step_order ASC, id ASC`,
    [submissionId]
  );
  if (!approvals.length) return;
  const anyRejected = approvals.some((a) => a.status === "rejected");
  if (anyRejected) {
    await pool.query(`UPDATE form_submissions SET status = 'rejected' WHERE id = $1`, [submissionId]);
    return;
  }
  const allApproved = approvals.every((a) => a.status === "approved" || a.status === "skipped");
  if (allApproved) {
    await pool.query(`UPDATE form_submissions SET status = 'approved' WHERE id = $1`, [submissionId]);
    // Fire automations when all approvals are complete
    try {
      const { rows: s } = await pool.query(`SELECT form_id, submission_data FROM form_submissions WHERE id = $1`, [submissionId]);
      if (s.length) {
        const { executeFormAutomations } = await import("../lib/form-automations.js");
        await executeFormAutomations(s[0].form_id, submissionId, s[0].submission_data);
      }
    } catch (err) {
      console.error("[approval automations]", err?.message || err);
    }
    return;
  }
  // If sequential, notify the next pending approver
  const next = approvals.find((a) => a.status === "pending");
  if (next && next.approver_user_id) {
    await pool.query(
      `INSERT INTO notifications (user_id, message, link)
       VALUES ($1, $2, $3)`,
      [next.approver_user_id, "A submission is ready for your approval.", `/forms/approvals/my`]
    ).catch(() => {});
  }
}

async function notifyApprovers(pool, submissionId, formId, approvers, firstStepOnly) {
  for (let i = 0; i < approvers.length; i++) {
    const approverId = Number.parseInt(approvers[i], 10);
    if (!Number.isFinite(approverId)) continue;
    if (firstStepOnly && i !== 0) continue;
    await pool.query(
      `INSERT INTO notifications (user_id, message, link)
       VALUES ($1, $2, $3)`,
      [approverId, "A new submission requires your approval.", `/forms/approvals/my`]
    ).catch(() => {});
  }
}

/** Called from submit after insert to initialize approval records if required. */
export async function initApprovalsForSubmission(submissionId, formId) {
  const pool = getPool();
  const { rows: formRows } = await pool.query(
    `SELECT requires_approval, approval_config FROM forms WHERE id = $1`, [formId]
  );
  if (!formRows.length || !formRows[0].requires_approval) return false;
  const cfg = formRows[0].approval_config || {};
  const isSequential = cfg.type === "sequential";
  let approvers = [];
  if (isSequential && Array.isArray(cfg.steps)) {
    approvers = cfg.steps.map((s) => s.approverUserId);
  } else if (Array.isArray(cfg.approvers)) {
    approvers = cfg.approvers;
  }
  approvers = approvers.filter((a) => Number.isFinite(Number.parseInt(a, 10)));
  if (!approvers.length) return false;

  for (let i = 0; i < approvers.length; i++) {
    await pool.query(
      `INSERT INTO form_submission_approvals (submission_id, approver_user_id, step_order, status)
       VALUES ($1, $2, $3, 'pending')`,
      [submissionId, approvers[i], i]
    );
  }
  await pool.query(
    `UPDATE form_submissions SET status = 'pending_approval' WHERE id = $1`, [submissionId]
  );
  await notifyApprovers(pool, submissionId, formId, approvers, isSequential);
  return true;
}

async function decideApproval(req, res, decision) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const userId = req.user?.id;
  if (!Number.isFinite(submissionId) || !userId) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    // Find the pending approval for this user
    const { rows } = await pool.query(
      `SELECT * FROM form_submission_approvals
       WHERE submission_id = $1 AND approver_user_id = $2 AND status = 'pending'
       ORDER BY step_order ASC LIMIT 1`,
      [submissionId, userId]
    );
    if (!rows.length) return res.status(404).json({ error: "No pending approval for you on this submission." });

    // For sequential, ensure all earlier steps are approved
    const approval = rows[0];
    if (approval.step_order > 0) {
      const { rows: earlier } = await pool.query(
        `SELECT status FROM form_submission_approvals
         WHERE submission_id = $1 AND step_order < $2`,
        [submissionId, approval.step_order]
      );
      if (!earlier.every((e) => e.status === "approved" || e.status === "skipped")) {
        return res.status(409).json({ error: "Earlier approval step has not completed." });
      }
    }

    await pool.query(
      `UPDATE form_submission_approvals
       SET status = $1, decision_notes = $2, decided_at = NOW() WHERE id = $3`,
      [decision, notes, approval.id]
    );
    await advanceApproval(pool, submissionId);
    res.json({ ok: true });
  } catch (e) {
    console.error("[approval decide]", e);
    res.status(500).json({ error: "Could not record decision." });
  }
}

export const putApproveSubmission = (req, res) => decideApproval(req, res, "approved");
export const putRejectSubmission = (req, res) => decideApproval(req, res, "rejected");

export async function getSubmissionApprovals(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid submission id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.*, u.display_name AS approver_name
       FROM form_submission_approvals a
       LEFT JOIN users u ON u.id = a.approver_user_id
       WHERE a.submission_id = $1 ORDER BY a.step_order ASC, a.id ASC`,
      [submissionId]
    );
    res.json({ approvals: rows });
  } catch (e) {
    console.error("[approvals list]", e);
    res.status(500).json({ error: "Could not load approvals." });
  }
}

/** ---------- Distribution ---------- */
export async function postDistribute(req, res) {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(formId)) return res.status(400).json({ error: "Invalid form id." });
  const b = req.body || {};
  if (b.channel !== "email") return res.status(400).json({ error: "Only email channel supported." });
  const recipients = Array.isArray(b.recipients) ? b.recipients : [];
  if (!recipients.length) return res.status(400).json({ error: "No recipients." });
  const smtp = getSmtp();
  if (!smtp) return res.status(503).json({ error: "SMTP is not configured on this server." });

  try {
    const pool = getPool();
    const { rows: formRows } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [formId]);
    if (!formRows.length) return res.status(404).json({ error: "Form not found." });
    const form = formRows[0];
    const subject = typeof b.subject === "string" ? b.subject : `Please complete: ${form.name}`;
    const messageTpl = typeof b.message === "string" ? b.message : "Please complete the attached form.";

    const baseUrl = getBaseUrl();
    const results = [];
    for (const r of recipients) {
      if (!r?.email) continue;
      const token = randomBytes(24).toString("hex");
      const link = `${baseUrl}/forms/${form.slug}?t=${token}${r.propertyId ? `&pid=${encodeURIComponent(r.propertyId)}` : ""}`;
      const ctx = {
        formName: form.name,
        submissionData: { name: r.name || "", property_name: r.propertyName || "" },
      };
      const personalizedSubject = replaceFormVariables(subject, ctx);
      const personalizedBody = replaceFormVariables(messageTpl, ctx)
        .replace(/\{\{name\}\}/g, r.name || "")
        .replace(/\{\{property_name\}\}/g, r.propertyName || "")
        .replace(/\{\{link\}\}/g, link);
      const bodyWithLink = personalizedBody.includes(link) ? personalizedBody : `${personalizedBody}\n\n${link}`;

      try {
        await smtp.transport.sendMail({
          from: smtp.from,
          to: r.email,
          subject: personalizedSubject,
          text: bodyWithLink,
        });
        const { rows: dist } = await pool.query(
          `INSERT INTO form_distributions
             (form_id, channel, recipient_email, recipient_name, personal_link, personal_token,
              status, source, source_id, created_by)
           VALUES ($1, 'email', $2, $3, $4, $5, 'sent', $6, $7, $8) RETURNING *`,
          [formId, r.email, r.name || null, link, token, b.source || "manual",
            r.propertyId ? String(r.propertyId) : null, req.user?.id ?? null]
        );
        results.push({ ok: true, distributionId: dist[0].id, email: r.email });
      } catch (err) {
        await pool.query(
          `INSERT INTO form_distributions
             (form_id, channel, recipient_email, recipient_name, personal_link, personal_token,
              status, error_message, source, source_id, created_by)
           VALUES ($1, 'email', $2, $3, $4, $5, 'failed', $6, $7, $8, $9)`,
          [formId, r.email, r.name || null, link, token,
            String(err?.message || err).slice(0, 500),
            b.source || "manual",
            r.propertyId ? String(r.propertyId) : null,
            req.user?.id ?? null]
        ).catch(() => {});
        results.push({ ok: false, email: r.email, error: String(err?.message || err) });
      }
    }
    res.json({ results });
  } catch (e) {
    console.error("[distribute]", e);
    res.status(500).json({ error: "Distribution failed." });
  }
}

export async function postDistributeBulk(req, res) {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(formId)) return res.status(400).json({ error: "Invalid form id." });
  const source = typeof req.body?.source === "string" ? req.body.source : "";
  const customEmails = Array.isArray(req.body?.customEmails) ? req.body.customEmails : [];
  try {
    const pool = getPool();
    let recipients = [];
    if (source === "all_owners") {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (appfolio_data->>'OwnerEmail')
            appfolio_data->>'OwnerEmail' AS email,
            appfolio_data->>'OwnerName' AS name
         FROM cached_owners
         WHERE appfolio_data->>'OwnerEmail' IS NOT NULL
           AND appfolio_data->>'OwnerEmail' <> ''`
      ).catch(() => ({ rows: [] }));
      recipients = rows.map((r) => ({ email: r.email, name: r.name }));
    } else if (source === "all_tenants") {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (appfolio_data->>'TenantEmail')
            appfolio_data->>'TenantEmail' AS email,
            appfolio_data->>'TenantName' AS name,
            appfolio_data->>'PropertyName' AS property_name
         FROM cached_rent_roll
         WHERE appfolio_data->>'TenantEmail' IS NOT NULL
           AND appfolio_data->>'TenantEmail' <> ''
           AND LOWER(COALESCE(appfolio_data->>'Status', 'current')) = 'current'`
      ).catch(() => ({ rows: [] }));
      recipients = rows.map((r) => ({ email: r.email, name: r.name, propertyName: r.property_name }));
    } else if (source === "custom_list") {
      recipients = customEmails
        .map((e) => (typeof e === "string" ? { email: e.trim() } : null))
        .filter((r) => r && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
    } else {
      return res.status(400).json({ error: "Unsupported source." });
    }
    if (!recipients.length) return res.json({ sent: 0, results: [] });
    req.body = { ...req.body, channel: "email", recipients, source };
    return postDistribute(req, res);
  } catch (e) {
    console.error("[distribute bulk]", e);
    res.status(500).json({ error: "Bulk distribution failed." });
  }
}

export async function getDistributionHistory(req, res) {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(formId)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM form_distributions WHERE form_id = $1 ORDER BY sent_at DESC LIMIT 500`,
      [formId]
    );
    const sent = rows.filter((r) => r.status === "sent").length;
    const opened = rows.filter((r) => r.opened_at).length;
    const submitted = rows.filter((r) => r.submission_id).length;
    res.json({
      distributions: rows,
      stats: { total: rows.length, sent, opened, submitted },
    });
  } catch (e) {
    console.error("[distribution history]", e);
    res.status(500).json({ error: "Could not load history." });
  }
}

/** Public: mark distribution link as opened */
export async function getDistributionOpen(req, res) {
  const token = typeof req.params.token === "string" ? req.params.token : "";
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE form_distributions SET opened_at = COALESCE(opened_at, NOW()) WHERE personal_token = $1`,
      [token]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed." });
  }
}

/** ---------- Document templates ---------- */
function mapDocTemplate(r) {
  return {
    id: r.id,
    formId: r.form_id,
    name: r.name,
    description: r.description,
    templateType: r.template_type,
    templateContent: r.template_content,
    templateConfig: r.template_config || {},
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getDocTemplates(req, res) {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(formId)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM form_document_templates WHERE form_id = $1 AND is_active = true ORDER BY id ASC`,
      [formId]
    );
    res.json({ templates: rows.map(mapDocTemplate) });
  } catch (e) {
    console.error("[doc templates list]", e);
    res.status(500).json({ error: "Could not load templates." });
  }
}

export async function postDocTemplate(req, res) {
  const formId = Number.parseInt(req.params.id, 10);
  const b = req.body || {};
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!Number.isFinite(formId) || !name) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO form_document_templates (form_id, name, description, template_type, template_content, template_config)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [formId, name, b.description || null, b.templateType || "pdf",
        typeof b.templateContent === "string" ? b.templateContent : "",
        b.templateConfig && typeof b.templateConfig === "object" ? b.templateConfig : {}]
    );
    res.status(201).json({ template: mapDocTemplate(rows[0]) });
  } catch (e) {
    console.error("[doc template create]", e);
    res.status(500).json({ error: "Could not create template." });
  }
}

export async function putDocTemplate(req, res) {
  const id = Number.parseInt(req.params.templateId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof b.name === "string") { sets.push(`name = $${n++}`); vals.push(b.name.trim()); }
  if (typeof b.description === "string") { sets.push(`description = $${n++}`); vals.push(b.description || null); }
  if (typeof b.templateContent === "string") { sets.push(`template_content = $${n++}`); vals.push(b.templateContent); }
  if (b.templateConfig && typeof b.templateConfig === "object") { sets.push(`template_config = $${n++}`); vals.push(b.templateConfig); }
  if (typeof b.isActive === "boolean") { sets.push(`is_active = $${n++}`); vals.push(b.isActive); }
  if (!sets.length) return res.status(400).json({ error: "No fields to update." });
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE form_document_templates SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Template not found." });
    res.json({ template: mapDocTemplate(rows[0]) });
  } catch (e) {
    console.error("[doc template update]", e);
    res.status(500).json({ error: "Could not update." });
  }
}

export async function deleteDocTemplate(req, res) {
  const id = Number.parseInt(req.params.templateId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    await pool.query(`UPDATE form_document_templates SET is_active = false WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[doc template delete]", e);
    res.status(500).json({ error: "Could not delete." });
  }
}

export async function postGenerateDocument(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const templateId = Number.parseInt(req.params.templateId, 10);
  if (!Number.isFinite(submissionId) || !Number.isFinite(templateId)) {
    return res.status(400).json({ error: "Invalid ids." });
  }
  try {
    const pool = getPool();
    const { rows: tRows } = await pool.query(
      `SELECT * FROM form_document_templates WHERE id = $1`, [templateId]
    );
    if (!tRows.length) return res.status(404).json({ error: "Template not found." });
    const template = tRows[0];
    const { rows: sRows } = await pool.query(
      `SELECT * FROM form_submissions WHERE id = $1`, [submissionId]
    );
    if (!sRows.length) return res.status(404).json({ error: "Submission not found." });
    const submission = sRows[0];
    const { rows: fRows } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [submission.form_id]);
    if (!fRows.length) return res.status(404).json({ error: "Form not found." });
    const form = fRows[0];
    const { rows: fieldRows } = await pool.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`, [form.id]
    );
    const result = await renderDocumentTemplatePdf({
      template, form, submission, fields: fieldRows,
      submissionData: submission.submission_data || {},
      user: req.user,
    });
    const relPath = path.relative(
      path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "uploads", "forms"),
      result.filePath
    );
    const { rows: genRows } = await pool.query(
      `INSERT INTO form_generated_documents (template_id, submission_id, filename, file_path, generated_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [templateId, submissionId, result.fileName, relPath, req.user?.id ?? null]
    );
    res.json({ document: genRows[0] });
  } catch (e) {
    console.error("[generate document]", e);
    res.status(500).json({ error: "Could not generate document." });
  }
}

export async function getGeneratedDocuments(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT g.*, t.name AS template_name FROM form_generated_documents g
       LEFT JOIN form_document_templates t ON t.id = g.template_id
       WHERE g.submission_id = $1 ORDER BY g.generated_at DESC`,
      [submissionId]
    );
    res.json({ documents: rows });
  } catch (e) {
    console.error("[gen docs list]", e);
    res.status(500).json({ error: "Could not load documents." });
  }
}

export async function getDocumentDownload(req, res) {
  const docId = Number.parseInt(req.params.documentId, 10);
  if (!Number.isFinite(docId)) return res.status(400).send("Invalid.");
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM form_generated_documents WHERE id = $1`, [docId]);
    if (!rows.length) return res.status(404).send("Not found.");
    const doc = rows[0];
    const full = path.resolve(
      path.dirname(new URL(import.meta.url).pathname), "..", "uploads", "forms", doc.file_path
    );
    const st = statSync(full);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    res.setHeader("Content-Length", st.size);
    createReadStream(full).pipe(res);
  } catch (e) {
    console.error("[doc download]", e);
    res.status(500).send("Failed.");
  }
}

/** ---------- Notes / tags / assign / priority / star ---------- */
export async function postSubmissionNote(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (!Number.isFinite(submissionId) || !note) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO form_submission_notes (submission_id, user_id, note) VALUES ($1, $2, $3) RETURNING *`,
      [submissionId, req.user?.id ?? null, note]
    );
    res.status(201).json({ note: rows[0] });
  } catch (e) {
    console.error("[sub note create]", e);
    res.status(500).json({ error: "Could not add note." });
  }
}

export async function getSubmissionNotes(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT n.*, u.display_name AS user_name FROM form_submission_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.submission_id = $1 ORDER BY n.created_at DESC`,
      [submissionId]
    );
    res.json({ notes: rows });
  } catch (e) {
    console.error("[sub notes list]", e);
    res.status(500).json({ error: "Could not load notes." });
  }
}

export async function deleteSubmissionNote(req, res) {
  const noteId = Number.parseInt(req.params.noteId, 10);
  if (!Number.isFinite(noteId)) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `DELETE FROM form_submission_notes WHERE id = $1 AND user_id = $2 RETURNING id`,
      [noteId, req.user?.id ?? -1]
    );
    if (!rows.length) return res.status(404).json({ error: "Note not found or not yours." });
    res.json({ ok: true });
  } catch (e) {
    console.error("[sub note delete]", e);
    res.status(500).json({ error: "Could not delete note." });
  }
}

export async function putAssignSubmission(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const userId = req.body?.userId === null
    ? null
    : Number.isFinite(Number.parseInt(req.body?.userId, 10))
      ? Number.parseInt(req.body.userId, 10) : undefined;
  if (!Number.isFinite(submissionId) || userId === undefined) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    await pool.query(`UPDATE form_submissions SET assigned_to = $1 WHERE id = $2`, [userId, submissionId]);
    if (userId) {
      await pool.query(
        `INSERT INTO notifications (user_id, message, link)
         VALUES ($1, 'A form submission was assigned to you.', $2)`,
        [userId, `/forms/submissions/${submissionId}`]
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[assign]", e);
    res.status(500).json({ error: "Could not assign." });
  }
}

export async function putSubmissionPriority(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const priority = typeof req.body?.priority === "string" ? req.body.priority : "";
  if (!Number.isFinite(submissionId) || !["low", "normal", "high", "urgent"].includes(priority)) {
    return res.status(400).json({ error: "Invalid priority." });
  }
  try {
    const pool = getPool();
    await pool.query(`UPDATE form_submissions SET priority = $1 WHERE id = $2`, [priority, submissionId]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[priority]", e);
    res.status(500).json({ error: "Could not update priority." });
  }
}

export async function putSubmissionStar(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE form_submissions SET is_starred = NOT COALESCE(is_starred, false) WHERE id = $1 RETURNING is_starred`,
      [submissionId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ isStarred: rows[0].is_starred });
  } catch (e) {
    console.error("[star]", e);
    res.status(500).json({ error: "Could not toggle star." });
  }
}

export async function postSubmissionTag(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const tag = typeof req.body?.tag === "string" ? req.body.tag.trim().slice(0, 100) : "";
  if (!Number.isFinite(submissionId) || !tag) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO form_submission_tags (submission_id, tag) VALUES ($1, $2)
       ON CONFLICT (submission_id, tag) DO NOTHING RETURNING *`,
      [submissionId, tag]
    );
    res.status(201).json({ tag: rows[0] || { submission_id: submissionId, tag } });
  } catch (e) {
    console.error("[tag add]", e);
    res.status(500).json({ error: "Could not add tag." });
  }
}

export async function deleteSubmissionTag(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const tag = typeof req.params.tag === "string" ? req.params.tag : "";
  if (!Number.isFinite(submissionId) || !tag) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM form_submission_tags WHERE submission_id = $1 AND tag = $2`, [submissionId, tag]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[tag delete]", e);
    res.status(500).json({ error: "Could not delete tag." });
  }
}

export async function getSubmissionTags(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT tag FROM form_submission_tags WHERE submission_id = $1 ORDER BY tag`, [submissionId]
    );
    res.json({ tags: rows.map((r) => r.tag) });
  } catch (e) {
    res.status(500).json({ error: "Could not load tags." });
  }
}

/** ---------- Export / import JSON ---------- */
export async function getFormExport(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid." });
  try {
    const pool = getPool();
    const { rows: formRows } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [id]);
    if (!formRows.length) return res.status(404).json({ error: "Form not found." });
    const form = formRows[0];
    const { rows: pages } = await pool.query(
      `SELECT * FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`, [id]
    );
    const { rows: fields } = await pool.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`, [id]
    );
    const { rows: automations } = await pool.query(
      `SELECT * FROM form_automations WHERE form_id = $1 ORDER BY sort_order ASC`, [id]
    );
    const { rows: docTemplates } = await pool.query(
      `SELECT * FROM form_document_templates WHERE form_id = $1 AND is_active = true`, [id]
    );
    const payload = {
      rpmPrestigeExport: 1,
      exportedAt: new Date().toISOString(),
      form: {
        name: form.name,
        description: form.description,
        category: form.category,
        isMultiStep: form.is_multi_step,
        settings: form.settings,
        branding: form.branding,
        submitButtonText: form.submit_button_text,
        successMessage: form.success_message,
        successRedirectUrl: form.success_redirect_url,
      },
      pages: pages.map((p) => ({
        title: p.title, description: p.description, pageOrder: p.page_order,
        isVisible: p.is_visible, visibilityConditions: p.visibility_conditions,
      })),
      fields: fields.map((f) => ({
        pageOrder: pages.find((p) => p.id === f.page_id)?.page_order ?? null,
        fieldKey: f.field_key, fieldType: f.field_type, label: f.label,
        description: f.description, placeholder: f.placeholder, helpText: f.help_text,
        isRequired: f.is_required, isHidden: f.is_hidden, defaultValue: f.default_value,
        validation: f.validation, fieldConfig: f.field_config,
        conditionalLogic: f.conditional_logic, preFillConfig: f.pre_fill_config,
        layout: f.layout, sortOrder: f.sort_order,
      })),
      automations: automations.map((a) => ({
        name: a.name, triggerType: a.trigger_type, actionType: a.action_type,
        actionConfig: a.action_config, isActive: a.is_active, sortOrder: a.sort_order,
      })),
      documentTemplates: docTemplates.map((t) => ({
        name: t.name, description: t.description, templateType: t.template_type,
        templateContent: t.template_content, templateConfig: t.template_config,
      })),
    };
    const safeName = (form.name || "form").replace(/[^\w]+/g, "_");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_export.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error("[export json]", e);
    res.status(500).json({ error: "Export failed." });
  }
}

export async function postFormImport(req, res) {
  const payload = req.body;
  if (!payload || typeof payload !== "object" || payload.rpmPrestigeExport !== 1) {
    return res.status(400).json({ error: "Invalid export format." });
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const f = payload.form || {};
    const name = (typeof f.name === "string" && f.name.trim()) || "Imported form";
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imported-form";
    let slug = baseSlug;
    for (let i = 0; ; i++) {
      const s = i === 0 ? baseSlug : `${baseSlug}-${i}`;
      const { rows } = await client.query(`SELECT 1 FROM forms WHERE slug = $1`, [s]);
      if (!rows.length) { slug = s; break; }
    }
    const token = randomBytes(24).toString("hex");
    const { rows: formRows } = await client.query(
      `INSERT INTO forms (name, description, category, status, is_multi_step, settings, branding,
                          access_type, access_token, slug, submit_button_text, success_message,
                          success_redirect_url, is_active, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, 'public', $7, $8, $9, $10, $11, true, $12)
       RETURNING *`,
      [
        name, f.description || null, f.category || null, !!f.isMultiStep,
        f.settings || {}, f.branding || {}, token, slug,
        f.submitButtonText || "Submit",
        f.successMessage || "Thank you! Your submission has been received.",
        f.successRedirectUrl || null, req.user?.id ?? null,
      ]
    );
    const formId = formRows[0].id;

    const pages = Array.isArray(payload.pages) ? payload.pages : [];
    const pageIdByOrder = new Map();
    for (const p of pages) {
      const { rows: np } = await client.query(
        `INSERT INTO form_pages (form_id, title, description, page_order, is_visible, visibility_conditions)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, page_order`,
        [formId, p.title || null, p.description || null, p.pageOrder || 0,
          p.isVisible !== false, p.visibilityConditions || null]
      );
      pageIdByOrder.set(np[0].page_order, np[0].id);
    }
    if (!pages.length) {
      const { rows: np } = await client.query(
        `INSERT INTO form_pages (form_id, title, page_order) VALUES ($1, 'Page 1', 0) RETURNING id`,
        [formId]
      );
      pageIdByOrder.set(0, np[0].id);
    }

    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    for (const fd of fields) {
      const pageId = pageIdByOrder.get(fd.pageOrder ?? 0) ?? pageIdByOrder.values().next().value ?? null;
      await client.query(
        `INSERT INTO form_fields (
           form_id, page_id, field_key, field_type, label, description, placeholder, help_text,
           is_required, is_hidden, default_value, validation, field_config, conditional_logic,
           pre_fill_config, layout, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          formId, pageId, fd.fieldKey, fd.fieldType, fd.label,
          fd.description || null, fd.placeholder || null, fd.helpText || null,
          !!fd.isRequired, !!fd.isHidden, fd.defaultValue || null,
          fd.validation || {}, fd.fieldConfig || {}, fd.conditionalLogic || null,
          fd.preFillConfig || null, fd.layout || { width: "full" }, fd.sortOrder || 0,
        ]
      );
    }

    for (const a of (payload.automations || [])) {
      await client.query(
        `INSERT INTO form_automations (form_id, name, trigger_type, action_type, action_config, is_active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [formId, a.name || a.actionType, a.triggerType || "on_submit", a.actionType,
          a.actionConfig || {}, a.isActive !== false, a.sortOrder || 0]
      );
    }
    for (const t of (payload.documentTemplates || [])) {
      await client.query(
        `INSERT INTO form_document_templates (form_id, name, description, template_type, template_content, template_config)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [formId, t.name, t.description || null, t.templateType || "pdf",
          t.templateContent || "", t.templateConfig || {}]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ formId });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[import json]", e);
    res.status(500).json({ error: "Import failed." });
  } finally {
    client.release();
  }
}

/** ---------- Sidebar badge ---------- */
export async function getFormsBadge(req, res) {
  try {
    const pool = getPool();
    const { rows: sub } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM form_submissions WHERE status = 'submitted'`
    );
    const userId = req.user?.id ?? -1;
    const { rows: myApprovals } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM form_submission_approvals
       WHERE approver_user_id = $1 AND status = 'pending'`,
      [userId]
    );
    res.json({
      unreviewedSubmissions: sub[0].c,
      pendingApprovals: myApprovals[0].c,
    });
  } catch (e) {
    res.json({ unreviewedSubmissions: 0, pendingApprovals: 0 });
  }
}

/** Embed.js (public, no auth) */
export function getEmbedJs(_req, res) {
  const base = getBaseUrl();
  const js = `(function(){
  var BASE = ${JSON.stringify(base)};
  function buildUrl(slug, extras){
    var u = BASE + "/forms/" + encodeURIComponent(slug) + "?embed=true";
    if (extras) for (var k in extras) u += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(extras[k]);
    return u;
  }
  function listenResize(iframe){
    window.addEventListener("message", function(e){
      if (!e.data || e.data.event !== "rpm-form-resize") return;
      if (e.data.iframeId && e.data.iframeId !== iframe.id) return;
      iframe.style.height = (e.data.height + 20) + "px";
    });
  }
  var RPMForms = {
    render: function(slug, selector, opts){
      var target = typeof selector === "string" ? document.querySelector(selector) : selector;
      if (!target) return;
      var iframe = document.createElement("iframe");
      iframe.id = "rpm-form-iframe-" + Math.random().toString(36).slice(2);
      iframe.src = buildUrl(slug, opts && opts.params);
      iframe.style.width = "100%";
      iframe.style.maxWidth = (opts && opts.maxWidth) || "720px";
      iframe.style.height = (opts && opts.height) || "800px";
      iframe.style.border = "none";
      iframe.style.display = "block";
      iframe.style.margin = "0 auto";
      iframe.frameBorder = "0";
      listenResize(iframe);
      target.innerHTML = "";
      target.appendChild(iframe);
      return iframe;
    },
    open: function(slug, opts){
      var overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(27,40,86,0.6);z-index:2147483647;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow:auto";
      var box = document.createElement("div");
      box.style.cssText = "background:#fff;border-radius:12px;max-width:760px;width:100%;position:relative;box-shadow:0 12px 40px rgba(0,0,0,0.25);max-height:calc(100vh - 48px);overflow:auto";
      var close = document.createElement("button");
      close.textContent = "×";
      close.setAttribute("aria-label", "Close");
      close.style.cssText = "position:absolute;top:8px;right:12px;background:transparent;border:none;font-size:24px;cursor:pointer;color:#1b2856;z-index:2";
      close.onclick = function(){ document.body.removeChild(overlay); };
      overlay.appendChild(box);
      overlay.appendChild(close);
      document.body.appendChild(overlay);
      RPMForms.render(slug, box, opts);
      window.addEventListener("message", function onMsg(e){
        if (e.data && e.data.event === "rpm-form-submitted") {
          setTimeout(function(){ if (overlay.parentNode) document.body.removeChild(overlay); window.removeEventListener("message", onMsg); }, 2000);
        }
      });
    },
  };
  window.RPMForms = RPMForms;
})();`;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(js);
}
