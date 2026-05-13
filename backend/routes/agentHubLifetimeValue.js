/**
 * Phase 2: lifetime value read + manual refresh.
 *
 * Reads always come from the materialized view — never compute on the fly.
 * View is refreshed nightly at 2am UTC by cron (see backend/index.js) plus
 * on-demand by referrals.advance-stage (active_management), payment
 * record/update/delete, and revenue add/update/delete.
 *
 * Manual refresh endpoint exists for the UI's "Refresh" button on the
 * agent detail page (manager+ only).
 */

import { getPool } from "../lib/db.js";
import { assertManagerRole, allowedAgentIdsFor } from "../lib/agentHub/permissions.js";
import { mapLifetimeValue } from "../lib/agentHub/mappers.js";
import { vIntId } from "../lib/agentHub/validators.js";
import { refreshAgentLifetimeValue } from "../lib/agentHubPhase2Schema.js";

export async function getAgentLifetimeValue(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const allowedAgentIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedAgentIds && !allowedAgentIds.includes(agentId)) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_agent_lifetime_value WHERE agent_id = $1`,
      [agentId]
    );
    if (!rows.length) {
      // No row in MV yet — likely a new agent before first refresh. Return zeros.
      res.json({
        ltv: {
          agent_id: agentId,
          total_referrals_received: 0,
          total_referrals_in_pipeline: 0,
          total_referrals_converted: 0,
          total_referrals_lost: 0,
          total_referrals_declined: 0,
          conversion_rate_pct: 0,
          total_referral_fees_paid: 0,
          total_revenue_generated: 0,
          lifetime_relationship_value: 0,
          first_referral_date: null,
          last_referral_date: null,
          avg_days_to_convert: null,
          last_calculated_at: null,
        },
      });
      return;
    }
    res.json({ ltv: mapLifetimeValue(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] LTV get", e);
    res.status(500).json({ error: "Could not load lifetime value." });
  }
}

export async function refreshLifetimeValue(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const refreshed_at = await refreshAgentLifetimeValue();
    res.json({ ok: true, refreshed_at });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] LTV refresh", e);
    res.status(500).json({ error: "Could not refresh lifetime value." });
  }
}

export async function leaderboard(req, res) {
  try {
    const sortBy = ["fees", "revenue", "referrals"].includes(req.query.sort_by)
      ? req.query.sort_by
      : "fees";
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const pool = getPool();
    const orderCol = sortBy === "revenue"
      ? "ltv.total_revenue_generated"
      : sortBy === "referrals"
        ? "ltv.total_referrals_received"
        : "ltv.total_referral_fees_paid";

    const { rows } = await pool.query(
      `SELECT a.id AS agent_id, a.full_name, a.brokerage_name, a.tier, a.photo_url,
              ltv.total_referrals_received,
              ltv.total_referrals_converted,
              ltv.conversion_rate_pct,
              ltv.total_referral_fees_paid,
              ltv.total_revenue_generated,
              ltv.lifetime_relationship_value
         FROM agent_hub_agent_lifetime_value ltv
         JOIN agent_hub_agents a ON a.id = ltv.agent_id
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
        ORDER BY ${orderCol} DESC NULLS LAST
        LIMIT $1`,
      [limit]
    );
    res.json({ leaderboard: rows, sort_by: sortBy });
  } catch (e) {
    console.error("[agent-hub] leaderboard", e);
    res.status(500).json({ error: "Could not load leaderboard." });
  }
}
