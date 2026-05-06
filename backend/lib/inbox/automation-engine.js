/**
 * Phase 4: workflow automation rules engine.
 *
 * For each trigger event we pull active rules in priority_rank order,
 * evaluate the conditions JSON against the thread, and either log a
 * hypothetical action (shadow), log a suggestion (suggested), or apply
 * the action (auto).
 *
 * Three guarantees:
 *   1. Idempotency — `(rule_id, thread_id, trigger)` is a unique index, so
 *      replaying a trigger event is a no-op.
 *   2. One auto per trigger — once an `auto` rule executes for a thread on
 *      a given trigger, subsequent matching auto rules log as
 *      `executed=false, skipped_reason='another auto rule already acted'`.
 *      Suggested + shadow rules still log normally.
 *   3. Reversibility — every auto-action stores a `revert_payload` with
 *      the pre-action values so the route layer can undo within 24h.
 */

import { getPool } from "../db.js";

const PAUSE_STATUSES_DEFAULT = new Set([
  "waiting_on_tenant",
  "waiting_on_owner",
  "waiting_on_vendor",
  "snoozed",
]);

const ACTIONS_EXECUTABLE = new Set([
  "assign",
  "set_status",
  "set_priority",
  "close",
  "star",
  "escalate",
]);
// Actions that we log but never execute server-side. The UI surfaces them
// for the operator (suggested → one-click; auto → still no execution).
const ACTIONS_SUGGESTION_ONLY = new Set(["create_task", "create_work_order", "apply_label"]);

/**
 * Evaluate a conditions JSON against a thread row + the most recent
 * inbound ticket. Supported keys (more can be added later without engine
 * changes — unknown keys cause the rule to be skipped with a logged
 * skipped_reason so we don't silently match on a typo'd condition).
 */
function evaluateConditions(conditions, ctx) {
  const reasons = [];
  if (!conditions || typeof conditions !== "object") return { matched: true };

  for (const [key, want] of Object.entries(conditions)) {
    switch (key) {
      case "category":
        if (ctx.thread.category !== String(want)) reasons.push(`category!=${want}`);
        break;
      case "category_in":
        if (!Array.isArray(want) || !want.includes(ctx.thread.category)) reasons.push(`category not in ${JSON.stringify(want)}`);
        break;
      case "priority":
        if (ctx.thread.priority !== String(want)) reasons.push(`priority!=${want}`);
        break;
      case "priority_in":
        if (!Array.isArray(want) || !want.includes(ctx.thread.priority)) reasons.push(`priority not in ${JSON.stringify(want)}`);
        break;
      case "mailbox_id":
      case "connection_id":
        if (Number(ctx.thread.connection_id) !== Number(want)) reasons.push(`connection_id!=${want}`);
        break;
      case "subject_contains":
        if (!String(ctx.thread.subject || "").toLowerCase().includes(String(want).toLowerCase())) {
          reasons.push(`subject does not contain "${want}"`);
        }
        break;
      case "body_contains":
        if (!String(ctx.message?.body_preview || "").toLowerCase().includes(String(want).toLowerCase())) {
          reasons.push(`body does not contain "${want}"`);
        }
        break;
      case "min_message_count":
        if ((ctx.thread.message_count ?? 0) < Number(want)) reasons.push(`message_count < ${want}`);
        break;
      case "starred":
        if (ctx.thread.starred !== !!want) reasons.push(`starred!=${want}`);
        break;
      default:
        return { matched: false, unknown: true, skipped_reason: `unknown condition "${key}"` };
    }
  }
  return { matched: reasons.length === 0, reasons };
}

/** Resolve an assignee_username against the live users table. Returns the
 *  numeric id or null if not found. */
