/**
 * Phase 4: cohorts CRUD + comparison + agent membership listing.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { assertManagerRole } from "../lib/agentHub/permissions.js";
import { vIntId, vStringOpt, vStringReq } from "../lib/agentHub/validators.js";
import { buildCohortClause, computeCohortMetrics } from "../lib/agentHub/intelligence/cohorts.js";

function mapCohort(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    definition: r.definition || {},
    is_system: r.is_system === true,
    metrics: r.metrics || null,
    metrics_calculated_at: r.metrics_calculated_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listCohorts(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_cohorts ORDER BY is_system DESC, name ASC`
    );
    res.json({ cohorts: rows.map(mapCohort) });
  } catch (e) {
    console.error("[agent-hub] cohorts list", e);
    res.status(500).json({ error: "Could not load cohorts." });
  }
}

export async function getCohort(req, res) {
  try {
    const id = vIntId(req.params.id, "cohort id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM agent_hub_cohorts WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const cohort = rows[0];

    // List agents in cohort (limited to 200 for safety).
    const { whereClause, params } = buildCohortClause(cohort.definition, 0);
    const { rows: agents } = await pool.query(
      `SELECT a.id, a.full_name, a.tier, a.status, a.brokerage_name,
              a.last_interaction_date,
              ltv.total_referrals_received, ltv.total_revenue_generated
         FROM agent_hub_agents a
         LEFT JOIN agent_hub_agent_lifetime_value ltv ON ltv.agent_id = a.id
        WHERE ${whereClause}
        ORDER BY a.created_at DESC
        LIMIT 200`,
      params
    );
    res.json({ cohort: mapCohort(cohort), agents });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] cohort get", e);
    res.status(500).json({ error: "Could not load cohort." });
  }
}

export async function createCohort(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const name = vStringReq(req.body?.name, "name", { maxLen: 200 });
    const description = vStringOpt(req.body?.description, { maxLen: 2000 });
    const definition = req.body?.definition && typeof req.body.definition === "object"
      ? req.body.definition
      : {};
    const pool = getPool();
    // Validate the definition produces a parseable WHERE.
    const { whereClause } = buildCohortClause(definition, 0);
    if (!whereClause || whereClause === "FALSE") {
      res.status(400).json({ error: "Invalid cohort definition." });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_cohorts (name, description, definition, is_system, created_by)
       VALUES ($1, $2, $3::jsonb, FALSE, $4)
       RETURNING *`,
      [name, description, JSON.stringify(definition), req.user.id]
    );
    // Compute metrics immediately for the create response.
    try {
      const metrics = await computeCohortMetrics(definition);
      await pool.query(
        `UPDATE agent_hub_cohorts SET metrics = $1::jsonb, metrics_calculated_at = NOW() WHERE id = $2`,
        [JSON.stringify(metrics), rows[0].id]
      );
      rows[0].metrics = metrics;
    } catch {
      /* non-fatal */
    }
    await logAudit(req, {
      entity_type: "cohort",
      entity_id: rows[0].id,
      action: "create",
      new_value: { name, definition },
    });
    res.status(201).json({ cohort: mapCohort(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "A cohort with that name already exists." });
      return;
    }
    console.error("[agent-hub] cohort create", e);
    res.status(500).json({ error: "Could not create cohort." });
  }
}

export async function deleteCohort(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "cohort id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT is_system FROM agent_hub_cohorts WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (rows[0].is_system) {
      res.status(400).json({ error: "System cohorts cannot be deleted." });
      return;
    }
    await pool.query(`DELETE FROM agent_hub_cohorts WHERE id = $1`, [id]);
    await logAudit(req, { entity_type: "cohort", entity_id: id, action: "delete" });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] cohort delete", e);
    res.status(500).json({ error: "Could not delete." });
  }
}

export async function compareCohorts(req, res) {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length < 2 || ids.length > 4) {
      res.status(400).json({ error: "Supply 2-4 cohort ids: /compare?ids=1,2,3" });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_cohorts WHERE id = ANY($1::int[])`,
      [ids]
    );
    res.json({ cohorts: rows.map(mapCohort) });
  } catch (e) {
    console.error("[agent-hub] cohort compare", e);
    res.status(500).json({ error: "Could not compare." });
  }
}
