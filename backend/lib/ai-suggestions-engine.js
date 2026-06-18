import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "./db.js";

/**
 * Phase 6 — AI Suggestions Engine.
 *
 * Periodically inspects active processes plus team workload, communications
 * gaps, and stage history, asks Claude for actionable suggestions, and stores
 * the deduplicated results in process_ai_suggestions for the operator UI.
 *
 * Cost-aware: a quick activity check skips runs that would only re-process
 * stale data. Estimated ~$1-3/day at the default 15-minute cadence.
 */

const MODEL = "claude-sonnet-4-5";
const MAX_SUGGESTIONS_PER_RUN = 8;
const STALE_AFTER_DAYS = 7;

const VALID_TYPES = new Set([
  "follow_up",
  "escalate",
  "reassign",
  "auto_create",
  "reminder",
  "insight",
]);
const VALID_ACTION_TYPES = new Set([
  "send_email",
  "send_text",
  "change_stage",
  "reassign",
  "create_process",
]);

function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set.");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }
  return new Anthropic({ apiKey: key });
}

function textFromMessage(msg) {
  return (msg?.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/* ---------- context gathering ---------- */

async function gatherContext(pool) {
  const { rows: processes } = await pool.query(
    `SELECT
       p.id, p.status, p.target_completion, p.started_at, p.stage_entered_at,
       p.property_name, p.property_id, p.contact_name, p.last_activity_at,
       EXTRACT(DAY FROM NOW() - p.stage_entered_at)::int AS days_in_stage,
       (p.target_completion IS NOT NULL AND p.target_completion < CURRENT_DATE) AS is_overdue,
       t.name AS template_name,
       s.name AS stage_name,
       s.default_days AS expected_days,
       (SELECT COUNT(*)::int FROM process_steps ps
        WHERE ps.process_id = p.id AND ps.status NOT IN ('completed','skipped')) AS pending_tasks,
       (SELECT COUNT(*)::int FROM process_steps ps
        WHERE ps.process_id = p.id AND ps.status = 'completed') AS completed_tasks,
       (SELECT COUNT(*)::int FROM process_communications pc
        WHERE pc.process_id = p.id AND pc.direction = 'outbound'
          AND pc.created_at >= NOW() - INTERVAL '14 days') AS recent_outbound_comms,
       (SELECT MAX(pc2.created_at) FROM process_communications pc2
        WHERE pc2.process_id = p.id AND pc2.direction = 'outbound') AS last_outbound_at,
       (SELECT u.display_name
        FROM process_steps ps JOIN users u ON u.id = ps.assigned_user_id
        WHERE ps.process_id = p.id AND ps.status NOT IN ('completed','skipped')
        ORDER BY ps.step_number ASC LIMIT 1) AS lead_assignee_name
     FROM processes p
     LEFT JOIN process_templates t ON t.id = p.template_id
     LEFT JOIN process_template_stages s ON s.id = p.current_stage_id
     WHERE p.status = 'active'
       AND p.archived_at IS NULL AND p.deleted_at IS NULL
     ORDER BY days_in_stage DESC NULLS LAST
     LIMIT 80`
  );

  const { rows: workload } = await pool.query(
    `SELECT u.id, u.display_name AS name, u.role,
            COUNT(s.id) FILTER (
              WHERE s.assigned_user_id = u.id
                AND s.status NOT IN ('completed','skipped')
                AND p.status = 'active'
                AND p.archived_at IS NULL AND p.deleted_at IS NULL
            )::int AS active_tasks,
            COUNT(s.id) FILTER (
              WHERE s.assigned_user_id = u.id
                AND s.status NOT IN ('completed','skipped')
                AND p.status = 'active'
                AND s.due_date < CURRENT_DATE
                AND p.archived_at IS NULL AND p.deleted_at IS NULL
            )::int AS overdue_tasks
     FROM users u
     LEFT JOIN process_steps s ON s.assigned_user_id = u.id
     LEFT JOIN processes p ON p.id = s.process_id
     GROUP BY u.id, u.display_name, u.role
     HAVING COALESCE(SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END), 0) > 0
     ORDER BY active_tasks DESC`
  );

  const { rows: existing } = await pool.query(
    `SELECT process_id, suggestion_type, title
     FROM process_ai_suggestions
     WHERE status = 'pending'`
  );

  return { processes, workload, existing };
}

/* ---------- Claude analysis ---------- */

const SYSTEM_PROMPT = `You are an AI operations assistant for RPM Prestige, a residential property
management company in Houston, TX managing roughly 217 doors. You analyze
running processes and suggest actions.

Your job is to identify:
1. STUCK processes — in a stage longer than expected with no recent activity
2. FOLLOW-UP needed — outbound communication gaps (7+ days no contact)
3. ESCALATION needed — processes that should move to a different stage
4. REASSIGNMENT needed — team members who are overloaded
5. AUTOMATION opportunities — repetitive patterns that could be auto-handled

RULES:
- Only suggest actions that are genuinely helpful. Quality over quantity.
- Maximum 8 suggestions per run.
- Don't duplicate any pending suggestion already listed for that process+type.
- Be specific: name the property, the person, the exact action.
- Confidence is 0.0–1.0; reserve >0.85 for cases with clear evidence.

Respond with ONLY a JSON array. No markdown, no backticks, no preamble.
Each item:
{
  "processId": number,
  "type": "follow_up" | "escalate" | "reassign" | "auto_create" | "reminder" | "insight",
  "title": "short imperative title under 60 chars",
  "description": "1-2 sentence explanation",
  "confidence": 0.0,
  "actionType": "send_email" | "send_text" | "change_stage" | "reassign" | "create_process" | null,
  "actionPayload": object | null
}

actionPayload examples:
- send_email: { "recipientType": "tenant"|"owner"|"assigned_role", "suggestedSubject": "...", "suggestedBody": "..." }
- send_text:  { "recipientType": "tenant"|"owner", "suggestedBody": "..." }
- change_stage: { "suggestedStage": "Tenant Unresponsive" }
- reassign: { "fromUser": "Lori", "toUser": "Amelia", "reason": "workload" }
- create_process: { "templateName": "Maintenance Request", "reason": "..." }`;

function buildUserMessage(ctx) {
  const trim = (a) => (Array.isArray(a) ? a.slice(0, 60) : a);
  return `Analyze these and respond with JSON only.

ACTIVE PROCESSES:
${JSON.stringify(
  trim(ctx.processes).map((p) => ({
    id: p.id,
    template: p.template_name,
    stage: p.stage_name,
    property: p.property_name,
    contact: p.contact_name,
    leadAssignee: p.lead_assignee_name,
    daysInStage: p.days_in_stage,
    expectedDays: p.expected_days,
    isOverdue: p.is_overdue,
    pendingTasks: p.pending_tasks,
    completedTasks: p.completed_tasks,
    recentOutboundComms: p.recent_outbound_comms,
    lastOutboundAt: p.last_outbound_at,
    lastActivityAt: p.last_activity_at,
  })),
  null,
  2
)}

TEAM WORKLOAD:
${JSON.stringify(ctx.workload, null, 2)}

ALREADY PENDING (do not duplicate by processId + type + title):
${JSON.stringify(
  ctx.existing.map((s) => ({
    processId: s.process_id,
    type: s.suggestion_type,
    title: s.title,
  })),
  null,
  2
)}`;
}

function safeParse(jsonText) {
  if (!jsonText) return [];
  // Strip code fences if present.
  const cleaned = jsonText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.suggestions)) return parsed.suggestions;
    return [];
  } catch {
    // Try to find a JSON array inside the text.
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      return JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
}