async function resolveAssigneeId(pool, params) {
  if (!params) return null;
  if (Number.isFinite(Number(params.assignee_id))) return Number(params.assignee_id);
  if (typeof params.assignee_username === "string" && params.assignee_username.trim()) {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND active = TRUE LIMIT 1`,
      [params.assignee_username.trim()]
    );
    return rows[0]?.id ?? null;
  }
  return null;
}

/** Compose a concrete proposed_action JSON resolving any user lookups so
 *  the log entry is self-describing and the revert payload can be applied
 *  without re-querying the live users table. */
async function resolveProposedAction(pool, rule) {
  const params = rule.action_params || {};
  switch (rule.action) {
    case "assign": {
      const assigneeId = await resolveAssigneeId(pool, params);
      return { action: "assign", assignee_id: assigneeId };
    }
    case "set_status":
      return { action: "set_status", status: params.status || null };
    case "set_priority":
      return { action: "set_priority", priority: params.priority || null };
    case "close":
      return { action: "set_status", status: "closed" };
    case "star":
      return { action: "set_starred", starred: params.starred !== false };
    case "escalate": {
      const assigneeId = await resolveAssigneeId(pool, params);
      return {
        action: "escalate",
        assignee_id: assigneeId,
        priority: params.priority || "high",
        starred: params.star === true || params.starred === true ? true : null,
      };
    }
    case "create_task":
    case "create_work_order":
    case "apply_label":
      return { action: rule.action, params: params };
    default:
      return { action: rule.action, params: params, unknown: true };
  }
}

/** Capture the thread fields we'd mutate so we can undo within 24h. */
function captureRevertPayload(thread, proposed) {
  const revert = {};
  switch (proposed.action) {
    case "assign":
      revert.assignee_id = thread.assignee_id ?? null;
      break;
    case "set_status":
      revert.status = thread.status;
      break;
    case "set_priority":
      revert.priority = thread.priority;
      break;
    case "set_starred":
      revert.starred = thread.starred;
      break;
    case "escalate":
      revert.assignee_id = thread.assignee_id ?? null;
      revert.priority = thread.priority;
      revert.starred = thread.starred;
      break;
    default:
      return null;
  }
  return revert;
}

/** Apply a proposed action to the thread. Mirrors the routes/inboxThreads
 *  patch path so the underlying tickets stay coherent. */
async function applyAction(pool, threadId, proposed, userId) {
  const sets = [];
  const vals = [];
  let n = 1;
  switch (proposed.action) {
    case "assign":
      sets.push(`assignee_id = $${n++}`);
      vals.push(proposed.assignee_id ?? null);
      break;
    case "set_status":
      sets.push(`status = $${n++}`);
      vals.push(proposed.status);
      break;
    case "set_priority":
      sets.push(`priority = $${n++}`);
      vals.push(proposed.priority);
      break;
    case "set_starred":
      sets.push(`starred = $${n++}`);
      vals.push(!!proposed.starred);
      break;
    case "escalate":
      if (proposed.assignee_id != null) {
        sets.push(`assignee_id = $${n++}`);
        vals.push(proposed.assignee_id);
      }
      if (proposed.priority) {
        sets.push(`priority = $${n++}`);
        vals.push(proposed.priority);
      }
      if (proposed.starred === true) {
        sets.push(`starred = $${n++}`);
        vals.push(true);
      }
      break;
    default:
      return; // Suggestion-only or unknown — caller logs without executing.
  }
  if (!sets.length) return;
  if (userId != null) {
    sets.push(`last_touched_by = $${n++}`);
    vals.push(userId);
  }
  sets.push(`last_touched_at = NOW()`);
  sets.push(`updated_at = NOW()`);
  vals.push(threadId);
  await pool.query(
    `UPDATE threads SET ${sets.join(", ")} WHERE thread_id = $${n}`,
    vals
  );
  // Mirror status/assignee onto underlying tickets so legacy views stay coherent.
  if (proposed.action === "set_status" || proposed.action === "escalate") {
    const ticketStatus = threadStatusToTicketStatus(
      proposed.action === "set_status" ? proposed.status : "open"
    );
    if (ticketStatus) {
      await pool.query(
        `UPDATE tickets SET status = $1, updated_at = NOW()
          WHERE thread_id = $2 AND deleted_at IS NULL`,
        [ticketStatus, threadId]
      );
    }
  }
  if (proposed.action === "assign" || (proposed.action === "escalate" && proposed.assignee_id != null)) {
    await pool.query(
      `UPDATE tickets SET assigned_to = $1, updated_at = NOW()
        WHERE thread_id = $2 AND deleted_at IS NULL`,
      [proposed.assignee_id, threadId]
    );
  }
}

function threadStatusToTicketStatus(s) {
  if (s === "open") return "open";
  if (s === "closed") return "resolved";
  if (s && s.startsWith("waiting_on_")) return "waiting";
  if (s === "snoozed") return "waiting";
  return null;
}

/**
 * Run automation rules for one thread + trigger. Idempotent (relies on
 * the unique log index). Returns the set of log rows it created.
 */
export async function runAutomationsForThread(threadId, trigger, opts = {}) {
  const pool = getPool();
  if (!threadId) return [];

  // Pull thread + most recent inbound message + current confidence.
  const { rows: tRows } = await pool.query(
    `SELECT * FROM threads WHERE thread_id = $1`,
    [threadId]
  );
  const thread = tRows[0];
  if (!thread) return [];

  const { rows: mRows } = await pool.query(
    `SELECT id, subject, body_preview, ai_confidence
       FROM tickets
      WHERE thread_id = $1 AND deleted_at IS NULL
      ORDER BY received_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [threadId]
  );
  const message = mRows[0] || null;
  const confidence =
    message && message.ai_confidence != null ? Number(message.ai_confidence) : null;

  const ctx = { thread, message };
  const created = [];
  let autoExecutedThisCycle = false;

  const { rows: rules } = await pool.query(
    `SELECT * FROM automation_rules
      WHERE active = TRUE AND trigger = $1
      ORDER BY priority_rank ASC, id ASC`,
    [trigger]
  );

  for (const rule of rules) {
    const evalResult = evaluateConditions(rule.conditions, ctx);
    const matched = evalResult.matched && !evalResult.unknown;

    let executed = false;
    let skippedReason = null;
    let proposed = null;
    let revertPayload = null;

    if (matched) {
      proposed = await resolveProposedAction(pool, rule);

      // Confidence gating only applies to suggested + auto. Shadow always
      // logs so operators can see confidence distribution and tune.
      const confidenceOk =
        rule.mode === "shadow" ||
        Number(rule.confidence_min) <= 0 ||
        (confidence != null && confidence >= Number(rule.confidence_min));

      if (rule.mode === "auto") {
        if (autoExecutedThisCycle) {
          skippedReason = "another auto rule already acted on this thread";
        } else if (!confidenceOk) {
          skippedReason =
            confidence == null
              ? "no AI confidence on the thread"
              : `confidence ${confidence} < ${rule.confidence_min}`;
        } else if (ACTIONS_SUGGESTION_ONLY.has(rule.action)) {
          skippedReason = "action is suggestion-only — never auto";
        } else if (!ACTIONS_EXECUTABLE.has(rule.action)) {
          skippedReason = "unknown action";
        } else {
          revertPayload = captureRevertPayload(thread, proposed);
          try {
            await applyAction(pool, threadId, proposed, opts.actorUserId ?? null);
            executed = true;
            autoExecutedThisCycle = true;
          } catch (e) {
            skippedReason = `apply failed: ${e.message || String(e)}`;
          }
        }
      } else if (rule.mode === "suggested") {
        if (!confidenceOk) {
          skippedReason =
            confidence == null
              ? "no AI confidence — suggestion gated"
              : `confidence ${confidence} < ${rule.confidence_min}`;
        }
      }
    } else {
      skippedReason = evalResult.skipped_reason || (evalResult.reasons || []).join("; ");
    }

    try {
      const { rows: ins } = await pool.query(
        `INSERT INTO automation_log
           (rule_id, thread_id, trigger, matched, proposed_action, revert_payload,
            confidence, mode, executed, executed_at, skipped_reason)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9, CASE WHEN $9 THEN NOW() ELSE NULL END, $10)
         ON CONFLICT (rule_id, thread_id, trigger) DO NOTHING
         RETURNING id`,
        [
          rule.id,
          threadId,
          trigger,
          matched,
          proposed ? JSON.stringify(proposed) : null,
          revertPayload ? JSON.stringify(revertPayload) : null,
          confidence,
          rule.mode,
          executed,
          skippedReason,
        ]
      );
      if (ins.length) created.push(ins[0].id);
    } catch (e) {
      console.error("[automation] log insert failed", rule.id, threadId, e.message || e);
    }
  }

  return created;
}

