/**
 * Prestige Connect automation worker.
 *
 * Loop:
 *   1. Atomically claim up to BATCH_SIZE pending events from `events`
 *      using FOR UPDATE SKIP LOCKED (so we can scale to N workers).
 *   2. For each claimed event, look up enabled automations whose
 *      trigger_type matches, then execute the steps in order.
 *   3. Persist a row in automation_runs per (event x automation).
 *   4. Mark the event as 'processed' (or 'failed' if every match blew up).
 *
 * Safety nets:
 *   - A stuck-event sweeper resets rows still in 'processing' past
 *     STUCK_THRESHOLD_MS back to 'pending' so a worker crash mid-run
 *     doesn't permanently shelve an event.
 *   - A daily cleanup deletes 'processed' / 'skipped' events older
 *     than EVENT_RETENTION_DAYS.
 */

import { getPool } from "./db.js";
import { renderDeep } from "./templating.js";
import { runFilter } from "./handlers/filter.js";
import { runSendSms } from "./handlers/sendSms.js";
import { runSendEmail } from "./handlers/sendEmail.js";
import { runCreateCard } from "./handlers/createCard.js";
import { runAiDraft } from "./handlers/aiDraft.js";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS) || 5000;
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE) || 10;
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const STUCK_SWEEP_INTERVAL_MS = 60 * 1000; // 1 minute
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EVENT_RETENTION_DAYS = 90;

const HANDLERS = {
  filter: runFilter,
  send_sms: runSendSms,
  send_email: runSendEmail,
  create_card: runCreateCard,
  ai_draft: runAiDraft,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Atomically claim a batch of pending events. */
async function claimPendingEvents(batchSize) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE events
        SET status = 'processing', processed_at = NOW()
      WHERE id IN (
        SELECT id FROM events
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [batchSize]
  );
  return rows;
}

/** Resolve all enabled automations for a given event type. */
async function loadMatchingAutomations(eventType) {
  const pool = getPool();
  const { rows: automations } = await pool.query(
    `SELECT id, name, trigger_type, trigger_config, max_runs_per_day
       FROM automations
      WHERE enabled = true AND trigger_type = $1
      ORDER BY id ASC`,
    [eventType]
  );
  if (!automations.length) return [];
  const ids = automations.map((a) => a.id);
  const { rows: steps } = await pool.query(
    `SELECT id, automation_id, step_order, step_type, config
       FROM automation_steps
      WHERE automation_id = ANY($1::int[])
      ORDER BY automation_id, step_order ASC`,
    [ids]
  );
  const byAuto = new Map();
  for (const a of automations) byAuto.set(a.id, { ...a, steps: [] });
  for (const s of steps) byAuto.get(s.automation_id)?.steps.push(s);
  return Array.from(byAuto.values());
}

/** Has this automation hit its per-day rate limit? */
async function dailyRunCount(automationId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c
       FROM automation_runs
      WHERE automation_id = $1
        AND started_at >= NOW() - INTERVAL '24 hours'`,
    [automationId]
  );
  return rows[0]?.c ?? 0;
}

async function recordRun(automationId, eventId, status, startedAt, stepResults, error) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO automation_runs
       (automation_id, event_id, status, started_at, finished_at, step_results, error)
     VALUES ($1, $2, $3, $4, NOW(), $5::jsonb, $6)`,
    [automationId, eventId, status, startedAt, JSON.stringify(stepResults || []), error || null]
  );
}