async function analyzeWithClaude(ctx) {
  if (!ctx.processes.length) return [];
  const anthropic = getAnthropic();
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(ctx) }],
  });
  return safeParse(textFromMessage(msg));
}

/* ---------- store ---------- */

function normalizeSuggestion(s) {
  if (!s || !Number.isFinite(Number(s.processId))) return null;
  if (typeof s.title !== "string" || !s.title.trim()) return null;
  if (typeof s.description !== "string" || !s.description.trim()) return null;
  const type = VALID_TYPES.has(s.type) ? s.type : "insight";
  const actionType = VALID_ACTION_TYPES.has(s.actionType) ? s.actionType : null;
  const confidence =
    typeof s.confidence === "number" && s.confidence >= 0 && s.confidence <= 1
      ? Number(s.confidence.toFixed(2))
      : 0.5;
  return {
    processId: Number(s.processId),
    type,
    title: s.title.trim().slice(0, 255),
    description: s.description.trim().slice(0, 2000),
    actionType,
    actionPayload: s.actionPayload && typeof s.actionPayload === "object" ? s.actionPayload : null,
    confidence,
  };
}

async function storeSuggestions(suggestions, pool) {
  let stored = 0;
  for (const raw of suggestions.slice(0, MAX_SUGGESTIONS_PER_RUN)) {
    const s = normalizeSuggestion(raw);
    if (!s) continue;
    try {
      const { rows: dup } = await pool.query(
        `SELECT id FROM process_ai_suggestions
         WHERE process_id = $1 AND suggestion_type = $2
           AND status = 'pending' AND title = $3
         LIMIT 1`,
        [s.processId, s.type, s.title]
      );
      if (dup.length) continue;
      // Make sure the process actually exists & is active before storing.
      const { rows: proc } = await pool.query(
        `SELECT id FROM processes
         WHERE id = $1 AND status = 'active'
           AND archived_at IS NULL AND deleted_at IS NULL`,
        [s.processId]
      );
      if (!proc.length) continue;
      await pool.query(
        `INSERT INTO process_ai_suggestions
           (process_id, suggestion_type, title, description,
            action_type, action_payload, confidence, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending')`,
        [
          s.processId,
          s.type,
          s.title,
          s.description,
          s.actionType,
          s.actionPayload != null ? JSON.stringify(s.actionPayload) : null,
          s.confidence,
        ]
      );
      stored += 1;
    } catch (err) {
      console.warn("[ai-suggestions] insert failed:", err.message);
    }
  }
  return stored;
}

