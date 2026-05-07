/**
 * Agent Hub automation engine.
 *
 * Five workers:
 *   1. evaluateTriggers (cron, every 15 min)  — finds eligible (automation × agent) pairs and creates runs.
 *   2. executeActions   (cron, every 5 min)   — drains the action queue.
 *   3. reapApprovalWindow (cron, every hour)  — cancels expired pending_approval runs.
 *   4. detectReplies    (cron, every 15 min)  — scans Graph for replies to outbound emails.
 *   5. emitEvent        (inline)              — fires event-based automations from Phase 1+2 code paths.
 *
 * Idempotency is non-negotiable. Concurrent crons must not double-run the
 * same (automation, agent, day) or (automation, agent, event_id). We rely
 * on partial unique indexes (uq_agent_hub_runs_event, uq_agent_hub_runs_daily)
 * combined with FOR UPDATE SKIP LOCKED on the action queue.
 */

import { getPool } from "../db.js";
import { canSendTo, buildMergeContext, getSystemConfig, renderTemplate } from "./compliance.js";
import { sendEmail, sendSms, queuePostcard } from "./sendChannels.js";
import { graphGet } from "../inbox/graph-client.js";
import {
  getValidAccessTokenForConnection,
  pickEmailConnection,
} from "../inbox/microsoft-auth.js";
import { logAudit } from "./audit.js";

// ============================================================
// EVENT EMITTER (called inline from Phase 1+2 routes)
// ============================================================
/**
 * Fire an event for matching event_based automations. Called inline by
 * existing routes:
 *   - referral advance-stage → emitEvent('referral_stage_changed', { agent_id, to_stage, ... }, 'referral_stage:<id>:<stage>')
 *   - agent tier change → emitEvent('agent_tier_changed', { agent_id, to_tier }, 'agent_tier:<id>:<tier>')
 *   - agent status change → emitEvent('agent_status_changed', { agent_id, to_status }, ...)
 *
 * eventId MUST be deterministic per (event source, target). Re-firing
 * with the same eventId is a no-op (uq_agent_hub_runs_event).
 */
export async function emitEvent(eventName, data, eventId) {
  const pool = getPool();
  const agentId = data.agent_id;
  if (!agentId) {
    console.warn(`[agent-hub] emitEvent ${eventName} missing agent_id`, data);
    return [];
  }
  const config = await getSystemConfig();
  if (config?.kill_switch_enabled) {
    return []; // No new automation runs while kill switch engaged.
  }
  const { rows: automations } = await pool.query(
    `SELECT * FROM agent_hub_automations
      WHERE enabled = TRUE AND trigger_type = 'event_based'`
  );
  const fired = [];
  for (const auto of automations) {
    const cfg = auto.trigger_config || {};
    if (cfg.event !== eventName) continue;
    // Match optional data filters (to_stage, to_tier, from_stage).
    if (cfg.to_stage && data.to_stage !== cfg.to_stage) continue;
    if (cfg.from_stage && data.from_stage !== cfg.from_stage) continue;
    if (cfg.to_tier && data.to_tier !== cfg.to_tier) continue;
    if (cfg.to_status && data.to_status !== cfg.to_status) continue;
    try {
      const runId = await createRunIfEligible({
        automation: auto,
        agentId,
        triggeredBy: "event",
        triggeredByEventId: eventId,
      });
      if (runId) fired.push({ automation_id: auto.id, run_id: runId });
    } catch (e) {
      // Log but don't break the parent request — automations are best-effort.
      console.error(`[agent-hub] emitEvent ${eventName} create failed`, e);
    }
  }
  return fired;
}

// ============================================================
// CONDITION EVALUATOR
// ============================================================
function evaluateCondition(agent, cond) {
  const v = agent[cond.field];
  switch (cond.op) {
    case "eq": return v === cond.value;
    case "ne": return v !== cond.value;
    case "in": return Array.isArray(cond.value) && cond.value.includes(v);
    case "not_in": return Array.isArray(cond.value) && !cond.value.includes(v);
    case "gt": return v != null && v > cond.value;
    case "lt": return v != null && v < cond.value;
    case "is_null": return v == null;
    case "is_not_null": return v != null;
    default:
      console.warn(`[agent-hub] unknown op ${cond.op}`);
      return false;
  }
}

// Special pseudo-fields that derive from agent + personal_details.
async function buildAgentEvalRow(pool, agentId) {
  const { rows } = await pool.query(
    `SELECT a.*,
            (p.birthday_month IS NOT NULL AND p.birthday_day IS NOT NULL) AS has_birthday,
            (a.mailing_address_1 IS NOT NULL AND a.city IS NOT NULL
              AND a.state IS NOT NULL AND a.zip IS NOT NULL) AS has_mailing_address,
            p.birthday_month, p.birthday_day, p.spouse_name, p.anniversary_date
       FROM agent_hub_agents a
       LEFT JOIN agent_hub_personal_details p ON p.agent_id = a.id
      WHERE a.id = $1`,
    [agentId]
  );
  return rows[0] || null;
}