async function executeAutomation(automation, event) {
  const startedAt = new Date();
  const stepResults = [];
  const context = {};
  const scope = { event, context };

  // Per-day rate limit (when configured) — fail closed.
  if (automation.max_runs_per_day && automation.max_runs_per_day > 0) {
    const used = await dailyRunCount(automation.id);
    if (used >= automation.max_runs_per_day) {
      await recordRun(
        automation.id,
        event.id,
        "skipped",
        startedAt,
        [],
        `Skipped: max_runs_per_day (${automation.max_runs_per_day}) reached.`
      );
      return { status: "skipped" };
    }
  }

  let finalStatus = "success";
  let finalError = null;

  for (const step of automation.steps) {
    const handler = HANDLERS[step.step_type];
    if (!handler) {
      const r = { step_order: step.step_order, step_type: step.step_type, status: "failed", error: `Unknown step type: ${step.step_type}` };
      stepResults.push(r);
      finalStatus = "failed";
      finalError = r.error;
      break;
    }
    const cfgRaw = step.config || {};
    const cfg = renderDeep(cfgRaw, scope);
    let result;
    try {
      result = await handler({ config: cfg, scope, context, event });
    } catch (err) {
      result = { status: "failed", error: err.message || String(err) };
    }
    stepResults.push({
      step_order: step.step_order,
      step_type: step.step_type,
      status: result.status,
      output: result.output ?? null,
      error: result.error ?? null,
    });
    if (result.status === "filtered_out") {
      finalStatus = "filtered_out";
      break;
    }
    if (result.status === "failed") {
      finalStatus = "failed";
      finalError = result.error || "Step failed.";
      break;
    }
  }

  await recordRun(automation.id, event.id, finalStatus, startedAt, stepResults, finalError);
  return { status: finalStatus, error: finalError };
}

async function processEvent(event) {
  const pool = getPool();
  let hadFailure = false;
  let hadSuccess = false;
  try {
    const automations = await loadMatchingAutomations(event.type);
    if (!automations.length) {
      await pool.query(
        `UPDATE events SET status = 'skipped', processed_at = NOW() WHERE id = $1`,
        [event.id]
      );
      return;
    }
    for (const automation of automations) {
      const r = await executeAutomation(automation, event);
      if (r.status === "failed") hadFailure = true;
      else hadSuccess = true;
    }
    // If at least one automation succeeded (or was filtered), call it
    // processed. Only mark the event as failed if every automation
    // blew up — that's a signal worth investigating.
    const status = hadSuccess || !hadFailure ? "processed" : "failed";
    const err = status === "failed" ? "All matching automations failed — see automation_runs." : null;
    await pool.query(
      `UPDATE events
          SET status = $1, processed_at = NOW(), error = $2
        WHERE id = $3`,
      [status, err, event.id]
    );
  } catch (err) {
    console.error(`[worker] event ${event.id} crashed:`, err);
    await pool
      .query(
        `UPDATE events SET status = 'failed', processed_at = NOW(), error = $1 WHERE id = $2`,
        [err.message || String(err), event.id]
      )
      .catch(() => {});
  }
}

async function sweepStuckEvents() {
  const pool = getPool();
  try {
    const { rowCount } = await pool.query(
      `UPDATE events
          SET status = 'pending'
        WHERE status = 'processing'
          AND processed_at < NOW() - ($1 || ' milliseconds')::interval`,
      [String(STUCK_THRESHOLD_MS)]
    );
    if (rowCount > 0) {
      console.log(`[worker] reset ${rowCount} stuck event(s) back to pending`);
    }
  } catch (err) {
    console.error("[worker] stuck sweep failed:", err.message || err);
  }
}

async function cleanupOldEvents() {
  const pool = getPool();
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM events
        WHERE status IN ('processed', 'skipped')
          AND created_at < NOW() - INTERVAL '${EVENT_RETENTION_DAYS} days'`
    );
    if (rowCount > 0) {
      console.log(`[worker] purged ${rowCount} old event(s)`);
    }
  } catch (err) {
    console.error("[worker] cleanup failed:", err.message || err);
  }
}

async function processLoop() {
  console.log(
    `[worker] starting — poll=${POLL_INTERVAL_MS}ms batch=${BATCH_SIZE} handlers=[${Object.keys(HANDLERS).join(", ")}]`
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const events = await claimPendingEvents(BATCH_SIZE);
      if (events.length === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      for (const event of events) {
        await processEvent(event);
      }
    } catch (err) {
      console.error("[worker] loop error:", err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function startTimers() {
  setInterval(() => {
    sweepStuckEvents().catch(() => {});
  }, STUCK_SWEEP_INTERVAL_MS);
  setInterval(() => {
    cleanupOldEvents().catch(() => {});
  }, CLEANUP_INTERVAL_MS);
}

process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM — exiting");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[worker] SIGINT — exiting");
  process.exit(0);
});

startTimers();
processLoop().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