async function expireOld(pool) {
  await pool.query(
    `UPDATE process_ai_suggestions
     SET status = 'expired'
     WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '${STALE_AFTER_DAYS} days'`
  );
}

/* ---------- cost-saving skip ---------- */

async function shouldRunAnalysis(pool) {
  // Skip the run unless something has changed in the operations world since
  // 20 minutes ago (covers a 15-minute cadence with a small grace window).
  const { rows } = await pool.query(
    `SELECT 1 FROM process_activity_log
     WHERE created_at >= NOW() - INTERVAL '20 minutes'
     LIMIT 1`
  );
  return rows.length > 0;
}

/* ---------- public API ---------- */

/**
 * Cron entry — guards on activity, gathers context, calls Claude, stores
 * suggestions, expires stale ones. Best-effort: never throws to the caller.
 */
export async function runAIAnalysis({ force = false } = {}) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.warn("[ai-suggestions] ANTHROPIC_API_KEY missing — skipping run");
    return { skipped: "not_configured" };
  }
  const pool = getPool();
  try {
    if (!force && !(await shouldRunAnalysis(pool))) {
      return { skipped: "no_recent_activity" };
    }
    const ctx = await gatherContext(pool);
    if (!ctx.processes.length) {
      await expireOld(pool);
      return { skipped: "no_active_processes" };
    }
    const suggestions = await analyzeWithClaude(ctx);
    const stored = await storeSuggestions(suggestions, pool);
    await expireOld(pool);
    console.log(
      `[ai-suggestions] ${suggestions.length} returned, ${stored} stored, ${ctx.processes.length} processes analyzed`
    );
    return { generated: suggestions.length, stored, processes: ctx.processes.length };
  } catch (err) {
    console.warn("[ai-suggestions] run failed:", err.message);
    return { error: err.message };
  }
}

/* ---------- summary stats ---------- */

export async function getSuggestionStats() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
       COUNT(*) FILTER (
         WHERE status = 'accepted' AND responded_at >= DATE_TRUNC('day', NOW())
       )::int AS accepted_today,
       COUNT(*) FILTER (
         WHERE status = 'dismissed' AND responded_at >= DATE_TRUNC('day', NOW())
       )::int AS dismissed_today,
       COUNT(*) FILTER (WHERE status IN ('accepted','dismissed'))::int AS responded_total,
       COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_total
     FROM process_ai_suggestions`
  );
  const r = rows[0] || {};
  const acceptRate =
    r.responded_total > 0
      ? Math.round((100 * (r.accepted_total || 0)) / r.responded_total)
      : null;
  const { rows: types } = await pool.query(
    `SELECT suggestion_type, COUNT(*)::int AS c
     FROM process_ai_suggestions
     WHERE status = 'pending'
     GROUP BY suggestion_type ORDER BY c DESC`
  );
  return {
    pendingCount: r.pending_count ?? 0,
    acceptedToday: r.accepted_today ?? 0,
    dismissedToday: r.dismissed_today ?? 0,
    acceptRate,
    topSuggestionTypes: types.map((t) => ({ type: t.suggestion_type, count: t.c })),
  };
}
