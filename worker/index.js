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

import cronParser from "cron-parser";
import { getPool } from "./db.js";
import { customPatternMatches } from "./matching.js";
import { renderDeep } from "./templating.js";
import { isTransient, backoffMs } from "./errors.js";
import { runFilter } from "./handlers/filter.js";
import { runSendSms } from "./handlers/sendSms.js";
import { runSendEmail } from "./handlers/sendEmail.js";
import { runCreateCard } from "./handlers/createCard.js";
import { runAiDraft } from "./handlers/aiDraft.js";

const RESUME_EVENT_TYPE = "internal.automation.resume";
const SCHEDULE_TICK_INTERVAL_MS = 60 * 1000;

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS) || 5000;
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE) || 10;
const RETRY_BATCH_SIZE = Number(process.env.WORKER_RETRY_BATCH_SIZE) || 10;
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const STUCK_SWEEP_INTERVAL_MS = 60 * 1000; // 1 minute
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EVENT_RETENTION_DAYS = 90;
const DEFAULT_MAX_ATTEMPTS = 3;

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

/**
 * Atomically claim a batch of pending events.
 *
 * Phase 2 §2: respect `scheduled_for`. A delay step writes an event
 * with scheduled_for=NOW()+duration; we mustn't pick it up before
 * then. Ordering uses COALESCE so immediate events (NULL) still sort
 * by created_at against the delayed batch.
 */
async function claimPendingEvents(batchSize) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE events
        SET status = 'processing', processed_at = NOW()
      WHERE id IN (
        SELECT id FROM events
         WHERE status = 'pending'
           AND (scheduled_for IS NULL OR scheduled_for <= NOW())
         ORDER BY COALESCE(scheduled_for, created_at) ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [batchSize]
  );
  return rows;
}

/**
 * Resolve all enabled automations for a given event type. Steps are
 * returned as TOP-LEVEL only (parent_step_id IS NULL); branch children
 * are loaded on demand by executeSteps when a branch step is hit.
 * Loading children lazily keeps the executor simple and avoids
 * shipping the whole tree to memory for an automation whose branch
 * path is never taken.
 */
async function loadMatchingAutomations(eventType) {
  const pool = getPool();
  // 'custom.event' automations match by pattern (exact, or prefix when
  // the pattern ends in ".*") instead of by literal trigger_type, so
  // they're fetched alongside every lookup and filtered in JS.
  const { rows: candidates } = await pool.query(
    `SELECT id, name, trigger_type, trigger_config, max_runs_per_day
       FROM automations
      WHERE enabled = true AND (trigger_type = $1 OR trigger_type = 'custom.event')
      ORDER BY id ASC`,
    [eventType]
  );
  const automations = candidates.filter((a) =>
    a.trigger_type === "custom.event"
      ? customPatternMatches(a.trigger_config?.event_type_pattern, eventType)
      : true
  );
  if (!automations.length) return [];
  const ids = automations.map((a) => a.id);
  const { rows: steps } = await pool.query(
    `SELECT id, automation_id, step_order, step_type, config,
            parent_step_id, branch_path
       FROM automation_steps
      WHERE automation_id = ANY($1::int[])
        AND parent_step_id IS NULL
      ORDER BY automation_id, step_order ASC`,
    [ids]
  );
  const byAuto = new Map();
  for (const a of automations) byAuto.set(a.id, { ...a, steps: [] });
  for (const s of steps) byAuto.get(s.automation_id)?.steps.push(s);
  return Array.from(byAuto.values());
}

/** Load the ordered child steps for one side of a branch. */
async function loadBranchChildren(automationId, parentStepId, branchPath) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, automation_id, step_order, step_type, config,
            parent_step_id, branch_path
       FROM automation_steps
      WHERE automation_id = $1
        AND parent_step_id = $2
        AND branch_path = $3
      ORDER BY step_order ASC`,
    [automationId, parentStepId, branchPath]
  );
  return rows;
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

/**
 * Insert a run row at the START of execution (Phase 2 §1 — we need a
 * stable run id so a transient failure mid-execution can be retried by
 * updating this same row).
 */
async function insertRun({ automationId, eventId, startedAt, maxAttempts }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO automation_runs
       (automation_id, event_id, status, started_at, attempt, max_attempts)
     VALUES ($1, $2, 'running', $3, 1, $4)
     RETURNING id`,
    [automationId, eventId, startedAt, maxAttempts]
  );
  return rows[0].id;
}

