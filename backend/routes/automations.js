/**
 * Prestige Connect — Automations CRUD + run history.
 *
 * Authoring shape (POST / PUT body):
 * {
 *   name, description?, trigger_type, trigger_config?, enabled?, max_runs_per_day?,
 *   steps: [ { step_type, config }, ... ]
 * }
 *
 * The legacy step_order field is computed server-side from array
 * position so the editor UI never has to renumber.
 */

import cronParser from "cron-parser";
import { getPool } from "../lib/db.js";
import { emitEvent } from "../lib/eventBus.js";

const DEFAULT_SCHEDULE_TZ = "America/Chicago";

/**
 * Validate + compute next_fire_at for a schedule. Throws .http=400 on
 * a bad expression so the route handler can surface it to the user.
 */
function computeNextFireAt(cronExpression, timezone) {
  try {
    const it = cronParser.parseExpression(cronExpression, {
      tz: timezone || DEFAULT_SCHEDULE_TZ,
      currentDate: new Date(),
    });
    return it.next().toDate();
  } catch (err) {
    const e = new Error(`Invalid cron expression: ${err.message}`);
    e.http = 400;
    throw e;
  }
}

const ALLOWED_TRIGGERS = new Set([
  "appfolio.work_order.created",
  "appfolio.work_order.updated",
  "appfolio.lease.signed",
  "appfolio.lease.created",
  "openphone.message.received",
  "openphone.call.completed",
  "openphone.voicemail.received",
  "ms_graph.message.created",
  "ms_graph.event.created",
  "internal.form.submitted",
  "internal.board.card_created",
  "internal.board.card_moved",
  // Phase 2 §2: time-based trigger. The accompanying automation_schedules
  // row holds the cron expression + timezone.
  "schedule.triggered",
]);

// Phase 2 §2: 'delay' step parks the run via the resume-event pattern.
const ALLOWED_STEP_TYPES = new Set([
  "filter",
  "send_sms",
  "send_email",
  "create_card",
  "ai_draft",
  "delay",
  // Phase 2 §3: branch step has two child step lists (true_steps,
  // false_steps) that the API persists as separate automation_steps
  // rows with parent_step_id pointing at the branch and branch_path
  // = 'true' / 'false'.
  "branch",
]);

const MAX_BRANCH_DEPTH_API = 5;

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

function parseId(raw, label = "id") {
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n <= 0) {
    const err = new Error(`Invalid ${label}`);
    err.http = 400;
    throw err;
  }
  return n;
}

/**
 * Validate a list of steps (which may include nested branch children
 * via .true_steps / .false_steps). Returns the same nested shape with
 * normalized fields — persistence flattens it via persistSteps below.
 */
function normalizeStepsTree(rawSteps, depth = 0) {
  if (depth > MAX_BRANCH_DEPTH_API) {
    const e = new Error(`Branch nesting exceeded ${MAX_BRANCH_DEPTH_API} levels.`);
    e.http = 400;
    throw e;
  }
  const arr = Array.isArray(rawSteps) ? rawSteps : [];
  return arr
    .map((s, i) => {
      if (!s || typeof s !== "object") return null;
      const step_type = String(s.step_type || "").trim();
      if (!ALLOWED_STEP_TYPES.has(step_type)) {
        const err = new Error(`Unsupported step_type: ${step_type || "(empty)"}`);
        err.http = 400;
        throw err;
      }
      const config = s.config && typeof s.config === "object" ? s.config : {};
      const out = { step_order: i + 1, step_type, config };
      if (step_type === "branch") {
        out.true_steps = normalizeStepsTree(s.true_steps, depth + 1);
        out.false_steps = normalizeStepsTree(s.false_steps, depth + 1);
      }
      return out;
    })
    .filter(Boolean);
}

function normalizeSteps(body) {
  return normalizeStepsTree(body.steps);
}

/**
 * Recursively persist a normalized step tree under (automationId,
 * parentStepId, branchPath). Returns the inserted top-level rows
 * (without children) — the caller pieces the tree back together via
 * a fresh GET after the transaction commits.
 */
async function persistSteps(client, { automationId, parentStepId, branchPath, steps }) {
  const inserted = [];
  for (const s of steps) {
    const { rows } = await client.query(
      `INSERT INTO automation_steps
         (automation_id, step_order, step_type, config, parent_step_id, branch_path)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, step_order, step_type, config, parent_step_id, branch_path`,
      [
        automationId,
        s.step_order,
        s.step_type,
        JSON.stringify(s.config),
        parentStepId,
        branchPath,
      ]
    );
    const row = rows[0];
    inserted.push(row);
    if (s.step_type === "branch") {
      await persistSteps(client, {
        automationId,
        parentStepId: row.id,
        branchPath: "true",
        steps: s.true_steps || [],
      });
      await persistSteps(client, {
        automationId,
        parentStepId: row.id,
        branchPath: "false",
        steps: s.false_steps || [],
      });
    }
  }
  return inserted;
}

