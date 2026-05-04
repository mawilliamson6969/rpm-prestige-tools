import { getPool } from "../lib/db.js";
import {
  calculateNextRun,
  dryRunRule,
  executeRule,
} from "../lib/autopilot-engine.js";

/* ---------- mappers ---------- */

function mapRule(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    description: r.description,
    isEnabled: r.is_enabled,
    frequency: r.frequency,
    dayOfPeriod: r.day_of_period,
    timeOfDay: r.time_of_day,
    timezone: r.timezone,
    startingStageId: r.starting_stage_id,
    conditionEntity: r.condition_entity,
    conditions: r.conditions || [],
    processNameTemplate: r.process_name_template,
    preventDuplicate: r.prevent_duplicate,
    duplicateCheckField: r.duplicate_check_field,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    totalRuns: r.total_runs ?? 0,
    totalProcessesCreated: r.total_processes_created ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapLog(r) {
  return {
    id: r.id,
    ruleId: r.rule_id,
    runAt: r.run_at,
    status: r.status,
    entitiesMatched: r.entities_matched ?? 0,
    processesCreated: r.processes_created ?? 0,
    duplicatesSkipped: r.duplicates_skipped ?? 0,
    errors: r.errors,
    details: r.details,
  };
}

const VALID_FREQ = new Set(["day", "week", "month"]);
const VALID_ENTITY = new Set(["unit", "property", "owner", "tenant", "lease"]);

/* ---------- CRUD ---------- */

export async function getAutopilotRules(req, res) {
  const templateId = Number.parseInt(req.params.templateId, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_autopilot_rules WHERE template_id = $1
       ORDER BY id ASC`,
      [templateId]
    );
    res.json({ rules: rows.map(mapRule) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load autopilot rules." });
  }
}

export async function postAutopilotRule(req, res) {
  const templateId = Number.parseInt(req.params.templateId, 10);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isFinite(templateId) || !name) {
    res.status(400).json({ error: "templateId and name required." });
    return;
  }
  const frequency =
    typeof req.body?.frequency === "string" && VALID_FREQ.has(req.body.frequency)
      ? req.body.frequency
      : "month";
  const conditionEntity =
    typeof req.body?.conditionEntity === "string" && VALID_ENTITY.has(req.body.conditionEntity)
      ? req.body.conditionEntity
      : "unit";
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO process_autopilot_rules
         (template_id, name, description, frequency, day_of_period, time_of_day,
          timezone, starting_stage_id, condition_entity, conditions,
          process_name_template, prevent_duplicate, duplicate_check_field, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
       RETURNING *`,
      [
        templateId,
        name,
        typeof req.body?.description === "string" ? req.body.description.trim() || null : null,
        frequency,
        Number.isFinite(Number.parseInt(req.body?.dayOfPeriod, 10))
          ? Number.parseInt(req.body.dayOfPeriod, 10)
          : 1,
        typeof req.body?.timeOfDay === "string" ? req.body.timeOfDay : "06:00:00",
        typeof req.body?.timezone === "string" ? req.body.timezone : "America/Chicago",
        Number.isFinite(Number.parseInt(req.body?.startingStageId, 10))
          ? Number.parseInt(req.body.startingStageId, 10)
          : null,
        conditionEntity,
        JSON.stringify(Array.isArray(req.body?.conditions) ? req.body.conditions : []),
        typeof req.body?.processNameTemplate === "string"
          ? req.body.processNameTemplate.slice(0, 500)
          : null,
        req.body?.preventDuplicate !== false,
        typeof req.body?.duplicateCheckField === "string"
          ? req.body.duplicateCheckField
          : "property_name",
        req.user?.id ?? null,
      ]
    );
    res.status(201).json({ rule: mapRule(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create autopilot rule." });
  }
}

export async function putAutopilotRule(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid rule id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  const fields = [
    ["name", "name", (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined)],
    [
      "description",
      "description",
      (v) => (typeof v === "string" ? v.trim() || null : undefined),
    ],
    [
      "frequency",
      "frequency",
      (v) => (typeof v === "string" && VALID_FREQ.has(v) ? v : undefined),
    ],
    [
      "dayOfPeriod",
      "day_of_period",
      (v) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : undefined),
    ],
    [
      "timeOfDay",
      "time_of_day",
      (v) => (typeof v === "string" ? v : undefined),
    ],
    ["timezone", "timezone", (v) => (typeof v === "string" ? v : undefined)],
    [
      "startingStageId",
      "starting_stage_id",
      (v) =>
        v === null
          ? null
          : Number.isFinite(Number.parseInt(v, 10))
          ? Number.parseInt(v, 10)
          : undefined,
    ],
    [
      "conditionEntity",
      "condition_entity",
      (v) => (typeof v === "string" && VALID_ENTITY.has(v) ? v : undefined),
    ],
    [
      "processNameTemplate",
      "process_name_template",
      (v) => (typeof v === "string" ? v.slice(0, 500) : undefined),
    ],
    ["preventDuplicate", "prevent_duplicate", (v) => (typeof v === "boolean" ? v : undefined)],
    [
      "duplicateCheckField",
      "duplicate_check_field",
      (v) => (typeof v === "string" ? v : undefined),
    ],
  ];
  for (const [k, col, parse] of fields) {
    if (req.body?.[k] !== undefined) {
      const v = parse(req.body[k]);
      if (v !== undefined) {
        sets.push(`${col} = $${n++}`);
        vals.push(v);
      }
    }
  }
  if (Array.isArray(req.body?.conditions)) {
    sets.push(`conditions = $${n++}::jsonb`);
    vals.push(JSON.stringify(req.body.conditions));
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_autopilot_rules SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Rule not found." });
      return;
    }
    // If still enabled, recompute next_run_at for the new schedule.
    if (rows[0].is_enabled) {
      const next = calculateNextRun(rows[0], new Date());
      await pool.query(
        `UPDATE process_autopilot_rules SET next_run_at = $1 WHERE id = $2`,
        [next, id]
      );
      rows[0].next_run_at = next;
    }
    res.json({ rule: mapRule(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update rule." });
  }
}

export async function deleteAutopilotRule(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid rule id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM process_autopilot_rules WHERE id = $1`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Rule not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete rule." });
  }
}

export function putAutopilotRuleEnabled(enabled) {
  return async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid rule id." });
      return;
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT r.*, t.is_active, COALESCE(t.is_live, TRUE) AS is_live
         FROM process_autopilot_rules r
         JOIN process_templates t ON t.id = r.template_id
         WHERE r.id = $1`,
        [id]
      );
      if (!rows.length) {
        res.status(404).json({ error: "Rule not found." });
        return;
      }
      const rule = rows[0];
      if (enabled) {
        if (!rule.is_active) {
          res.status(400).json({ error: "Template is archived." });
          return;
        }
        if (!rule.is_live) {
          res.status(400).json({
            error:
              "Template is in Draft mode — set it Live before enabling autopilot rules.",
          });
          return;
        }
        if (!rule.starting_stage_id) {
          res.status(400).json({ error: "Pick a starting stage before enabling." });
          return;
        }
        if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
          res.status(400).json({ error: "Add at least one condition before enabling." });
          return;
        }
      }
      const nextRun = enabled ? calculateNextRun(rule, new Date()) : null;
      const { rows: updated } = await pool.query(
        `UPDATE process_autopilot_rules
         SET is_enabled = $1, next_run_at = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [enabled, nextRun, id]
      );
      res.json({ rule: mapRule(updated[0]) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not toggle rule." });
    }
  };
}

/* ---------- test (dry run) + log ---------- */

export async function postAutopilotRuleTest(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid rule id." });
    return;
  }
  try {
    const result = await dryRunRule(id);
    if (!result) {
      res.status(404).json({ error: "Rule not found." });
      return;
    }
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Dry run failed." });
  }
}

export async function postAutopilotRuleRunNow(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid rule id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_autopilot_rules WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Rule not found." });
      return;
    }
    const result = await executeRule(rows[0]);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Run failed." });
  }
}

export async function getAutopilotRuleLog(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid rule id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_autopilot_log
       WHERE rule_id = $1
       ORDER BY run_at DESC
       LIMIT 50`,
      [id]
    );
    res.json({ runs: rows.map(mapLog) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load run log." });
  }
}

export async function getAutopilotSummary(_req, res) {
  try {
    const pool = getPool();
    const { rows: counts } = await pool.query(
      `SELECT
         COUNT(*)::int AS rule_count,
         COUNT(*) FILTER (WHERE is_enabled)::int AS enabled_count,
         MIN(next_run_at) FILTER (WHERE is_enabled) AS next_run
       FROM process_autopilot_rules`
    );
    const { rows: recent } = await pool.query(
      `SELECT l.*, r.name AS rule_name, r.template_id
       FROM process_autopilot_log l
       JOIN process_autopilot_rules r ON r.id = l.rule_id
       WHERE l.run_at > NOW() - INTERVAL '24 hours'
       ORDER BY l.run_at DESC
       LIMIT 20`
    );
    const summary = counts[0] || {};
    const totalCreated24h = recent.reduce(
      (sum, r) => sum + (r.processes_created || 0),
      0
    );
    res.json({
      ruleCount: summary.rule_count ?? 0,
      enabledCount: summary.enabled_count ?? 0,
      nextRunAt: summary.next_run ?? null,
      created24h: totalCreated24h,
      recent: recent.map((r) => ({
        ...mapLog(r),
        ruleName: r.rule_name,
        templateId: r.template_id,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load autopilot summary." });
  }
}