async function finalizeRun(runId, { status, stepResults, context, error }) {
  const pool = getPool();
  await pool.query(
    `UPDATE automation_runs
        SET status = $1,
            finished_at = NOW(),
            step_results = $2::jsonb,
            context = $3::jsonb,
            error = $4,
            next_retry_at = NULL,
            resume_from_step = NULL
      WHERE id = $5`,
    [status, JSON.stringify(stepResults || []), JSON.stringify(context || {}), error || null, runId]
  );
}

/**
 * Phase 2 §2: park a run that hit a delay step. Writes a scheduled
 * resume event, marks the run 'waiting', and persists step_results
 * + context so the resume picks up cleanly even if the worker
 * restarts in the meantime.
 *
 * `resume_from_step` points at the delay step itself — executeSteps'
 * skip-if-success guard handles moving past it.
 */
async function parkRunForResume({ runId, automationId, delayStep, scheduledFor, stepResults, context }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Write the resume event first so we have its id to record.
    const { rows: ev } = await client.query(
      `INSERT INTO events (type, source, payload, scheduled_for)
       VALUES ($1, 'internal', $2::jsonb, $3)
       RETURNING id`,
      [
        RESUME_EVENT_TYPE,
        JSON.stringify({ run_id: runId, automation_id: automationId, delay_step_id: delayStep?.id ?? null }),
        scheduledFor,
      ]
    );
    const resumeEventId = ev[0].id;
    await client.query(
      `UPDATE automation_runs
          SET status = 'waiting',
              step_results = $1::jsonb,
              context = $2::jsonb,
              resume_from_step = $3,
              next_retry_at = $4,
              finished_at = NULL
        WHERE id = $5`,
      [
        JSON.stringify(stepResults || []),
        JSON.stringify(context || {}),
        delayStep?.id ?? null,
        scheduledFor,
        runId,
      ]
    );
    await client.query("COMMIT");
    return resumeEventId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function markRunRetrying(runId, { attempt, stepResults, context, error, resumeFromStepId, nextRetryAt }) {
  const pool = getPool();
  await pool.query(
    `UPDATE automation_runs
        SET status = 'retrying',
            attempt = $1,
            step_results = $2::jsonb,
            context = $3::jsonb,
            error = $4,
            resume_from_step = $5,
            next_retry_at = $6,
            finished_at = NULL
      WHERE id = $7`,
    [
      attempt,
      JSON.stringify(stepResults || []),
      JSON.stringify(context || {}),
      error || null,
      resumeFromStepId ?? null,
      nextRetryAt,
      runId,
    ]
  );
}

const MAX_BRANCH_DEPTH = 5;

/**
 * Filter handler reused for branch step's condition (same shape).
 * Avoids duplicating the operator table here.
 */
async function evaluateBranchCondition(branchStep, scope) {
  const cfg = renderDeep(branchStep.config || {}, scope);
  const res = await runFilter({ config: cfg, scope });
  // runFilter returns success when condition passes, filtered_out when
  // it fails. We translate that to a boolean for the branch.
  if (res.status === "success") return { passed: true, output: res.output };
  if (res.status === "filtered_out") return { passed: false, output: res.output };
  return { error: res.error || "Invalid branch condition.", output: res.output };
}

/**
 * Core step executor. Iterates steps in step_order, recording each
 * result. When a step fails, returns control to the caller along with
 * the failed step's id so retry logic can pick up there.
 *
 * Existing step_results (from a previous attempt) are honored — any
 * step already at status='success' is skipped on resume and its
 * recorded output stays in place.
 *
 * The context object is mutated in place by handlers (e.g. ai_draft
 * sets context[output_key]). Caller passes in an empty {} for a fresh
 * run, or the persisted context for a resume.
 *
 * Phase 2 §3 — `branch` steps: when one is hit, the executor evaluates
 * its condition, loads the matching path's children from the DB, and
 * recurses. depth is incremented per recursion and capped so a
 * misconfigured nested branch can't loop forever.
 */
async function executeSteps(
  automationSteps,
  { event, context, existingResults, resumeFromStepId, depth = 0 }
) {
  if (depth > MAX_BRANCH_DEPTH) {
    return {
      kind: "failed",
      results: existingResults || [],
      transient: false,
      error: `Branch nesting exceeded ${MAX_BRANCH_DEPTH} levels.`,
      failedStep: null,
    };
  }
  const results = Array.isArray(existingResults) ? existingResults.slice() : [];
  const resultByStepId = new Map();
  for (const r of results) {
    if (r.step_id != null) resultByStepId.set(r.step_id, r);
  }

  // If we have a resume target, find its index and pick up there.
  // Anything before resumeFromStepId is considered already-done — we
  // do NOT re-execute side-effecting steps like send_sms.
  let resumeIndex = 0;
  if (resumeFromStepId != null) {
    const idx = automationSteps.findIndex((s) => s.id === resumeFromStepId);
    if (idx >= 0) {
      resumeIndex = idx;
      // Drop the old entry ONLY when we intend to re-execute the step
      // (i.e. it failed last time). For a delay-resume the entry is
      // status='success' and stays — the for-loop's skip-if-success
      // guard below takes care of moving past it.
      const oldIdx = results.findIndex((r) => r.step_id === resumeFromStepId);
      if (oldIdx >= 0 && results[oldIdx].status === "failed") {
        results.splice(oldIdx, 1);
        resultByStepId.delete(resumeFromStepId);
      }
    }
  }

  for (let i = resumeIndex; i < automationSteps.length; i++) {
    const step = automationSteps[i];
    // Skip if this step already succeeded in a prior attempt.
    const prior = resultByStepId.get(step.id);
    if (prior && prior.status === "success") {
      continue;
    }

    // Phase 2 §3: branch step is special — evaluate the condition,
    // load the matching path's children, recurse. The branch itself
    // never "fails" the run; its children's outcomes do. Branch
    // recursion respects MAX_BRANCH_DEPTH.
    if (step.step_type === "branch") {
      const scope = { event, context };
      const cond = await evaluateBranchCondition(step, scope);
      if (cond.error) {
        const entry = {
          step_id: step.id,
          step_order: step.step_order,
          step_type: "branch",
          status: "failed",
          error: cond.error,
          output: cond.output ?? null,
        };
        results.push(entry);
        return { kind: "failed", results, failedStep: step, transient: false, error: cond.error };
      }
      const childPath = cond.passed ? "true" : "false";
      const children = await loadBranchChildren(step.automation_id, step.id, childPath);
      results.push({
        step_id: step.id,
        step_order: step.step_order,
        step_type: "branch",
        status: "success",
        output: { passed: cond.passed, branch_path: childPath, child_count: children.length },
        error: null,
      });
      const childOutcome = await executeSteps(children, {
        event,
        context,
        existingResults: results,
        resumeFromStepId,
        depth: depth + 1,
      });
      // executeSteps in recursion returns its full results array
      // (which already contains our entry, since we passed `results`
      // by reference). Hand the children's outcome straight back.
      if (childOutcome.kind === "success") {
        // The children path completed — continue with any steps after
        // the branch at this level. Replace results so we keep the
        // child entries, then fall through to the next sibling.
        // (childOutcome.results === results so no copy needed.)
        continue;
      }
      // failed / filtered_out / waiting bubble up unchanged.
      return childOutcome;
    }

    // Phase 2 §2: delay step is special — it doesn't run through the
    // HANDLERS map. We record a success entry and return 'waiting' so
    // the caller can write a scheduled resume event and park the run.
    if (step.step_type === "delay") {
      const cfg = renderDeep(step.config || {}, { event, context });
      const minutes = Number(cfg.duration_minutes);
      const hours = Number(cfg.duration_hours);
      const days = Number(cfg.duration_days);
      let totalMs = 0;
      if (Number.isFinite(minutes) && minutes > 0) totalMs += minutes * 60 * 1000;
      if (Number.isFinite(hours) && hours > 0) totalMs += hours * 60 * 60 * 1000;
      if (Number.isFinite(days) && days > 0) totalMs += days * 24 * 60 * 60 * 1000;
      if (totalMs <= 0) {
        const entry = {
          step_id: step.id,
          step_order: step.step_order,
          step_type: step.step_type,
          status: "failed",
          error: "delay: must set a positive duration (duration_minutes / duration_hours / duration_days).",
          output: null,
        };
        results.push(entry);
        return {
          kind: "failed",
          results,
          failedStep: step,
          transient: false,
          error: entry.error,
        };
      }
      const scheduledFor = new Date(Date.now() + totalMs);
      results.push({
        step_id: step.id,
        step_order: step.step_order,
        step_type: "delay",
        status: "success",
        output: { scheduled_for: scheduledFor.toISOString(), duration_ms: totalMs },
        error: null,
      });
      return { kind: "waiting", results, delayStep: step, scheduledFor };
    }

    const handler = HANDLERS[step.step_type];
    if (!handler) {
      const entry = {
        step_id: step.id,
        step_order: step.step_order,
        step_type: step.step_type,
        status: "failed",
        error: `Unknown step type: ${step.step_type}`,
        output: null,
      };
      results.push(entry);
      return { kind: "failed", results, failedStep: step, transient: false, error: entry.error };
    }

    const scope = { event, context };
    const cfg = renderDeep(step.config || {}, scope);
    let result;
    try {
      result = await handler({ config: cfg, scope, context, event });
    } catch (err) {
      result = {
        status: "failed",
        transient: isTransient(err),
        error: err.message || String(err),
      };
    }

    const entry = {
      step_id: step.id,
      step_order: step.step_order,
      step_type: step.step_type,
      status: result.status,
      output: result.output ?? null,
      error: result.error ?? null,
    };
    results.push(entry);

    if (result.status === "filtered_out") {
      return { kind: "filtered_out", results };
    }
    if (result.status === "failed") {
      const transient = isTransient(result.error, {
        transient: result.transient,
        status: result.status_code,
      });
      return {
        kind: "failed",
        results,
        failedStep: step,
        transient,
        error: result.error || "Step failed.",
      };
    }
  }

  return { kind: "success", results };
}

async function executeAutomation(automation, event) {
  const startedAt = new Date();
  const maxAttempts = DEFAULT_MAX_ATTEMPTS;

  // Per-day rate limit (when configured) — fail closed BEFORE the run
  // row exists, so a rate-limited automation doesn't add noise to the
  // history. Recorded as a single 'skipped' row instead.
  if (automation.max_runs_per_day && automation.max_runs_per_day > 0) {
    const used = await dailyRunCount(automation.id);
    if (used >= automation.max_runs_per_day) {
      await getPool().query(
        `INSERT INTO automation_runs
           (automation_id, event_id, status, started_at, finished_at,
            step_results, error, attempt, max_attempts)
         VALUES ($1, $2, 'skipped', $3, NOW(), '[]'::jsonb, $4, 1, $5)`,
        [
          automation.id,
          event.id,
          startedAt,
          `Skipped: max_runs_per_day (${automation.max_runs_per_day}) reached.`,
          maxAttempts,
        ]
      );
      return { status: "skipped" };
    }
  }

  const runId = await insertRun({ automationId: automation.id, eventId: event.id, startedAt, maxAttempts });
  const context = {};
  const outcome = await executeSteps(automation.steps, { event, context, existingResults: [] });

  if (outcome.kind === "success") {
    await finalizeRun(runId, { status: "success", stepResults: outcome.results, context, error: null });
    return { status: "success" };
  }
  if (outcome.kind === "filtered_out") {
    await finalizeRun(runId, { status: "filtered_out", stepResults: outcome.results, context, error: null });
    return { status: "filtered_out" };
  }
  if (outcome.kind === "waiting") {
    await parkRunForResume({
      runId,
      automationId: automation.id,
      delayStep: outcome.delayStep,
      scheduledFor: outcome.scheduledFor,
      stepResults: outcome.results,
      context,
    });
    return { status: "waiting" };
  }

  // Failed. Decide retry vs permanent.
  if (outcome.transient && 1 < maxAttempts) {
    await markRunRetrying(runId, {
      attempt: 2,
      stepResults: outcome.results,
      context,
      error: outcome.error,
      resumeFromStepId: outcome.failedStep?.id ?? null,
      nextRetryAt: new Date(Date.now() + backoffMs(1)),
    });
    return { status: "retrying" };
  }

  await finalizeRun(runId, {
    status: "failed",
    stepResults: outcome.results,
    context,
    error: outcome.error,
  });
  return { status: "failed", error: outcome.error };
}

/**
 * Atomically claim retry-ready runs. Same SKIP LOCKED pattern as
 * events — flips them to 'running' so concurrent workers don't
 * double-execute.
 */
async function claimRetryRuns(batchSize) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE automation_runs
        SET status = 'running'
      WHERE id IN (
        SELECT id FROM automation_runs
         WHERE status = 'retrying' AND next_retry_at <= NOW()
         ORDER BY next_retry_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [batchSize]
  );
  return rows;
}