/**
 * Load all steps for an automation as a nested tree. Top-level steps
 * have parent_step_id IS NULL; branch children sit under their parent
 * with branch_path = 'true' / 'false'.
 */
async function loadStepTree(pool, automationId) {
  const { rows } = await pool.query(
    `SELECT id, step_order, step_type, config, parent_step_id, branch_path
       FROM automation_steps
      WHERE automation_id = $1
      ORDER BY step_order ASC`,
    [automationId]
  );
  const byParent = new Map(); // key: `${parent}|${branch}` → array
  for (const r of rows) {
    const key = `${r.parent_step_id ?? "ROOT"}|${r.branch_path ?? "main"}`;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(r);
  }
  function buildList(parentKey) {
    const list = byParent.get(parentKey) || [];
    return list.map((r) => {
      const node = {
        id: r.id,
        step_order: r.step_order,
        step_type: r.step_type,
        config: r.config || {},
      };
      if (r.step_type === "branch") {
        node.true_steps = buildList(`${r.id}|true`);
        node.false_steps = buildList(`${r.id}|false`);
      }
      return node;
    });
  }
  return buildList("ROOT|main");
}

function shapeAutomation(row, steps, schedule) {
  // `steps` may arrive as a nested tree (preferred — from loadStepTree)
  // OR as a flat top-level list (legacy path). Detect and pass through.
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trigger_type: row.trigger_type,
    trigger_config: row.trigger_config || {},
    enabled: row.enabled,
    max_runs_per_day: row.max_runs_per_day,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    steps: steps || [],
    schedule: schedule
      ? {
          id: schedule.id,
          cron_expression: schedule.cron_expression,
          timezone: schedule.timezone,
          enabled: schedule.enabled,
          last_fired_at: schedule.last_fired_at,
          next_fire_at: schedule.next_fire_at,
        }
      : null,
  };
}

async function loadSchedule(pool, automationId) {
  const { rows } = await pool.query(
    `SELECT id, cron_expression, timezone, enabled, last_fired_at, next_fire_at
       FROM automation_schedules WHERE automation_id = $1`,
    [automationId]
  );
  return rows[0] || null;
}

/**
 * Upsert (or clear) the schedule row that backs schedule.triggered.
 * Pass body.schedule = { cron_expression, timezone?, enabled? } to set
 * or update; pass body.schedule = null to delete an existing row.
 */
async function upsertSchedule(client, automationId, schedulePayload, triggerType) {
  if (schedulePayload === undefined) return; // caller didn't touch it
  // Clearing.
  if (schedulePayload === null) {
    await client.query(`DELETE FROM automation_schedules WHERE automation_id = $1`, [automationId]);
    return;
  }
  if (typeof schedulePayload !== "object") {
    const e = new Error("schedule must be an object or null");
    e.http = 400;
    throw e;
  }
  // A schedule only makes sense for schedule.triggered automations.
  if (triggerType !== "schedule.triggered") {
    const e = new Error(
      "Schedule can only be set on automations whose trigger_type is 'schedule.triggered'."
    );
    e.http = 400;
    throw e;
  }
  const cron = String(schedulePayload.cron_expression || "").trim();
  if (!cron) {
    const e = new Error("schedule.cron_expression is required");
    e.http = 400;
    throw e;
  }
  const tz = String(schedulePayload.timezone || DEFAULT_SCHEDULE_TZ).trim() || DEFAULT_SCHEDULE_TZ;
  const enabled = schedulePayload.enabled === undefined ? true : Boolean(schedulePayload.enabled);
  const nextFire = computeNextFireAt(cron, tz);

  await client.query(
    `INSERT INTO automation_schedules (automation_id, cron_expression, timezone, enabled, next_fire_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (automation_id) DO UPDATE
       SET cron_expression = EXCLUDED.cron_expression,
           timezone = EXCLUDED.timezone,
           enabled = EXCLUDED.enabled,
           next_fire_at = EXCLUDED.next_fire_at,
           updated_at = NOW()`,
    [automationId, cron, tz, enabled, nextFire]
  );
}

