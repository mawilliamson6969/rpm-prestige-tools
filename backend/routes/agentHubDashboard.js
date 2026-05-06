/**
 * Phase 1 Agent Hub: dashboard cards.
 *
 * Endpoints (each cached at the route layer for 60s — but we don't have
 * a Redis dependency wired in for the Hub yet, so caching is in-process
 * via a simple Map. Match existing project pattern: lazy is fine for now.)
 */

import { getPool } from "../lib/db.js";
import { allowedAgentIdsFor, assertPermission } from "../lib/agentHub/permissions.js";

const CACHE_TTL_MS = 60 * 1000;
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

export function clearAgentHubDashboardCache() {
  cache.clear();
}

function allowedFilterClause(perms, paramOffset) {
  const allowed = allowedAgentIdsFor(perms);
  if (!allowed) return { clause: "", param: null };
  return {
    clause: ` AND a.id = ANY($${paramOffset}::int[])`,
    param: allowed,
  };
}

// GET /agent-hub/dashboard
export async function getAgentHubDashboard(req, res) {
  try {
    const cached = getCached(req, "summary");
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const allowed = allowedAgentIdsFor(req.agentHubPerms);
    const baseWhere = `a.status != 'deleted' AND a.merged_into_agent_id IS NULL` +
      (allowed ? ` AND a.id = ANY($1::int[])` : ``);
    const params = allowed ? [allowed] : [];

    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE a.tier = 'cold')::int AS cold,
         COUNT(*) FILTER (WHERE a.tier = 'prospect')::int AS prospect,
         COUNT(*) FILTER (WHERE a.tier = 'warm')::int AS warm,
         COUNT(*) FILTER (WHERE a.tier = 'partner')::int AS partner,
         COUNT(*) FILTER (WHERE a.tier = 'vip')::int AS vip,
         COUNT(*) FILTER (WHERE a.tier = 'dormant')::int AS dormant,
         COUNT(*) FILTER (WHERE a.do_not_contact = TRUE)::int AS dnc,
         COUNT(*) FILTER (WHERE a.tier IN ('warm','partner','vip')
                           AND (a.last_interaction_date IS NULL
                                OR a.last_interaction_date < NOW() - INTERVAL '90 days'))::int
           AS needs_attention
       FROM agent_hub_agents a
      WHERE ${baseWhere}`,
      params
    );

    const { rows: weekRows } = await pool.query(
      `SELECT COUNT(*)::int AS interactions_7d
         FROM agent_hub_activities act
         JOIN agent_hub_agents a ON a.id = act.agent_id
        WHERE act.deleted_at IS NULL
          AND act.occurred_at >= NOW() - INTERVAL '7 days'
          AND ${baseWhere}`,
      params
    );

    const data = {
      ...rows[0],
      interactions_7d: weekRows[0].interactions_7d,
    };
    setCached(req, "summary", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] dashboard summary", e);
    res.status(500).json({ error: "Could not load dashboard summary." });
  }
}

// GET /agent-hub/dashboard/recent-activity
export async function getAgentHubRecentActivity(req, res) {
  try {
    const cached = getCached(req, "recent");
    if (cached) {
      res.json(cached);
      return;
    }
    const pool = getPool();
    const allowed = allowedAgentIdsFor(req.agentHubPerms);
    const allowedClause = allowed ? `AND act.agent_id = ANY($1::int[])` : ``;
    const params = allowed ? [allowed] : [];
    const { rows } = await pool.query(
      `SELECT act.id, act.agent_id, act.type, act.direction,
              act.subject, act.summary, act.occurred_at,
              ag.full_name AS agent_name, ag.tier AS agent_tier,
              u.display_name AS logged_by_name
         FROM agent_hub_activities act
         JOIN agent_hub_agents ag ON ag.id = act.agent_id
         LEFT JOIN users u ON u.id = act.created_by
        WHERE act.deleted_at IS NULL
          AND ag.status != 'deleted'
          AND act.occurred_at >= NOW() - INTERVAL '7 days'
          ${allowedClause}
        ORDER BY act.occurred_at DESC
        LIMIT 20`,
      params
    );
    const data = { activities: rows };
    setCached(req, "recent", data);
    res.json(data);
  } catch (e) {
    console.error("[agent-hub] dashboard recent", e);
    res.status(500).json({ error: "Could not load recent activity." });
  }
}

// GET /agent-hub/dashboard/upcoming-touchpoints
// Birthdays/anniversaries in the next N days. Permission-gated: users without
// can_view_personal_details get a count only, no names or dates.
export async function getAgentHubUpcomingTouchpoints(req, res) {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const pool = getPool();
    const allowed = allowedAgentIdsFor(req.agentHubPerms);

    // We compute a "next occurrence" date for birthdays/anniversaries by
    // building a date in the current year (or next year if already past)
    // and checking it falls within the window.
    //
    // VIP isolation: managers (and below) cannot see VIP names + birthday data,
    // matching the rule in agentHubPersonalDetails.js (assertVipOwnerOnly).
    const isOwner = req.agentHubPerms?.role === "owner";
    const vipClause = isOwner ? `` : `AND a.tier != 'vip'`;
    const allowedClause = allowed ? `AND a.id = ANY($1::int[])` : ``;
    const params = allowed ? [allowed, days] : [days];
    const daysParam = allowed ? "$2" : "$1";

    const { rows } = await pool.query(
      `WITH base AS (
         SELECT a.id, a.full_name, a.tier, p.birthday_month, p.birthday_day,
                p.spouse_name, p.spouse_birthday_month, p.spouse_birthday_day,
                p.anniversary_date
           FROM agent_hub_agents a
           JOIN agent_hub_personal_details p ON p.agent_id = a.id
          WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
            ${vipClause}
            ${allowedClause}
       ),
       expanded AS (
         SELECT id, full_name, tier, 'birthday'::text AS kind,
                NULL::text AS related_name,
                make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, birthday_month, birthday_day) AS this_year_date
           FROM base WHERE birthday_month IS NOT NULL AND birthday_day IS NOT NULL
         UNION ALL
         SELECT id, full_name, tier, 'spouse_birthday', spouse_name,
                make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, spouse_birthday_month, spouse_birthday_day)
           FROM base WHERE spouse_birthday_month IS NOT NULL AND spouse_birthday_day IS NOT NULL
         UNION ALL
         SELECT id, full_name, tier, 'anniversary', NULL,
                make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                          EXTRACT(MONTH FROM anniversary_date)::int,
                          EXTRACT(DAY FROM anniversary_date)::int)
           FROM base WHERE anniversary_date IS NOT NULL
       ),
       upcoming AS (
         SELECT *,
                CASE WHEN this_year_date < CURRENT_DATE
                     THEN this_year_date + INTERVAL '1 year'
                     ELSE this_year_date END AS next_occurrence
           FROM expanded
       )
       SELECT * FROM upcoming
        WHERE next_occurrence::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (${daysParam}::int * INTERVAL '1 day'))
        ORDER BY next_occurrence::date ASC`,
      params
    );

    if (req.agentHubPerms.can_view_personal_details === true) {
      res.json({
        upcoming: rows.map((r) => ({
          id: r.id,
          full_name: r.full_name,
          tier: r.tier,
          kind: r.kind,
          related_name: r.related_name ?? null,
          date: r.next_occurrence,
          days_until: Math.round(
            (new Date(r.next_occurrence).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          ),
        })),
      });
    } else {
      // Counted only — no names, no dates.
      const counts = rows.reduce(
        (acc, r) => {
          acc[r.kind] = (acc[r.kind] || 0) + 1;
          return acc;
        },
        { total: rows.length }
      );
      res.json({ upcoming: null, counts });
    }
  } catch (e) {
    console.error("[agent-hub] dashboard upcoming", e);
    res.status(500).json({ error: "Could not load upcoming touchpoints." });
  }
}

// GET /agent-hub/dashboard/needs-attention
// warm/partner/vip with no contact in 90+ days.
export async function getAgentHubNeedsAttention(req, res) {
  try {
    const pool = getPool();
    const allowed = allowedAgentIdsFor(req.agentHubPerms);
    const allowedClause = allowed ? `AND a.id = ANY($1::int[])` : ``;
    const params = allowed ? [allowed] : [];
    const { rows } = await pool.query(
      `SELECT a.id, a.full_name, a.tier, a.brokerage_name,
              a.last_interaction_date,
              EXTRACT(DAY FROM (NOW() - COALESCE(a.last_interaction_date, a.created_at)))::int AS days_since
         FROM agent_hub_agents a
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          AND a.tier IN ('warm','partner','vip')
          AND (a.last_interaction_date IS NULL
               OR a.last_interaction_date < NOW() - INTERVAL '90 days')
          ${allowedClause}
        ORDER BY a.tier DESC,
                 a.last_interaction_date ASC NULLS FIRST
        LIMIT 100`,
      params
    );
    res.json({ agents: rows });
  } catch (e) {
    console.error("[agent-hub] dashboard needs-attention", e);
    res.status(500).json({ error: "Could not load needs-attention list." });
  }
}
