/**
 * Phase 4 Agent Hub: intelligence layer routes.
 *
 * Read-heavy. Manual recalc endpoints require manager+. Dismiss-flag
 * is open to any team user (audit-logged).
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole } from "../lib/agentHub/permissions.js";
import { vIntId, vStringOpt, vStringReq } from "../lib/agentHub/validators.js";
import {
  recomputeAllEngagementScores,
  refreshAllPredictiveFlags,
} from "../lib/agentHub/intelligence/jobs.js";

// ============================================================
// In-process caches (60s for dashboard endpoints, 5min for leaderboard).
// ============================================================
const dashCache = new Map();
const DASH_TTL_MS = 60 * 1000;
const lbCache = new Map();
const LB_TTL_MS = 5 * 60 * 1000;

function cacheGet(map, key, ttl) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() - e.t > ttl) {
    map.delete(key);
    return null;
  }
  return e.v;
}
function cacheSet(map, key, v) {
  map.set(key, { v, t: Date.now() });
}
export function clearIntelligenceCaches() {
  dashCache.clear();
  lbCache.clear();
}

function mapScore(r) {
  if (!r) return null;
  return {
    id: r.id,
    agent_id: r.agent_id,
    agent_name: r.agent_name ?? null,
    agent_tier: r.agent_tier ?? null,
    calculated_at: r.calculated_at,
    score: r.score,
    tier_recommendation: r.tier_recommendation ?? null,
    tier_recommendation_changed: r.tier_recommendation_changed === true,
    components: {
      recency: r.component_recency,
      frequency: r.component_frequency,
      two_way: r.component_two_way,
      referrals: r.component_referrals,
      financials: r.component_financials,
    },
    explanation: r.explanation || [],
  };
}

function mapFlag(r) {
  if (!r) return null;
  return {
    id: r.id,
    agent_id: r.agent_id,
    agent_name: r.agent_name ?? null,
    agent_tier: r.agent_tier ?? null,
    agent_photo_url: r.agent_photo_url ?? null,
    flag_type: r.flag_type,
    severity: r.severity,
    confidence: r.confidence,
    reasoning: r.reasoning,
    data_points: r.data_points || {},
    first_flagged_at: r.first_flagged_at,
    last_seen_at: r.last_seen_at,
    resolved_at: r.resolved_at ?? null,
    resolution_reason: r.resolution_reason ?? null,
    dismissed_at: r.dismissed_at ?? null,
    dismissed_by: r.dismissed_by ?? null,
    dismissed_reason: r.dismissed_reason ?? null,
    snooze_until: r.snooze_until ?? null,
  };
}

// ============================================================
// SCORES
// ============================================================
export async function listScores(req, res) {
  try {
    const pool = getPool();
    const allowed = allowedAgentIdsFor(req.agentHubPerms);
    const filters = ["s.calculated_at::date = CURRENT_DATE"];
    const params = [];
    let p = 1;
    if (req.query.tier) {
      filters.push(`a.tier = $${p++}`);
      params.push(String(req.query.tier));
    }
    if (req.query.tier_recommendation_changed === "true") {
      filters.push("s.tier_recommendation_changed = TRUE");
    }
    if (req.query.min_score) {
      filters.push(`s.score >= $${p++}`);
      params.push(Number(req.query.min_score));
    }
    if (req.query.max_score) {
      filters.push(`s.score <= $${p++}`);
      params.push(Number(req.query.max_score));
    }
    if (allowed) {
      filters.push(`s.agent_id = ANY($${p++}::int[])`);
      params.push(allowed);
    }
    const sortMap = {
      score: "s.score DESC",
      tier_recommendation_changed: "s.tier_recommendation_changed DESC, s.score DESC",
      // For trend sort, treat NULL 30d-history (brand-new agents) as
      // "no trend data" — push to the end rather than ranking them by
      // raw score.
      score_trend: "(s.score - h.score) DESC NULLS LAST",
      name: "LOWER(a.full_name) ASC",
    };
    const sort = sortMap[req.query.sort] || sortMap.score;
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;

    const where = `WHERE ${filters.join(" AND ")}`;
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM agent_hub_agent_engagement_scores s
         JOIN agent_hub_agents a ON a.id = s.agent_id
         ${where}`,
      params
    );
    const { rows } = await pool.query(
      `SELECT s.*, a.full_name AS agent_name, a.tier AS agent_tier,
              h.score AS score_30d_ago
         FROM agent_hub_agent_engagement_scores s
         JOIN agent_hub_agents a ON a.id = s.agent_id
         LEFT JOIN LATERAL (
           SELECT score FROM agent_hub_engagement_score_history
            WHERE agent_id = s.agent_id AND calculation_date <= CURRENT_DATE - INTERVAL '30 days'
            ORDER BY calculation_date DESC LIMIT 1
         ) h ON TRUE
         ${where}
        ORDER BY ${sort}
        LIMIT $${p++} OFFSET $${p++}`,
      [...params, perPage, offset]
    );
    res.json({
      scores: rows.map((r) => ({ ...mapScore(r), score_30d_ago: r.score_30d_ago != null ? Number(r.score_30d_ago) : null })),
      total: countRows[0].total,
      page,
      per_page: perPage,
    });
  } catch (e) {
    console.error("[agent-hub] scores list", e);
    res.status(500).json({ error: "Could not load scores." });
  }
}

export async function getAgentScore(req, res) {
  try {
    const id = vIntId(req.params.agent_id || req.params.id, "agent id");
    const allowed = allowedAgentIdsFor(req.agentHubPerms);
    if (allowed && !allowed.includes(id)) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.*, a.full_name AS agent_name, a.tier AS agent_tier
         FROM agent_hub_agent_engagement_scores s
         JOIN agent_hub_agents a ON a.id = s.agent_id
        WHERE s.agent_id = $1
        ORDER BY s.calculated_at DESC LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      res.json({ score: null, history: [] });
      return;
    }
    const { rows: history } = await pool.query(
      `SELECT calculation_date, score, tier_at_time
         FROM agent_hub_engagement_score_history
        WHERE agent_id = $1 AND calculation_date >= CURRENT_DATE - INTERVAL '90 days'
        ORDER BY calculation_date ASC`,
      [id]
    );
    res.json({ score: mapScore(rows[0]), history });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] agent score", e);
    res.status(500).json({ error: "Could not load score." });
  }
}

export async function recalculateScores(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const body = req.body ?? {};
    const agentId = body.agent_id ? vIntId(body.agent_id, "agent_id") : null;
    const result = await recomputeAllEngagementScores({ agentId, triggeredBy: req.user.id });
    clearIntelligenceCaches();
    await logAudit(req, {
      entity_type: "intelligence",
      action: "update",
      field_name: "engagement_score_recalc",
      context: { agent_id: agentId, ...result },
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] recalc scores", e);
    res.status(500).json({ error: e.message || "Recalc failed." });
  }
}

export async function getCalculationLog(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT l.*, u.display_name AS triggered_by_name
         FROM agent_hub_intelligence_calculations_log l
         LEFT JOIN users u ON u.id = l.triggered_by
        ORDER BY l.started_at DESC
        LIMIT 100`
    );
    res.json({ runs: rows });
  } catch (e) {
    console.error("[agent-hub] calc log", e);
    res.status(500).json({ error: "Could not load log." });
  }
}

// ============================================================
// FLAGS
// ============================================================
export async function listFlags(req, res) {
  try {
    const pool = getPool();
    const filters = ["f.resolved_at IS NULL", "f.dismissed_at IS NULL"];
    const params = [];
    let p = 1;
    if (req.query.flag_type) {
      filters.push(`f.flag_type = $${p++}`);
      params.push(String(req.query.flag_type));
    }
    if (req.query.severity) {
      filters.push(`f.severity = $${p++}`);
      params.push(String(req.query.severity));
    }
    if (req.query.agent_id) {
      filters.push(`f.agent_id = $${p++}`);
      params.push(Number(req.query.agent_id));
    }
    const allowed = allowedAgentIdsFor(req.agentHubPerms);
    if (allowed) {
      filters.push(`f.agent_id = ANY($${p++}::int[])`);
      params.push(allowed);
    }
    const where = `WHERE ${filters.join(" AND ")}`;
    const { rows } = await pool.query(
      `SELECT f.*, a.full_name AS agent_name, a.tier AS agent_tier, a.photo_url AS agent_photo_url
         FROM agent_hub_predictive_flags f
         JOIN agent_hub_agents a ON a.id = f.agent_id
         ${where}
        ORDER BY
          CASE f.severity WHEN 'action' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,
          CASE f.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
          f.last_seen_at DESC
        LIMIT 200`,
      params
    );
    res.json({ flags: rows.map(mapFlag) });
  } catch (e) {
    console.error("[agent-hub] flags list", e);
    res.status(500).json({ error: "Could not load flags." });
  }
}

export async function getFlag(req, res) {
  try {
    const id = vIntId(req.params.id, "flag id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT f.*, a.full_name AS agent_name, a.tier AS agent_tier
         FROM agent_hub_predictive_flags f
         JOIN agent_hub_agents a ON a.id = f.agent_id
        WHERE f.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ flag: mapFlag(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] flag get", e);
    res.status(500).json({ error: "Could not load flag." });
  }
}

const SNOOZE_DAYS = 90;

export async function dismissFlag(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const id = vIntId(req.params.id, "flag id");
    const reason = vStringReq(req.body?.reason, "reason", { maxLen: 500 });
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT * FROM agent_hub_predictive_flags WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (rows[0].dismissed_at) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Already dismissed." });
      return;
    }
    // Transactional: dismiss + activity-log together so a partial failure
    // never leaves the timeline desynced from the flag state.
    const { rows: updated } = await client.query(
      `UPDATE agent_hub_predictive_flags
          SET dismissed_at = NOW(),
              dismissed_by = $2,
              dismissed_reason = $3,
              snooze_until = NOW() + INTERVAL '90 days'
        WHERE id = $1
       RETURNING *`,
      [id, req.user.id, reason]
    );
    await client.query(
      `INSERT INTO agent_hub_activities
         (agent_id, type, direction, summary, metadata, occurred_at, created_by, updated_by)
       VALUES ($1, 'system_event', 'internal', $2, $3::jsonb, NOW(), $4, $4)`,
      [
        rows[0].agent_id,
        `Flag dismissed: ${rows[0].flag_type} — ${reason}`,
        JSON.stringify({ flag_id: id, flag_type: rows[0].flag_type, snooze_days: SNOOZE_DAYS }),
        req.user.id,
      ]
    );
    await client.query("COMMIT");
    // Audit log is best-effort and runs after commit (logAudit uses its
    // own pool query and tolerates failure without throwing).
    await logAudit(req, {
      entity_type: "predictive_flag",
      entity_id: id,
      action: "delete",
      old_value: { flag_type: rows[0].flag_type },
      context: { reason, snooze_days: SNOOZE_DAYS },
    });
    res.json({ flag: mapFlag(updated[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] dismiss flag", e);
    res.status(500).json({ error: "Could not dismiss." });
  } finally {
    client.release();
  }
}

export async function recalculateFlags(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const result = await refreshAllPredictiveFlags({ triggeredBy: req.user.id });
    clearIntelligenceCaches();
    await logAudit(req, {
      entity_type: "intelligence",
      action: "update",
      field_name: "flag_recalc",
      context: result,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] recalc flags", e);
    res.status(500).json({ error: e.message || "Recalc failed." });
  }
}

// ============================================================
// LEADERBOARD
// ============================================================
export async function leaderboard(req, res) {
  try {
    const metric = ["referrals", "fees_paid", "revenue", "score", "engagement_growth"].includes(req.query.metric)
      ? req.query.metric
      : "score";
    const range = ["ytd", "mtd", "last_30", "last_90", "all_time"].includes(req.query.range)
      ? req.query.range
      : "all_time";
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const cacheKey = `lb:${metric}:${range}:${limit}`;
    const cached = cacheGet(lbCache, cacheKey, LB_TTL_MS);
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    let query;
    let params = [limit];
    if (metric === "score") {
      query = `
        SELECT a.id AS agent_id, a.full_name, a.brokerage_name, a.tier, a.photo_url,
               s.score AS metric_value
          FROM agent_hub_agent_engagement_scores s
          JOIN agent_hub_agents a ON a.id = s.agent_id
         WHERE s.calculated_at::date = CURRENT_DATE
           AND a.status != 'deleted' AND a.merged_into_agent_id IS NULL
         ORDER BY s.score DESC
         LIMIT $1`;
    } else if (metric === "engagement_growth") {
      // Only include agents with a 30-day-ago history row. Brand-new
      // agents (no history yet) would otherwise show "growth = score"
      // and flood the "biggest improvers" leaderboard.
      query = `
        SELECT a.id AS agent_id, a.full_name, a.brokerage_name, a.tier, a.photo_url,
               (s.score - h.score) AS metric_value
          FROM agent_hub_agent_engagement_scores s
          JOIN agent_hub_agents a ON a.id = s.agent_id
          JOIN LATERAL (
            SELECT score FROM agent_hub_engagement_score_history
             WHERE agent_id = s.agent_id AND calculation_date <= CURRENT_DATE - INTERVAL '30 days'
             ORDER BY calculation_date DESC LIMIT 1
          ) h ON TRUE
         WHERE s.calculated_at::date = CURRENT_DATE
           AND a.status != 'deleted' AND a.merged_into_agent_id IS NULL
         ORDER BY metric_value DESC NULLS LAST
         LIMIT $1`;
    } else {
      // referrals / fees_paid / revenue come from LTV view (which already
      // aggregates by effective_id including merged-loser rollups).
      const dateClause =
        range === "all_time" ? "" :
        range === "ytd" ? "AND r.created_at >= date_trunc('year', NOW())" :
        range === "mtd" ? "AND r.created_at >= date_trunc('month', NOW())" :
        range === "last_30" ? "AND r.created_at >= NOW() - INTERVAL '30 days'" :
        "AND r.created_at >= NOW() - INTERVAL '90 days'";
      const paymentDateClause = dateClause.replace("r.created_at", "p.payment_date");
      const revDateClause = dateClause.replace("r.created_at", "rt.month");

      if (metric === "referrals") {
        query = `
          SELECT a.id AS agent_id, a.full_name, a.brokerage_name, a.tier, a.photo_url,
                 (SELECT COUNT(*)::int FROM agent_hub_referrals r WHERE r.agent_id = a.id ${dateClause}) AS metric_value
            FROM agent_hub_agents a
           WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
           ORDER BY metric_value DESC
           LIMIT $1`;
      } else if (metric === "fees_paid") {
        query = `
          SELECT a.id AS agent_id, a.full_name, a.brokerage_name, a.tier, a.photo_url,
                 (SELECT COALESCE(SUM(p.amount), 0)
                    FROM agent_hub_referral_payments p
                    JOIN agent_hub_referrals r ON r.id = p.referral_id
                   WHERE r.agent_id = a.id AND p.deleted_at IS NULL ${paymentDateClause}) AS metric_value
            FROM agent_hub_agents a
           WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
           ORDER BY metric_value DESC NULLS LAST
           LIMIT $1`;
      } else { // revenue
        query = `
          SELECT a.id AS agent_id, a.full_name, a.brokerage_name, a.tier, a.photo_url,
                 (SELECT COALESCE(SUM(rt.management_fee_earned), 0)
                    FROM agent_hub_revenue_tracking rt
                    JOIN agent_hub_referrals r ON r.id = rt.referral_id
                   WHERE r.agent_id = a.id AND rt.deleted_at IS NULL ${revDateClause}) AS metric_value
            FROM agent_hub_agents a
           WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
           ORDER BY metric_value DESC NULLS LAST
           LIMIT $1`;
      }
    }
    const { rows } = await pool.query(query, params);
    const data = {
      metric,
      range,
      leaderboard: rows.map((r, i) => ({
        rank: i + 1,
        agent_id: r.agent_id,
        full_name: r.full_name,
        brokerage_name: r.brokerage_name,
        tier: r.tier,
        photo_url: r.photo_url ?? null,
        metric_value: r.metric_value != null ? Number(r.metric_value) : 0,
      })),
    };
    cacheSet(lbCache, cacheKey, data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] leaderboard", e);
    res.status(500).json({ error: "Could not load leaderboard." });
  }
}

// ============================================================
// HEALTH (by tier)
// ============================================================
export async function getHealth(_req, res) {
  try {
    const cached = cacheGet(dashCache, "health", DASH_TTL_MS);
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.tier,
              COUNT(*)::int AS agents,
              ROUND(AVG(s.score)::numeric, 1) AS avg_score,
              COUNT(*) FILTER (WHERE s.score < COALESCE(h.score, 0))::int AS declining_count
         FROM agent_hub_agents a
         LEFT JOIN agent_hub_agent_engagement_scores s
                ON s.agent_id = a.id AND s.calculated_at::date = CURRENT_DATE
         LEFT JOIN LATERAL (
           SELECT score FROM agent_hub_engagement_score_history
            WHERE agent_id = a.id AND calculation_date <= CURRENT_DATE - INTERVAL '14 days'
            ORDER BY calculation_date DESC LIMIT 1
         ) h ON TRUE
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
        GROUP BY a.tier`
    );
    const data = { tiers: rows };
    cacheSet(dashCache, "health", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] health", e);
    res.status(500).json({ error: "Could not load health." });
  }
}

// ============================================================
// PREDICTIONS — flat list, prioritized
// ============================================================
export async function getPredictions(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT f.*, a.full_name AS agent_name, a.tier AS agent_tier, a.photo_url AS agent_photo_url
         FROM agent_hub_predictive_flags f
         JOIN agent_hub_agents a ON a.id = f.agent_id
        WHERE f.resolved_at IS NULL AND f.dismissed_at IS NULL
        ORDER BY
          CASE f.severity WHEN 'action' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,
          CASE f.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
          f.last_seen_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ predictions: rows.map(mapFlag) });
  } catch (e) {
    console.error("[agent-hub] predictions", e);
    res.status(500).json({ error: "Could not load predictions." });
  }
}

// ============================================================
// TRENDS
// ============================================================
export async function trendScoreDistribution(_req, res) {
  try {
    const cached = cacheGet(dashCache, "score_dist", DASH_TTL_MS);
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT WIDTH_BUCKET(s.score, 0, 100, 10) AS bucket,
              COUNT(*)::int AS n,
              ROUND(AVG(s.score)::numeric, 1) AS avg_score,
              ARRAY_AGG(DISTINCT a.tier) AS tiers
         FROM agent_hub_agent_engagement_scores s
         JOIN agent_hub_agents a ON a.id = s.agent_id
        WHERE s.calculated_at::date = CURRENT_DATE
          AND a.status != 'deleted' AND a.merged_into_agent_id IS NULL
        GROUP BY bucket
        ORDER BY bucket`
    );
    const histogram = rows.map((r) => ({
      bucket: r.bucket,
      bucket_min: (r.bucket - 1) * 10,
      bucket_max: Math.min(r.bucket * 10, 100),
      count: r.n,
      avg_score: Number(r.avg_score),
      tiers: r.tiers || [],
    }));
    const data = { histogram };
    cacheSet(dashCache, "score_dist", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] score dist", e);
    res.status(500).json({ error: "Could not load distribution." });
  }
}

export async function trendTierMovement(_req, res) {
  try {
    const cached = cacheGet(dashCache, "tier_movement", DASH_TTL_MS);
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    // Tier audit values are JSON-encoded strings (Phase 1 logFieldDiff
    // stringifies values), so old_value/new_value look like '"warm"'.
    // Earlier code lex-compared these strings, which is wrong: "cold" < "warm"
    // lexically would mark cold→warm as a downgrade. Map to ordinals first.
    const tierOrdinal = `
      CASE COALESCE(old_value->>0, '')::text
        WHEN 'cold' THEN 0
        WHEN 'dormant' THEN 0
        WHEN 'prospect' THEN 1
        WHEN 'warm' THEN 2
        WHEN 'partner' THEN 3
        WHEN 'vip' THEN 4
        ELSE NULL END`;
    const newOrdinal = `
      CASE COALESCE(new_value->>0, '')::text
        WHEN 'cold' THEN 0
        WHEN 'dormant' THEN 0
        WHEN 'prospect' THEN 1
        WHEN 'warm' THEN 2
        WHEN 'partner' THEN 3
        WHEN 'vip' THEN 4
        ELSE NULL END`;
    const { rows } = await pool.query(
      `SELECT DATE_TRUNC('day', created_at)::date AS day,
              COUNT(*) FILTER (WHERE (${newOrdinal}) > (${tierOrdinal}))::int AS upgrades,
              COUNT(*) FILTER (WHERE (${newOrdinal}) < (${tierOrdinal}))::int AS downgrades
         FROM agent_hub_audit_log
        WHERE entity_type = 'agent'
          AND field_name = 'tier'
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY day ASC`
    );
    const data = { days: rows };
    cacheSet(dashCache, "tier_movement", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] tier movement", e);
    res.status(500).json({ error: "Could not load tier movement." });
  }
}

export async function trendReferralVelocity(_req, res) {
  try {
    const cached = cacheGet(dashCache, "ref_velocity", DASH_TTL_MS);
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT DATE_TRUNC('month', created_at)::date AS month,
              COUNT(*)::int AS referrals,
              COUNT(*) FILTER (WHERE stage = 'active_management')::int AS converted
         FROM agent_hub_referrals
        WHERE created_at >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month ASC`
    );
    const data = { months: rows };
    cacheSet(dashCache, "ref_velocity", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] ref velocity", e);
    res.status(500).json({ error: "Could not load velocity." });
  }
}

// ============================================================
// FUNNEL — agents reached → engaged → referring → repeat → partner
// ============================================================
export async function getFunnel(_req, res) {
  try {
    const cached = cacheGet(dashCache, "funnel", DASH_TTL_MS);
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'deleted' AND merged_into_agent_id IS NULL)::int AS reached,
         COUNT(*) FILTER (
           WHERE status != 'deleted' AND merged_into_agent_id IS NULL
             AND last_interaction_date IS NOT NULL
         )::int AS engaged,
         COUNT(*) FILTER (
           WHERE status != 'deleted' AND merged_into_agent_id IS NULL
             AND id IN (SELECT agent_id FROM agent_hub_referrals)
         )::int AS referring,
         COUNT(*) FILTER (
           WHERE status != 'deleted' AND merged_into_agent_id IS NULL
             AND id IN (
               SELECT agent_id FROM agent_hub_referrals
                GROUP BY agent_id HAVING COUNT(*) >= 2
             )
         )::int AS repeat_referring,
         COUNT(*) FILTER (WHERE tier IN ('partner','vip'))::int AS partner_or_vip
         FROM agent_hub_agents`
    );
    const data = { funnel: rows[0] };
    cacheSet(dashCache, "funnel", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] funnel", e);
    res.status(500).json({ error: "Could not load funnel." });
  }
}