function meetsConditions(agentRow, conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  // AND-only for v1.
  return conditions.every((c) => evaluateCondition(agentRow, c));
}

// ============================================================
// RUN CREATION (shared by trigger evaluator + event emitter)
// ============================================================
async function createRunIfEligible({ automation, agentId, triggeredBy, triggeredByEventId = null, simulate = false }) {
  const pool = getPool();
  const agentRow = await buildAgentEvalRow(pool, agentId);
  if (!agentRow) return null;

  if (!meetsConditions(agentRow, automation.conditions)) {
    if (simulate) return { skipped: "conditions_not_met" };
    return null;
  }

  // Cooldown — reject if a non-skipped run for (automation, agent) exists
  // within cooldown_period_days.
  if (automation.cooldown_period_days != null && automation.cooldown_period_days > 0) {
    const { rows } = await pool.query(
      `SELECT 1 FROM agent_hub_automation_runs
        WHERE automation_id = $1 AND agent_id = $2
          AND triggered_by != 'simulator'
          AND status NOT IN ('skipped','cancelled','failed')
          AND triggered_at >= NOW() - ($3 || ' days')::interval
        LIMIT 1`,
      [automation.id, agentId, String(automation.cooldown_period_days)]
    );
    if (rows.length) {
      if (simulate) return { skipped: "cooldown_active" };
      return null;
    }
  }

  // Lifetime cap.
  if (automation.max_runs_per_agent != null) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM agent_hub_automation_runs
        WHERE automation_id = $1 AND agent_id = $2
          AND triggered_by != 'simulator'
          AND status IN ('approved','running','completed')`,
      [automation.id, agentId]
    );
    if (rows[0].n >= automation.max_runs_per_agent) {
      if (simulate) return { skipped: "max_runs_reached" };
      return null;
    }
  }

  if (simulate) {
    // In simulator mode, bail before any DB write.
    return { eligible: true };
  }

  // Insert run + actions atomically.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const wantsApproval = automation.requires_approval;
    const status = wantsApproval ? "pending_approval" : "approved";
    const approvalUntil = wantsApproval
      ? new Date(Date.now() + automation.approval_window_hours * 3600 * 1000).toISOString()
      : null;

    let runId;
    try {
      const { rows: runRows } = await client.query(
        `INSERT INTO agent_hub_automation_runs
           (automation_id, agent_id, triggered_at, triggered_by, triggered_by_event_id,
            status, approval_required_until, actions_total)
         VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          automation.id,
          agentId,
          triggeredBy,
          triggeredByEventId,
          status,
          approvalUntil,
          Array.isArray(automation.actions) ? automation.actions.length : 0,
        ]
      );
      runId = runRows[0].id;
    } catch (e) {
      if (e.code === "23505") {
        // Idempotency hit — another caller already created this run.
        await client.query("ROLLBACK");
        return null;
      }
      throw e;
    }

    // Build action queue. Wait actions add to scheduled_for cumulatively.
    let scheduledOffsetMs = 0;
    const actions = Array.isArray(automation.actions) ? automation.actions : [];
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.type === "wait") {
        const days = Number(a.config?.days) || 0;
        scheduledOffsetMs += days * 86400 * 1000;
        // We still insert wait rows so the queue order is preserved and the
        // executor can mark them completed quickly.
      }
      const scheduledAt = new Date(Date.now() + scheduledOffsetMs).toISOString();
      await client.query(
        `INSERT INTO agent_hub_automation_action_queue
           (automation_run_id, sequence_index, action_type, action_config, scheduled_for, status)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, 'pending')`,
        [runId, i, a.type, JSON.stringify(a.config || {}), scheduledAt]
      );
    }

    await client.query("COMMIT");
    return runId;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================
// 1. TRIGGER EVALUATOR (cron, every 15 min)
// ============================================================
export async function evaluateTriggers() {
  const pool = getPool();
  const config = await getSystemConfig();
  if (config?.kill_switch_enabled) {
    console.log("[agent-hub] kill switch engaged — trigger evaluator skipping");
    return { processed: 0, skipped: 0, kill_switch: true };
  }
  const { rows: automations } = await pool.query(
    `SELECT * FROM agent_hub_automations
      WHERE enabled = TRUE AND trigger_type = 'time_based'`
  );
  let totalCreated = 0;
  for (const auto of automations) {
    try {
      const created = await evaluateOneTimeBasedAutomation(auto);
      totalCreated += created;
    } catch (e) {
      console.error(`[agent-hub] evaluateTriggers ${auto.slug}`, e);
    }
  }
  return { processed: automations.length, created: totalCreated };
}