async function executeRetry(runRow) {
  const pool = getPool();
  // Load the source event and the automation's full step list.
  const { rows: eventRows } = await pool.query(
    `SELECT * FROM events WHERE id = $1`,
    [runRow.event_id]
  );
  const event = eventRows[0];
  if (!event) {
    // The source event was purged or deleted — we can't replay safely.
    await finalizeRun(runRow.id, {
      status: "dead_letter",
      stepResults: runRow.step_results || [],
      context: runRow.context || {},
      error: "Retry abandoned: source event no longer exists.",
    });
    return;
  }
  const { rows: steps } = await pool.query(
    `SELECT id, automation_id, step_order, step_type, config
       FROM automation_steps
      WHERE automation_id = $1
      ORDER BY step_order ASC`,
    [runRow.automation_id]
  );

  const context =
    runRow.context && typeof runRow.context === "object" ? { ...runRow.context } : {};
  const existingResults = Array.isArray(runRow.step_results) ? runRow.step_results : [];
  const outcome = await executeSteps(steps, {
    event,
    context,
    existingResults,
    resumeFromStepId: runRow.resume_from_step ?? null,
  });

  if (outcome.kind === "success") {
    await finalizeRun(runRow.id, { status: "success", stepResults: outcome.results, context, error: null });
    return;
  }
  if (outcome.kind === "filtered_out") {
    await finalizeRun(runRow.id, { status: "filtered_out", stepResults: outcome.results, context, error: null });
    return;
  }
  if (outcome.kind === "waiting") {
    await parkRunForResume({
      runId: runRow.id,
      automationId: runRow.automation_id,
      delayStep: outcome.delayStep,
      scheduledFor: outcome.scheduledFor,
      stepResults: outcome.results,
      context,
    });
    return;
  }

  const nextAttempt = (runRow.attempt || 1) + 1;
  const maxAttempts = runRow.max_attempts || DEFAULT_MAX_ATTEMPTS;
  if (outcome.transient && nextAttempt <= maxAttempts) {
    await markRunRetrying(runRow.id, {
      attempt: nextAttempt,
      stepResults: outcome.results,
      context,
      error: outcome.error,
      resumeFromStepId: outcome.failedStep?.id ?? null,
      nextRetryAt: new Date(Date.now() + backoffMs(nextAttempt - 1)),
    });
    return;
  }

  // Out of attempts (or permanent error) — dead letter.
  await finalizeRun(runRow.id, {
    status: outcome.transient ? "dead_letter" : "failed",
    stepResults: outcome.results,
    context,
    error: outcome.error,
  });
}

