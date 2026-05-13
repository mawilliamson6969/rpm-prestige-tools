/**
 * Phase 1 Agent Hub: search.
 *
 * GET /agent-hub/search?q=...&limit=20
 *
 * Returns categorized results: agents, brokerages, activities.
 * Uses the tsvector indexes built by the migration plus trigram fuzzy
 * match on agent.full_name. Results are ranked by ts_rank.
 *
 * Activity bodies are searched with ranking, but we never include the
 * full body in the response — only a snippet around the match. (Privacy:
 * activity bodies may contain quoted client info.)
 */

import { getPool } from "../lib/db.js";
import { allowedAgentIdsFor } from "../lib/agentHub/permissions.js";
import { mapAgent, mapBrokerage } from "../lib/agentHub/mappers.js";

const SNIPPET_OPTIONS = "StartSel=<mark>,StopSel=</mark>,MaxFragments=2,FragmentDelimiter=… ,MaxWords=20,MinWords=8";

export async function searchAgentHub(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      res.json({ agents: [], brokerages: [], activities: [], query: q });
      return;
    }
    if (q.length < 2) {
      res.status(400).json({ error: "Search query must be at least 2 characters." });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const pool = getPool();
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);

    // Agents: ts rank + trigram similarity blended.
    const agentParams = [q, limit];
    let agentFilter = "";
    if (allowedIds) {
      agentParams.push(allowedIds);
      agentFilter = `AND a.id = ANY($${agentParams.length}::int[])`;
    }
    const { rows: agents } = await pool.query(
      `SELECT a.*,
              ts_rank(a.search_tsv, plainto_tsquery('simple', $1)) +
                similarity(a.full_name, $1) AS rank
         FROM agent_hub_agents a
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          AND (a.search_tsv @@ plainto_tsquery('simple', $1) OR a.full_name % $1)
          ${agentFilter}
        ORDER BY rank DESC, a.full_name ASC
        LIMIT $2`,
      agentParams
    );

    // Brokerages: ILIKE only (small table, simpler). Brokerage visibility is
    // not gated by allowedIds — brokerages aren't agent-scoped in Phase 1.
    const { rows: brokerages } = await pool.query(
      `SELECT b.* FROM agent_hub_brokerages b
        WHERE b.active = TRUE
          AND (b.name ILIKE $1 OR b.city ILIKE $1)
        ORDER BY LOWER(b.name) ASC
        LIMIT $2`,
      [`%${q}%`, limit]
    );

    // Activities: tsvector with snippet. Build params + placeholders carefully.
    const actParams = [q, limit, SNIPPET_OPTIONS];
    let actFilter = "";
    if (allowedIds) {
      actParams.push(allowedIds);
      actFilter = `AND act.agent_id = ANY($${actParams.length}::int[])`;
    }
    const { rows: activities } = await pool.query(
      `SELECT act.id, act.agent_id, act.type, act.subject, act.summary,
              act.occurred_at,
              ag.full_name AS agent_name,
              ts_headline('english',
                          COALESCE(act.subject || ' — ', '') || COALESCE(act.summary, '') ||
                          CASE WHEN act.body IS NOT NULL THEN ' — ' || LEFT(act.body, 2000) ELSE '' END,
                          plainto_tsquery('english', $1),
                          $3) AS snippet,
              ts_rank(act.search_tsv, plainto_tsquery('english', $1)) AS rank
         FROM agent_hub_activities act
         JOIN agent_hub_agents ag ON ag.id = act.agent_id
        WHERE act.deleted_at IS NULL
          AND ag.status != 'deleted'
          AND act.search_tsv @@ plainto_tsquery('english', $1)
          ${actFilter}
        ORDER BY rank DESC, act.occurred_at DESC
        LIMIT $2`,
      actParams
    );

    res.json({
      query: q,
      agents: agents.map((r) => ({ ...mapAgent(r), rank: Number(r.rank) })),
      brokerages: brokerages.map(mapBrokerage),
      activities: activities.map((r) => ({
        id: r.id,
        agent_id: r.agent_id,
        agent_name: r.agent_name,
        type: r.type,
        subject: r.subject,
        summary: r.summary,
        occurred_at: r.occurred_at,
        snippet: r.snippet,
        rank: Number(r.rank),
      })),
    });
  } catch (e) {
    console.error("[agent-hub] search", e);
    res.status(500).json({ error: "Search failed." });
  }
}
