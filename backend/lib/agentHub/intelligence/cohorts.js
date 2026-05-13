/**
 * Cohort framework.
 *
 * A cohort is defined by a JSONB object stored in agent_hub_cohorts.
 * The evaluator below converts that JSON to a parameterized SQL WHERE
 * clause. CRITICAL: every value flows through $N placeholders. We never
 * concatenate user-provided strings into SQL. The keys are whitelisted;
 * unknown keys are ignored.
 *
 * Allowed keys:
 *   added_after        — ISO date (string)
 *   added_before       — ISO date (string)
 *   tiers              — array of tier names
 *   sources            — array of source values
 *   target_zips        — array of zip codes (array overlap)
 *   brokerage_ids      — array of integer ids
 *   tags               — array of tag strings (any-of match)
 */

import { getPool } from "../../db.js";

const TIERS = new Set(["cold", "prospect", "warm", "partner", "vip", "dormant"]);
const SOURCES = new Set([
  "manual",
  "mls_listing",
  "linkedin",
  "event",
  "referral_from_agent",
  "website_form",
  "other",
]);

function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Translate a cohort definition into { whereClause, params }. Returns
 * `null, null` when the definition is invalid; caller should treat as
 * empty cohort.
 *
 * Safe: every dynamic value is bound via $N placeholders. Unknown keys
 * are silently dropped.
 */
export function buildCohortClause(definition, paramOffset = 0) {
  if (!definition || typeof definition !== "object") {
    return { whereClause: "FALSE", params: [] };
  }
  const filters = ["a.status != 'deleted'", "a.merged_into_agent_id IS NULL"];
  const params = [];
  let p = paramOffset + 1;

  if (definition.added_after && isIsoDate(definition.added_after)) {
    filters.push(`a.created_at >= $${p++}::timestamptz`);
    params.push(definition.added_after);
  }
  if (definition.added_before && isIsoDate(definition.added_before)) {
    filters.push(`a.created_at < $${p++}::timestamptz`);
    params.push(definition.added_before);
  }
  if (Array.isArray(definition.tiers) && definition.tiers.length) {
    const cleaned = definition.tiers.filter((t) => TIERS.has(t));
    if (cleaned.length) {
      filters.push(`a.tier = ANY($${p++}::text[])`);
      params.push(cleaned);
    }
  }
  if (Array.isArray(definition.sources) && definition.sources.length) {
    const cleaned = definition.sources.filter((s) => SOURCES.has(s));
    if (cleaned.length) {
      filters.push(`a.source = ANY($${p++}::text[])`);
      params.push(cleaned);
    }
  }
  if (Array.isArray(definition.target_zips) && definition.target_zips.length) {
    const cleaned = definition.target_zips
      .filter((z) => typeof z === "string" && /^\d{5}(-\d{4})?$/.test(z));
    if (cleaned.length) {
      // a.target_zips is text[], so use && (overlap) operator.
      filters.push(`a.target_zips && $${p++}::text[]`);
      params.push(cleaned);
    }
  }
  if (Array.isArray(definition.brokerage_ids) && definition.brokerage_ids.length) {
    const cleaned = definition.brokerage_ids
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (cleaned.length) {
      filters.push(`a.brokerage_id = ANY($${p++}::int[])`);
      params.push(cleaned);
    }
  }
  if (Array.isArray(definition.tags) && definition.tags.length) {
    const cleaned = definition.tags.filter((t) => typeof t === "string" && t.length <= 64);
    if (cleaned.length) {
      filters.push(`EXISTS (
        SELECT 1 FROM agent_hub_tags t
         WHERE t.agent_id = a.id
           AND t.tag = ANY($${p++}::text[])
      )`);
      params.push(cleaned);
    }
  }

  return { whereClause: filters.join(" AND "), params };
}

/**
 * Compute metrics for a cohort. Returns the metrics object (not stored
 * here — caller persists to agent_hub_cohorts.metrics).
 */
