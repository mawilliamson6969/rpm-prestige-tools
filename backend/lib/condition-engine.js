import nodemailer from "nodemailer";
import { getPool } from "./db.js";

/**
 * In-memory cache of template conditions keyed by `${templateId}:${triggerType}`.
 * TTL 60s — templates change rarely.
 */
const conditionCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function cacheKey(tpl, trig) {
  return `${tpl}:${trig}`;
}

export function invalidateConditionCache(templateId) {
  for (const k of conditionCache.keys()) {
    if (k.startsWith(`${templateId}:`)) conditionCache.delete(k);
  }
}

async function loadConditions(pool, templateId, triggerType) {
  const key = cacheKey(templateId, triggerType);
  const entry = conditionCache.get(key);
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.rows;
  const { rows } = await pool.query(
    `SELECT * FROM process_conditions
     WHERE template_id = $1 AND trigger_type = $2 AND is_active = true
     ORDER BY sort_order ASC, id ASC`,
    [templateId, triggerType]
  );
  conditionCache.set(key, { at: Date.now(), rows });
  return rows;
}

function replaceVars(text, ctx) {
  if (typeof text !== "string" || !text) return text;
  return text
    .replace(/\{\{contact_name\}\}/g, ctx.contact_name || "")
    .replace(/\{\{contact_email\}\}/g, ctx.contact_email || "")
    .replace(/\{\{contact_phone\}\}/g, ctx.contact_phone || "")
    .replace(/\{\{property_name\}\}/g, ctx.property_name || "")
    .replace(/\{\{process_name\}\}/g, ctx.process_name || "")
    .replace(/\{\{process_id\}\}/g, ctx.process_id != null ? String(ctx.process_id) : "")
    .replace(/\{\{step_name\}\}/g, ctx.step_name || "")
    .replace(/\{\{stage_name\}\}/g, ctx.stage_name || "");
}

function replaceDeep(v, ctx) {
  if (typeof v === "string") return replaceVars(v, ctx);
  if (Array.isArray(v)) return v.map((x) => replaceDeep(x, ctx));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = replaceDeep(val, ctx);
    return out;
  }
  return v;
}

