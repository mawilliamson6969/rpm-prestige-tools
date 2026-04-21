import nodemailer from "nodemailer";
import { getPool } from "./db.js";

const SYSTEM_USER_ID = null; // Comments logged with user_id=NULL indicate system/automation.

function buildSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export function replaceTemplateVars(text, processRow) {
  if (typeof text !== "string" || !text) return text;
  const p = processRow || {};
  const started = p.started_at ? new Date(p.started_at).toISOString().slice(0, 10) : "";
  const target = p.target_completion
    ? new Date(p.target_completion).toISOString().slice(0, 10)
    : "";
  return text
    .replace(/\{\{contact_name\}\}/g, p.contact_name || "")
    .replace(/\{\{contact_email\}\}/g, p.contact_email || "")
    .replace(/\{\{contact_phone\}\}/g, p.contact_phone || "")
    .replace(/\{\{property_name\}\}/g, p.property_name || "")
    .replace(/\{\{process_name\}\}/g, p.name || "")
    .replace(/\{\{process_id\}\}/g, p.id != null ? String(p.id) : "")
    .replace(/\{\{started_at\}\}/g, started)
    .replace(/\{\{target_completion\}\}/g, target);
}

function replaceDeep(value, processRow) {
  if (typeof value === "string") return replaceTemplateVars(value, processRow);
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, processRow));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceDeep(v, processRow);
    return out;
  }
  return value;
}

async function logSystemComment(stepId, comment) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO task_comments (process_step_id, user_id, comment) VALUES ($1, NULL, $2)`,
      [stepId, `[automation] ${comment}`]
    );
  } catch (err) {
    console.warn("[automation] log comment failed:", err.message);
  }
}

async function autoCompleteStep(step) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE process_steps
       SET status = 'completed', completed_at = NOW(), completed_by = NULL, updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('completed','skipped')
       RETURNING *`,
      [step.id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return [];
    }
    const completed = rows[0];
    const { rows: unblocked } = await client.query(
      `UPDATE process_steps SET status = 'pending', updated_at = NOW()
       WHERE depends_on_step_id = $1 AND status = 'blocked'
       RETURNING id`,
      [completed.id]
    );
    const { rows: remaining } = await client.query(
      `SELECT COUNT(*)::int AS c FROM process_steps
       WHERE process_id = $1 AND status NOT IN ('completed','skipped')`,
      [completed.process_id]
    );
    if (remaining[0].c === 0) {
      await client.query(
        `UPDATE processes SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [completed.process_id]
      );
    }
    await client.query("COMMIT");
    return unblocked.map((r) => r.id);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function markAutomationStatus(stepId, status, error = null) {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE process_steps SET automation_status = $1, automation_error = $2, updated_at = NOW() WHERE id = $3`,
      [status, error, stepId]
    );
  } catch (err) {
    console.warn("[automation] status update failed:", err.message);
  }
}