async function evaluateOneTimeBasedAutomation(auto) {
  const pool = getPool();
  const cfg = auto.trigger_config || {};
  let candidates = [];
  if (cfg.trigger === "birthday") {
    const offsetDays = Number(cfg.offset_days) || 0;
    // Find agents whose birthday is exactly N days from today.
    const { rows } = await pool.query(
      `SELECT a.id
         FROM agent_hub_agents a
         JOIN agent_hub_personal_details p ON p.agent_id = a.id
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          AND p.birthday_month IS NOT NULL AND p.birthday_day IS NOT NULL
          AND make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, p.birthday_month, p.birthday_day)
              = (CURRENT_DATE - $1::int * INTERVAL '1 day')::date
              + ($1::int * INTERVAL '1 day')::interval`,
      [-offsetDays]
    );
    // Simplified: birthday within next |offsetDays| days from today, exact match.
    // The query above is approximate; use simpler: compute target date and match.
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + Math.abs(offsetDays));
    const targetMonth = target.getUTCMonth() + 1;
    const targetDay = target.getUTCDate();
    const { rows: clean } = await pool.query(
      `SELECT a.id FROM agent_hub_agents a
         JOIN agent_hub_personal_details p ON p.agent_id = a.id
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          AND p.birthday_month = $1 AND p.birthday_day = $2`,
      [targetMonth, targetDay]
    );
    candidates = clean.map((r) => r.id);
  } else if (cfg.trigger === "anniversary") {
    // First-referral anniversary.
    const offsetDays = Number(cfg.offset_days) || 0;
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + Math.abs(offsetDays));
    const targetMonth = target.getUTCMonth() + 1;
    const targetDay = target.getUTCDate();
    const { rows } = await pool.query(
      `SELECT a.id FROM agent_hub_agents a
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          AND a.first_contact_date IS NOT NULL
          AND EXTRACT(MONTH FROM a.first_contact_date)::int = $1
          AND EXTRACT(DAY FROM a.first_contact_date)::int = $2`,
      [targetMonth, targetDay]
    );
    candidates = rows.map((r) => r.id);
  } else if (cfg.trigger === "days_since_last_interaction") {
    const threshold = Number(cfg.threshold) || 0;
    const { rows } = await pool.query(
      `SELECT a.id FROM agent_hub_agents a
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          AND (a.last_interaction_date IS NULL
               OR a.last_interaction_date < NOW() - ($1 || ' days')::interval)`,
      [String(threshold)]
    );
    candidates = rows.map((r) => r.id);
  } else if (cfg.trigger === "fixed_schedule") {
    // Phase 3 simplification: fixed_schedule automations expect their own
    // matching cron trigger in index.js — Worker 1's job is just to
    // enumerate eligible agents under conditions and build runs. The
    // schedule_cron string is a contract for the operator who configures
    // index.js, not something the engine parses itself. Here, fire only
    // if today matches the basic "this is the day" semantics: scan for
    // every active warm/partner/vip agent. Safer than parsing cron in JS.
    const { rows } = await pool.query(
      `SELECT a.id FROM agent_hub_agents a
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL`
    );
    candidates = rows.map((r) => r.id);
  } else if (cfg.trigger === "license_anniversary") {
    const offsetDays = Number(cfg.offset_days) || 0;
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + Math.abs(offsetDays));
    const targetMonth = target.getUTCMonth() + 1;
    const targetDay = target.getUTCDate();
    const { rows } = await pool.query(
      `SELECT a.id FROM agent_hub_agents a
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          AND a.license_expiration IS NOT NULL
          AND EXTRACT(MONTH FROM a.license_expiration)::int = $1
          AND EXTRACT(DAY FROM a.license_expiration)::int = $2`,
      [targetMonth, targetDay]
    );
    candidates = rows.map((r) => r.id);
  } else {
    console.warn(`[agent-hub] unknown trigger ${cfg.trigger} on automation ${auto.slug}`);
    return 0;
  }

  let created = 0;
  for (const agentId of candidates) {
    try {
      const runId = await createRunIfEligible({
        automation: auto,
        agentId,
        triggeredBy: "cron",
      });
      if (runId) created++;
    } catch (e) {
      console.error(`[agent-hub] evaluateTriggers ${auto.slug} agent ${agentId}`, e);
    }
  }
  return created;
}

// ============================================================
// 2. ACTION EXECUTOR (cron, every 5 min)
// ============================================================
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const RETRY_BASE_MINUTES = 10;
const STUCK_LEASE_MINUTES = 15;

/**
 * Reap stuck 'executing' rows that exceeded the lease. A worker crash
 * mid-batch (OOM, container restart) leaves rows pinned 'executing'
 * forever without this. Runs at the top of every executor invocation.
 */
