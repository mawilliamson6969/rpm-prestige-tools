/**
 * Phase 2: pipeline + financials aggregation endpoints.
 *
 * Cached for 5 minutes per the spec. Same in-process Map pattern as the
 * Phase 1 dashboard cache.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertPermission } from "../lib/agentHub/permissions.js";
import { STAGES, PIPELINE_STAGES } from "../lib/agentHub/stages.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function cachedKey(req, key) {
  const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
  return `${key}::${req.agentHubPerms?.role || "?"}::${allowedIds ? allowedIds.join(",") : "all"}`;
}
function getCached(req, key) {
  const k = cachedKey(req, key);
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_TTL_MS) {
    cache.delete(k);
    return null;
  }
  return e.v;
}
function setCached(req, key, v) {
  cache.set(cachedKey(req, key), { v, t: Date.now() });
}
export function clearAgentHubFinancialsCache() {
  cache.clear();
}

function allowedAgentClause(perms, paramOffset) {
  const allowed = allowedAgentIdsFor(perms);
  if (!allowed) return { clause: "", params: [] };
  return {
    clause: ` AND r.agent_id = ANY($${paramOffset}::int[])`,
    params: [allowed],
  };
}

// GET /agent-hub/pipeline/stats
export async function getPipelineStats(req, res) {
  try {
    const cached = getCached(req, "pipeline_stats");
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const { clause, params } = allowedAgentClause(req.agentHubPerms, 1);

    const { rows: byStage } = await pool.query(
      `SELECT r.stage,
              COUNT(*)::int AS count,
              COALESCE(SUM(r.expected_first_month_referral_fee), 0) AS expected_fees,
              COALESCE(SUM(r.expected_monthly_rent), 0) AS expected_mrr,
              ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - r.stage_changed_at))/86400.0)::numeric, 1) AS avg_days_in_stage
         FROM agent_hub_referrals r
        WHERE r.stage NOT IN ('lost','declined') ${clause}
        GROUP BY r.stage`,
      params
    );

    // Conversion rate this quarter
    const { rows: conv } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE r.stage = 'active_management')::int AS converted,
         COUNT(*) FILTER (WHERE r.stage = 'lost')::int AS lost,
         COUNT(*) FILTER (WHERE r.stage = 'declined')::int AS declined
         FROM agent_hub_referrals r
        WHERE r.stage_changed_at >= date_trunc('quarter', NOW()) ${clause}`,
      params
    );

    const total = byStage.reduce((s, r) => s + r.count, 0);
    const totalExpectedFees = byStage.reduce((s, r) => s + Number(r.expected_fees || 0), 0);
    const totalExpectedMrr = byStage.reduce((s, r) => s + Number(r.expected_mrr || 0), 0);
    const c = conv[0];
    const denom = c.converted + c.lost + c.declined;
    const conversionRate = denom > 0 ? Math.round((c.converted / denom) * 1000) / 10 : 0;

    const data = {
      total_in_pipeline: total,
      total_expected_first_month_fees: totalExpectedFees,
      total_expected_mrr: totalExpectedMrr,
      conversion_rate_qtr: conversionRate,
      by_stage: byStage.map((r) => ({
        stage: r.stage,
        count: r.count,
        expected_fees: Number(r.expected_fees),
        expected_mrr: Number(r.expected_mrr),
        avg_days_in_stage: r.avg_days_in_stage != null ? Number(r.avg_days_in_stage) : null,
      })),
    };
    setCached(req, "pipeline_stats", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] pipeline stats", e);
    res.status(500).json({ error: "Could not load pipeline stats." });
  }
}

// GET /agent-hub/pipeline/funnel?days=30|90|365
export async function getPipelineFunnel(req, res) {
  try {
    const days = [30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 90;
    const cached = getCached(req, `funnel_${days}`);
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const { clause, params } = allowedAgentClause(req.agentHubPerms, 1);
    // Count referrals that EVER reached each stage in the last N days
    // (using stage history). The N is the number of days the stage entry occurred within.
    const { rows } = await pool.query(
      `SELECT h.to_stage AS stage, COUNT(DISTINCT h.referral_id)::int AS count
         FROM agent_hub_referral_stage_history h
         JOIN agent_hub_referrals r ON r.id = h.referral_id
        WHERE h.changed_at >= NOW() - ($1::int * INTERVAL '1 day')
          ${clause.replace("$1", `$${params.length + 2}`)}
        GROUP BY h.to_stage`,
      [days, ...params]
    );
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r.count]));
    const data = {
      days,
      stages: STAGES.map((s) => ({ stage: s, count: byStage[s] || 0 })),
    };
    setCached(req, `funnel_${days}`, data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] pipeline funnel", e);
    res.status(500).json({ error: "Could not load funnel." });
  }
}

// GET /agent-hub/financials/summary
export async function getFinancialsSummary(req, res) {
  try {
    const cached = getCached(req, "financials_summary");
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(p.amount), 0) AS lifetime_fees,
         COALESCE(SUM(p.amount) FILTER (
           WHERE p.payment_date >= date_trunc('year', NOW())
         ), 0) AS ytd_fees,
         COALESCE(SUM(p.amount) FILTER (
           WHERE p.payment_date >= date_trunc('month', NOW())
         ), 0) AS mtd_fees
         FROM agent_hub_referral_payments p
        WHERE p.deleted_at IS NULL`
    );
    const { rows: rev } = await pool.query(
      `SELECT
         COALESCE(SUM(rt.management_fee_earned), 0) AS lifetime_revenue,
         COALESCE(SUM(rt.management_fee_earned) FILTER (
           WHERE rt.month >= date_trunc('year', NOW())::date
         ), 0) AS ytd_revenue,
         COALESCE(SUM(rt.management_fee_earned) FILTER (
           WHERE rt.month = date_trunc('month', NOW())::date
         ), 0) AS mtd_revenue
         FROM agent_hub_revenue_tracking rt
        WHERE rt.deleted_at IS NULL`
    );

    const lifetimeFees = Number(rows[0].lifetime_fees);
    const lifetimeRevenue = Number(rev[0].lifetime_revenue);
    const data = {
      lifetime_fees_paid: lifetimeFees,
      ytd_fees_paid: Number(rows[0].ytd_fees),
      mtd_fees_paid: Number(rows[0].mtd_fees),
      lifetime_revenue_generated: lifetimeRevenue,
      ytd_revenue_generated: Number(rev[0].ytd_revenue),
      mtd_revenue_generated: Number(rev[0].mtd_revenue),
      net_margin: lifetimeRevenue - lifetimeFees,
      roi_ratio: lifetimeFees > 0 ? Math.round((lifetimeRevenue / lifetimeFees) * 100) / 100 : null,
    };
    setCached(req, "financials_summary", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] financials summary", e);
    res.status(500).json({ error: "Could not load financials." });
  }
}

// GET /agent-hub/financials/by-month?months=24
export async function getFinancialsByMonth(req, res) {
  try {
    const months = Math.min(Math.max(Number(req.query.months) || 24, 1), 60);
    const cached = getCached(req, `financials_by_month_${months}`);
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const { rows: feesByMonth } = await pool.query(
      `SELECT date_trunc('month', p.payment_date)::date AS month,
              COALESCE(SUM(p.amount), 0) AS fees
         FROM agent_hub_referral_payments p
        WHERE p.deleted_at IS NULL
          AND p.payment_date >= (date_trunc('month', NOW()) - ($1::int - 1) * INTERVAL '1 month')::date
        GROUP BY 1
        ORDER BY 1 ASC`,
      [months]
    );
    const { rows: revByMonth } = await pool.query(
      `SELECT rt.month, COALESCE(SUM(rt.management_fee_earned), 0) AS revenue
         FROM agent_hub_revenue_tracking rt
        WHERE rt.deleted_at IS NULL
          AND rt.month >= (date_trunc('month', NOW()) - ($1::int - 1) * INTERVAL '1 month')::date
        GROUP BY rt.month
        ORDER BY rt.month ASC`,
      [months]
    );
    // Merge into a single timeline.
    const map = new Map();
    for (const r of feesByMonth) {
      const k = String(r.month);
      map.set(k, { month: r.month, fees: Number(r.fees), revenue: 0 });
    }
    for (const r of revByMonth) {
      const k = String(r.month);
      if (!map.has(k)) {
        map.set(k, { month: r.month, fees: 0, revenue: Number(r.revenue) });
      } else {
        map.get(k).revenue = Number(r.revenue);
      }
    }
    const series = Array.from(map.values())
      .sort((a, b) => (a.month < b.month ? -1 : 1))
      .map((m) => ({ ...m, net_margin: m.revenue - m.fees }));
    const data = { months, series };
    setCached(req, `financials_by_month_${months}`, data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] financials by month", e);
    res.status(500).json({ error: "Could not load monthly financials." });
  }
}

// GET /agent-hub/financials/export.csv
export async function exportFinancialsCsv(req, res) {
  try {
    assertPermission(req.agentHubPerms, "can_export");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.id AS agent_id, a.full_name, a.brokerage_name, a.tier,
              ltv.total_referrals_received, ltv.total_referrals_converted,
              ltv.conversion_rate_pct, ltv.total_referral_fees_paid,
              ltv.total_revenue_generated, ltv.lifetime_relationship_value,
              ltv.first_referral_date, ltv.last_referral_date
         FROM agent_hub_agent_lifetime_value ltv
         JOIN agent_hub_agents a ON a.id = ltv.agent_id
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
        ORDER BY ltv.total_referral_fees_paid DESC NULLS LAST`
    );
    const escape = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "agent_id","full_name","brokerage","tier",
      "referrals_received","referrals_converted","conversion_rate_pct",
      "total_fees_paid","total_revenue_generated","lifetime_relationship_value",
      "first_referral_date","last_referral_date",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.agent_id, r.full_name, r.brokerage_name || "", r.tier,
        r.total_referrals_received, r.total_referrals_converted, r.conversion_rate_pct,
        r.total_referral_fees_paid, r.total_revenue_generated, r.lifetime_relationship_value,
        r.first_referral_date, r.last_referral_date,
      ].map(escape).join(","));
    }
    await logAudit(req, {
      entity_type: "financials",
      action: "export",
      context: { row_count: rows.length, format: "csv" },
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="agent-hub-financials-${Date.now()}.csv"`);
    res.send(lines.join("\n"));
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] financials export", e);
    res.status(500).json({ error: "Could not export." });
  }
}