const AUTO_ACTIONS = {
  async send_email(config, processRow, step) {
    const to = replaceTemplateVars(config.to, processRow);
    const subject = replaceTemplateVars(config.subject, processRow);
    const body = replaceTemplateVars(config.body ?? config.template ?? "", processRow);
    const cc = replaceTemplateVars(config.cc || "", processRow);
    const bcc = replaceTemplateVars(config.bcc || "", processRow);
    if (!to) throw new Error("send_email: recipient (to) is required.");
    const from = process.env.SMTP_FROM;
    const transport = buildSmtpTransport();
    if (!transport || !from) {
      throw new Error("SMTP not configured (set SMTP_HOST/SMTP_USER/SMTP_FROM).");
    }
    const info = await transport.sendMail({
      from,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject: subject || `Update on ${processRow.name || "your process"}`,
      html: body.includes("<") ? body : `<p>${body.replace(/\n/g, "<br>")}</p>`,
      text: body.replace(/<[^>]+>/g, ""),
    });
    await logSystemComment(step.id, `Email sent to ${to} (${info.messageId || "ok"})`);
    return { summary: `Email sent to ${to}` };
  },

  async notify(config, processRow, step) {
    const pool = getPool();
    const message = replaceTemplateVars(config.message || "", processRow);
    const link = replaceTemplateVars(config.link || `/operations/processes/${processRow.id}`, processRow);
    const userIds = [];
    if (config.notify_user_id) {
      const uid = Number(config.notify_user_id);
      if (Number.isFinite(uid)) userIds.push(uid);
    }
    if (config.notify_role) {
      userIds.push(...(await resolveUsersByRole(config.notify_role)));
    }
    if (!userIds.length) {
      throw new Error("notify: must specify notify_user_id or notify_role.");
    }
    for (const uid of userIds) {
      await pool.query(
        `INSERT INTO notifications (user_id, message, link) VALUES ($1, $2, $3)`,
        [uid, message || "You have a new process update.", link]
      );
    }
    await logSystemComment(
      step.id,
      `Notified ${userIds.length} user${userIds.length === 1 ? "" : "s"}`
    );
    return { summary: `Notified ${userIds.length} user(s)` };
  },

  async create_folder(config, processRow, step) {
    const pool = getPool();
    const type = config.folder_type === "owner" ? "owner" : "property";
    const name = replaceTemplateVars(
      config.folder_name || (type === "owner" ? "{{contact_name}}" : "{{property_name}}"),
      processRow
    );
    if (!name.trim()) throw new Error("create_folder: folder_name is required.");
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 200);
    const { rows } = await pool.query(
      `INSERT INTO file_folders (name, slug, folder_type, linked_property_name, linked_owner_name, icon, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       RETURNING id, name`,
      [
        name.trim(),
        slug,
        type === "owner" ? "owner" : "property",
        type === "property" ? name.trim() : null,
        type === "owner" ? name.trim() : null,
        type === "owner" ? "👤" : "🏠",
      ]
    );
    await logSystemComment(step.id, `Created ${type} folder "${rows[0].name}" (#${rows[0].id})`);
    return { summary: `Folder created: ${rows[0].name}` };
  },

  async create_task(config, processRow, step) {
    const pool = getPool();
    const title = replaceTemplateVars(config.title || "Follow up", processRow);
    const description = replaceTemplateVars(config.description || "", processRow);
    const priority = ["urgent", "high", "normal", "low"].includes(config.priority)
      ? config.priority
      : "normal";
    const category = config.category || null;
    let assignedUserId = null;
    if (config.assigned_user_id) {
      const uid = Number(config.assigned_user_id);
      if (Number.isFinite(uid)) assignedUserId = uid;
    } else if (config.assigned_role) {
      const roleUsers = await resolveUsersByRole(config.assigned_role);
      assignedUserId = roleUsers[0] ?? null;
    }
    const dueDays = Number.parseInt(config.due_days_from_now, 10);
    let dueDate = null;
    if (Number.isFinite(dueDays)) {
      const d = new Date();
      d.setDate(d.getDate() + dueDays);
      dueDate = d.toISOString().slice(0, 10);
    }
    const { rows } = await pool.query(
      `INSERT INTO tasks
         (title, description, priority, assigned_user_id, property_name, property_id,
          contact_name, due_date, category, process_step_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, title`,
      [
        title,
        description || null,
        priority,
        assignedUserId,
        processRow.property_name,
        processRow.property_id,
        processRow.contact_name,
        dueDate,
        category,
        step.id,
        `Auto-created by process "${processRow.name}"`,
      ]
    );
    await logSystemComment(step.id, `Task created: "${rows[0].title}" (#${rows[0].id})`);
    return { summary: `Task created: ${rows[0].title}` };
  },

  async auto_complete_delay(config, processRow, step) {
    const pool = getPool();
    const days = Number.parseInt(config.delay_days, 10);
    if (!Number.isFinite(days) || days < 0) {
      throw new Error("auto_complete_delay: delay_days must be a non-negative integer.");
    }
    const due = new Date();
    due.setDate(due.getDate() + days);
    await pool.query(
      `UPDATE process_steps
       SET status = 'in_progress', due_date = $1::date, updated_at = NOW()
       WHERE id = $2`,
      [due.toISOString().slice(0, 10), step.id]
    );
    await logSystemComment(step.id, `Waiting ${days} day(s) — will auto-complete ${due.toISOString().slice(0, 10)}`);
    return { summary: `Scheduled auto-complete in ${days}d`, skipAutoComplete: true };
  },

  async webhook(config, processRow, step) {
    const url = replaceTemplateVars(config.url, processRow);
    if (!url || !/^https?:\/\//.test(url)) throw new Error("webhook: valid url is required.");
    const method = (config.method || "POST").toUpperCase();
    const headers = replaceDeep(config.headers || { "Content-Type": "application/json" }, processRow);
    let body = config.body;
    if (typeof body === "string") body = replaceTemplateVars(body, processRow);
    else if (body && typeof body === "object") body = replaceDeep(body, processRow);
    const init = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = typeof body === "string" ? body : JSON.stringify(body ?? {});
    }
    const res = await fetch(url, init);
    const text = await res.text().catch(() => "");
    const summary = `Webhook ${method} ${url} → ${res.status}`;
    await logSystemComment(step.id, `${summary}${text ? ` · ${text.slice(0, 200)}` : ""}`);
    if (!res.ok) {
      const err = new Error(`${summary}${text ? `: ${text.slice(0, 200)}` : ""}`);
      err.skipAutoComplete = true;
      throw err;
    }
    return { summary };
  },

  async launch_process(config, processRow, step) {
    const pool = getPool();
    const templateId = Number.parseInt(config.template_id, 10);
    if (!Number.isFinite(templateId)) throw new Error("launch_process: template_id is required.");
    const inheritProperty = config.inherit_property !== false;
    const inheritContact = config.inherit_contact !== false;
    const { rows: tmpl } = await pool.query(
      `SELECT * FROM process_templates WHERE id = $1 AND is_active = true`,
      [templateId]
    );
    if (!tmpl.length) throw new Error(`launch_process: template ${templateId} not found or archived.`);
    const template = tmpl[0];
    const name = inheritProperty && processRow.property_name
      ? `${template.name}: ${processRow.property_name}`
      : template.name;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: procRows } = await client.query(
        `INSERT INTO processes
           (template_id, name, status, property_name, property_id, contact_name, contact_email,
            contact_phone, created_by)
         VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, NULL)
         RETURNING *`,
        [
          templateId,
          name,
          inheritProperty ? processRow.property_name : null,
          inheritProperty ? processRow.property_id : null,
          inheritContact ? processRow.contact_name : null,
          inheritContact ? processRow.contact_email : null,
          inheritContact ? processRow.contact_phone : null,
        ]
      );
      const newProcess = procRows[0];
      const { rows: tmplSteps } = await client.query(
        `SELECT * FROM process_template_steps WHERE template_id = $1 ORDER BY step_number ASC`,
        [templateId]
      );
      const idByStepNumber = new Map();
      for (const ts of tmplSteps) {
        const d = new Date(newProcess.started_at);
        d.setDate(d.getDate() + (ts.due_days_offset || 0));
        const initialStatus = ts.depends_on_step ? "blocked" : "pending";
        const { rows: ins } = await client.query(
          `INSERT INTO process_steps
             (process_id, template_step_id, step_number, name, description, status,
              assigned_user_id, assigned_role, due_date, auto_action, auto_action_config)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11)
           RETURNING id`,
          [
            newProcess.id,
            ts.id,
            ts.step_number,
            ts.name,
            ts.description,
            initialStatus,
            ts.assigned_user_id,
            ts.assigned_role,
            d.toISOString().slice(0, 10),
            ts.auto_action,
            ts.auto_action_config,
          ]
        );
        idByStepNumber.set(ts.step_number, ins[0].id);
      }
      for (const ts of tmplSteps) {
        if (ts.depends_on_step) {
          const dep = idByStepNumber.get(ts.depends_on_step);
          const self = idByStepNumber.get(ts.step_number);
          if (dep && self) {
            await client.query(
              `UPDATE process_steps SET depends_on_step_id = $1 WHERE id = $2`,
              [dep, self]
            );
          }
        }
      }
      await client.query("COMMIT");
      await logSystemComment(step.id, `Launched process "${newProcess.name}" (#${newProcess.id})`);
      // Fire-and-forget automation on the new process's first step(s).
      setImmediate(() => {
        runAutomationForProcessLaunch(newProcess.id).catch((err) =>
          console.warn("[automation] cascade launch failed:", err.message)
        );
      });
      return { summary: `Launched ${template.name}`, newProcessId: newProcess.id };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
};