export async function listAutomations(_req, res) {
  try {
    const pool = getPool();
    // Pull recent run stats (last 20) per automation for the list page.
    const { rows } = await pool.query(`
      SELECT a.id, a.name, a.description, a.trigger_type, a.enabled, a.max_runs_per_day,
             a.created_at, a.updated_at,
             (SELECT COUNT(*)::int FROM automation_steps s WHERE s.automation_id = a.id) AS step_count,
             (SELECT MAX(started_at) FROM automation_runs r WHERE r.automation_id = a.id) AS last_run_at,
             COALESCE((
               SELECT ROUND(
                 100.0 * COUNT(*) FILTER (WHERE status = 'success')
                       / NULLIF(COUNT(*), 0)
               )
               FROM (
                 SELECT status FROM automation_runs
                 WHERE automation_id = a.id
                 ORDER BY started_at DESC
                 LIMIT 20
               ) recent
             ), NULL) AS success_rate_pct,
             (SELECT COUNT(*)::int FROM automation_runs r
               WHERE r.automation_id = a.id
                 AND r.started_at >= NOW() - INTERVAL '24 hours'
             ) AS runs_last_24h
        FROM automations a
       ORDER BY a.updated_at DESC
    `);
    res.json({ automations: rows });
  } catch (err) {
    console.error("[automations] list failed:", err);
    res.status(500).json({ error: "Could not load automations." });
  }
}

export async function getAutomation(req, res) {
  try {
    const id = parseId(req.params.id);
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM automations WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    const steps = await loadStepTree(pool, id);
    const schedule = await loadSchedule(pool, id);
    res.json({ automation: shapeAutomation(rows[0], steps, schedule) });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] get failed:", err);
    res.status(500).json({ error: "Could not load automation." });
  }
}

export async function createAutomation(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) return badRequest(res, "Name is required.");
    const triggerType = String(body.trigger_type || "").trim();
    if (!triggerType) return badRequest(res, "Trigger is required.");
    if (!ALLOWED_TRIGGERS.has(triggerType) && !triggerType.startsWith("custom.")) {
      return badRequest(res, `Unsupported trigger_type: ${triggerType}`);
    }
    const steps = normalizeSteps(body);

    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO automations
         (name, description, trigger_type, trigger_config, enabled, max_runs_per_day, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING *`,
      [
        name,
        body.description ?? null,
        triggerType,
        JSON.stringify(body.trigger_config || {}),
        Boolean(body.enabled),
        Number.isFinite(Number(body.max_runs_per_day)) && Number(body.max_runs_per_day) > 0
          ? Number(body.max_runs_per_day)
          : null,
        req.user?.id ?? null,
      ]
    );
    const automation = rows[0];

    await persistSteps(client, {
      automationId: automation.id,
      parentStepId: null,
      branchPath: null,
      steps,
    });
    // Phase 2 §2: optional schedule for time-based triggers.
    if (body.schedule !== undefined) {
      await upsertSchedule(client, automation.id, body.schedule, triggerType);
    }
    await client.query("COMMIT");
    const tree = await loadStepTree(pool, automation.id);
    const schedule = await loadSchedule(pool, automation.id);
    res.status(201).json({ automation: shapeAutomation(automation, tree, schedule) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] create failed:", err);
    res.status(500).json({ error: "Could not create automation." });
  } finally {
    client.release();
  }
}

export async function updateAutomation(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const body = req.body || {};
    const sets = [];
    const vals = [];
    let n = 1;

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return badRequest(res, "Name cannot be empty.");
      sets.push(`name = $${n++}`);
      vals.push(name);
    }
    if (body.description !== undefined) {
      sets.push(`description = $${n++}`);
      vals.push(body.description ?? null);
    }
    if (body.trigger_type !== undefined) {
      const tt = String(body.trigger_type).trim();
      if (!ALLOWED_TRIGGERS.has(tt) && !tt.startsWith("custom.")) {
        return badRequest(res, `Unsupported trigger_type: ${tt}`);
      }
      sets.push(`trigger_type = $${n++}`);
      vals.push(tt);
    }
    if (body.trigger_config !== undefined) {
      sets.push(`trigger_config = $${n++}::jsonb`);
      vals.push(JSON.stringify(body.trigger_config || {}));
    }
    if (body.enabled !== undefined) {
      sets.push(`enabled = $${n++}`);
      vals.push(Boolean(body.enabled));
    }
    if (body.max_runs_per_day !== undefined) {
      const v =
        Number.isFinite(Number(body.max_runs_per_day)) && Number(body.max_runs_per_day) > 0
          ? Number(body.max_runs_per_day)
          : null;
      sets.push(`max_runs_per_day = $${n++}`);
      vals.push(v);
    }
    sets.push(`updated_at = NOW()`);

    await client.query("BEGIN");
    if (sets.length > 1) {
      vals.push(id);
      const { rowCount } = await client.query(
        `UPDATE automations SET ${sets.join(", ")} WHERE id = $${n}`,
        vals
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Automation not found." });
      }
    }
    // Replace steps when body includes a steps array. Otherwise leave alone.
    if (Array.isArray(body.steps)) {
      const steps = normalizeSteps(body);
      await client.query(`DELETE FROM automation_steps WHERE automation_id = $1`, [id]);
      await persistSteps(client, {
        automationId: id,
        parentStepId: null,
        branchPath: null,
        steps,
      });
    }
    // Phase 2 §2: schedule upsert/clear. Need the current trigger_type
    // (which may have just been updated above) to gate the operation.
    if (body.schedule !== undefined) {
      const { rows: curr } = await client.query(
        `SELECT trigger_type FROM automations WHERE id = $1`,
        [id]
      );
      await upsertSchedule(client, id, body.schedule, curr[0]?.trigger_type);
    }
    await client.query("COMMIT");

    const { rows } = await pool.query(`SELECT * FROM automations WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    const tree = await loadStepTree(pool, id);
    const schedule = await loadSchedule(pool, id);
    res.json({ automation: shapeAutomation(rows[0], tree, schedule) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] update failed:", err);
    res.status(500).json({ error: "Could not update automation." });
  } finally {
    client.release();
  }
}

