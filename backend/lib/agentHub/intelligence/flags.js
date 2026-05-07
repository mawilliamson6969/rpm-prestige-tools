/**
 * Predictive flag rules.
 *
 * 6 flag types, each with a clear deterministic rule. Heuristics, not ML.
 * Each rule is a pure function evaluated against precomputed agent facts.
 *
 * Lifecycle:
 *   - condition first true        → INSERT (status=active)
 *   - still true on next refresh  → UPDATE last_seen_at
 *   - condition no longer true    → resolve (resolved_at = NOW, reason auto)
 *   - manually dismissed          → dismissed_at + dismissed_reason +
 *                                    snooze_until = now + 90 days
 *   - snoozed flag whose condition still holds is NOT recreated until
 *     snooze_until passes
 */

export const FLAG_TYPES = [
  "likely_referrer",
  "dormancy_risk",
  "tier_upgrade_candidate",
  "tier_downgrade_candidate",
  "re_engagement_candidate",
  "vip_consideration",
];

/**
 * @typedef {object} AgentFacts
 * @property {number} agent_id
 * @property {string} tier
 * @property {string} status
 * @property {boolean} consent_to_email
 * @property {number|null} engagement_score
 * @property {number|null} engagement_score_14d_ago
 * @property {number|null} engagement_score_30d_ago
 * @property {string|null} tier_recommendation
 * @property {number} consistent_recommendation_days
 * @property {number} total_referrals
 * @property {number} converted_referrals
 * @property {number|null} days_since_last_referral
 * @property {number|null} avg_days_between_referrals
 * @property {number|null} days_since_last_interaction
 * @property {boolean} has_pending_automation
 * @property {number} total_revenue
 * @property {boolean} has_any_reply
 */

// ============================================================
// likely_referrer
// ============================================================
export function evalLikelyReferrer(a) {
  if (!["warm", "partner"].includes(a.tier)) return null;
  if ((a.total_referrals || 0) < 2) return null;
  if (!a.avg_days_between_referrals || !a.days_since_last_referral) return null;
  if ((a.engagement_score || 0) < 50) return null;

  const lower = a.avg_days_between_referrals * 0.7;
  const upper = a.avg_days_between_referrals * 1.3;
  if (a.days_since_last_referral < lower || a.days_since_last_referral > upper) return null;

  const confidence = a.total_referrals >= 4 ? "high" : "medium";
  return {
    severity: "action",
    confidence,
    reasoning: `Sent ${a.total_referrals} referrals lifetime, averaging every ${Math.round(a.avg_days_between_referrals)} days. Last referral was ${a.days_since_last_referral} days ago — pattern suggests they're due.`,
    data_points: {
      total_referrals: a.total_referrals,
      avg_days_between_referrals: Math.round(a.avg_days_between_referrals),
      days_since_last_referral: a.days_since_last_referral,
      engagement_score: a.engagement_score,
    },
  };
}

// ============================================================
// dormancy_risk
// ============================================================
export function evalDormancyRisk(a) {
  if (!["warm", "partner", "vip"].includes(a.tier)) return null;
  if (a.days_since_last_interaction == null) return null;
  if (a.days_since_last_interaction < 75 || a.days_since_last_interaction > 110) return null;
  if (a.has_pending_automation) return null;
  // Score must be declining 5+ points over 14 days.
  if (a.engagement_score == null || a.engagement_score_14d_ago == null) return null;
  const drop = a.engagement_score_14d_ago - a.engagement_score;
  if (drop < 5) return null;

  return {
    severity: "watch",
    confidence: "high",
    reasoning: `Score dropped from ${a.engagement_score_14d_ago} to ${a.engagement_score} over the past 2 weeks. Last interaction ${a.days_since_last_interaction} days ago. ${a.tier[0].toUpperCase() + a.tier.slice(1)} tier — worth a personal outreach before the formal dormant_re_engagement automation fires at 120 days.`,
    data_points: {
      score_now: a.engagement_score,
      score_14d_ago: a.engagement_score_14d_ago,
      score_drop: drop,
      days_since_last_interaction: a.days_since_last_interaction,
      tier: a.tier,
    },
  };
}