/**
 * Phase 2 §2: resume a run that previously parked on a delay step.
 * Replays the run's stored context and step_results, then continues
 * executing from the step after the delay.
 */
async function processResumeEvent(event) {
  const pool = getPool();
  const payload = (event.payload && typeof event.payload === "object") ? event.payload : {};
  const runId = Number(payload.run_id);
  if (!Number.isFinite(runId)) {
    await pool.query(
      `UPDATE events SET status = 'skipped', processed_at = NOW(),
              error = 'resume event missing run_id'
        WHERE id = $1`,
      [event.id]
    );
    return;
  }
  const { rows: runRows } = await pool.query(
    `SELECT * FROM automation_runs WHERE id = $1`,
    [runId]
  );
  const runRow = runRows[0];
  if (!runRow) {
    await pool.query(
      `UPDATE events SET status = 'skipped', processed_at = NOW(),
              error = 'resume event references a missing run'
        WHERE id = $1`,
      [event.id]
    );
    return;
  }
  if (runRow.status !== "waiting") {
    // A human may have intervened (manual retry, manual fail). Don't
    // re-execute a non-waiting run — just mark the event processed.
    await pool.query(
      `UPDATE events SET status = 'processed', processed_at = NOW(),
              error = 'resume skipped: run is no longer waiting'
        WHERE id = $1`,
      [event.id]
    );
    return;
  }

  // Reuse the same path as a retry — executeSteps + finalize.
  // Mark the run 'running' first so a concurrent worker doesn't pick
  // it up via the (admittedly cold) retry sweep.
  await pool.query(`UPDATE automation_runs SET status = 'running' WHERE id = $1`, [runId]);

  // Load the original source event for templating against {{event.*}}.
  const { rows: sourceRows } = await pool.query(`SELECT * FROM events WHERE id = $1`, [runRow.event_id]);
  const sourceEvent = sourceRows[0] || event;
  const { rows: steps } = await pool.query(
    `SELECT id, automation_id, step_order, step_type, config
       FROM automation_steps
      WHERE automation_id = $1
      ORDER BY step_order ASC`,
    [runRow.automation_id]
  );

  const context =
    runRow.context && typeof runRow.context === "object" ? { ...runRow.context } : {};
  const existingResults = Array.isArray(runRow.step_results) ? runRow.step_results : [];

  try {
    const outcome = await executeSteps(steps, {
      event: sourceEvent,
      context,
      existingResults,
      resumeFromStepId: runRow.resume_from_step ?? null,
    });

    if (outcome.kind === "success") {
      await finalizeRun(runId, { status: "success", stepResults: outcome.results, context, error: null });
    } else if (outcome.kind === "filtered_out") {
      await finalizeRun(runId, { status: "filtered_out", stepResults: outcome.results, context, error: null });
    } else if (outcome.kind === "waiting") {
      // A second delay step further down the flow.
      await parkRunForResume({
        runId,
        automationId: runRow.automation_id,
        delayStep: outcome.delayStep,
        scheduledFor: outcome.scheduledFor,
        stepResults: outcome.results,
        context,
      });
    } else if (outcome.kind === "failed") {
      const maxAttempts = runRow.max_attempts || DEFAULT_MAX_ATTEMPTS;
      const nextAttempt = (runRow.attempt || 1) + 1;
      if (outcome.transient && nextAttempt <= maxAttempts) {
        await markRunRetrying(runId, {
          attempt: nextAttempt,
          stepResults: outcome.results,
          context,
          error: outcome.error,
          resumeFromStepId: outcome.failedStep?.id ?? null,
          nextRetryAt: new Date(Date.now() + backoffMs(nextAttempt - 1)),
        });
      } else {
        await finalizeRun(runId, {
          status: outcome.transient ? "dead_letter" : "failed",
          stepResults: outcome.results,
          context,
          error: outcome.error,
        });
      }
    }
    await pool.query(
      `UPDATE events SET status = 'processed', processed_at = NOW() WHERE id = $1`,
      [event.id]
    );
  } catch (err) {
    await pool
      .query(
        `UPDATE events SET status = 'failed', processed_at = NOW(), error = $1 WHERE id = $2`,
        [`resume crashed: ${err.message || String(err)}`, event.id]
      )
      .catch(() => {});
    await finalizeRun(runId, {
      status: "dead_letter",
      stepResults: runRow.step_results || [],
      context: runRow.context || {},
      error: `Resume crashed: ${err.message || String(err)}`,
    }).catch(() => {});
  }
}

