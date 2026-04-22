import nodemailer from "nodemailer";
import { getPool } from "./db.js";
import { generateSubmissionPdf } from "./form-pdf.js";

export const FORM_TRIGGER_TYPES = new Set(["on_submit", "on_field_value", "on_submission_count"]);

export const FORM_ACTION_TYPES = new Set([
  "send_notification",
  "send_email",
  "create_task",
  "launch_process",
  "webhook",
  "create_project",
  "generate_pdf",
  "send_confirmation",
  "assign_to_team",
]);

function getEmailSender() {
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

export function replaceFormVariables(text, context) {
  if (typeof text !== "string") return text;
  return text.replace(/\{\{([^}]+)\}\}/g, (_m, key) => {
    const k = String(key).trim();
    if (k.startsWith("field:")) {
      const fieldKey = k.slice(6).trim();
      const v = context.submissionData?.[fieldKey];
      if (v == null) return "";
      if (typeof v === "object") {
        if (Array.isArray(v)) return v.join(", ");
        // address / fullname
        return Object.values(v).filter(Boolean).join(" ");
      }
      return String(v);
    }
    if (k === "form_name") return context.formName || "";
    if (k === "submission_id") return String(context.submissionId ?? "");
    if (k === "contact_name") return context.contactName || "";
    if (k === "contact_email") return context.contactEmail || "";
    if (k === "date") return new Date().toLocaleDateString();
    if (k === "datetime") return new Date().toLocaleString();
    return "";
  });
}

function replaceDeep(value, ctx) {
  if (typeof value === "string") return replaceFormVariables(value, ctx);
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, ctx));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceDeep(v, ctx);
    return out;
  }
  return value;
}

function evaluateTrigger(automation, context, submissionCount) {
  const triggerType = automation.trigger_type || "on_submit";
  if (triggerType === "on_submit") return true;
  const cfg = automation.action_config?.trigger || {};
  if (triggerType === "on_field_value") {
    const actual = context.submissionData?.[cfg.fieldKey];
    const strActual = actual == null ? "" : String(actual);
    const strValue = cfg.value == null ? "" : String(cfg.value);
    switch (cfg.operator) {
      case "equals": return strActual === strValue;
      case "not_equals": return strActual !== strValue;
      case "contains": return strActual.toLowerCase().includes(strValue.toLowerCase());
      case "is_empty": return !strActual;
      case "is_not_empty": return !!strActual;
      default: return false;
    }
  }
  if (triggerType === "on_submission_count") {
    const threshold = Number(cfg.count) || 0;
    return submissionCount === threshold;
  }
  return false;
}