// ============================================================
// tier_upgrade_candidate
// ============================================================
export function evalTierUpgradeCandidate(a) {
  if (!["cold", "prospect", "warm"].includes(a.tier)) return null;
  if (!a.tier_recommendation) return null;
  // Recommendation must be HIGHER than current.
  const order = ["cold", "prospect", "warm", "partner", "vip"];
  const currentIdx = order.indexOf(a.tier);
  const recIdx = order.indexOf(a.tier_recommendation);
  if (recIdx <= currentIdx || recIdx === -1) return null;
  if ((a.consistent_recommendation_days || 0) < 14) return null;

  return {
    severity: "info",
    confidence: "medium",
    reasoning: `Engagement score consistently high for ${a.consistent_recommendation_days} days. Currently '${a.tier}' — recommendation suggests '${a.tier_recommendation}'. Consider upgrade.`,
    data_points: {
      current_tier: a.tier,
      recommended_tier: a.tier_recommendation,
      consistent_days: a.consistent_recommendation_days,
      engagement_score: a.engagement_score,
    },
  };
}

// ============================================================
// tier_downgrade_candidate
// ============================================================
export function evalTierDowngradeCandidate(a) {
  if (!["warm", "partner", "vip"].includes(a.tier)) return null;
  if (!["cold", "dormant"].includes(a.tier_recommendation)) return null;
  if ((a.consistent_recommendation_days || 0) < 30) return null;

  return {
    severity: "info",
    confidence: "medium",
    reasoning: `Recommendation has been '${a.tier_recommendation}' for ${a.consistent_recommendation_days} days while currently '${a.tier}'. Consider downgrade or targeted re-engagement.`,
    data_points: {
      current_tier: a.tier,
      recommended_tier: a.tier_recommendation,
      consistent_days: a.consistent_recommendation_days,
      engagement_score: a.engagement_score,
      days_since_last_interaction: a.days_since_last_interaction,
    },
  };
}

// ============================================================
// re_engagement_candidate
// ============================================================
export function evalReEngagementCandidate(a) {
  if (a.tier !== "dormant") return null;
  if (a.engagement_score == null || a.engagement_score_30d_ago == null) return null;
  const rise = a.engagement_score - a.engagement_score_30d_ago;
  if (rise < 10) return null;

  return {
    severity: "action",
    confidence: "medium",
    reasoning: `Marked dormant, but score rose from ${a.engagement_score_30d_ago} to ${a.engagement_score} this month. Something is happening — worth a personal call.`,
    data_points: {
      score_now: a.engagement_score,
      score_30d_ago: a.engagement_score_30d_ago,
      score_rise: rise,
    },
  };
}

// ============================================================
// vip_consideration
// ============================================================
export function evalVipConsideration(a) {
  if (a.tier !== "partner") return null;
  if ((a.converted_referrals || 0) < 5) return null;
  if ((a.total_revenue || 0) < 50000) return null;
  if (a.days_since_last_interaction == null || a.days_since_last_interaction > 60) return null;

  return {
    severity: "info",
    confidence: "high",
    reasoning: `$${(a.total_revenue || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} revenue generated from ${a.converted_referrals} converted referrals. Most active referrer in 'partner' tier. Consider VIP upgrade + appreciation gesture.`,
    data_points: {
      converted_referrals: a.converted_referrals,
      total_revenue: a.total_revenue,
      days_since_last_interaction: a.days_since_last_interaction,
    },
  };
}

// ============================================================
// Dispatch table
// ============================================================
export const FLAG_EVALUATORS = {
  likely_referrer: evalLikelyReferrer,
  dormancy_risk: evalDormancyRisk,
  tier_upgrade_candidate: evalTierUpgradeCandidate,
  tier_downgrade_candidate: evalTierDowngradeCandidate,
  re_engagement_candidate: evalReEngagementCandidate,
  vip_consideration: evalVipConsideration,
};
