/**
 * Daily intelligence jobs.
 *
 * Cron schedule (registered in backend/index.js):
 *   3:00 AM — recomputeAllEngagementScores
 *   3:30 AM — refreshAllPredictiveFlags
 *   4:00 AM — refreshAllCohortMetrics + maintainQuarterlyCohorts
 *   5:00 AM — archiveAndPruneScoreHistory
 *
 * All jobs are idempotent. Re-running mid-day (via the manager+ manual
 * recalc endpoint) produces the same result for the same input.
 */

import { getPool } from "../../db.js";
import { computeScore } from "./scoring.js";
import { FLAG_TYPES, FLAG_EVALUATORS } from "./flags.js";
import {
  refreshAllCohortMetrics,
  maintainQuarterlyCohorts,
} from "./cohorts.js";

async function logCalculation(client, type, result) {
  try {
    await client.query(
      `INSERT INTO agent_hub_intelligence_calculations_log
         (calculation_type, started_at, completed_at, agents_processed,
          flags_added, flags_resolved, errors_count, error_log, duration_ms,
          triggered_by)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        type,
        result.startedAt,
        result.processed ?? null,
        result.flagsAdded ?? null,
        result.flagsResolved ?? null,
        result.errors ?? 0,
        JSON.stringify(result.errorLog || []),
        result.durationMs ?? null,
        result.triggeredBy ?? null,
      ]
    );
  } catch (e) {
    console.error("[agent-hub] intelligence log write failed", e);
  }
}

// ============================================================
// 1. ENGAGEMENT SCORE — recompute for all agents
// ============================================================
/**
 * Pulls a single big query that joins all the facts per agent,
 * iterates in JS to compute scores, then UPSERTs into
 * agent_hub_agent_engagement_scores. Also writes a compact row to
 * agent_hub_engagement_score_history.
 *
 * Performance target: <5 minutes for 10K agents. The dominant cost
 * is the per-agent UPSERT — we batch with a multi-row INSERT.
 */
export async function recomputeAllEngagementScores({ agentId = null, triggeredBy = null } = {}) {
  const pool = getPool();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const errorLog = [];
  let processed = 0;

  // Pull every fact in one query. The CTE structure keeps the engine
  // doing aggregation work in SQL where it's fast.
  const facts = await pool.query(
    `WITH base AS (
       SELECT a.id, a.tier, a.status, a.consent_to_email,
              a.last_interaction_date, a.created_at,
              a.first_contact_date,
              -- IMPORTANT: leave NULL when last_interaction_date is NULL.
              -- An earlier version COALESCE'd to created_at, which produced
              -- "Last interaction today (+25 recency)" for brand-new agents
              -- with zero activity. scoreRecency(null) correctly returns 0.
              CASE WHEN a.last_interaction_date IS NULL THEN NULL
                   ELSE EXTRACT(EPOCH FROM (NOW() - a.last_interaction_date)) / 86400.0
              END AS days_since_last_interaction,
              EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 86400.0 AS first_seen_days_ago
         FROM agent_hub_agents a
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          ${agentId ? `AND a.id = $1` : ``}
     ),
     interaction_count AS (
       SELECT a.id AS agent_id,
              COUNT(act.id)::int AS count_90d
         FROM base a
         LEFT JOIN agent_hub_activities act
           ON act.agent_id = a.id
          AND act.deleted_at IS NULL
          AND act.occurred_at >= NOW() - INTERVAL '90 days'
        GROUP BY a.id
     ),
     last_reply AS (
       SELECT a.id AS agent_id,
              EXTRACT(EPOCH FROM (NOW() - MAX(s.replied_at))) / 86400.0 AS days_since_last_reply
         FROM base a
         LEFT JOIN agent_hub_send_log s ON s.agent_id = a.id AND s.replied_at IS NOT NULL
        GROUP BY a.id
     ),
     inbound_check AS (
       SELECT a.id AS agent_id,
              EXISTS (
                SELECT 1 FROM agent_hub_activities act2
                 WHERE act2.agent_id = a.id AND act2.direction = 'inbound' AND act2.deleted_at IS NULL
              ) OR EXISTS (
                SELECT 1 FROM agent_hub_send_log s2 WHERE s2.agent_id = a.id AND s2.replied_at IS NOT NULL
              ) AS has_inbound,
              EXISTS (
                SELECT 1 FROM agent_hub_send_log s3 WHERE s3.agent_id = a.id AND s3.replied_at IS NOT NULL
              ) AS has_any_reply
         FROM base a
     ),
     ref_facts AS (
       SELECT a.id AS agent_id,
              COUNT(r.id)::int AS total_referrals,
              COUNT(r.id) FILTER (WHERE r.stage = 'active_management')::int AS converted_referrals,
              EXTRACT(EPOCH FROM (NOW() - MAX(r.created_at))) / 86400.0 AS days_since_last_referral
         FROM base a
         LEFT JOIN agent_hub_referrals r ON r.agent_id = a.id
        GROUP BY a.id
     )
     SELECT b.id AS agent_id, b.tier, b.consent_to_email,
            b.days_since_last_interaction,
            b.first_seen_days_ago,
            ic.count_90d,
            lr.days_since_last_reply,
            ib.has_inbound,
            ib.has_any_reply,
            rf.total_referrals,
            rf.converted_referrals,
            rf.days_since_last_referral,
            COALESCE(ltv.total_revenue_generated, 0) AS total_revenue
       FROM base b
       JOIN interaction_count ic ON ic.agent_id = b.id
       JOIN last_reply lr ON lr.agent_id = b.id
       JOIN inbound_check ib ON ib.agent_id = b.id
       JOIN ref_facts rf ON rf.agent_id = b.id
       LEFT JOIN agent_hub_agent_lifetime_value ltv ON ltv.agent_id = b.id`,
    agentId ? [agentId] : []
  );

  for (const row of facts.rows) {
    try {
      const dsiRaw = row.days_since_last_interaction;
      const daysSinceLastInteraction = dsiRaw == null ? null : Math.floor(Number(dsiRaw));
      const dsrRaw = row.days_since_last_reply;
      const daysSinceLastReply = dsrRaw == null ? null : Math.floor(Number(dsrRaw));
      const dsrefRaw = row.days_since_last_referral;
      const daysSinceLastReferral = dsrefRaw == null ? null : Math.floor(Number(dsrefRaw));

      const result = computeScore({
        daysSinceLastInteraction,
        interactionCount90d: row.count_90d || 0,
        daysSinceLastReply,
        totalReferrals: row.total_referrals || 0,
        daysSinceLastReferral,
        convertedReferrals: row.converted_referrals || 0,
        totalRevenue: Number(row.total_revenue || 0),
        currentTier: row.tier,
        consentToEmail: row.consent_to_email === true,
        hasInbound: row.has_inbound === true,
        firstSeenDaysAgo: row.first_seen_days_ago == null ? null : Math.floor(Number(row.first_seen_days_ago)),
      });

      await pool.query(
        `INSERT INTO agent_hub_agent_engagement_scores
           (agent_id, calculated_at, score, tier_recommendation, tier_recommendation_changed,
            component_recency, component_frequency, component_two_way,
            component_referrals, component_financials, explanation)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         ON CONFLICT (agent_id, (calculated_at::date)) DO UPDATE SET
           score = EXCLUDED.score,
           tier_recommendation = EXCLUDED.tier_recommendation,
           tier_recommendation_changed = EXCLUDED.tier_recommendation_changed,
           component_recency = EXCLUDED.component_recency,
           component_frequency = EXCLUDED.component_frequency,
           component_two_way = EXCLUDED.component_two_way,
           component_referrals = EXCLUDED.component_referrals,
           component_financials = EXCLUDED.component_financials,
           explanation = EXCLUDED.explanation,
           calculated_at = NOW()`,
        [
          row.agent_id,
          result.score,
          result.tier_recommendation,
          result.tier_recommendation_changed,
          result.components.recency,
          result.components.frequency,
          result.components.two_way,
          result.components.referrals,
          result.components.financials,
          JSON.stringify(result.explanation),
        ]
      );

      // Compact history row (idempotent on (agent, date)).
      await pool.query(
        `INSERT INTO agent_hub_engagement_score_history (agent_id, calculation_date, score, tier_at_time)
         VALUES ($1, CURRENT_DATE, $2, $3)
         ON CONFLICT (agent_id, calculation_date) DO UPDATE SET
           score = EXCLUDED.score,
           tier_at_time = EXCLUDED.tier_at_time`,
        [row.agent_id, result.score, row.tier]
      );

      processed++;
    } catch (e) {
      errorLog.push({ agent_id: row.agent_id, error: e.message });
    }
  }

  const durationMs = Date.now() - t0;
  await logCalculation(pool, "engagement_score", {
    startedAt,
    processed,
    errors: errorLog.length,
    errorLog,
    durationMs,
    triggeredBy,
  });

  return { processed, errors: errorLog.length, durationMs };
}

// ============================================================
// 2. PREDICTIVE FLAGS — refresh all flags for all agents
// ============================================================
/**
 * For each agent, evaluate all 6 flag rules. Insert/update active
 * flags. Auto-resolve flags whose conditions no longer hold. Respect
 * dismiss-with-snooze (don't recreate during snooze window).
 */
export async function refreshAllPredictiveFlags({ agentId = null, triggeredBy = null } = {}) {
  const pool = getPool();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const errorLog = [];
  let processed = 0;
  let added = 0;
  let resolved = 0;

  // Build the AgentFacts batch. Joins today's score, score 14d ago,
  // score 30d ago, and a history-of-recommendations check.
  const facts = await pool.query(
    `WITH today_score AS (
       SELECT s.agent_id, s.score, s.tier_recommendation, s.calculated_at
         FROM agent_hub_agent_engagement_scores s
        WHERE s.calculated_at::date = CURRENT_DATE
     ),
     score_14d AS (
       SELECT DISTINCT ON (agent_id) agent_id, score
         FROM agent_hub_engagement_score_history
        WHERE calculation_date <= CURRENT_DATE - INTERVAL '14 days'
        ORDER BY agent_id, calculation_date DESC
     ),
     score_30d AS (
       SELECT DISTINCT ON (agent_id) agent_id, score
         FROM agent_hub_engagement_score_history
        WHERE calculation_date <= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY agent_id, calculation_date DESC
     ),
     consistent_rec AS (
       -- True consecutive-run length, ending today. Gap-and-island pattern:
       --   Subtract row_number from date — for consecutive days the
       --   difference is constant per "island". Group by that to size each
       --   run, then pick the run that ends on CURRENT_DATE.
       --
       -- An earlier version computed (MAX - MIN + 1) which is the SPAN
       -- between first/last day a recommendation was *ever* observed —
       -- that produced false positives for flip-flopping agents.
       WITH rec_per_day AS (
         SELECT s.agent_id,
                s.calculated_at::date AS d,
                s.tier_recommendation
           FROM agent_hub_agent_engagement_scores s
          WHERE s.tier_recommendation IS NOT NULL
       ),
       grouped AS (
         SELECT *,
                d - (ROW_NUMBER() OVER (
                  PARTITION BY agent_id, tier_recommendation ORDER BY d
                ))::int AS island
           FROM rec_per_day
       ),
       runs AS (
         SELECT agent_id, tier_recommendation,
                MAX(d) - MIN(d) + 1 AS days,
                MAX(d) AS run_end
           FROM grouped
          GROUP BY agent_id, tier_recommendation, island
       )
       SELECT agent_id, tier_recommendation, days
         FROM runs
        WHERE run_end = CURRENT_DATE
     ),
     last_referral AS (
       SELECT r.agent_id, MAX(r.created_at) AS last_at, COUNT(*) AS total
         FROM agent_hub_referrals r
        GROUP BY r.agent_id
     ),
     ref_intervals AS (
       SELECT r.agent_id,
              AVG(EXTRACT(EPOCH FROM (r.created_at - prev.created_at)) / 86400.0) AS avg_days
         FROM agent_hub_referrals r
         JOIN LATERAL (
           SELECT created_at FROM agent_hub_referrals r2
            WHERE r2.agent_id = r.agent_id AND r2.created_at < r.created_at
            ORDER BY r2.created_at DESC LIMIT 1
         ) prev ON TRUE
        GROUP BY r.agent_id
     ),
     pending_auto AS (
       SELECT DISTINCT ar.agent_id
         FROM agent_hub_automation_runs ar
        WHERE ar.status IN ('pending_approval','approved','running')
     )
     SELECT a.id AS agent_id, a.tier, a.status, a.consent_to_email,
            t.score AS engagement_score,
            t.tier_recommendation,
            s14.score AS engagement_score_14d_ago,
            s30.score AS engagement_score_30d_ago,
            cr.days AS consistent_recommendation_days,
            COALESCE(lr.total, 0)::int AS total_referrals,
            (SELECT COUNT(*) FROM agent_hub_referrals rr
              WHERE rr.agent_id = a.id AND rr.stage = 'active_management')::int AS converted_referrals,
            EXTRACT(EPOCH FROM (NOW() - lr.last_at)) / 86400.0 AS days_since_last_referral,
            ri.avg_days AS avg_days_between_referrals,
            EXTRACT(EPOCH FROM (NOW() - a.last_interaction_date)) / 86400.0 AS days_since_last_interaction,
            (pa.agent_id IS NOT NULL) AS has_pending_automation,
            COALESCE(ltv.total_revenue_generated, 0) AS total_revenue,
            EXISTS (SELECT 1 FROM agent_hub_send_log sl WHERE sl.agent_id = a.id AND sl.replied_at IS NOT NULL) AS has_any_reply
       FROM agent_hub_agents a
       LEFT JOIN today_score t ON t.agent_id = a.id
       LEFT JOIN score_14d s14 ON s14.agent_id = a.id
       LEFT JOIN score_30d s30 ON s30.agent_id = a.id
       LEFT JOIN consistent_rec cr
              ON cr.agent_id = a.id AND cr.tier_recommendation = t.tier_recommendation
       LEFT JOIN last_referral lr ON lr.agent_id = a.id
       LEFT JOIN ref_intervals ri ON ri.agent_id = a.id
       LEFT JOIN pending_auto pa ON pa.agent_id = a.id
       LEFT JOIN agent_hub_agent_lifetime_value ltv ON ltv.agent_id = a.id
      WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
        ${agentId ? `AND a.id = $1` : ``}`,
    agentId ? [agentId] : []
  );

  for (const row of facts.rows) {
    try {
      const a = {
        agent_id: row.agent_id,
        tier: row.tier,
        status: row.status,
        consent_to_email: row.consent_to_email === true,
        engagement_score: row.engagement_score == null ? null : Number(row.engagement_score),
        engagement_score_14d_ago: row.engagement_score_14d_ago == null ? null : Number(row.engagement_score_14d_ago),
        engagement_score_30d_ago: row.engagement_score_30d_ago == null ? null : Number(row.engagement_score_30d_ago),
        tier_recommendation: row.tier_recommendation,
        consistent_recommendation_days: row.consistent_recommendation_days == null ? 0 : Number(row.consistent_recommendation_days),
        total_referrals: row.total_referrals || 0,
        converted_referrals: row.converted_referrals || 0,
        days_since_last_referral: row.days_since_last_referral == null ? null : Math.floor(Number(row.days_since_last_referral)),
        avg_days_between_referrals: row.avg_days_between_referrals == null ? null : Number(row.avg_days_between_referrals),
        days_since_last_interaction: row.days_since_last_interaction == null ? null : Math.floor(Number(row.days_since_last_interaction)),
        has_pending_automation: row.has_pending_automation === true,
        total_revenue: Number(row.total_revenue || 0),
        has_any_reply: row.has_any_reply === true,
      };

      // Get currently active flags + snooze info for this agent.
      const { rows: existing } = await pool.query(
        `SELECT id, flag_type, resolved_at, dismissed_at, snooze_until
           FROM agent_hub_predictive_flags
          WHERE agent_id = $1`,
        [row.agent_id]
      );
      const activeByType = new Map();
      const snoozedByType = new Map();
      for (const f of existing) {
        if (!f.resolved_at && !f.dismissed_at) {
          activeByType.set(f.flag_type, f);
        } else if (f.snooze_until && new Date(f.snooze_until) > new Date()) {
          snoozedByType.set(f.flag_type, f);
        }
      }

      // Evaluate each rule.
      const stillActiveTypes = new Set();
      for (const flagType of FLAG_TYPES) {
        const evalFn = FLAG_EVALUATORS[flagType];
        const evaluation = evalFn(a);
        if (evaluation == null) continue;

        // Snoozed? Don't create a new flag while snoozed.
        if (snoozedByType.has(flagType)) continue;

        stillActiveTypes.add(flagType);
        if (activeByType.has(flagType)) {
          // Update last_seen_at + reasoning + data_points (data may have shifted).
          await pool.query(
            `UPDATE agent_hub_predictive_flags
                SET last_seen_at = NOW(),
                    severity = $1,
                    confidence = $2,
                    reasoning = $3,
                    data_points = $4::jsonb
              WHERE id = $5`,
            [evaluation.severity, evaluation.confidence, evaluation.reasoning, JSON.stringify(evaluation.data_points || {}), activeByType.get(flagType).id]
          );
        } else {
          // Insert new active flag.
          try {
            await pool.query(
              `INSERT INTO agent_hub_predictive_flags
                 (agent_id, flag_type, severity, confidence, reasoning, data_points)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
              [row.agent_id, flagType, evaluation.severity, evaluation.confidence, evaluation.reasoning, JSON.stringify(evaluation.data_points || {})]
            );
            added++;
          } catch (e) {
            // The partial unique index can fire if a parallel job already
            // inserted this flag — safe no-op.
            if (e.code !== "23505") throw e;
          }
        }
      }

      // Auto-resolve any active flag whose condition no longer holds.
      for (const [flagType, flagRow] of activeByType.entries()) {
        if (!stillActiveTypes.has(flagType)) {
          await pool.query(
            `UPDATE agent_hub_predictive_flags
                SET resolved_at = NOW(),
                    resolution_reason = 'condition_no_longer_holds'
              WHERE id = $1 AND resolved_at IS NULL AND dismissed_at IS NULL`,
            [flagRow.id]
          );
          resolved++;
        }
      }

      processed++;
    } catch (e) {
      errorLog.push({ agent_id: row.agent_id, error: e.message });
    }
  }

  const durationMs = Date.now() - t0;
  await logCalculation(pool, "predictive_flags", {
    startedAt,
    processed,
    flagsAdded: added,
    flagsResolved: resolved,
    errors: errorLog.length,
    errorLog,
    durationMs,
    triggeredBy,
  });

  return { processed, added, resolved, errors: errorLog.length, durationMs };
}

