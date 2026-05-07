/**
 * Engagement scoring — the single source of truth.
 *
 * 5 components, each transparent and explainable. Total range 0-100.
 * Component thresholds are defined as constants below with rationale.
 *
 * NOT machine learning. NOT a black box. If you change a threshold,
 * change the comment too.
 */

// ============================================================
// COMPONENT 1: Recency (0-25)
// "When did we last interact with this agent?"
// ============================================================
// Rationale: recency is the single best predictor of future engagement
// in CRM systems. Heavily front-loaded — a chat last week is much
// more valuable than 3 chats last quarter.
const RECENCY_BANDS = [
  { maxDays: 7, score: 25 },
  { maxDays: 30, score: 23 },
  { maxDays: 60, score: 20 },
  { maxDays: 90, score: 15 },
  { maxDays: 180, score: 10 },
  { maxDays: 365, score: 5 },
  { maxDays: Infinity, score: 0 },
];

function scoreRecency(daysSinceLast) {
  if (daysSinceLast == null) return 0;
  for (const band of RECENCY_BANDS) {
    if (daysSinceLast <= band.maxDays) return band.score;
  }
  return 0;
}

// ============================================================
// COMPONENT 2: Frequency (0-20)
// "How often have we touched them in the last 90 days?"
// ============================================================
// Rationale: 4+ touches in a quarter signals an active relationship.
// 1 touch = lukewarm, 0 = cold.
const FREQUENCY_BANDS = [
  { maxCount: 0, score: 0 },
  { maxCount: 1, score: 5 },
  { maxCount: 3, score: 10 },
  { maxCount: 6, score: 15 },
  { maxCount: Infinity, score: 20 },
];

function scoreFrequency(count90d) {
  for (const band of FREQUENCY_BANDS) {
    if (count90d <= band.maxCount) return band.score;
  }
  return 0;
}

// ============================================================
// COMPONENT 3: Two-way engagement (0-15)
// "Have they actually replied? When?"
// ============================================================
// Rationale: a reply means we have a real two-way relationship,
// not a one-way email blast. Recent replies are stronger signal.
function scoreTwoWay(daysSinceLastReply) {
  if (daysSinceLastReply == null) return 0;
  if (daysSinceLastReply <= 30) return 15;
  if (daysSinceLastReply <= 90) return 12;
  if (daysSinceLastReply <= 180) return 8;
  return 5; // any reply ever, but old
}

// ============================================================
// COMPONENT 4: Referral activity (0-25)
// "Are they actually sending us business?"
// ============================================================
// The core revenue-driving signal. Lifetime count + recency bonus.
function scoreReferrals(totalReferrals, daysSinceLastReferral) {
  let base = 0;
  if (totalReferrals >= 7) base = 22;
  else if (totalReferrals >= 4) base = 19;
  else if (totalReferrals >= 2) base = 14;
  else if (totalReferrals >= 1) base = 8;

  let bonus = 0;
  if (daysSinceLastReferral != null) {
    if (daysSinceLastReferral <= 90) bonus = 3;
    else if (daysSinceLastReferral <= 180) bonus = 1;
  }
  return Math.min(base + bonus, 25);
}

// ============================================================
// COMPONENT 5: Financial impact (0-15)
// "How much money have they actually generated?"
// ============================================================
// Pulled from agent_hub_agent_lifetime_value (Phase 2 materialized view).
// NULL revenue treated as 0 — agents in pipeline aren't penalized for
// not yet having converted referrals.
function scoreFinancial(totalRevenue) {
  const r = totalRevenue || 0;
  if (r >= 50000) return 15;
  if (r >= 15000) return 12;
  if (r >= 5000) return 8;
  if (r > 0) return 4;
  return 0;
}

// ============================================================
// TIER RECOMMENDATION — derived from score + a few facts.
// ============================================================
// Rationale: VIP requires existing partner status (don't jump from cold
// to VIP). Dormant requires both low score AND established history
// (don't mark a brand-new low-engagement agent as dormant).
export function recommendTier({
  score,
  currentTier,
  convertedReferrals,
  consentToEmail,
  hasInbound,
  firstSeenDaysAgo,
  hasInteractions,
}) {
  if (score >= 90 && (currentTier === "partner" || currentTier === "vip")) {
    return "vip";
  }
  if (score >= 70 || (convertedReferrals >= 3 && consentToEmail)) {
    return "partner";
  }
  if (score >= 40) return "warm";
  if (score >= 20 && hasInbound) return "prospect";
  if (score < 20 && firstSeenDaysAgo != null && firstSeenDaysAgo > 180 && !hasInteractions) {
    return "dormant";
  }
  return "cold";
}