export async function deleteAutomation(req, res) {
  try {
    const id = parseId(req.params.id);
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM automations WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ error: "Automation not found." });
    res.json({ ok: true });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] delete failed:", err);
    res.status(500).json({ error: "Could not delete automation." });
  }
}

export async function listRuns(req, res) {
  try {
    const id = parseId(req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const onlyStatus = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const pool = getPool();
    const params = [id, limit];
    let statusFilter = "";
    if (onlyStatus) {
      params.push(onlyStatus);
      statusFilter = ` AND r.status = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.started_at, r.finished_at, r.step_results, r.error,
              r.event_id, r.attempt, r.max_attempts, r.next_retry_at, r.resume_from_step,
              e.type AS event_type, e.payload AS event_payload
         FROM automation_runs r
         LEFT JOIN events e ON e.id = r.event_id
        WHERE r.automation_id = $1${statusFilter}
        ORDER BY r.started_at DESC
        LIMIT $2`,
      params
    );
    res.json({ runs: rows });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] runs failed:", err);
    res.status(500).json({ error: "Could not load runs." });
  }
}

/**
 * Phase 2 §1: manual "Retry now" — flip a dead_letter or failed run
 * back to 'retrying' with next_retry_at=NOW() so the worker picks it
 * up on the next poll. Counts as another attempt (incrementing
 * attempt), but caps at max_attempts + 1 so a human can always force
 * one more try. resume_from_step is preserved from the prior attempt
 * if set, otherwise the run replays from the first non-success step.
 */
export async function retryRunNow(req, res) {
  try {
    const automationId = parseId(req.params.id);
    const runId = parseId(req.params.runId, "run id");
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE automation_runs
          SET status = 'retrying',
              next_retry_at = NOW(),
              attempt = attempt + 1,
              max_attempts = GREATEST(max_attempts, attempt + 1),
              error = COALESCE(error, '') || ' [manual retry requested]'
        WHERE id = $1 AND automation_id = $2
          AND status IN ('dead_letter', 'failed')
        RETURNING id, status, attempt, max_attempts, next_retry_at`,
      [runId, automationId]
    );
    if (!rows.length) {
      return res
        .status(409)
        .json({ error: "Run not found, or not in a retryable state." });
    }
    res.json({ run: rows[0] });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] retry-now failed:", err);
    res.status(500).json({ error: "Could not enqueue retry." });
  }
}

export async function getRun(req, res) {
  try {
    const automationId = parseId(req.params.id);
    const runId = parseId(req.params.runId, "run id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT r.*, e.type AS event_type, e.payload AS event_payload
         FROM automation_runs r
         LEFT JOIN events e ON e.id = r.event_id
        WHERE r.automation_id = $1 AND r.id = $2`,
      [automationId, runId]
    );
    if (!rows.length) return res.status(404).json({ error: "Run not found." });
    res.json({ run: rows[0] });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] run get failed:", err);
    res.status(500).json({ error: "Could not load run." });
  }
}

/**
 * "Test" button — synthesize a fake event with the provided payload and
 * write it to the bus. The worker will pick it up. This is the simplest
 * round-trip that proves the wiring works end-to-end.
 */
export async function testAutomation(req, res) {
  try {
    const id = parseId(req.params.id);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT trigger_type FROM automations WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    const sample = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
    const eventId = await emitEvent({
      type: rows[0].trigger_type,
      source: "test",
      payload: { ...sample, _test: true, _user_id: req.user?.id ?? null },
    });
    res.json({ ok: true, event_id: eventId });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] test failed:", err);
    res.status(500).json({ error: "Could not enqueue test event." });
  }
}

/** Static lookup for the editor UI — which triggers and step types we accept. */
export function getAutomationMeta(_req, res) {
  res.json({
    triggers: Array.from(ALLOWED_TRIGGERS).map((t) => ({ value: t, label: t })),
    step_types: Array.from(ALLOWED_STEP_TYPES).map((t) => ({ value: t, label: t })),
  });
}