async function logAutomation(pool, automation, form, submission, result, details) {
  try {
    await pool.query(
      `INSERT INTO form_automation_log (automation_id, form_id, submission_id, action_type, result, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [automation.id, form.id, submission?.id ?? null, automation.action_type, result, details]
    );
  } catch {/* ignore */}
}

async function runSendNotification(pool, config, ctx) {
  const userIds = Array.isArray(config.userIds) ? config.userIds : [];
  const message = replaceFormVariables(config.message || `New submission for ${ctx.formName}`, ctx);
  const link = `/forms/${ctx.formId}/submissions`;
  for (const uid of userIds) {
    const n = Number.parseInt(uid, 10);
    if (!Number.isFinite(n)) continue;
    await pool.query(
      `INSERT INTO notifications (user_id, message, link) VALUES ($1, $2, $3)`,
      [n, message, link]
    ).catch(() => {});
  }
  return { userCount: userIds.length };
}

async function runSendEmail(pool, config, ctx, submission) {
  const sender = getEmailSender();
  if (!sender) return { sent: false, reason: "SMTP not configured" };
  let to = config.toAddress ? replaceFormVariables(config.toAddress, ctx).trim() : "";
  if (!to && config.toField) {
    const v = ctx.submissionData?.[config.toField];
    if (typeof v === "string") to = v.trim();
  }
  if (!to) return { sent: false, reason: "no recipient" };
  const subject = replaceFormVariables(config.subject || `New submission: ${ctx.formName}`, ctx);
  const body = replaceFormVariables(config.body || "See attached submission details.", ctx);
  const attachments = [];
  if (config.includeSubmissionPdf && submission) {
    try {
      const pdf = await generateSubmissionPdf(submission.id);
      if (pdf?.filePath) attachments.push({ filename: pdf.fileName, path: pdf.filePath });
    } catch {/* ignore */}
  }
  await sender.transport.sendMail({
    from: sender.from,
    to,
    cc: config.cc ? replaceFormVariables(config.cc, ctx) : undefined,
    replyTo: config.replyTo ? replaceFormVariables(config.replyTo, ctx) : undefined,
    subject,
    text: body,
    attachments,
  });
  return { sent: true, to };
}

async function runSendConfirmation(pool, config, ctx) {
  const sender = getEmailSender();
  if (!sender) return { sent: false, reason: "SMTP not configured" };
  const to = (ctx.submissionData?.[config.emailField] || ctx.contactEmail || "").trim();
  if (!to) return { sent: false, reason: "no submitter email" };
  const subject = replaceFormVariables(config.subject || "Thank you for your submission", ctx);
  let body = replaceFormVariables(
    config.body || "We received your {{form_name}} submission. We'll be in touch shortly.",
    ctx
  );
  if (config.includeSubmissionSummary) {
    const lines = ["", "Your submission:"];
    for (const [k, v] of Object.entries(ctx.submissionData || {})) {
      const strV = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
      lines.push(`  ${k}: ${strV}`);
    }
    body += `\n\n${lines.join("\n")}`;
  }
  await sender.transport.sendMail({ from: sender.from, to, subject, text: body });
  return { sent: true, to };
}

async function runCreateTask(pool, config, ctx) {
  const title = replaceFormVariables(config.title || `Review ${ctx.formName} submission`, ctx);
  const description = config.description ? replaceFormVariables(config.description, ctx) : null;
  const assignedUserId = Number.isFinite(Number.parseInt(config.assignedUserId, 10))
    ? Number.parseInt(config.assignedUserId, 10) : null;
  const priority = typeof config.priority === "string" ? config.priority : "normal";
  const category = typeof config.category === "string" ? config.category : null;
  const days = Number.parseInt(config.dueDaysFromSubmit, 10);
  const dueDate = Number.isFinite(days) && days > 0
    ? new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10)
    : null;
  const projectId = Number.isFinite(Number.parseInt(config.projectId, 10))
    ? Number.parseInt(config.projectId, 10) : null;
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, description, status, priority, assigned_user_id, category, contact_name, due_date, project_id)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8) RETURNING id`,
    [title, description, priority, assignedUserId, category, ctx.contactName, dueDate, projectId]
  );
  return { taskId: rows[0].id };
}

async function runLaunchProcess(pool, config, ctx) {
  const templateId = Number.parseInt(config.templateId, 10);
  if (!Number.isFinite(templateId)) return { launched: false, reason: "invalid templateId" };
  const name = replaceFormVariables(
    config.name || `${ctx.formName}: ${ctx.contactName || "New"}`,
    ctx
  );
  const contactName = config.contactNameField
    ? (ctx.submissionData?.[config.contactNameField] || ctx.contactName)
    : ctx.contactName;
  const contactEmail = config.contactEmailField
    ? (ctx.submissionData?.[config.contactEmailField] || ctx.contactEmail)
    : ctx.contactEmail;
  const contactPhone = config.contactPhoneField
    ? ctx.submissionData?.[config.contactPhoneField]
    : null;
  const propertyName = config.propertyNameField
    ? ctx.submissionData?.[config.propertyNameField]
    : null;
  const { rows } = await pool.query(
    `INSERT INTO processes (template_id, name, property_name, contact_name, contact_email, contact_phone)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [templateId, name, propertyName, contactName, contactEmail, contactPhone]
  );
  return { processId: rows[0].id };
}

async function runCreateProject(pool, config, ctx) {
  const name = replaceFormVariables(config.name || `${ctx.formName} project`, ctx);
  const description = config.description ? replaceFormVariables(config.description, ctx) : null;
  const category = typeof config.category === "string" ? config.category : null;
  const ownerUserId = Number.isFinite(Number.parseInt(config.ownerUserId, 10))
    ? Number.parseInt(config.ownerUserId, 10) : null;
  const propertyName = config.propertyNameField
    ? ctx.submissionData?.[config.propertyNameField]
    : null;
  const targetDays = Number.parseInt(config.targetDaysFromSubmit, 10);
  const targetDate = Number.isFinite(targetDays) && targetDays > 0
    ? new Date(Date.now() + targetDays * 86400_000).toISOString().slice(0, 10)
    : null;
  const { rows } = await pool.query(
    `INSERT INTO projects (name, description, category, owner_user_id, property_name, target_date)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, description, category, ownerUserId, propertyName, targetDate]
  );
  return { projectId: rows[0].id };
}