// ============================================================
// 3. COHORT METRICS REFRESH (delegates to cohorts.js)
// ============================================================
export async function refreshCohorts({ triggeredBy = null } = {}) {
  const pool = getPool();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  await maintainQuarterlyCohorts();
  const result = await refreshAllCohortMetrics();
  const durationMs = Date.now() - t0;
  await logCalculation(pool, "cohort_refresh", {
    startedAt,
    processed: result.processed,
    errors: result.errors,
    durationMs,
    triggeredBy,
  });
  return { ...result, durationMs };
}

// ============================================================
// 4. SCORE HISTORY ARCHIVAL — keep 90 days in scores table, 365 in
//    history; truncate older.
// ============================================================
export async function archiveAndPruneScoreHistory({ triggeredBy = null } = {}) {
  const pool = getPool();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // Move scores older than 90d into history (already there via daily insert,
  // but ensure no gaps), then delete from scores table.
  await pool.query(
    `INSERT INTO agent_hub_engagement_score_history (agent_id, calculation_date, score, tier_at_time)
     SELECT s.agent_id, s.calculated_at::date, s.score, NULL
       FROM agent_hub_agent_engagement_scores s
      WHERE s.calculated_at < NOW() - INTERVAL '90 days'
     ON CONFLICT (agent_id, calculation_date) DO NOTHING`
  );
  const { rowCount: scoresDeleted } = await pool.query(
    `DELETE FROM agent_hub_agent_engagement_scores
       WHERE calculated_at < NOW() - INTERVAL '90 days'`
  );
  const { rowCount: historyDeleted } = await pool.query(
    `DELETE FROM agent_hub_engagement_score_history
       WHERE calculation_date < CURRENT_DATE - INTERVAL '365 days'`
  );
  const { rowCount: logDeleted } = await pool.query(
    `DELETE FROM agent_hub_intelligence_calculations_log
       WHERE started_at < NOW() - INTERVAL '60 days'`
  );

  const durationMs = Date.now() - t0;
  await logCalculation(pool, "score_history_archival", {
    startedAt,
    processed: scoresDeleted + historyDeleted + logDeleted,
    durationMs,
    triggeredBy,
  });

  return {
    scores_pruned: scoresDeleted,
    history_pruned: historyDeleted,
    log_pruned: logDeleted,
    durationMs,
  };
}