async function loadProcessContext(pool, processId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.property_name, p.contact_name, p.contact_email, p.contact_phone,
            p.template_id, p.status
     FROM processes p WHERE p.id = $1`,
    [processId]
  );
  if (!rows.length) return null;
  return {
    process_id: rows[0].id,
    process_name: rows[0].name,
    property_name: rows[0].property_name,
    contact_name: rows[0].contact_name,
    contact_email: rows[0].contact_email,
    contact_phone: rows[0].contact_phone,
    template_id: rows[0].template_id,
    status: rows[0].status,
  };
}

/**
 * Evaluate a single trigger_config against the triggerContext.
 * Returns true if the condition should fire.
 */
function triggerMatches(cond, triggerContext) {
  const cfg = cond.trigger_config || {};
  switch (cond.trigger_type) {
    case "step_completed":
      if (cfg.stepId && triggerContext.templateStepId) {
        return Number(cfg.stepId) === Number(triggerContext.templateStepId);
      }
      if (cfg.stepName && triggerContext.stepName) {
        return String(cfg.stepName).toLowerCase() ===
          String(triggerContext.stepName).toLowerCase();
      }
      return !cfg.stepId && !cfg.stepName;
    case "stage_completed":
      if (cfg.stageId && triggerContext.templateStageId) {
        return Number(cfg.stageId) === Number(triggerContext.templateStageId);
      }
      if (cfg.stageName && triggerContext.stageName) {
        return String(cfg.stageName).toLowerCase() ===
          String(triggerContext.stageName).toLowerCase();
      }
      return !cfg.stageId && !cfg.stageName;
    case "all_steps_completed":
      return true;
    case "process_launched":
      return true;
    case "process_status_changed":
      return (
        (!cfg.fromStatus || cfg.fromStatus === triggerContext.fromStatus) &&
        (!cfg.toStatus || cfg.toStatus === triggerContext.toStatus)
      );
    case "field_equals":
      return (
        Number(cfg.fieldDefinitionId) === Number(triggerContext.fieldDefinitionId) &&
        String(cfg.value) === String(triggerContext.value)
      );
    case "field_greater_than":
      return (
        Number(cfg.fieldDefinitionId) === Number(triggerContext.fieldDefinitionId) &&
        Number(triggerContext.value) > Number(cfg.value)
      );
    case "field_changed":
      return Number(cfg.fieldDefinitionId) === Number(triggerContext.fieldDefinitionId);
    case "due_date_approaching":
    case "overdue":
      // Cron-driven; trigger context will include { stepId }. Match by stepId or 'any'.
      if (cfg.entityId && triggerContext.entityId)
        return Number(cfg.entityId) === Number(triggerContext.entityId);
      return true;
    default:
      return false;
  }
}

/**
 * Execute an action. Returns { ok, summary, error }.
 */
async function executeAction(pool, processId, cond, ctx) {
  const cfg = replaceDeep(cond.action_config || {}, ctx);
  try {
    switch (cond.action_type) {
      case "create_task": {
        const days = Number(cfg.dueDaysFromTrigger) || 0;
        const d = new Date();
        d.setDate(d.getDate() + days);
        const { rows } = await pool.query(
          `INSERT INTO tasks
             (title, description, priority, assigned_user_id, property_name, property_id,
              contact_name, due_date, category, notes)
           VALUES ($1, $2, $3, $4, $5,
             (SELECT property_id FROM processes WHERE id = $6),
             $7, $8::date, $9, $10)
           RETURNING id, title`,
          [
            String(cfg.title || "Auto-created task"),
            cfg.description || null,
            ["urgent", "high", "normal", "low"].includes(cfg.priority) ? cfg.priority : "normal",
            cfg.assignedUserId ? Number(cfg.assignedUserId) : null,
            ctx.property_name || null,
            processId,
            ctx.contact_name || null,
            days > 0 ? d.toISOString().slice(0, 10) : null,
            cfg.category || null,
            `Auto-created by condition: ${cond.name}`,
          ]
        );
        return { ok: true, summary: `Created task "${rows[0].title}" (#${rows[0].id})` };
      }
      case "skip_step": {
        const stepId = Number(cfg.stepId);
        if (!stepId) return { ok: false, error: "skip_step: stepId required" };
        // Find the process_step matching this template_step_id
        const { rows } = await pool.query(
          `UPDATE process_steps
           SET status = 'skipped', completed_at = NOW(), updated_at = NOW()
           WHERE process_id = $1 AND template_step_id = $2 AND status NOT IN ('completed','skipped')
           RETURNING id, name`,
          [processId, stepId]
        );
        if (!rows.length) return { ok: false, error: "step not found or already done" };
        return { ok: true, summary: `Skipped step "${rows[0].name}"` };
      }
      case "complete_step": {
        const stepId = Number(cfg.stepId);
        if (!stepId) return { ok: false, error: "complete_step: stepId required" };
        const { rows } = await pool.query(
          `UPDATE process_steps
           SET status = 'completed', completed_at = NOW(), updated_at = NOW()
           WHERE process_id = $1 AND template_step_id = $2 AND status NOT IN ('completed','skipped')
           RETURNING id, name`,
          [processId, stepId]
        );
        if (!rows.length) return { ok: false, error: "step not found or already done" };
        return { ok: true, summary: `Completed step "${rows[0].name}"` };
      }
      case "reassign_step": {
        const stepId = Number(cfg.stepId);
        if (!stepId) return { ok: false, error: "reassign_step: stepId required" };
        await pool.query(
          `UPDATE process_steps SET assigned_user_id = $1, updated_at = NOW()
           WHERE process_id = $2 AND template_step_id = $3`,
          [cfg.assignedUserId ? Number(cfg.assignedUserId) : null, processId, stepId]
        );
        return { ok: true, summary: `Reassigned step ${stepId}` };
      }
      case "reassign_process": {
        // Processes don't have an explicit owner field currently; log only.
        return { ok: true, summary: "reassign_process noted (no-op)" };
      }
      case "send_notification": {
        let userIds = [];
        if (cfg.userId) userIds.push(Number(cfg.userId));
        if (cfg.role) {
          const { rows } = await pool.query(
            `SELECT id FROM users WHERE lower(display_name) LIKE $1 OR lower(username) LIKE $1
               OR ($2 = 'admin' AND role = 'admin')`,
            [`%${String(cfg.role).toLowerCase()}%`, String(cfg.role).toLowerCase()]
          );
          for (const r of rows) userIds.push(r.id);
        }
        userIds = Array.from(new Set(userIds));
        for (const uid of userIds) {
          await pool.query(
            `INSERT INTO notifications (user_id, message, link) VALUES ($1, $2, $3)`,
            [
              uid,
              String(cfg.message || `Update on ${ctx.process_name || "process"}`),
              cfg.link || `/operations/processes/${processId}`,
            ]
          );
        }
        return { ok: true, summary: `Notified ${userIds.length} user(s)` };
      }
      case "send_email": {
        const transport = buildSmtpTransport();
        const from = process.env.SMTP_FROM;
        if (!transport || !from) return { ok: false, error: "SMTP not configured" };
        const to = String(cfg.to || "").trim();
        if (!to) return { ok: false, error: "send_email: to required" };
        const info = await transport.sendMail({
          from,
          to,
          subject: String(cfg.subject || `Update on ${ctx.process_name || "process"}`),
          html:
            typeof cfg.body === "string" && cfg.body.includes("<")
              ? cfg.body
              : `<p>${String(cfg.body || "").replace(/\n/g, "<br>")}</p>`,
          text: String(cfg.body || "").replace(/<[^>]+>/g, ""),
        });
        return { ok: true, summary: `Emailed ${to} (${info.messageId || "ok"})` };
      }
      case "move_to_stage": {
        const stageId = Number(cfg.stageId);
        if (!stageId) return { ok: false, error: "move_to_stage: stageId required" };
        await pool.query(
          `UPDATE process_stages
           SET status = CASE WHEN template_stage_id = $1 THEN 'active'
                             WHEN stage_order < (SELECT stage_order FROM process_stages
                                                 WHERE process_id = $2 AND template_stage_id = $1 LIMIT 1)
                               THEN 'completed'
                             ELSE status END,
               updated_at = NOW()
           WHERE process_id = $2`,
          [stageId, processId]
        );
        return { ok: true, summary: `Moved to stage ${stageId}` };
      }
      case "launch_process": {
        const tplId = Number(cfg.templateId);
        if (!tplId) return { ok: false, error: "launch_process: templateId required" };
        // Delegate to process-automation helper via dynamic import to avoid cycles.
        const { runAutomationForProcessLaunch } = await import("./process-automation.js");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const name =
            cfg.inheritProperty && ctx.property_name
              ? `Auto-launched: ${ctx.property_name}`
              : "Auto-launched process";
          const { rows: procIns } = await client.query(
            `INSERT INTO processes
               (template_id, name, status, property_name, property_id, contact_name, contact_email, contact_phone)
             VALUES ($1, $2, 'active', $3, (SELECT property_id FROM processes WHERE id = $4),
               $5, $6, $7) RETURNING id`,
            [
              tplId,
              name,
              cfg.inheritProperty ? ctx.property_name : null,
              processId,
              cfg.inheritContact ? ctx.contact_name : null,
              cfg.inheritContact ? ctx.contact_email : null,
              cfg.inheritContact ? ctx.contact_phone : null,
            ]
          );
          await client.query("COMMIT");
          setImmediate(() =>
            runAutomationForProcessLaunch(procIns[0].id).catch(() => {})
          );
          return { ok: true, summary: `Launched process #${procIns[0].id}` };
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          return { ok: false, error: e.message };
        } finally {
          client.release();
        }
      }
      case "update_field": {
        const defId = Number(cfg.fieldDefinitionId);
        if (!defId) return { ok: false, error: "update_field: fieldDefinitionId required" };
        // Delegate to custom-fields upsert helper; keep it simple — directly upsert.
        const { rows: defRows } = await pool.query(
          `SELECT field_type FROM custom_field_definitions WHERE id = $1`,
          [defId]
        );
        if (!defRows.length) return { ok: false, error: "field def not found" };
        const ft = defRows[0].field_type;
        const val = cfg.value;
        const cols = {
          value_text: null,
          value_number: null,
          value_boolean: null,
          value_date: null,
          value_datetime: null,
          value_json: null,
        };
        if (["text", "textarea", "select", "email", "phone", "url", "color"].includes(ft))
          cols.value_text = String(val);
        else if (["number", "currency", "percentage", "rating", "user"].includes(ft))
          cols.value_number = Number(val);
        else if (ft === "boolean")
          cols.value_boolean = val === true || val === "true" || val === 1;
        else if (ft === "date") cols.value_date = String(val);
        else if (ft === "datetime") cols.value_datetime = String(val);
        else cols.value_json = JSON.stringify(val);
        await pool.query(
          `INSERT INTO custom_field_values
             (field_definition_id, entity_type, entity_id, value_text, value_number, value_boolean,
              value_date, value_datetime, value_json, updated_at)
           VALUES ($1, 'process', $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (field_definition_id, entity_type, entity_id)
           DO UPDATE SET value_text = EXCLUDED.value_text, value_number = EXCLUDED.value_number,
                         value_boolean = EXCLUDED.value_boolean, value_date = EXCLUDED.value_date,
                         value_datetime = EXCLUDED.value_datetime, value_json = EXCLUDED.value_json,
                         updated_at = NOW()`,
          [
            defId,
            processId,
            cols.value_text,
            cols.value_number,
            cols.value_boolean,
            cols.value_date,
            cols.value_datetime,
            cols.value_json,
          ]
        );
        return { ok: true, summary: `Updated field #${defId}` };
      }
      case "change_process_status": {
        const status = String(cfg.status || "").trim();
        if (!["active", "paused", "completed", "canceled"].includes(status)) {
          return { ok: false, error: "invalid status" };
        }
        await pool.query(
          `UPDATE processes SET status = $1,
             completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END,
             updated_at = NOW() WHERE id = $2`,
          [status, processId]
        );
        return { ok: true, summary: `Set process status to ${status}` };
      }
      case "webhook": {
        const url = cfg.url;
        if (!url || !/^https?:\/\//.test(url)) return { ok: false, error: "invalid url" };
        const method = (cfg.method || "POST").toUpperCase();
        const init = { method, headers: cfg.headers || { "Content-Type": "application/json" } };
        if (method !== "GET" && method !== "HEAD") {
          init.body = typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body ?? {});
        }
        const res = await fetch(url, init);
        return {
          ok: res.ok,
          summary: `Webhook ${method} ${url} → ${res.status}`,
          error: res.ok ? undefined : `status ${res.status}`,
        };
      }
      default:
        return { ok: false, error: `unknown action: ${cond.action_type}` };
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

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