async function resolveUsersByRole(role) {
  if (!role) return [];
  const pool = getPool();
  const r = String(role).toLowerCase();
  if (r === "admin") {
    const { rows } = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
    return rows.map((x) => x.id);
  }
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE lower(display_name) LIKE $1 OR lower(username) LIKE $1`,
    [`%${r}%`]
  );
  return rows.map((x) => x.id);
}

/**
 * Executes the automation on a single step. Called after the step is activated
 * (pending → ready to work on). Idempotent-guarded via automation_status.
 *
 * Options:
 *   dryRun: true — resolves config + returns what would happen; does not mutate.
 */
export async function executeStepAutomation(stepId, { dryRun = false } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT s.*, p.id AS p_id, p.name AS p_name, p.property_name AS p_property_name,
            p.property_id AS p_property_id, p.contact_name AS p_contact_name,
            p.contact_email AS p_contact_email, p.contact_phone AS p_contact_phone,
            p.started_at AS p_started_at, p.target_completion AS p_target_completion
     FROM process_steps s
     JOIN processes p ON p.id = s.process_id
     WHERE s.id = $1`,
    [stepId]
  );
  if (!rows.length) return { ok: false, error: "step not found" };
  const step = rows[0];
  const action = step.auto_action;
  if (!action) return { ok: false, error: "no automation configured" };
  const handler = AUTO_ACTIONS[action];
  if (!handler) return { ok: false, error: `unknown action: ${action}` };
  if (step.status === "completed" || step.status === "skipped") {
    return { ok: false, error: "step already finished" };
  }
  if (step.automation_status === "completed") {
    return { ok: false, error: "automation already ran" };
  }
  const processRow = {
    id: step.p_id,
    name: step.p_name,
    property_name: step.p_property_name,
    property_id: step.p_property_id,
    contact_name: step.p_contact_name,
    contact_email: step.p_contact_email,
    contact_phone: step.p_contact_phone,
    started_at: step.p_started_at,
    target_completion: step.p_target_completion,
  };
  const config = step.auto_action_config || {};
  if (dryRun) {
    const resolved = replaceDeep(config, processRow);
    return { ok: true, dryRun: true, action, resolvedConfig: resolved };
  }
  await markAutomationStatus(stepId, "running");
  try {
    const result = await handler(config, processRow, step);
    await markAutomationStatus(stepId, "completed");
    let cascadeIds = [];
    if (!result?.skipAutoComplete) {
      cascadeIds = await autoCompleteStep(step);
    }
    // Fire automation for any step we just unblocked.
    for (const nextId of cascadeIds) {
      setImmediate(() => {
        executeStepAutomation(nextId).catch((err) =>
          console.warn("[automation] cascade failed:", err.message)
        );
      });
    }
    return { ok: true, ...result };
  } catch (err) {
    await markAutomationStatus(stepId, "failed", err.message || String(err));
    await logSystemComment(stepId, `FAILED: ${err.message || err}`);
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * When a process is first launched, run automation on all currently-active steps
 * (status=pending with no depends_on_step_id, or dependencies already met).
 */
export async function runAutomationForProcessLaunch(processId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id FROM process_steps
     WHERE process_id = $1 AND status = 'pending' AND auto_action IS NOT NULL
       AND (depends_on_step_id IS NULL OR depends_on_step_id IN (
         SELECT id FROM process_steps WHERE status IN ('completed','skipped')
       ))
     ORDER BY step_number ASC`,
    [processId]
  );
  for (const r of rows) {
    await executeStepAutomation(r.id).catch((err) =>
      console.warn("[automation] launch step", r.id, err.message)
    );
  }
}

/**
 * When a step completes, some dependents may have been unblocked. Run automation
 * on any newly-pending steps that have auto_action.
 */
export async function runAutomationForUnblockedSteps(stepIds) {
  for (const id of stepIds) {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id FROM process_steps WHERE id = $1 AND status = 'pending' AND auto_action IS NOT NULL`,
      [id]
    );
    if (rows.length) {
      await executeStepAutomation(id).catch((err) =>
        console.warn("[automation] unblocked step", id, err.message)
      );
    }
  }
}

/**
 * Cron: finds auto_complete_delay steps whose due_date has arrived and completes them.
 */
export async function processDelayedAutoCompletes() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id FROM process_steps
     WHERE auto_action = 'auto_complete_delay'
       AND status = 'in_progress'
       AND due_date IS NOT NULL
       AND due_date <= CURRENT_DATE`
  );
  for (const r of rows) {
    try {
      await autoCompleteStep({ id: r.id });
      await logSystemComment(r.id, `Delay elapsed — auto-completed.`);
      // Cascade to any freshly-unblocked dependents.
      const { rows: unblocked } = await pool.query(
        `SELECT id FROM process_steps WHERE depends_on_step_id = $1 AND status = 'pending' AND auto_action IS NOT NULL`,
        [r.id]
      );
      for (const u of unblocked) {
        await executeStepAutomation(u.id).catch(() => {});
      }
    } catch (err) {
      console.warn("[automation] delayed complete failed:", r.id, err.message);
    }
  }
  return { processed: rows.length };
}

export { AUTO_ACTIONS };