async function runWebhook(pool, config, ctx) {
  const url = replaceFormVariables(config.url || "", ctx);
  if (!url) return { sent: false, reason: "no url" };
  const method = (config.method || "POST").toUpperCase();
  const headers = { "Content-Type": "application/json", ...(config.headers || {}) };
  const payload = config.includeAllFields !== false
    ? { form: ctx.formName, submissionId: ctx.submissionId, data: ctx.submissionData }
    : replaceDeep(config.body || {}, ctx);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    return { sent: true, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function runGeneratePdf(pool, config, ctx, submission) {
  if (!submission) return { generated: false, reason: "no submission" };
  const pdf = await generateSubmissionPdf(submission.id);
  if (!pdf?.filePath) return { generated: false, reason: "pdf failed" };
  if (config.saveToPropertyFolder) {
    const propertyName = config.propertyNameField
      ? ctx.submissionData?.[config.propertyNameField]
      : submission.property_name;
    if (propertyName) {
      // Try to find a matching file_folder
      try {
        const { rows: folderRows } = await pool.query(
          `SELECT id FROM file_folders WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [propertyName]
        );
        const folderId = folderRows[0]?.id ?? null;
        // Insert into files table (schema: name, filename, folder_id, size, created_by)
        await pool.query(
          `INSERT INTO files (name, filename, folder_id, size, description, property_name)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [pdf.fileName, pdf.fileName, folderId, pdf.size || null, `${ctx.formName} submission`, propertyName]
        ).catch(() => {});
      } catch {/* ignore — files schema may differ */}
    }
  }
  return { generated: true, filename: pdf.fileName };
}

async function runAssignToTeam(pool, config, ctx, submission) {
  let assigneeId = Number.isFinite(Number.parseInt(config.assigneeUserId, 10))
    ? Number.parseInt(config.assigneeUserId, 10) : null;
  if (!assigneeId && config.roundRobin && Array.isArray(config.roundRobinUserIds) && config.roundRobinUserIds.length) {
    // Use submission count mod list length to rotate
    const idx = (ctx.submissionCount || 0) % config.roundRobinUserIds.length;
    assigneeId = Number.parseInt(config.roundRobinUserIds[idx], 10);
  }
  if (!assigneeId && config.assigneeRole) {
    const { rows: userRows } = await pool.query(
      `SELECT id FROM users WHERE role = $1 ORDER BY id LIMIT 1`, [config.assigneeRole]
    );
    assigneeId = userRows[0]?.id ?? null;
  }
  if (!assigneeId) return { assigned: false, reason: "no assignee" };
  await pool.query(
    `INSERT INTO notifications (user_id, message, link)
     VALUES ($1, $2, $3)`,
    [assigneeId, `You've been assigned a new ${ctx.formName} submission for review.`,
     `/forms/${ctx.formId}/submissions`]
  );
  if (submission) {
    await pool.query(
      `UPDATE form_submissions SET reviewed_by = $1 WHERE id = $2 AND reviewed_by IS NULL`,
      [assigneeId, submission.id]
    ).catch(() => {});
  }
  return { assigned: true, assigneeId };
}

export async function executeFormAutomations(formId, submissionId, submissionData) {
  const pool = getPool();
  const { rows: formRows } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [formId]);
  if (!formRows.length) return [];
  const form = formRows[0];
  const { rows: submissionRows } = await pool.query(`SELECT * FROM form_submissions WHERE id = $1`, [submissionId]);
  const submission = submissionRows[0] || null;
  const { rows: autos } = await pool.query(
    `SELECT * FROM form_automations WHERE form_id = $1 AND is_active = true ORDER BY sort_order ASC`,
    [formId]
  );
  const ctx = {
    formId,
    formName: form.name,
    submissionId,
    submissionData: submissionData || submission?.submission_data || {},
    contactName: submission?.contact_name,
    contactEmail: submission?.contact_email,
    submissionCount: form.submissions_count,
  };
  const results = [];
  for (const automation of autos) {
    const config = automation.action_config || {};
    try {
      if (!evaluateTrigger(automation, ctx, form.submissions_count)) {
        continue;
      }
      let result;
      switch (automation.action_type) {
        case "send_notification": result = await runSendNotification(pool, config, ctx); break;
        case "send_email": result = await runSendEmail(pool, config, ctx, submission); break;
        case "send_confirmation": result = await runSendConfirmation(pool, config, ctx); break;
        case "create_task": result = await runCreateTask(pool, config, ctx); break;
        case "launch_process": result = await runLaunchProcess(pool, config, ctx); break;
        case "create_project": result = await runCreateProject(pool, config, ctx); break;
        case "webhook": result = await runWebhook(pool, config, ctx); break;
        case "generate_pdf": result = await runGeneratePdf(pool, config, ctx, submission); break;
        case "assign_to_team": result = await runAssignToTeam(pool, config, ctx, submission); break;
        default: result = { skipped: true, reason: "unknown action_type" };
      }
      await logAutomation(pool, automation, form, submission, "success", result);
      results.push({ automationId: automation.id, ok: true, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logAutomation(pool, automation, form, submission, "error", { error: msg });
      results.push({ automationId: automation.id, ok: false, error: msg });
    }
  }
  return results;
}

export async function testAutomation(automation, sampleData = {}) {
  const ctx = {
    formId: 0,
    formName: "Test Form",
    submissionId: 0,
    submissionData: sampleData,
    contactName: "Test Contact",
    contactEmail: "test@example.com",
    submissionCount: 1,
  };
  const config = automation.actionConfig || automation.action_config || {};
  const resolved = {};
  for (const [k, v] of Object.entries(config)) {
    resolved[k] = replaceDeep(v, ctx);
  }
  return { dryRun: true, actionType: automation.actionType || automation.action_type, resolvedConfig: resolved };
}