async function processEvent(event) {
  // Phase 2 §2: resume events route to a dedicated handler.
  if (event.type === RESUME_EVENT_TYPE) {
    return processResumeEvent(event);
  }

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
      // Phase 2 §1: a 'retrying' outcome is still in flight — it's not
      // a failure from the event's perspective. Treat anything that
      // isn't an outright 'failed' as "OK enough" to mark the event
      // processed; the run row carries the real ongoing state.
      if (r.status === "failed") hadFailure = true;
      else hadSuccess = true;
    }
    // If at least one automation succeeded/filtered/is-retrying, call
    // it processed. Only mark the event failed if every automation
    // blew up permanently — that's a signal worth investigating.
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

/**
 * Phase 2 §1: also sweep runs stuck in 'running'. A worker that
 * crashed between `insertRun` and `finalizeRun` would otherwise leave
 * an orphaned row forever. We mark them dead_letter with a note so
 * a human can investigate or click "Retry now".
 */
async function sweepStuckRuns() {
  const pool = getPool();
  try {
    const { rowCount } = await pool.query(
      `UPDATE automation_runs
          SET status = 'dead_letter',
              finished_at = NOW(),
              error = COALESCE(error, '') || ' [stuck-run sweep: worker crashed mid-execution]'
        WHERE status = 'running'
          AND started_at < NOW() - ($1 || ' milliseconds')::interval`,
      [String(STUCK_THRESHOLD_MS)]
    );
    if (rowCount > 0) {
      console.log(`[worker] swept ${rowCount} stuck run(s) to dead_letter`);
    }
  } catch (err) {
    console.error("[worker] stuck-run sweep failed:", err.message || err);
  }
}