async function reapStuckExecuting() {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE agent_hub_automation_action_queue
        SET status = 'pending',
            executing_at = NULL,
            retry_count = retry_count + 1,
            error_text = COALESCE(error_text, '') || ' [reaped stale executing lease]'
      WHERE status = 'executing'
        AND executing_at IS NOT NULL
        AND executing_at < NOW() - ($1 || ' minutes')::interval
     RETURNING id`,
    [String(STUCK_LEASE_MINUTES)]
  );
  if (rows.length) {
    console.warn(`[agent-hub] reaped ${rows.length} stuck 'executing' action(s)`);
  }
}

export async function executeActions() {
  await reapStuckExecuting();
  const pool = getPool();
  const config = await getSystemConfig();
  if (config?.kill_switch_enabled) {
    return { skipped: true, kill_switch: true };
  }
  // Lock a batch of pending action queue rows. SKIP LOCKED prevents
  // concurrent crons from touching the same rows.
  const { rows: batch } = await pool.query(
    `WITH next_batch AS (
       SELECT q.id
         FROM agent_hub_automation_action_queue q
         JOIN agent_hub_automation_runs r ON r.id = q.automation_run_id
        WHERE q.status = 'pending'
          AND q.scheduled_for <= NOW()
          AND r.status IN ('approved','running')
        ORDER BY q.scheduled_for ASC, q.id ASC
        LIMIT $1
        FOR UPDATE OF q SKIP LOCKED
     )
     UPDATE agent_hub_automation_action_queue q
        SET status = 'executing', executing_at = NOW()
       FROM next_batch nb
      WHERE q.id = nb.id
     RETURNING q.*`,
    [BATCH_SIZE]
  );

  let processed = 0;
  for (const action of batch) {
    // Per-action kill-switch recheck. Reading the cached config is
    // essentially free; the cache TTL means at worst we send 30s past
    // the engagement, and within a batch we stop at the next action.
    const liveConfig = await getSystemConfig();
    if (liveConfig?.kill_switch_enabled) {
      // Release the lease we took so the executor can resume from here
      // when the switch is released.
      await pool.query(
        `UPDATE agent_hub_automation_action_queue
            SET status = 'pending', executing_at = NULL,
                error_text = COALESCE(error_text, '') || ' [paused: kill switch]'
          WHERE id = $1 AND status = 'executing'`,
        [action.id]
      );
      console.warn(`[agent-hub] kill switch detected mid-batch — pausing remaining actions`);
      break;
    }
    try {
      await executeOneAction(action);
    } catch (e) {
      // executeOneAction logs internally; a top-level catch here protects
      // the loop against unforeseen throws.
      console.error(`[agent-hub] executeActions fatal action ${action.id}`, e);
    }
    processed++;
  }
  // Release any remaining 'executing' rows from this batch that we didn't
  // process due to the kill switch break above.
  await pool.query(
    `UPDATE agent_hub_automation_action_queue
        SET status = 'pending', executing_at = NULL
      WHERE status = 'executing'
        AND id = ANY($1::int[])`,
    [batch.slice(processed).map((a) => a.id)]
  );

  // Mark runs whose every action is completed/skipped.
  await pool.query(
    `UPDATE agent_hub_automation_runs r
        SET status = 'completed',
            completed_at = NOW(),
            actions_completed = COALESCE((
              SELECT COUNT(*) FROM agent_hub_automation_action_queue
               WHERE automation_run_id = r.id AND status = 'completed'
            ), 0),
            actions_failed = COALESCE((
              SELECT COUNT(*) FROM agent_hub_automation_action_queue
               WHERE automation_run_id = r.id AND status = 'failed'
            ), 0)
      WHERE r.status IN ('approved','running')
        AND NOT EXISTS (
          SELECT 1 FROM agent_hub_automation_action_queue q
           WHERE q.automation_run_id = r.id
             AND q.status IN ('pending','executing')
        )`
  );

  return { processed };
}

async function executeOneAction(action) {
  const pool = getPool();
  let result = null;
  let externalId = null;
  let resolvedStatus = "completed";
  let errorText = null;

  try {
    // Look up run + agent.
    const { rows: runRows } = await pool.query(
      `SELECT r.*, a.* FROM agent_hub_automation_runs r
         JOIN agent_hub_agents a ON a.id = r.agent_id
        WHERE r.id = $1`,
      [action.automation_run_id]
    );
    if (!runRows.length) {
      throw new Error("Run or agent not found.");
    }
    const run = runRows[0];
    const agent = run; // joined columns
    const { rows: tplRows } = action.action_config?.template_slug
      ? await pool.query(`SELECT * FROM agent_hub_message_templates WHERE slug = $1`, [action.action_config.template_slug])
      : { rows: [] };
    const template = tplRows[0] || null;

    switch (action.action_type) {
      case "wait":
        // No-op — the scheduled_for offset already enforced the wait.
        result = { kind: "wait" };
        break;

      case "send_email": {
        if (!template) throw new Error(`Template not found: ${action.action_config?.template_slug}`);
        const compliance = await canSendTo(agent, "email");
        if (!compliance.allowed) {
          if (compliance.defer) {
            // Reschedule for an hour later, do NOT mark skipped.
            await pool.query(
              `UPDATE agent_hub_automation_action_queue
                  SET status = 'pending', executing_at = NULL,
                      scheduled_for = NOW() + INTERVAL '1 hour',
                      error_text = $1,
                      retry_count = retry_count + 1
                WHERE id = $2`,
              [`deferred:${compliance.reason}`, action.id]
            );
            return; // Don't fall through to the success path.
          }
          resolvedStatus = "skipped";
          errorText = compliance.reason;
          break;
        }
        const sent = await sendEmail({
          agent,
          template,
          senderUserId: run.created_by || run.approved_by || null,
          linkRefs: { automation_run_id: run.id, action_queue_id: action.id },
        });
        result = { send_log_id: sent.send_log_id, subject: sent.subject };
        externalId = sent.external_id;
        break;
      }

      case "send_sms": {
        if (!template) throw new Error(`Template not found: ${action.action_config?.template_slug}`);
        const compliance = await canSendTo(agent, "sms");
        if (!compliance.allowed) {
          if (compliance.defer) {
            await pool.query(
              `UPDATE agent_hub_automation_action_queue
                  SET status = 'pending', executing_at = NULL,
                      scheduled_for = NOW() + INTERVAL '1 hour',
                      error_text = $1,
                      retry_count = retry_count + 1
                WHERE id = $2`,
              [`deferred:${compliance.reason}`, action.id]
            );
            return;
          }
          resolvedStatus = "skipped";
          errorText = compliance.reason;
          break;
        }
        const sent = await sendSms({
          agent,
          template,
          linkRefs: { automation_run_id: run.id, action_queue_id: action.id },
        });
        result = { send_log_id: sent.send_log_id };
        externalId = sent.external_id;
        break;
      }

      case "queue_postcard": {
        if (!template) throw new Error(`Template not found: ${action.action_config?.template_slug}`);
        const compliance = await canSendTo(agent, "postcard");
        if (!compliance.allowed) {
          // Postcards aren't rate-limited so defer is unlikely; skip if blocked.
          resolvedStatus = "skipped";
          errorText = compliance.reason;
          break;
        }
        const queued = await queuePostcard({
          agent,
          template,
          linkRefs: { automation_run_id: run.id, action_queue_id: action.id },
        });
        result = queued;
        externalId = `postcard-queue-${queued.postcard_queue_id}`;
        break;
      }

      case "log_activity": {
        const summary = renderTemplate(action.action_config?.summary || "Automation activity",
          await buildMergeContext(agent.id));
        await pool.query(
          `INSERT INTO agent_hub_activities
             (agent_id, type, direction, summary, metadata, occurred_at, created_by, updated_by)
           VALUES ($1, 'system_event', 'internal', $2, $3::jsonb, NOW(), NULL, NULL)`,
          [agent.id, summary, JSON.stringify({ automation_run_id: run.id, source: "automation_action" })]
        );
        result = { logged: true };
        break;
      }

      case "update_agent_field": {
        const field = action.action_config?.field;
        const value = action.action_config?.value;
        if (!field) throw new Error("update_agent_field missing 'field'");
        // Whitelist: only allow updating safe fields. tier + status are most useful.
        const SAFE_FIELDS = new Set(["tier", "status"]);
        if (!SAFE_FIELDS.has(field)) {
          throw new Error(`update_agent_field: field '${field}' not allowed.`);
        }
        await pool.query(
          `UPDATE agent_hub_agents SET ${field} = $1 WHERE id = $2`,
          [value, agent.id]
        );
        result = { field, value };
        break;
      }

      case "create_task": {
        const cfg = action.action_config || {};
        const ctx = await buildMergeContext(agent.id);
        const title = renderTemplate(cfg.title || "Follow-up", ctx);
        const description = renderTemplate(cfg.description || "", ctx);
        // Resolve assignee — username "mike" → users.id.
        let assignedTo = null;
        if (cfg.assign) {
          const { rows } = await pool.query(
            `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND active = TRUE LIMIT 1`,
            [cfg.assign]
          );
          assignedTo = rows[0]?.id ?? null;
        }
        // Whitelist: automation authors can request the same `source` value
        // used by Phase 2's referral_advance flow, which gets idempotency
        // for free via uq_agent_hub_tasks_system_thank_you. Default stays
        // 'system_other' so most automations can't collide on that index.
        const SAFE_SOURCES = new Set(["system_other", "system_followup_reminder", "system_referral_thank_you"]);
        const taskSource = SAFE_SOURCES.has(cfg.source) ? cfg.source : "system_other";
        // Find the linked referral (if any) so the partial unique index
        // engages correctly when source='system_referral_thank_you'.
        let relatedReferralId = null;
        if (taskSource === "system_referral_thank_you") {
          // Use the run's metadata: post_conversion_thank_you triggers from
          // a referral_stage_changed event whose data.referral_id we can
          // recover via the run's triggered_by_event_id format.
          const m = (run.triggered_by_event_id || "").match(/^referral_stage:(\d+):/);
          if (m) relatedReferralId = Number(m[1]);
        }
        try {
          await pool.query(
            `INSERT INTO agent_hub_tasks
               (title, description, assigned_to, related_agent_id, related_referral_id,
                priority, source, status, created_by)
             VALUES ($1, $2, $3, $4, $5, 'medium', $6, 'pending', NULL)
             ON CONFLICT (related_referral_id, source)
               WHERE source = 'system_referral_thank_you' AND related_referral_id IS NOT NULL
             DO NOTHING`,
            [title, description, assignedTo, agent.id, relatedReferralId, taskSource]
          );
        } catch (e) {
          // ON CONFLICT only matches the partial unique target. For other
          // task sources, rethrow.
          if (e.code !== "23505") throw e;
        }
        result = { task_created: true, source: taskSource, related_referral_id: relatedReferralId };
        break;
      }

      case "notify_team": {
        // Phase 3 minimum: dashboard surface only. A future build can add email.
        // For now, log activity so it shows up.
        await pool.query(
          `INSERT INTO agent_hub_activities
             (agent_id, type, direction, summary, metadata, occurred_at, created_by, updated_by)
           VALUES ($1, 'system_event', 'internal', $2, $3::jsonb, NOW(), NULL, NULL)`,
          [agent.id, action.action_config?.summary || "Team notification", JSON.stringify({ automation_run_id: run.id, kind: "notify_team" })]
        );
        result = { notified: true };
        break;
      }

      case "branch": {
        // Branch evaluation is intentionally simple in Phase 3 and only
        // supports a small list of named conditions. Adding new branch
        // conditions = adding a new case here.
        const cfg = action.action_config || {};
        const cond = cfg.if;
        let truthy = false;
        if (cond === "reply_received_in_last_14d") {
          const { rows } = await pool.query(
            `SELECT 1 FROM agent_hub_send_log
              WHERE agent_id = $1 AND replied_at IS NOT NULL
                AND replied_at >= NOW() - INTERVAL '14 days'
              LIMIT 1`,
            [agent.id]
          );
          truthy = rows.length > 0;
        } else if (cond === "reply_received") {
          const { rows } = await pool.query(
            `SELECT 1 FROM agent_hub_send_log
              WHERE agent_id = $1 AND replied_at IS NOT NULL
                AND replied_at >= $2::timestamptz
              LIMIT 1`,
            [agent.id, run.triggered_at]
          );
          truthy = rows.length > 0;
        } else if (cond === "agent_tier_eq_cold") {
          truthy = agent.tier === "cold";
        } else {
          console.warn(`[agent-hub] unknown branch condition: ${cond}`);
        }
        const taken = truthy ? cfg.then_actions : cfg.else_actions;
        if (Array.isArray(taken) && taken.length > 0) {
          // Insert nested actions immediately after this one with sequential indexes.
          // Use scheduled_for = now so they fire on the next executor pass.
          const nextSeq = action.sequence_index + 1;
          // Bump existing actions' sequence_index to make room — only those
          // belonging to the same run with index >= nextSeq.
          await pool.query(
            `UPDATE agent_hub_automation_action_queue
                SET sequence_index = sequence_index + $1
              WHERE automation_run_id = $2 AND sequence_index >= $3`,
            [taken.length, run.id, nextSeq]
          );
          for (let i = 0; i < taken.length; i++) {
            const t = taken[i];
            await pool.query(
              `INSERT INTO agent_hub_automation_action_queue
                 (automation_run_id, sequence_index, action_type, action_config, scheduled_for, status)
               VALUES ($1, $2, $3, $4::jsonb, NOW(), 'pending')`,
              [run.id, nextSeq + i, t.type, JSON.stringify(t.config || {})]
            );
          }
          // Bump actions_total to reflect inserted children.
          await pool.query(
            `UPDATE agent_hub_automation_runs SET actions_total = actions_total + $1 WHERE id = $2`,
            [taken.length, run.id]
          );
        }
        result = { branch_taken: truthy ? "then" : "else" };
        break;
      }

      case "end_sequence":
        // Mark all subsequent actions skipped and the run completed.
        await pool.query(
          `UPDATE agent_hub_automation_action_queue
              SET status = 'skipped', error_text = 'end_sequence'
            WHERE automation_run_id = $1 AND sequence_index > $2 AND status = 'pending'`,
          [action.automation_run_id, action.sequence_index]
        );
        result = { ended: true };
        break;

      default:
        throw new Error(`Unknown action_type: ${action.action_type}`);
    }
  } catch (e) {
    errorText = e.message || String(e);
    resolvedStatus = "failed";
  }

  if (resolvedStatus === "failed" && action.retry_count + 1 < MAX_RETRIES) {
    // Exponential backoff: 10m, 30m, 90m.
    const minutes = RETRY_BASE_MINUTES * Math.pow(3, action.retry_count);
    await pool.query(
      `UPDATE agent_hub_automation_action_queue
          SET status = 'pending', executing_at = NULL,
              scheduled_for = NOW() + ($1 || ' minutes')::interval,
              retry_count = retry_count + 1,
              error_text = $2
        WHERE id = $3`,
      [String(minutes), errorText, action.id]
    );
    return;
  }

  await getPool().query(
    `UPDATE agent_hub_automation_action_queue
        SET status = $1, executed_at = NOW(),
            external_id = COALESCE($2, external_id),
            result = $3::jsonb,
            error_text = $4,
            executing_at = NULL
      WHERE id = $5`,
    [resolvedStatus, externalId, JSON.stringify(result || {}), errorText, action.id]
  );

  // If this action failed terminally, mark the run failed too.
  if (resolvedStatus === "failed") {
    await getPool().query(
      `UPDATE agent_hub_automation_runs
          SET status = 'failed',
              completed_at = NOW(),
              error_log = error_log || $1::jsonb
        WHERE id = $2 AND status NOT IN ('cancelled','failed')`,
      [JSON.stringify([{ action_id: action.id, error: errorText, at: new Date().toISOString() }]), action.automation_run_id]
    );
  }
}

// ============================================================
// 3. APPROVAL WINDOW REAPER (cron, every hour)
// ============================================================
export async function reapApprovalWindow() {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE agent_hub_automation_runs
        SET status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_reason = 'approval_window_expired'
      WHERE status = 'pending_approval'
        AND approval_required_until IS NOT NULL
        AND approval_required_until < NOW()
     RETURNING id`
  );
  if (rows.length) {
    console.log(`[agent-hub] reaped ${rows.length} expired approval(s)`);
  }
  return { cancelled: rows.length };
}

