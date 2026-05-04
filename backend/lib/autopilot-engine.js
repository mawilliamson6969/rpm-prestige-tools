import { getPool } from "./db.js";
import { logActivity, recordStageEntry } from "./process-activity.js";
import { applyMergeContext, buildMergeContext } from "./process-merge-fields.js";
import { calculateDueDateAtLaunch } from "./due-dates.js";
import { executeImmediateSendsForStage } from "./process-messaging.js";

/**
 * Phase 4: autopilot engine. Periodically scans enabled rules, queries cached
 * AppFolio data for matching entities, applies conditions, and starts new
 * processes — with duplicate prevention and full activity/stage logging.
 */

const ENTITY_TABLES = {
  unit: "cached_rent_roll",
  property: "cached_properties",
  owner: "cached_owners",
  tenant: "cached_rent_roll",
  lease: "cached_lease_expirations",
};

/* ---------- helpers ---------- */

function getField(row, field) {
  if (!row) return null;
  const data = row.appfolio_data || {};
  return data?.[field] ?? null;
}

function asNumber(v) {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function asDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function daysFromNow(v) {
  const d = asDate(v);
  if (!d) return null;
  return Math.floor((d.getTime() - Date.now()) / 86_400_000);
}

function evalCondition(value, operator, target) {
  const lhs = value;
  const rhs = target;
  switch (operator) {
    case "is":
      return String(lhs ?? "").toLowerCase() === String(rhs ?? "").toLowerCase();
    case "is_not":
      return String(lhs ?? "").toLowerCase() !== String(rhs ?? "").toLowerCase();
    case "contains":
      return String(lhs ?? "")
        .toLowerCase()
        .includes(String(rhs ?? "").toLowerCase());
    case "greater_than":
      return Number.isFinite(asNumber(lhs)) && asNumber(lhs) > asNumber(rhs);
    case "less_than":
      return Number.isFinite(asNumber(lhs)) && asNumber(lhs) < asNumber(rhs);
    case "is_empty":
      return lhs === null || lhs === undefined || String(lhs).trim() === "";
    case "is_not_empty":
      return lhs !== null && lhs !== undefined && String(lhs).trim() !== "";
    case "days_from_now_less_than": {
      const d = daysFromNow(lhs);
      return d !== null && d < asNumber(rhs);
    }
    case "days_from_now_greater_than": {
      const d = daysFromNow(lhs);
      return d !== null && d > asNumber(rhs);
    }
    default:
      return false;
  }
}

function matchesAllConditions(row, conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  for (const c of conditions) {
    if (!c || typeof c.field !== "string" || typeof c.operator !== "string") continue;
    const value = getField(row, c.field);
    if (!evalCondition(value, c.operator, c.value)) return false;
  }
  return true;
}

/* ---------- merge context for naming ---------- */

function entityToProcessSeed(rule, row) {
  const data = row.appfolio_data || {};
  const propertyName =
    data.property_name ||
    data.property ||
    data.property_address ||
    data.address ||
    null;
  const propertyId = data.property_id ? Number(data.property_id) : null;
  const contactName =
    rule.condition_entity === "owner"
      ? data.owner_name || data.name || null
      : data.tenant || data.primary_tenant || null;
  const contactEmail =
    rule.condition_entity === "owner"
      ? data.email || null
      : data.primary_tenant_email || data.email || null;
  const contactPhone =
    rule.condition_entity === "owner"
      ? data.phone || data.phone_number || null
      : data.primary_tenant_phone_number || data.phone_numbers || data.phone || null;

  const duplicateValue =
    typeof rule.duplicate_check_field === "string" && rule.duplicate_check_field
      ? data[rule.duplicate_check_field] ?? propertyName
      : propertyName;

  return {
    propertyName,
    propertyId: Number.isFinite(propertyId) ? propertyId : null,
    contactName,
    contactEmail,
    contactPhone,
    duplicateValue,
    entityKey: data.property_id || data.id || data.owner_id || propertyName,
  };
}

/**
 * Render the rule's process_name_template against a hypothetical merge context
 * that mixes the matched cached row's fields with the standard merge tokens.
 */
function renderProcessName(rule, row, fallbackTemplateName) {
  const template =
    typeof rule.process_name_template === "string" && rule.process_name_template.trim()
      ? rule.process_name_template
      : `${fallbackTemplateName} for {{property.address}}`;

  const data = row.appfolio_data || {};
  const street =
    data.property_address ||
    data.address ||
    data.property_name ||
    data.property ||
    "";
  const tenant = data.tenant || data.primary_tenant || "";
  const owner = data.owner_name || data.name || "";

  // Light-weight token resolution against the matched cached row.
  return template
    .replace(/\{\{\s*property\.address\s*\}\}/g, street)
    .replace(/\{\{\s*property\.name\s*\}\}/g, data.property_name || data.property || street)
    .replace(/\{\{\s*property\.city\s*\}\}/g, data.city || "")
    .replace(/\{\{\s*property\.state\s*\}\}/g, data.state || "")
    .replace(/\{\{\s*property\.zip\s*\}\}/g, data.zip_code || data.zip || "")
    .replace(/\{\{\s*tenant\.name\s*\}\}/g, tenant)
    .replace(/\{\{\s*tenant\.first_name\s*\}\}/g, (tenant.split(/\s+/)[0] || ""))
    .replace(/\{\{\s*owner\.name\s*\}\}/g, owner)
    .replace(/\{\{\s*owner\.first_name\s*\}\}/g, (owner.split(/\s+/)[0] || ""))
    .replace(/\{\{[^{}]+\}\}/g, "");
}

/* ---------- duplicate prevention ---------- */

async function isDuplicate(client, rule, seed) {
  if (!rule.prevent_duplicate) return false;
  const field = rule.duplicate_check_field || "property_name";
  // We always check against the same template for now.
  if (field === "property_id" && seed.propertyId != null) {
    const { rows } = await client.query(
      `SELECT id FROM processes
       WHERE template_id = $1
         AND property_id = $2
         AND status IN ('active','paused')
         AND archived_at IS NULL
         AND deleted_at IS NULL
       LIMIT 1`,
      [rule.template_id, seed.propertyId]
    );
    return rows.length > 0;
  }
  // Default: match by property_name (case-insensitive).
  const valueToMatch =
    seed.duplicateValue || seed.propertyName || seed.contactName || null;
  if (!valueToMatch) return false;
  const { rows } = await client.query(
    `SELECT id FROM processes
     WHERE template_id = $1
       AND LOWER(property_name) = LOWER($2)
       AND status IN ('active','paused')
       AND archived_at IS NULL
       AND deleted_at IS NULL
     LIMIT 1`,
    [rule.template_id, valueToMatch]
  );
  return rows.length > 0;
}

/* ---------- core process creation ---------- */

async function createProcessForEntity(rule, row, template, tmplStages, tmplSteps) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seed = entityToProcessSeed(rule, row);
    if (await isDuplicate(client, rule, seed)) {
      await client.query("ROLLBACK");
      return { skippedDuplicate: true, entity: seed };
    }

    const startingStageId =
      Number.isFinite(rule.starting_stage_id) && rule.starting_stage_id != null
        ? Number(rule.starting_stage_id)
        : tmplStages[0]?.id ?? null;

    const processName = renderProcessName(rule, row, template.name);

    const { rows: procRows } = await client.query(
      `INSERT INTO processes
         (template_id, name, status, property_name, property_id, contact_name,
          contact_email, contact_phone, notes, created_by, current_stage_id,
          last_activity_at, last_activity_type)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, NULL, $9, NOW(), 'autopilot_created')
       RETURNING *`,
      [
        rule.template_id,
        processName,
        seed.propertyName,
        seed.propertyId,
        seed.contactName,
        seed.contactEmail,
        seed.contactPhone,
        `Auto-created by autopilot rule "${rule.name}".`,
        startingStageId,
      ]
    );
    const processRow = procRows[0];
    const startedAt = new Date(processRow.started_at);

    // Mirror process_stages from template stages.
    const stageIdByTemplateStageId = new Map();
    for (const [idx, ts] of tmplStages.entries()) {
      const { rows: stageIns } = await client.query(
        `INSERT INTO process_stages
           (process_id, template_stage_id, name, stage_order, status, started_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          processRow.id,
          ts.id,
          ts.name,
          ts.stage_order ?? idx,
          ts.id === startingStageId ? "active" : "pending",
          ts.id === startingStageId ? new Date() : null,
        ]
      );
      stageIdByTemplateStageId.set(ts.id, stageIns[0].id);
    }

    const idByTemplateStepNumber = new Map();
    for (const ts of tmplSteps) {
      const computedDue =
        calculateDueDateAtLaunch(ts.due_date_type, ts.due_date_config, { startedAt }) ??
        (() => {
          const d = new Date(startedAt);
          d.setDate(d.getDate() + (ts.due_days_offset || 0));
          return d.toISOString().slice(0, 10);
        })();
      const initialStatus = ts.depends_on_step ? "blocked" : "pending";
      const processStageId = ts.stage_id
        ? stageIdByTemplateStageId.get(ts.stage_id) || null
        : null;
      const { rows: stepIns } = await client.query(
        `INSERT INTO process_steps
           (process_id, template_step_id, step_number, name, description, status,
            assigned_user_id, assigned_role, due_date, notes, auto_action,
            auto_action_config, stage_id, due_date_type, due_date_config,
            instructions, task_type, email_template_id, text_template_id,
            recipient_type, recipient_value, send_timing)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13,
                 $14, $15::jsonb, $16, $17, $18, $19, $20, $21, $22)
         RETURNING id`,
        [
          processRow.id,
          ts.id,
          ts.step_number,
          ts.name,
          ts.description,
          initialStatus,
          ts.assigned_user_id,
          ts.assigned_role,
          computedDue,
          null,
          ts.auto_action,
          ts.auto_action_config,
          processStageId,
          ts.due_date_type || "offset_from_start",
          JSON.stringify(ts.due_date_config ?? {}),
          ts.instructions || null,
          ts.task_type || "todo",
          ts.email_template_id ?? null,
          ts.text_template_id ?? null,
          ts.recipient_type || "tenant",
          ts.recipient_value || null,
          ts.send_timing || "immediately",
        ]
      );
      idByTemplateStepNumber.set(ts.step_number, stepIns[0].id);
    }
    for (const ts of tmplSteps) {
      if (ts.depends_on_step) {
        const dependsId = idByTemplateStepNumber.get(ts.depends_on_step);
        const stepId = idByTemplateStepNumber.get(ts.step_number);
        if (dependsId && stepId) {
          await client.query(
            `UPDATE process_steps SET depends_on_step_id = $1 WHERE id = $2`,
            [dependsId, stepId]
          );
        }
      }
    }
    await client.query("COMMIT");

    // Out-of-transaction: stage history + activity log + immediate sends.
    setImmediate(async () => {
      try {
        if (startingStageId) {
          await recordStageEntry(processRow.id, startingStageId, { userId: null });
        }
        await logActivity(processRow.id, {
          actionType: "process_created",
          description: `Autopilot created process: ${processName}`,
          metadata: { ruleId: rule.id, ruleName: rule.name, entity: seed },
          actorType: "automation",
        });
        if (startingStageId) {
          await executeImmediateSendsForStage(processRow.id, startingStageId, {
            actorUserId: null,
          });
        }
      } catch (err) {
        console.warn("[autopilot] post-create tasks failed:", err.message);
      }
    });

    return {
      created: true,
      processId: processRow.id,
      processName,
      entity: seed,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { error: err.message || String(err), entity: entityToProcessSeed(rule, row) };
  } finally {
    client.release();
  }
}

/* ---------- public API ---------- */

export async function executeRule(rule, { isDryRun = false } = {}) {
  const pool = getPool();
  const tableName = ENTITY_TABLES[rule.condition_entity] || ENTITY_TABLES.unit;

  // Pull the latest cached snapshot for this entity type.
  const { rows: rawRows } = await pool.query(
    `SELECT id, appfolio_data FROM ${tableName} ORDER BY id DESC LIMIT 5000`
  );

  // Tenant-mode is "occupied units" — narrow accordingly.
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  const filtered = rawRows.filter((row) => {
    if (rule.condition_entity === "tenant") {
      const status = String(getField(row, "status") || "").toLowerCase();
      if (!status.startsWith("current") && !status.startsWith("notice")) return false;
    }
    return matchesAllConditions(row, conditions);
  });

  if (isDryRun) {
    return {
      matched: filtered.length,
      created: 0,
      skipped: 0,
      errors: 0,
      preview: filtered.slice(0, 25).map((r) => entityToProcessSeed(rule, r)),
    };
  }

  // Live mode: load template + stages + steps once.
  const { rows: tmplRows } = await pool.query(
    `SELECT * FROM process_templates WHERE id = $1`,
    [rule.template_id]
  );
  const template = tmplRows[0];
  if (!template || template.is_active === false) {
    return { matched: filtered.length, created: 0, skipped: 0, errors: 1, error: "Template inactive" };
  }
  const { rows: tmplStages } = await pool.query(
    `SELECT * FROM process_template_stages WHERE template_id = $1
     ORDER BY stage_order ASC, id ASC`,
    [rule.template_id]
  );
  const { rows: tmplSteps } = await pool.query(
    `SELECT * FROM process_template_steps WHERE template_id = $1 ORDER BY step_number ASC`,
    [rule.template_id]
  );

  let created = 0;
  let skipped = 0;
  const errors = [];
  const details = [];

  for (const row of filtered) {
    const result = await createProcessForEntity(rule, row, template, tmplStages, tmplSteps);
    if (result.skippedDuplicate) {
      skipped += 1;
      details.push({ status: "skipped_duplicate", entity: result.entity });
    } else if (result.created) {
      created += 1;
      details.push({
        status: "created",
        processId: result.processId,
        processName: result.processName,
        entity: result.entity,
      });
    } else if (result.error) {
      errors.push({ entity: result.entity, error: result.error });
    }
  }

  // Log + bookkeeping.
  await pool.query(
    `INSERT INTO process_autopilot_log
       (rule_id, status, entities_matched, processes_created,
        duplicates_skipped, errors, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      rule.id,
      errors.length ? "partial" : "success",
      filtered.length,
      created,
      skipped,
      errors.length ? JSON.stringify(errors) : null,
      JSON.stringify(details.slice(0, 200)),
    ]
  );
  await pool.query(
    `UPDATE process_autopilot_rules
     SET last_run_at = NOW(),
         total_runs = COALESCE(total_runs, 0) + 1,
         total_processes_created = COALESCE(total_processes_created, 0) + $1,
         next_run_at = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [created, calculateNextRun(rule, new Date()), rule.id]
  );
  return { matched: filtered.length, created, skipped, errors: errors.length, details };
}

/* ---------- next-run calc ---------- */

export function calculateNextRun(rule, now = new Date()) {
  const freq = rule.frequency || "month";
  const time = String(rule.time_of_day || "06:00:00").slice(0, 8);
  const [hh, mm, ss] = time.split(":").map((x) => Number(x) || 0);
  const day = Number(rule.day_of_period) || 1;
  const next = new Date(now);
  next.setSeconds(ss || 0, 0);

  if (freq === "day") {
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  if (freq === "week") {
    // day = 0..6 (Sun..Sat)
    next.setHours(hh, mm, 0, 0);
    const cur = next.getDay();
    let delta = day - cur;
    if (delta < 0) delta += 7;
    if (delta === 0 && next <= now) delta = 7;
    next.setDate(next.getDate() + delta);
    return next;
  }
  // month
  next.setHours(hh, mm, 0, 0);
  next.setDate(Math.max(1, Math.min(28, day)));
  if (next <= now) {
    next.setMonth(next.getMonth() + 1);
    next.setDate(Math.max(1, Math.min(28, day)));
  }
  return next;
}

/* ---------- cron entry ---------- */

export async function runAutopilotCheck() {
  const pool = getPool();
  let due;
  try {
    const { rows } = await pool.query(
      `SELECT r.*
       FROM process_autopilot_rules r
       JOIN process_templates t ON t.id = r.template_id
       WHERE r.is_enabled = TRUE
         AND t.is_active = TRUE
         AND COALESCE(t.is_live, TRUE) = TRUE
         AND (r.next_run_at IS NULL OR r.next_run_at <= NOW())
       ORDER BY r.next_run_at NULLS FIRST
       LIMIT 20`
    );
    due = rows;
  } catch (err) {
    console.warn("[autopilot] check query failed:", err.message);
    return { processed: 0 };
  }
  let processed = 0;
  for (const rule of due) {
    try {
      await executeRule(rule);
      processed += 1;
    } catch (err) {
      console.warn(`[autopilot] rule ${rule.id} failed:`, err.message);
      try {
        await pool.query(
          `INSERT INTO process_autopilot_log (rule_id, status, errors)
           VALUES ($1, 'failed', $2::jsonb)`,
          [rule.id, JSON.stringify([{ error: err.message || String(err) }])]
        );
        await pool.query(
          `UPDATE process_autopilot_rules
           SET last_run_at = NOW(), next_run_at = $1, updated_at = NOW()
           WHERE id = $2`,
          [calculateNextRun(rule, new Date()), rule.id]
        );
      } catch {
        /* ignore */
      }
    }
  }
  return { processed };
}

export async function dryRunRule(ruleId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM process_autopilot_rules WHERE id = $1`,
    [ruleId]
  );
  if (!rows.length) return null;
  return executeRule(rows[0], { isDryRun: true });
}

/* ---------- merge field discovery (for the editor) ---------- */
export { buildMergeContext, applyMergeContext };