/**
 * Main entrypoint: evaluate conditions for a process & trigger.
 *
 * @param {number} processId
 * @param {string} triggerType
 * @param {object} triggerContext — shape depends on trigger_type
 *   step_completed: { templateStepId, stepName }
 *   stage_completed: { templateStageId, stageName }
 *   field_equals / field_greater_than / field_changed: { fieldDefinitionId, value }
 *   process_status_changed: { fromStatus, toStatus }
 *   due_date_approaching / overdue: { entityType, entityId }
 */
export async function evaluateConditions(processId, triggerType, triggerContext = {}) {
  const pool = getPool();
  try {
    const procCtx = await loadProcessContext(pool, processId);
    if (!procCtx || !procCtx.template_id) return { matched: 0, executed: 0 };
    const conditions = await loadConditions(pool, procCtx.template_id, triggerType);
    if (!conditions.length) return { matched: 0, executed: 0 };
    const varCtx = {
      ...procCtx,
      step_name: triggerContext.stepName || "",
      stage_name: triggerContext.stageName || "",
    };
    let matched = 0;
    let executed = 0;
    for (const cond of conditions) {
      if (!triggerMatches(cond, triggerContext)) continue;
      matched++;
      const result = await executeAction(pool, processId, cond, varCtx);
      executed++;
      try {
        await pool.query(
          `INSERT INTO process_condition_log
             (condition_id, process_id, trigger_type, action_type, result, details)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            cond.id,
            processId,
            triggerType,
            cond.action_type,
            result.ok ? "success" : "failed",
            JSON.stringify({
              conditionName: cond.name,
              summary: result.summary || null,
              error: result.error || null,
              triggerContext,
            }),
          ]
        );
      } catch {
        /* ignore log failure */
      }
    }
    return { matched, executed };
  } catch (err) {
    console.warn("[condition-engine]", triggerType, err.message);
    return { matched: 0, executed: 0, error: err.message };
  }
}

/**
 * Cron-driven check for time-based triggers.
 * Walks active processes, looks at approaching/overdue steps, fires matching conditions.
 */
export async function runTimeBasedConditions() {
  const pool = getPool();
  // due_date_approaching
  const { rows: approaching } = await pool.query(
    `SELECT s.id, s.process_id, s.template_step_id, s.name, p.template_id,
            (s.due_date - CURRENT_DATE) AS days_until
     FROM process_steps s
     JOIN processes p ON p.id = s.process_id
     WHERE s.status NOT IN ('completed','skipped')
       AND s.due_date IS NOT NULL
       AND s.due_date >= CURRENT_DATE
       AND (s.due_date - CURRENT_DATE) <= 7
       AND p.status = 'active'`
  );
  for (const step of approaching) {
    await evaluateConditions(step.process_id, "due_date_approaching", {
      entityType: "step",
      entityId: step.template_step_id,
      stepName: step.name,
      daysUntil: step.days_until,
    });
  }
  // overdue
  const { rows: overdue } = await pool.query(
    `SELECT s.id, s.process_id, s.template_step_id, s.name,
            (CURRENT_DATE - s.due_date) AS days_over
     FROM process_steps s
     JOIN processes p ON p.id = s.process_id
     WHERE s.status NOT IN ('completed','skipped')
       AND s.due_date IS NOT NULL
       AND s.due_date < CURRENT_DATE
       AND p.status = 'active'`
  );
  for (const step of overdue) {
    await evaluateConditions(step.process_id, "overdue", {
      entityType: "step",
      entityId: step.template_step_id,
      stepName: step.name,
      daysOverdue: step.days_over,
    });
  }
  return { approaching: approaching.length, overdue: overdue.length };
}