// ============================================================
// 4. REPLY DETECTOR (cron, every 15 min)
// ============================================================
/**
 * Polls Microsoft Graph for messages received in the active connection's
 * inbox since the last poll, matches them against agent_hub_send_log
 * external_ids via the In-Reply-To / x-agent-hub-message-id headers, and
 * marks the relevant agent's automations paused.
 *
 * Phase 3 simplification: scans the LATEST 50 messages every poll. A
 * future build should track a delta cursor.
 */
export async function detectReplies() {
  const pool = getPool();
  const config = await getSystemConfig();
  if (!config?.default_sender_email) return { skipped: true, reason: "no_sender_configured" };
  // Pick any active connection — we use the platform's existing helper.
  // For simplicity we attempt the configured sender's user_id first.
  const { rows: connRows } = await pool.query(
    `SELECT u.id AS user_id, ec.id AS connection_id, ec.mailbox_email
       FROM email_connections ec
       JOIN users u ON u.id = ec.user_id
      WHERE ec.is_active = TRUE
        AND (LOWER(ec.mailbox_email) = LOWER($1) OR ec.mailbox_type = 'shared')
      ORDER BY ec.last_sync_at DESC NULLS LAST
      LIMIT 1`,
    [config.default_sender_email]
  );
  if (!connRows.length) return { skipped: true, reason: "no_active_connection" };
  const conn = connRows[0];
  let token;
  try {
    const t = await getValidAccessTokenForConnection(conn.connection_id);
    token = t.accessToken;
  } catch (e) {
    return { skipped: true, reason: "token_error", error: e.message };
  }
  // Fetch latest 50 received messages with custom header.
  const path =
    conn.mailbox_email
      ? `/users/${encodeURIComponent(conn.mailbox_email)}/messages?$top=50&$select=id,subject,internetMessageId,internetMessageHeaders,from,receivedDateTime,conversationId&$orderby=receivedDateTime desc`
      : `/me/messages?$top=50&$select=id,subject,internetMessageId,internetMessageHeaders,from,receivedDateTime,conversationId&$orderby=receivedDateTime desc`;
  let resp;
  try {
    resp = await graphGet(path, token);
  } catch (e) {
    console.error("[agent-hub] detectReplies graph fetch", e);
    return { skipped: true, reason: "graph_error", error: e.message };
  }
  const messages = resp?.value || [];
  let matched = 0;
  for (const m of messages) {
    const headers = m.internetMessageHeaders || [];
    const inReplyTo = headers.find((h) => h.name?.toLowerCase() === "in-reply-to")?.value;
    const customId = headers.find((h) => h.name?.toLowerCase() === "x-agent-hub-message-id")?.value;
    const candidate = customId || inReplyTo;
    if (!candidate) continue;
    // Match must be EXACT against external_id. We mint our outbound IDs
    // with a deterministic format `<agent-hub-{run}-{action}-{agent}@host>`.
    // A LIKE %candidate% match risks false positives (e.g. a forwarded
    // message whose nested headers happen to include a similar substring),
    // and the unmatched case silently flags the wrong agent. Exact match.
    let cleaned = candidate.trim();
    if (!cleaned.startsWith("<")) cleaned = `<${cleaned}`;
    if (!cleaned.endsWith(">")) cleaned = `${cleaned}>`;
    // Defense in depth: only consider candidates that look like ours.
    if (!cleaned.includes("agent-hub-")) continue;
    const { rows: slRows } = await pool.query(
      `SELECT id, agent_id FROM agent_hub_send_log
        WHERE channel = 'email' AND external_id = $1
        LIMIT 1`,
      [cleaned]
    );
    if (!slRows.length) continue;
    const sendLog = slRows[0];
    // Already marked replied? Skip.
    const { rows: alreadyRows } = await pool.query(
      `SELECT replied_at FROM agent_hub_send_log WHERE id = $1`,
      [sendLog.id]
    );
    if (alreadyRows[0]?.replied_at) continue;
    matched++;
    await pool.query(
      `UPDATE agent_hub_send_log
          SET replied_at = NOW(),
              reply_external_id = $1,
              delivery_status = 'replied'
        WHERE id = $2`,
      [m.internetMessageId || m.id, sendLog.id]
    );
    // Pause in-flight automations for this agent.
    await pool.query(
      `UPDATE agent_hub_automation_runs
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_reason = 'reply_received'
        WHERE agent_id = $1 AND status IN ('pending_approval','approved','running')`,
      [sendLog.agent_id]
    );
    // Flag agent so future automations don't fire.
    await pool.query(
      `UPDATE agent_hub_agents
          SET personal_outreach_flag = TRUE,
              personal_outreach_flagged_at = NOW()
        WHERE id = $1`,
      [sendLog.agent_id]
    );
    // Activity timeline entry.
    await pool.query(
      `INSERT INTO agent_hub_activities
         (agent_id, type, direction, summary, metadata, occurred_at, created_by, updated_by)
       VALUES ($1, 'email_received', 'inbound', $2, $3::jsonb, NOW(), NULL, NULL)`,
      [
        sendLog.agent_id,
        `Reply received from ${m.from?.emailAddress?.address || "agent"} — automations paused`,
        JSON.stringify({ send_log_id: sendLog.id, graph_message_id: m.id }),
      ]
    );
  }
  return { processed: messages.length, matched };
}