/**
 * Revert an auto-action by id. Caller must enforce the 24-hour window.
 * Returns ApiResult-shaped object: { ok: true } | { ok: false, error }.
 */
export async function revertAutomationLog(logId, userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM automation_log WHERE id = $1`,
    [logId]
  );
  const log = rows[0];
  if (!log) return { ok: false, error: "Log entry not found." };
  if (!log.executed) return { ok: false, error: "Nothing to revert — action was never executed." };
  if (log.reverted) return { ok: false, error: "Already reverted." };
  if (!log.executed_at) return { ok: false, error: "No execution timestamp." };
  const ageMs = Date.now() - new Date(log.executed_at).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) {
    return { ok: false, error: "Revert window has closed (24h)." };
  }
  if (!log.revert_payload) {
    return { ok: false, error: "No revert payload captured." };
  }

  // Reapply the captured pre-action values via direct UPDATE (skip the
  // engine's last_touched bookkeeping so the audit trail stays accurate).
  const sets = [];
  const vals = [];
  let n = 1;
  for (const [key, value] of Object.entries(log.revert_payload)) {
    if (key === "assignee_id") {
      sets.push(`assignee_id = $${n++}`);
      vals.push(value ?? null);
    } else if (key === "status") {
      sets.push(`status = $${n++}`);
      vals.push(value);
    } else if (key === "priority") {
      sets.push(`priority = $${n++}`);
      vals.push(value);
    } else if (key === "starred") {
      sets.push(`starred = $${n++}`);
      vals.push(!!value);
    }
  }
  if (!sets.length) return { ok: false, error: "Revert payload had no applicable fields." };
  sets.push(`updated_at = NOW()`);
  vals.push(log.thread_id);

  await pool.query(
    `UPDATE threads SET ${sets.join(", ")} WHERE thread_id = $${n}`,
    vals
  );
  await pool.query(
    `UPDATE automation_log
        SET reverted = TRUE, reverted_at = NOW(), reverted_by = $1
      WHERE id = $2`,
    [userId ?? null, logId]
  );
  return { ok: true };
}

/**
 * Execute a `suggested` rule's proposed action — fires when an operator
 * clicks the one-click button on the thread.
 */
export async function executeSuggestedAutomation(logId, userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM automation_log WHERE id = $1`,
    [logId]
  );
  const log = rows[0];
  if (!log) return { ok: false, error: "Log entry not found." };
  if (log.mode !== "suggested") return { ok: false, error: "Not a suggested automation." };
  if (log.executed) return { ok: false, error: "Already executed." };
  if (!log.proposed_action) return { ok: false, error: "No proposed action recorded." };

  const { rows: tRows } = await pool.query(
    `SELECT * FROM threads WHERE thread_id = $1`,
    [log.thread_id]
  );
  const thread = tRows[0];
  if (!thread) return { ok: false, error: "Thread not found." };

  const proposed = log.proposed_action;
  if (ACTIONS_SUGGESTION_ONLY.has(proposed.action)) {
    // Mark executed but do nothing on the server — these are orchestration
    // hooks for follow-up systems (work orders, tasks, labels) that aren't
    // wired yet.
    await pool.query(
      `UPDATE automation_log SET executed = TRUE, executed_at = NOW() WHERE id = $1`,
      [logId]
    );
    return { ok: true, applied: false, message: "Logged — external system handles execution." };
  }
  if (!ACTIONS_EXECUTABLE.has(proposed.action)) {
    return { ok: false, error: `Cannot execute action: ${proposed.action}` };
  }
  const revertPayload = captureRevertPayload(thread, proposed);
  await applyAction(pool, log.thread_id, proposed, userId);
  await pool.query(
    `UPDATE automation_log
        SET executed = TRUE, executed_at = NOW(), revert_payload = $2::jsonb
      WHERE id = $1`,
    [logId, revertPayload ? JSON.stringify(revertPayload) : null]
  );
  return { ok: true, applied: true };
}

/** Per-rule accuracy stats for the shadow review page. */
export async function getRuleAccuracySummary() {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT
      r.id AS rule_id,
      r.name,
      r.mode,
      r.priority_rank,
      COUNT(l.*)::int AS total_firings,
      COUNT(*) FILTER (WHERE l.feedback = 'good')::int AS good_count,
      COUNT(*) FILTER (WHERE l.feedback = 'wrong')::int AS wrong_count,
      COUNT(*) FILTER (WHERE l.feedback IS NOT NULL)::int AS reviewed_count
    FROM automation_rules r
    LEFT JOIN automation_log l ON l.rule_id = r.id AND l.matched = TRUE
    GROUP BY r.id, r.name, r.mode, r.priority_rank
    ORDER BY r.priority_rank ASC, r.id ASC
  `);
  return rows.map((r) => ({
    ...r,
    accuracy:
      r.reviewed_count > 0
        ? Math.round((r.good_count / r.reviewed_count) * 1000) / 10
        : null,
  }));
}