export async function computeCohortMetrics(definition) {
  const pool = getPool();
  const { whereClause, params } = buildCohortClause(definition, 0);

  // Total + tier distribution.
  const tierQuery = `
    SELECT a.tier, COUNT(*)::int AS n
      FROM agent_hub_agents a
     WHERE ${whereClause}
     GROUP BY a.tier`;
  const { rows: tierRows } = await pool.query(tierQuery, params);
  const total = tierRows.reduce((s, r) => s + r.n, 0);
  const tier_distribution = {};
  for (const r of tierRows) tier_distribution[r.tier] = r.n;

  // First-referral conversion rate (lifetime).
  const firstRefQuery = `
    SELECT
      COUNT(*) FILTER (WHERE first_ref.id IS NOT NULL)::int AS agents_with_referral,
      COUNT(*) FILTER (WHERE first_ref.stage = 'active_management')::int AS converted,
      AVG(EXTRACT(EPOCH FROM (first_ref.created_at - a.created_at)) / 86400.0)
        FILTER (WHERE first_ref.id IS NOT NULL) AS avg_days_to_first_referral
      FROM agent_hub_agents a
      LEFT JOIN LATERAL (
        SELECT r.id, r.created_at, r.stage
          FROM agent_hub_referrals r
         WHERE r.agent_id = a.id
         ORDER BY r.created_at ASC
         LIMIT 1
      ) first_ref ON TRUE
     WHERE ${whereClause}`;
  const { rows: firQ } = await pool.query(firstRefQuery, params);
  const f = firQ[0];

  // Lifetime referrals + revenue per agent (from MV).
  // COALESCE NULL→0 so agents missing from the LTV view (brand-new
  // agents pending the next MV refresh) count as zero rather than
  // being silently dropped from the average — which would bias the
  // result upward.
  const ltvQuery = `
    SELECT
      AVG(COALESCE(ltv.total_referrals_received, 0)) AS avg_referrals_per_agent,
      AVG(COALESCE(ltv.total_revenue_generated, 0)) AS avg_revenue_per_agent,
      AVG(COALESCE(ltv.total_referral_fees_paid, 0)) AS avg_fees_per_agent
      FROM agent_hub_agents a
      LEFT JOIN agent_hub_agent_lifetime_value ltv ON ltv.agent_id = a.id
     WHERE ${whereClause}`;
  const { rows: ltvQ } = await pool.query(ltvQuery, params);
  const l = ltvQ[0];

  // Active retention (% in non-dormant, non-deleted state).
  const retentionQuery = `
    SELECT
      COUNT(*) FILTER (WHERE a.tier != 'dormant')::int AS active,
      COUNT(*)::int AS all_count
      FROM agent_hub_agents a
     WHERE ${whereClause}`;
  const { rows: retQ } = await pool.query(retentionQuery, params);
  const r = retQ[0];
  const retention_pct = r.all_count > 0 ? Math.round((100 * r.active) / r.all_count) : 0;

  return {
    total_agents: total,
    tier_distribution,
    agents_with_referral: f.agents_with_referral || 0,
    converted_referrals: f.converted || 0,
    conversion_rate_pct:
      total > 0 ? Math.round((100 * (f.converted || 0)) / total) : 0,
    avg_days_to_first_referral:
      f.avg_days_to_first_referral != null ? Math.round(f.avg_days_to_first_referral) : null,
    avg_referrals_per_agent: l.avg_referrals_per_agent != null ? Number(l.avg_referrals_per_agent).toFixed(2) : "0",
    avg_revenue_per_agent: l.avg_revenue_per_agent != null ? Number(l.avg_revenue_per_agent).toFixed(2) : "0",
    avg_fees_per_agent: l.avg_fees_per_agent != null ? Number(l.avg_fees_per_agent).toFixed(2) : "0",
    active_retention_pct: retention_pct,
    calculated_at: new Date().toISOString(),
  };
}

/**
 * Refresh metrics for ALL cohorts. Called nightly.
 */
export async function refreshAllCohortMetrics() {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id, definition FROM agent_hub_cohorts`);
  let processed = 0;
  let errors = 0;
  for (const c of rows) {
    try {
      const metrics = await computeCohortMetrics(c.definition);
      await pool.query(
        `UPDATE agent_hub_cohorts SET metrics = $1::jsonb, metrics_calculated_at = NOW() WHERE id = $2`,
        [JSON.stringify(metrics), c.id]
      );
      processed++;
    } catch (e) {
      errors++;
      console.error(`[agent-hub] cohort metrics ${c.id}`, e);
    }
  }
  return { processed, errors };
}

/**
 * Maintain auto-generated quarterly cohorts. Called from the daily
 * cohort refresh job. Adds a cohort for the upcoming quarter if it
 * doesn't already exist.
 */
export async function maintainQuarterlyCohorts() {
  const pool = getPool();
  const today = new Date();
  // Build the next two quarters.
  const out = [];
  for (let i = -8; i <= 1; i++) {
    const yr = today.getFullYear() + Math.floor((today.getMonth() / 3 + i) / 4);
    const q = ((today.getMonth() / 3 + i) % 4 + 4) % 4;
    const startMonth = q * 3;
    const start = new Date(Date.UTC(yr, startMonth, 1));
    const end = new Date(Date.UTC(yr, startMonth + 3, 1));
    const name = `${yr} Q${q + 1} cohort`;
    out.push({
      name,
      definition: {
        added_after: start.toISOString().slice(0, 10),
        added_before: end.toISOString().slice(0, 10),
      },
    });
  }
  let added = 0;
  for (const c of out) {
    const { rowCount } = await pool.query(
      `INSERT INTO agent_hub_cohorts (name, description, definition, is_system)
       VALUES ($1, $2, $3::jsonb, TRUE)
       ON CONFLICT (name) DO NOTHING`,
      [c.name, "Auto-generated quarterly cohort", JSON.stringify(c.definition)]
    );
    if (rowCount) added++;
  }
  return { added };
}