// ============================================================
// SIMULATOR — runs evaluation against current data WITHOUT side effects.
// ============================================================
export async function simulateAutomation(automationId) {
  const pool = getPool();
  const { rows: autoRows } = await pool.query(
    `SELECT * FROM agent_hub_automations WHERE id = $1`,
    [automationId]
  );
  if (!autoRows.length) throw new Error("Automation not found.");
  const auto = autoRows[0];

  // Find candidate agent ids the same way the real evaluator would.
  let candidates = [];
  if (auto.trigger_type === "time_based") {
    // Reuse the same logic but capture in-memory.
    const cfg = auto.trigger_config || {};
    if (cfg.trigger === "birthday") {
      const offsetDays = Number(cfg.offset_days) || 0;
      const target = new Date();
      target.setUTCDate(target.getUTCDate() + Math.abs(offsetDays));
      const { rows } = await pool.query(
        `SELECT a.id FROM agent_hub_agents a
           JOIN agent_hub_personal_details p ON p.agent_id = a.id
          WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
            AND p.birthday_month = $1 AND p.birthday_day = $2`,
        [target.getUTCMonth() + 1, target.getUTCDate()]
      );
      candidates = rows.map((r) => r.id);
    } else if (cfg.trigger === "days_since_last_interaction") {
      const threshold = Number(cfg.threshold) || 0;
      const { rows } = await pool.query(
        `SELECT a.id FROM agent_hub_agents a
          WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
            AND (a.last_interaction_date IS NULL
                 OR a.last_interaction_date < NOW() - ($1 || ' days')::interval)`,
        [String(threshold)]
      );
      candidates = rows.map((r) => r.id);
    } else if (cfg.trigger === "fixed_schedule") {
      const { rows } = await pool.query(
        `SELECT a.id FROM agent_hub_agents a
          WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL`
      );
      candidates = rows.map((r) => r.id);
    }
    // Other triggers handled the same way in evaluateOneTimeBasedAutomation.
  } else if (auto.trigger_type === "event_based") {
    // Simulator for event_based: scan agents that COULD match the event
    // shape — we can't synthesize the event here, so we return all
    // agents matching conditions and let the operator imagine.
    const { rows } = await pool.query(
      `SELECT a.id FROM agent_hub_agents a
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL`
    );
    candidates = rows.map((r) => r.id);
  } else if (auto.trigger_type === "manual") {
    return { eligible_agents: [], note: "Manual triggers fire on-demand only." };
  }

  const eligible = [];
  const skipped = [];
  for (const agentId of candidates) {
    const r = await createRunIfEligible({
      automation: auto,
      agentId,
      triggeredBy: "simulator",
      simulate: true,
    });
    if (!r) {
      skipped.push({ agent_id: agentId, reason: "conditions_not_met_or_unknown" });
      continue;
    }
    if (r.skipped) {
      skipped.push({ agent_id: agentId, reason: r.skipped });
      continue;
    }
    eligible.push(agentId);
  }

  return {
    automation: { id: auto.id, slug: auto.slug, name: auto.name },
    eligible_count: eligible.length,
    eligible_agents: eligible.slice(0, 100), // Cap returned ids
    skipped_count: skipped.length,
    skipped_sample: skipped.slice(0, 50),
  };
}