/**
 * Phase 2 §2: schedule ticker. Once a minute, find rows whose
 * next_fire_at has arrived, atomically claim them (so two workers
 * never double-fire), write the corresponding trigger event, and
 * compute the new next_fire_at from the cron expression in the
 * stored timezone (Houston = America/Chicago, observes DST — UTC
 * math would drift 9am by an hour twice a year).
 */
async function tickSchedules() {
  const pool = getPool();
  let claimed;
  try {
    // Atomic claim — flip due rows to last_fired_at=NOW() so a concurrent
    // worker can't see them as still-due.
    const { rows } = await pool.query(
      `UPDATE automation_schedules
          SET last_fired_at = NOW()
        WHERE id IN (
          SELECT id FROM automation_schedules
           WHERE enabled = true
             AND next_fire_at IS NOT NULL
             AND next_fire_at <= NOW()
           ORDER BY next_fire_at ASC
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, automation_id, cron_expression, timezone, last_fired_at`
    );
    claimed = rows;
  } catch (err) {
    console.error("[worker] schedule tick claim failed:", err.message || err);
    return;
  }

  for (const sched of claimed) {
    try {
      // Resolve the automation's trigger_type so the emitted event
      // matches what the user authored against.
      const { rows: autos } = await pool.query(
        `SELECT trigger_type FROM automations WHERE id = $1`,
        [sched.automation_id]
      );
      const triggerType = autos[0]?.trigger_type || "schedule.triggered";
      await pool.query(
        `INSERT INTO events (type, source, payload)
         VALUES ($1, 'schedule', $2::jsonb)`,
        [
          triggerType,
          JSON.stringify({
            schedule_id: sched.id,
            automation_id: sched.automation_id,
            fired_at: new Date().toISOString(),
            scheduled: true,
          }),
        ]
      );

      // Compute next_fire_at in the schedule's timezone.
      let nextFire = null;
      try {
        const it = cronParser.parseExpression(sched.cron_expression, {
          tz: sched.timezone || "America/Chicago",
          currentDate: new Date(),
        });
        nextFire = it.next().toDate();
      } catch (cronErr) {
        console.error(
          `[worker] cron parse failed for schedule ${sched.id} (${sched.cron_expression}):`,
          cronErr.message
        );
      }
      await pool.query(
        `UPDATE automation_schedules
            SET next_fire_at = $1, updated_at = NOW()
          WHERE id = $2`,
        [nextFire, sched.id]
      );
    } catch (err) {
      console.error(`[worker] schedule ${sched.id} fire failed:`, err.message || err);
    }
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

/**
 * Boot-order guard. On a fresh deploy the worker container can come up
 * a few seconds before the backend finishes running its ensure-schema
 * step — that race left the worker crash-looping for 14 hours in
 * Phase 1 because every poll query failed against missing tables, and
 * Docker's restart policy never gave the schema time to land.
 *
 * Block startup until `events` exists. Retry quietly for up to ~2min,
 * then exit non-zero so Docker restarts us with fresh state.
 */
async function waitForSchema() {
  const pool = getPool();
  const MAX_ATTEMPTS = 60;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await pool.query("SELECT to_regclass('public.events') AS t");
      if (r.rows[0].t) {
        console.log(`[worker] schema ready (attempt ${attempt})`);
        return;
      }
    } catch {
      // Pool or DB not up yet — fall through and retry.
    }
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`[worker] waiting for schema (attempt ${attempt}/${MAX_ATTEMPTS})`);
    }
    await sleep(2000);
  }
  throw new Error("[worker] schema never appeared — exiting");
}