// ============================================================
// EXPLANATION — JSONB array of human-readable bullets.
// ============================================================
function pluralize(n, singular, plural) {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural || singular + "s"}`;
}

function describeRecency(days, score) {
  if (days == null) return `Never interacted (+0 recency)`;
  if (days === 0) return `Last interaction today (+${score} recency)`;
  return `Last interaction ${pluralize(days, "day")} ago (+${score} recency)`;
}

function describeFrequency(count, score) {
  return `${pluralize(count, "interaction")} in last 90 days (+${score} frequency)`;
}

function describeTwoWay(days, score) {
  if (days == null) return `No replies on record (+0 two-way)`;
  return `Last reply ${pluralize(days, "day")} ago (+${score} two-way engagement)`;
}

function describeReferrals(total, daysSinceLast, score) {
  if (total === 0) return `No referrals on record (+0 referrals)`;
  if (daysSinceLast == null) {
    return `${pluralize(total, "referral")} on record (+${score} referrals)`;
  }
  return `${pluralize(total, "referral")}, last ${pluralize(daysSinceLast, "day")} ago (+${score} referrals)`;
}

function describeFinancial(revenue, score) {
  if (revenue === 0 || revenue == null) return `No revenue generated yet (+0 financial)`;
  return `$${revenue.toLocaleString("en-US", { maximumFractionDigits: 0 })} revenue generated (+${score} financial impact)`;
}

// ============================================================
// PUBLIC: computeScore(input) → { score, components, explanation, tier_recommendation, tier_recommendation_changed }
// ============================================================

/**
 * @param {object} input - Agent's facts.
 * @param {number|null} input.daysSinceLastInteraction
 * @param {number} input.interactionCount90d
 * @param {number|null} input.daysSinceLastReply
 * @param {number} input.totalReferrals
 * @param {number|null} input.daysSinceLastReferral
 * @param {number} input.convertedReferrals
 * @param {number|null} input.totalRevenue
 * @param {string} input.currentTier
 * @param {boolean} input.consentToEmail
 * @param {boolean} input.hasInbound
 * @param {number|null} input.firstSeenDaysAgo
 */
export function computeScore(input) {
  const recency = scoreRecency(input.daysSinceLastInteraction);
  const frequency = scoreFrequency(input.interactionCount90d || 0);
  const twoWay = scoreTwoWay(input.daysSinceLastReply);
  const referrals = scoreReferrals(input.totalReferrals || 0, input.daysSinceLastReferral);
  const financial = scoreFinancial(input.totalRevenue);

  const total = Math.max(0, Math.min(100, recency + frequency + twoWay + referrals + financial));

  const recommendation = recommendTier({
    score: total,
    currentTier: input.currentTier,
    convertedReferrals: input.convertedReferrals || 0,
    consentToEmail: input.consentToEmail === true,
    hasInbound: input.hasInbound === true,
    firstSeenDaysAgo: input.firstSeenDaysAgo,
    hasInteractions: (input.interactionCount90d || 0) > 0 || (input.totalReferrals || 0) > 0,
  });

  const explanation = [
    describeRecency(input.daysSinceLastInteraction, recency),
    describeFrequency(input.interactionCount90d || 0, frequency),
    describeTwoWay(input.daysSinceLastReply, twoWay),
    describeReferrals(input.totalReferrals || 0, input.daysSinceLastReferral, referrals),
    describeFinancial(input.totalRevenue, financial),
  ];

  return {
    score: total,
    components: {
      recency,
      frequency,
      two_way: twoWay,
      referrals,
      financials: financial,
    },
    explanation,
    tier_recommendation: recommendation,
    tier_recommendation_changed: recommendation !== input.currentTier,
  };
}

/**
 * Constants exported for documentation + tests.
 */
export const SCORING_CONSTANTS = {
  RECENCY_BANDS,
  FREQUENCY_BANDS,
  // Bonus for referral recency (additive, capped at 25 by component max).
  REFERRAL_RECENCY_BONUS_90D: 3,
  REFERRAL_RECENCY_BONUS_180D: 1,
  // Financial bands.
  FINANCIAL_BANDS: [
    { min: 50000, score: 15 },
    { min: 15000, score: 12 },
    { min: 5000, score: 8 },
    { min: 0.01, score: 4 },
    { min: 0, score: 0 },
  ],
  // Component caps.
  MAX_RECENCY: 25,
  MAX_FREQUENCY: 20,
  MAX_TWO_WAY: 15,
  MAX_REFERRALS: 25,
  MAX_FINANCIALS: 15,
  TOTAL_MAX: 100,
};