async function processLoop() {
  console.log(
    `[worker] starting — poll=${POLL_INTERVAL_MS}ms batch=${BATCH_SIZE} handlers=[${Object.keys(HANDLERS).join(", ")}]`
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // Phase 2 §1: each tick claims BOTH new events AND retry-ready
      // runs. The retry branch comes first because a back-pressured
      // queue of new events shouldn't starve in-flight retries — a
      // retry already represents a partially-paid-for run, finishing
      // it has priority.
      const retries = await claimRetryRuns(RETRY_BATCH_SIZE);
      for (const runRow of retries) {
        try {
          await executeRetry(runRow);
        } catch (err) {
          console.error(`[worker] retry of run ${runRow.id} crashed:`, err);
          // Best-effort: mark dead_letter so the sweep doesn't have
          // to clean it up later.
          await finalizeRun(runRow.id, {
            status: "dead_letter",
            stepResults: runRow.step_results || [],
            context: runRow.context || {},
            error: `Retry crashed: ${err.message || String(err)}`,
          }).catch(() => {});
        }
      }

      const events = await claimPendingEvents(BATCH_SIZE);
      if (events.length === 0 && retries.length === 0) {
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
    sweepStuckRuns().catch(() => {});
  }, STUCK_SWEEP_INTERVAL_MS);
  setInterval(() => {
    cleanupOldEvents().catch(() => {});
  }, CLEANUP_INTERVAL_MS);
  setInterval(() => {
    tickSchedules().catch(() => {});
  }, SCHEDULE_TICK_INTERVAL_MS);
}

process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM — exiting");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[worker] SIGINT — exiting");
  process.exit(0);
});

// Wait for the schema before any timers (sweepers query tables too) or
// the main poll. If the schema check times out we exit non-zero —
// Docker's restart policy gives us a clean slate without burning CPU
// in a hot crash loop.
(async () => {
  try {
    await waitForSchema();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
  startTimers();
  processLoop().catch((err) => {
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
})();
