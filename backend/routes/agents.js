import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../lib/db.js";
import { CHI_TODAY } from "../lib/agents-schema.js";

const MODEL = "claude-sonnet-4-20250514";

const STATUS = new Set(["active", "paused", "testing", "inactive"]);
const CATEGORIES = new Set([
  "leasing",
  "maintenance",
  "accounting",
  "client-success",
  "communications",
  "reporting",
  "general",
  "other",
]);

function badRequest(res, msg) {
  res.status(400).json({ error: msg });
}

function normalizeGuardrails(raw) {
  const g = raw && typeof raw === "object" ? raw : {};
  const arr = (x) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
  return {
    never: arr(g.never),
    always: arr(g.always),
    escalate: arr(g.escalate),
  };
}

function guardrailsPromptBlock(g) {
  const lines = [];
  if (g.never?.length) lines.push("NEVER:", ...g.never.map((x) => `- ${x}`));
  if (g.always?.length) lines.push("ALWAYS:", ...g.always.map((x) => `- ${x}`));
  if (g.escalate?.length) lines.push("ESCALATE FOR HUMAN REVIEW WHEN:", ...g.escalate.map((x) => `- ${x}`));
  if (!lines.length) return "";
  return "\n\n## Guardrails\n" + lines.join("\n");
}

function trainingPromptBlock(rows) {
  if (!rows?.length) return "";
  const parts = ["\n\n## Training examples (follow these patterns)"];
  for (const r of rows) {
    const tag = r.example_type === "bad" ? "BAD example (avoid)" : "GOOD example";
    parts.push(`\n### ${tag}`);
    parts.push(`Input:\n${r.input_context}`);
    parts.push(`Agent response:\n${r.agent_response}`);
    if (r.human_corrected_response) {
      parts.push(`Preferred / corrected response:\n${r.human_corrected_response}`);
    }
    if (r.correction_notes) parts.push(`Notes: ${r.correction_notes}`);
  }
  return parts.join("\n");
}

export function composeFullSystemPrompt(agent, trainingRows) {
  const base = (agent.system_prompt || "").trim();
  const g = normalizeGuardrails(agent.guardrails);
  const gb = guardrailsPromptBlock(g);
  const tb = trainingPromptBlock(trainingRows || []);
  return `${base}${gb}${tb}`.trim();
}

async function resolveAgent(pool, idParam) {
  const raw = String(idParam ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const { rows } = await pool.query(`SELECT * FROM agents WHERE id = $1`, [Number(raw)]);
    return rows[0] || null;
  }
  const { rows } = await pool.query(`SELECT * FROM agents WHERE lower(slug) = lower($1)`, [raw]);
  return rows[0] || null;
}

/** Increment metric columns for today (America/Chicago). */
async function bumpMetric(pool, agentId, partial) {
  const { rows } = await pool.query(`SELECT ${CHI_TODAY} AS d`);
  const metricDate = rows[0].d;
  const keys = Object.keys(partial).filter((k) => typeof partial[k] === "number" && partial[k] > 0);
  if (!keys.length) return;
  const cols = ["agent_id", "metric_date", ...keys];
  const vals = [agentId, metricDate, ...keys.map((k) => partial[k])];
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const updates = keys.map((k) => `${k} = COALESCE(agent_metrics.${k},0) + EXCLUDED.${k}`).join(", ");
  await pool.query(
    `INSERT INTO agent_metrics (${cols.join(", ")}) VALUES (${ph})
     ON CONFLICT (agent_id, metric_date) DO UPDATE SET ${updates}`,
    vals
  );
}

function mapAgentRow(r, extra = {}) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    category: r.category,
    status: r.status,
    ownerUserId: r.owner_user_id,
    ownerDisplayName: r.owner_display_name != null ? r.owner_display_name : null,
    triggerType: r.trigger_type,
    triggerConfig: r.trigger_config,
    systemPrompt: r.system_prompt,
    systemPromptVersion: r.system_prompt_version,
    actionsConfig: r.actions_config,
    guardrails: r.guardrails,
    confidenceThreshold: r.confidence_threshold,
    dailyActionLimit: r.daily_action_limit,
    dataSources: r.data_sources,
    icon: r.icon,
    color: r.color,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    totalActionsTaken: r.total_actions_taken,
    totalActionsAuto: r.total_actions_auto,
    totalActionsQueued: r.total_actions_queued,
    totalHumanOverrides: r.total_human_overrides,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...extra,
  };
}

export async function getAgentsSummary(req, res) {
  try {
    const pool = getPool();
    const { rows: stats } = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'testing')::int AS testing,
        COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
        COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive
      FROM agents
    `);
    const { rows: qrow } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM agent_queued_actions WHERE status = 'pending'`
    );
    const { rows: todayActions } = await pool.query(
      `SELECT COALESCE(SUM(actions_taken),0)::int AS c
       FROM agent_metrics WHERE metric_date = (${CHI_TODAY})`
    );
    const { rows: rateRow } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE result = 'success')::int AS ok,
        COUNT(*) FILTER (WHERE result IN ('success','failed','human_override'))::int AS denom
      FROM agent_activity_log
      WHERE (created_at AT TIME ZONE 'America/Chicago')::date =
            (NOW() AT TIME ZONE 'America/Chicago')::date
    `);
    const ok = rateRow[0]?.ok ?? 0;
    const denom = rateRow[0]?.denom ?? 0;
    const successRatePercent = denom > 0 ? Math.round((ok / denom) * 1000) / 10 : null;
    res.json({
      totalAgents: stats[0].total,
      active: stats[0].active,
      testing: stats[0].testing,
      paused: stats[0].paused,
      inactive: stats[0].inactive,
      actionsToday: todayActions[0].c,
      queuedForReview: qrow[0].c,
      successRatePercent,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load summary." });
  }
}

export async function getAgentsList(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT a.*,
        ou.display_name AS owner_display_name,
        (SELECT COUNT(*)::int FROM agent_queued_actions q
         WHERE q.agent_id = a.id AND q.status = 'pending') AS pending_queue,
        (SELECT COALESCE(m.actions_taken,0) FROM agent_metrics m
         WHERE m.agent_id = a.id AND m.metric_date = (${CHI_TODAY})
         LIMIT 1) AS actions_today,
        (SELECT m.avg_confidence_score FROM agent_metrics m
         WHERE m.agent_id = a.id AND m.metric_date = (${CHI_TODAY})
         LIMIT 1) AS avg_confidence_today
      FROM agents a
      LEFT JOIN users ou ON ou.id = a.owner_user_id
      ORDER BY lower(a.name)
    `);
    const mapped = rows.map((r) => {
      const denom = r.total_actions_taken > 0 ? r.total_actions_taken : 0;
      const successPct =
        denom > 0 ? Math.round(((r.total_actions_auto || 0) / denom) * 1000) / 10 : null;
      return mapAgentRow(r, {
        pendingQueue: r.pending_queue ?? 0,
        actionsToday: r.actions_today ?? 0,
        successApproxPercent: successPct,
        avgConfidenceToday: r.avg_confidence_today != null ? Number(r.avg_confidence_today) : null,
      });
    });
    res.json({ agents: mapped });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not list agents." });
  }
}

export async function getAgentDetail(req, res) {
  try {
    const pool = getPool();
    const raw = String(req.params.id ?? "").trim();
    let agentRow = null;
    if (/^\d+$/.test(raw)) {
      const { rows } = await pool.query(
        `SELECT a.*, ou.display_name AS owner_display_name
         FROM agents a
         LEFT JOIN users ou ON ou.id = a.owner_user_id
         WHERE a.id = $1`,
        [Number(raw)]
      );
      agentRow = rows[0] || null;
    } else {
      const { rows } = await pool.query(
        `SELECT a.*, ou.display_name AS owner_display_name
         FROM agents a
         LEFT JOIN users ou ON ou.id = a.owner_user_id
         WHERE lower(a.slug) = lower($1)`,
        [raw]
      );
      agentRow = rows[0] || null;
    }
    if (!agentRow) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const { rows: recent } = await pool.query(
      `SELECT * FROM agent_activity_log WHERE agent_id = $1
       ORDER BY created_at DESC LIMIT 25`,
      [agentRow.id]
    );
    res.json({
      agent: mapAgentRow(agentRow, {
        ownerDisplayName: agentRow.owner_display_name,
      }),
      recentActivity: recent.map(mapActivityRow),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load agent." });
  }
}

function mapActivityRow(r) {
  return {
    id: r.id,
    agentId: r.agent_id,
    triggerEvent: r.trigger_event,
    triggerData: r.trigger_data,
    decision: r.decision,
    actionTaken: r.action_taken,
    actionData: r.action_data,
    confidenceScore: r.confidence_score,
    contextUsed: r.context_used,
    result: r.result,
    resultDetails: r.result_details,
    humanFeedback: r.human_feedback,
    humanFeedbackNotes: r.human_feedback_notes,
    feedbackBy: r.feedback_by,
    feedbackAt: r.feedback_at,
    executionTimeMs: r.execution_time_ms,
    createdAt: r.created_at,
  };
}

export async function postAgent(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  try {
    const pool = getPool();
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    let slug = typeof req.body?.slug === "string" ? req.body.slug.trim().toLowerCase() : "";
    if (!name) {
      badRequest(res, "name is required.");
      return;
    }
    if (!slug) {
      slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 100);
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      badRequest(res, "slug must contain only lowercase letters, numbers, and hyphens.");
      return;
    }
    const description = typeof req.body?.description === "string" ? req.body.description : "";
    const category =
      typeof req.body?.category === "string" && CATEGORIES.has(req.body.category)
        ? req.body.category
        : "general";
    const trigger_type = ["schedule", "event", "manual"].includes(req.body?.triggerType)
      ? req.body.triggerType
      : "schedule";
    const trigger_config =
      req.body?.triggerConfig && typeof req.body.triggerConfig === "object"
        ? req.body.triggerConfig
        : {};
    const system_prompt = typeof req.body?.systemPrompt === "string" ? req.body.systemPrompt : "";
    const guardrails = normalizeGuardrails(req.body?.guardrails);
    const confidence_threshold =
      typeof req.body?.confidenceThreshold === "number"
        ? Math.min(100, Math.max(0, Math.round(req.body.confidenceThreshold)))
        : 85;
    const daily_action_limit =
      typeof req.body?.dailyActionLimit === "number"
        ? Math.max(0, Math.round(req.body.dailyActionLimit))
        : 50;
    const data_sources = Array.isArray(req.body?.dataSources)
      ? req.body.dataSources.map((s) => String(s).toLowerCase())
      : [];
    const icon = typeof req.body?.icon === "string" ? req.body.icon.slice(0, 10) : "🤖";
    const color = typeof req.body?.color === "string" ? req.body.color.slice(0, 7) : "#0098D0";
    const owner_user_id =
      typeof req.body?.ownerUserId === "number" && req.body.ownerUserId > 0
        ? req.body.ownerUserId
        : null;

    const { rows } = await pool.query(
      `INSERT INTO agents (
        name, slug, description, category, status, owner_user_id, trigger_type, trigger_config,
        system_prompt, guardrails, confidence_threshold, daily_action_limit, data_sources,
        icon, color, created_by
      ) VALUES ($1,$2,$3,$4,'inactive',$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        name,
        slug,
        description,
        category,
        owner_user_id,
        trigger_type,
        JSON.stringify(trigger_config),
        system_prompt,
        JSON.stringify(guardrails),
        confidence_threshold,
        daily_action_limit,
        data_sources,
        icon,
        color,
        req.user.id,
      ]
    );
    res.status(201).json({ agent: mapAgentRow(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      res.status(409).json({ error: "An agent with this slug already exists." });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not create agent." });
  }
}

export async function putAgent(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const fields = [];
    const vals = [];
    let n = 1;
    const set = (col, val) => {
      fields.push(`${col} = $${n}`);
      vals.push(val);
      n++;
    };
    if (typeof req.body?.name === "string") set("name", req.body.name.trim());
    if (typeof req.body?.description === "string") set("description", req.body.description);
    if (typeof req.body?.category === "string" && CATEGORIES.has(req.body.category))
      set("category", req.body.category);
    if (typeof req.body?.icon === "string") set("icon", req.body.icon.slice(0, 10));
    if (typeof req.body?.color === "string") set("color", req.body.color.slice(0, 7));
    if (["schedule", "event", "manual"].includes(req.body?.triggerType)) set("trigger_type", req.body.triggerType);
    if (req.body?.triggerConfig && typeof req.body.triggerConfig === "object")
      set("trigger_config", JSON.stringify(req.body.triggerConfig));
    if (req.body?.guardrails) set("guardrails", JSON.stringify(normalizeGuardrails(req.body.guardrails)));
    if (typeof req.body?.confidenceThreshold === "number")
      set(
        "confidence_threshold",
        Math.min(100, Math.max(0, Math.round(req.body.confidenceThreshold)))
      );
    if (typeof req.body?.dailyActionLimit === "number")
      set("daily_action_limit", Math.max(0, Math.round(req.body.dailyActionLimit)));
    if (Array.isArray(req.body?.dataSources)) set("data_sources", req.body.dataSources.map((s) => String(s)));
    if (req.body?.ownerUserId === null) set("owner_user_id", null);
    else if (typeof req.body?.ownerUserId === "number") set("owner_user_id", req.body.ownerUserId);
    if (req.body?.actionsConfig != null && typeof req.body.actionsConfig === "object")
      set("actions_config", JSON.stringify(req.body.actionsConfig));

    if (!fields.length) {
      badRequest(res, "No valid fields to update.");
      return;
    }
    fields.push(`updated_at = NOW()`);
    vals.push(agent.id);
    const { rows } = await pool.query(
      `UPDATE agents SET ${fields.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    res.json({ agent: mapAgentRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update agent." });
  }
}

export async function deleteAgent(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const confirm = req.query?.confirm === "true" || req.body?.confirm === true;
  if (!confirm) {
    badRequest(res, "confirmation required: pass confirm=true query or body.confirm true.");
    return;
  }
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    await pool.query(`DELETE FROM agents WHERE id = $1`, [agent.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete agent." });
  }
}

export async function putAgentStatus(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const status = typeof req.body?.status === "string" ? req.body.status : "";
  if (!STATUS.has(status)) {
    badRequest(res, "status must be active, paused, testing, or inactive.");
    return;
  }
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, agent.id]
    );
    res.json({ agent: mapAgentRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update status." });
  }
}

export async function postAgentRun(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const started = Date.now();
    await pool.query(
      `INSERT INTO agent_activity_log (
        agent_id, trigger_event, trigger_data, decision, action_taken, confidence_score, context_used, result, result_details, execution_time_ms
      ) VALUES ($1, 'manual_test', $2::jsonb, 'no_op', 'none', NULL, NULL, 'success', $3, $4)`,
      [
        agent.id,
        JSON.stringify({ byUserId: req.user.id }),
        "Manual test run — no execution engine configured.",
        Date.now() - started,
      ]
    );
    await pool.query(`UPDATE agents SET last_run_at = NOW(), updated_at = NOW() WHERE id = $1`, [agent.id]);
    await bumpMetric(pool, agent.id, { actions_taken: 1 });
    res.json({ ok: true, message: "Run logged (no automated actions executed)." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not trigger run." });
  }
}

export async function postPauseAllAgents(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE agents SET status = 'paused', updated_at = NOW() WHERE status = 'active'`
    );
    res.json({ ok: true, pausedCount: rowCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not pause agents." });
  }
}

export async function getAgentPrompts(req, res) {
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const { rows } = await pool.query(
      `SELECT v.*, u.display_name AS changed_by_name
       FROM agent_prompt_versions v
       LEFT JOIN users u ON u.id = v.changed_by
       WHERE v.agent_id = $1
       ORDER BY v.version_number DESC`,
      [agent.id]
    );
    res.json({
      currentVersion: agent.system_prompt_version,
      currentPrompt: agent.system_prompt,
      versions: rows.map((r) => ({
        id: r.id,
        versionNumber: r.version_number,
        systemPrompt: r.system_prompt,
        changeNotes: r.change_notes,
        changedByName: r.changed_by_name,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load prompts." });
  }
}

export async function putAgentPrompt(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const notes = typeof req.body?.changeNotes === "string" ? req.body.changeNotes.trim() : "";
  const nextPrompt = typeof req.body?.systemPrompt === "string" ? req.body.systemPrompt : "";
  if (!notes) {
    badRequest(res, "changeNotes is required when saving the prompt.");
    return;
  }
  try {
    const pool = getPool();
    const agentPre = await resolveAgent(pool, req.params.id);
    if (!agentPre) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: lockRows } = await client.query(`SELECT * FROM agents WHERE id = $1 FOR UPDATE`, [
        agentPre.id,
      ]);
      const agent = lockRows[0];
      await client.query(
        `INSERT INTO agent_prompt_versions (agent_id, version_number, system_prompt, change_notes, changed_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent_id, version_number) DO NOTHING`,
        [agent.id, agent.system_prompt_version, agent.system_prompt || "", notes, req.user.id]
      );
      const { rows } = await client.query(
        `UPDATE agents SET
          system_prompt = $1,
          system_prompt_version = system_prompt_version + 1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
        [nextPrompt, agent.id]
      );
      await client.query("COMMIT");
      res.json({ agent: mapAgentRow(rows[0]) });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update prompt." });
  }
}

export async function getAgentPromptVersion(req, res) {
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const ver = Number(req.params.version);
    if (!Number.isFinite(ver)) {
      badRequest(res, "Invalid version.");
      return;
    }
    const { rows } = await pool.query(
      `SELECT v.*, u.display_name AS changed_by_name
       FROM agent_prompt_versions v
       LEFT JOIN users u ON u.id = v.changed_by
       WHERE v.agent_id = $1 AND v.version_number = $2`,
      [agent.id, ver]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Version not found." });
      return;
    }
    const r = rows[0];
    res.json({
      versionNumber: r.version_number,
      systemPrompt: r.system_prompt,
      changeNotes: r.change_notes,
      changedByName: r.changed_by_name,
      createdAt: r.created_at,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load version." });
  }
}

export async function postRestoreAgentPrompt(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  try {
    const pool = getPool();
    const agentPre = await resolveAgent(pool, req.params.id);
    if (!agentPre) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const agent = agentPre;
      const ver = Number(req.params.version);
      const { rows: verRows } = await client.query(
        `SELECT * FROM agent_prompt_versions WHERE agent_id = $1 AND version_number = $2`,
        [agent.id, ver]
      );
      if (!verRows.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Version not found." });
        return;
      }
      const historical = verRows[0].system_prompt;
      await client.query(
        `INSERT INTO agent_prompt_versions (agent_id, version_number, system_prompt, change_notes, changed_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent_id, version_number) DO NOTHING`,
        [
          agent.id,
          agent.system_prompt_version,
          agent.system_prompt || "",
          `Archive before restore from v${ver}`,
          req.user.id,
        ]
      );
      const { rows } = await client.query(
        `UPDATE agents SET
          system_prompt = $1,
          system_prompt_version = system_prompt_version + 1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
        [historical, agent.id]
      );
      await client.query("COMMIT");
      res.json({ agent: mapAgentRow(rows[0]) });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not restore prompt." });
  }
}

export async function getAgentActivity(req, res) {
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const result = typeof req.query.result === "string" ? req.query.result.trim() : "";
    const humanFeedback =
      typeof req.query.humanFeedback === "string" ? req.query.humanFeedback.trim() : "";
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : "";
    const minConf = req.query.minConfidence != null ? Number(req.query.minConfidence) : null;
    const maxConf = req.query.maxConfidence != null ? Number(req.query.maxConfidence) : null;

    const where = [`agent_id = $1`];
    const params = [agent.id];
    let p = 2;
    if (result) {
      where.push(`result = $${p}`);
      params.push(result);
      p++;
    }
    if (humanFeedback) {
      where.push(`human_feedback = $${p}`);
      params.push(humanFeedback);
      p++;
    }
    if (startDate) {
      where.push(`created_at >= $${p}::date`);
      params.push(startDate);
      p++;
    }
    if (endDate) {
      where.push(`created_at < ($${p}::date + INTERVAL '1 day')`);
      params.push(endDate);
      p++;
    }
    if (Number.isFinite(minConf)) {
      where.push(`confidence_score >= $${p}`);
      params.push(minConf);
      p++;
    }
    if (Number.isFinite(maxConf)) {
      where.push(`confidence_score <= $${p}`);
      params.push(maxConf);
      p++;
    }

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM agent_activity_log WHERE ${where.join(" AND ")}`,
      params
    );
    const { rows } = await pool.query(
      `SELECT * FROM agent_activity_log WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    );
    res.json({
      total: countRows[0].c,
      limit,
      offset,
      items: rows.map(mapActivityRow),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load activity." });
  }
}

export async function putActivityFeedback(req, res) {
  const feedback = typeof req.body?.feedback === "string" ? req.body.feedback : "";
  if (!["good", "needs_improvement"].includes(feedback)) {
    badRequest(res, 'feedback must be "good" or "needs_improvement".');
    return;
  }
  const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
  try {
    const pool = getPool();
    const id = Number(req.params.activityId);
    const { rows } = await pool.query(
      `UPDATE agent_activity_log SET
        human_feedback = $1,
        human_feedback_notes = $2,
        feedback_by = $3,
        feedback_at = NOW()
      WHERE id = $4
      RETURNING *`,
      [feedback, notes, req.user.id, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Activity not found." });
      return;
    }
    res.json({ activity: mapActivityRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save feedback." });
  }
}

export async function getAgentTraining(req, res) {
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const { rows } = await pool.query(
      `SELECT t.*, u.display_name AS added_by_name
       FROM agent_training_examples t
       LEFT JOIN users u ON u.id = t.added_by
       WHERE t.agent_id = $1 AND t.is_active = true
       ORDER BY t.created_at DESC`,
      [agent.id]
    );
    res.json({
      examples: rows.map((r) => ({
        id: r.id,
        exampleType: r.example_type,
        inputContext: r.input_context,
        agentResponse: r.agent_response,
        humanCorrectedResponse: r.human_corrected_response,
        correctionNotes: r.correction_notes,
        addedByName: r.added_by_name,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load training examples." });
  }
}

export async function postAgentTraining(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const exampleType = req.body?.exampleType === "bad" ? "bad" : "good";
  const input_context = typeof req.body?.inputContext === "string" ? req.body.inputContext.trim() : "";
  const agent_response = typeof req.body?.agentResponse === "string" ? req.body.agentResponse.trim() : "";
  if (!input_context || !agent_response) {
    badRequest(res, "inputContext and agentResponse are required.");
    return;
  }
  const human_corrected_response =
    typeof req.body?.humanCorrectedResponse === "string" ? req.body.humanCorrectedResponse : null;
  const correction_notes = typeof req.body?.correctionNotes === "string" ? req.body.correctionNotes : null;
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO agent_training_examples (
        agent_id, example_type, input_context, agent_response, human_corrected_response, correction_notes, added_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        agent.id,
        exampleType,
        input_context,
        agent_response,
        human_corrected_response,
        correction_notes,
        req.user.id,
      ]
    );
    const r = rows[0];
    res.status(201).json({
      example: {
        id: r.id,
        exampleType: r.example_type,
        inputContext: r.input_context,
        agentResponse: r.agent_response,
        humanCorrectedResponse: r.human_corrected_response,
        correctionNotes: r.correction_notes,
        createdAt: r.created_at,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add example." });
  }
}

export async function deleteAgentTraining(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const exId = Number(req.params.exampleId);
    const { rowCount } = await pool.query(
      `DELETE FROM agent_training_examples WHERE id = $1 AND agent_id = $2`,
      [exId, agent.id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Example not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete example." });
  }
}

export async function getAgentQueue(req, res) {
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const { rows } = await pool.query(
      `SELECT * FROM agent_queued_actions WHERE agent_id = $1 AND status = 'pending' ORDER BY created_at ASC`,
      [agent.id]
    );
    res.json({ items: rows.map(mapQueueRow) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load queue." });
  }
}

function mapQueueRow(r) {
  return {
    id: r.id,
    agentId: r.agent_id,
    actionType: r.action_type,
    actionData: r.action_data,
    context: r.context,
    aiDraft: r.ai_draft,
    confidenceScore: r.confidence_score,
    status: r.status,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    reviewNotes: r.review_notes,
    createdAt: r.created_at,
  };
}

export async function getAllQueues(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT q.*, a.name AS agent_name, a.slug AS agent_slug, a.icon AS agent_icon, a.color AS agent_color
      FROM agent_queued_actions q
      JOIN agents a ON a.id = q.agent_id
      WHERE q.status = 'pending'
      ORDER BY q.created_at ASC
    `);
    res.json({
      items: rows.map((r) => ({
        ...mapQueueRow(r),
        agentName: r.agent_name,
        agentSlug: r.agent_slug,
        agentIcon: r.agent_icon,
        agentColor: r.agent_color,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load queues." });
  }
}

async function finalizeQueueItem(pool, queueId, agentId, reviewerId, status, reviewNotes, editedDraft) {
  const { rows } = await pool.query(
    `UPDATE agent_queued_actions SET
      status = $1,
      reviewed_by = $2,
      reviewed_at = NOW(),
      review_notes = $3,
      ai_draft = COALESCE($4, ai_draft)
    WHERE id = $5 AND agent_id = $6 AND status = 'pending'
    RETURNING *`,
    [status, reviewerId, reviewNotes ?? null, editedDraft ?? null, queueId, agentId]
  );
  return rows[0];
}

async function logQueueOutcome(pool, agent, queueRow, result, details, confidence, execMs) {
  await pool.query(
    `INSERT INTO agent_activity_log (
      agent_id, trigger_event, trigger_data, decision, action_taken, action_data, confidence_score, context_used, result, result_details, execution_time_ms
    ) VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11)`,
    [
      agent.id,
      "queued_action_review",
      JSON.stringify({ queueId: queueRow.id, actionType: queueRow.action_type }),
      "human_review",
      queueRow.action_type,
      queueRow.action_data,
      confidence,
      queueRow.context,
      result,
      details,
      execMs,
    ]
  );
}

export async function putQueueApprove(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  try {
    const pool = getPool();
    const queueId = Number(req.params.queueId);
    const { rows: qrows } = await pool.query(`SELECT * FROM agent_queued_actions WHERE id = $1`, [queueId]);
    const qrow = qrows[0];
    if (!qrow || qrow.status !== "pending") {
      res.status(404).json({ error: "Queue item not found or already processed." });
      return;
    }
    const agent = await resolveAgent(pool, String(qrow.agent_id));
    const started = Date.now();
    const updated = await finalizeQueueItem(pool, queueId, agent.id, req.user.id, "approved", null, null);
    if (!updated) {
      res.status(404).json({ error: "Queue item not found." });
      return;
    }
    await logQueueOutcome(
      pool,
      agent,
      qrow,
      "success",
      "Approved for send (simulated — no outbound integration).",
      qrow.confidence_score,
      Date.now() - started
    );
    await pool.query(
      `UPDATE agents SET
        total_actions_taken = total_actions_taken + 1,
        total_actions_auto = total_actions_auto + 1,
        updated_at = NOW()
      WHERE id = $1`,
      [agent.id]
    );
    await bumpMetric(pool, agent.id, { actions_taken: 1, actions_auto_sent: 1, human_approvals: 1 });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not approve." });
  }
}

export async function putQueueReject(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
  try {
    const pool = getPool();
    const queueId = Number(req.params.queueId);
    const { rows: qrows } = await pool.query(`SELECT * FROM agent_queued_actions WHERE id = $1`, [queueId]);
    const qrow = qrows[0];
    if (!qrow || qrow.status !== "pending") {
      res.status(404).json({ error: "Queue item not found or already processed." });
      return;
    }
    const agent = await resolveAgent(pool, String(qrow.agent_id));
    const started = Date.now();
    const updated = await finalizeQueueItem(pool, queueId, agent.id, req.user.id, "rejected", notes, null);
    if (!updated) {
      res.status(404).json({ error: "Queue item not found." });
      return;
    }
    await logQueueOutcome(
      pool,
      agent,
      qrow,
      "failed",
      notes || "Rejected by reviewer.",
      qrow.confidence_score,
      Date.now() - started
    );
    await pool.query(
      `UPDATE agents SET total_actions_taken = total_actions_taken + 1, updated_at = NOW() WHERE id = $1`,
      [agent.id]
    );
    await bumpMetric(pool, agent.id, { actions_taken: 1 });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not reject." });
  }
}

export async function putQueueEdit(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const editedDraft = typeof req.body?.editedDraft === "string" ? req.body.editedDraft : "";
  if (!editedDraft.trim()) {
    badRequest(res, "editedDraft is required.");
    return;
  }
  try {
    const pool = getPool();
    const queueId = Number(req.params.queueId);
    const { rows: qrows } = await pool.query(`SELECT * FROM agent_queued_actions WHERE id = $1`, [queueId]);
    const qrow = qrows[0];
    if (!qrow || qrow.status !== "pending") {
      res.status(404).json({ error: "Queue item not found or already processed." });
      return;
    }
    const agent = await resolveAgent(pool, String(qrow.agent_id));
    const started = Date.now();
    const updated = await finalizeQueueItem(
      pool,
      queueId,
      agent.id,
      req.user.id,
      "edited_approved",
      "Edited then approved",
      editedDraft
    );
    if (!updated) {
      res.status(404).json({ error: "Queue item not found." });
      return;
    }
    await logQueueOutcome(
      pool,
      agent,
      { ...qrow, ai_draft: editedDraft },
      "success",
      "Edited and approved (simulated send).",
      qrow.confidence_score,
      Date.now() - started
    );
    await pool.query(
      `UPDATE agents SET
        total_actions_taken = total_actions_taken + 1,
        total_actions_auto = total_actions_auto + 1,
        updated_at = NOW()
      WHERE id = $1`,
      [agent.id]
    );
    await bumpMetric(pool, agent.id, { actions_taken: 1, actions_auto_sent: 1, human_approvals: 1 });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save edit." });
  }
}

export async function getAgentMetrics(req, res) {
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const start = typeof req.query.startDate === "string" ? req.query.startDate : null;
    const end = typeof req.query.endDate === "string" ? req.query.endDate : null;
    const params = [agent.id];
    let where = "agent_id = $1";
    if (start) {
      where += ` AND metric_date >= $${params.length + 1}::date`;
      params.push(start);
    }
    if (end) {
      where += ` AND metric_date <= $${params.length + 1}::date`;
      params.push(end);
    }
    const { rows } = await pool.query(
      `SELECT * FROM agent_metrics WHERE ${where} ORDER BY metric_date ASC`,
      params
    );
    res.json({
      metrics: rows.map((m) => ({
        metricDate: m.metric_date,
        actionsTaken: m.actions_taken,
        actionsAutoSent: m.actions_auto_sent,
        actionsQueued: m.actions_queued,
        humanOverrides: m.human_overrides,
        humanApprovals: m.human_approvals,
        avgConfidenceScore: m.avg_confidence_score != null ? Number(m.avg_confidence_score) : null,
        errors: m.errors,
        avgExecutionTimeMs: m.avg_execution_time_ms,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load metrics." });
  }
}

function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set.");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }
  return new Anthropic({ apiKey: key });
}

function textFromMessage(msg) {
  if (!msg?.content) return "";
  const parts = [];
  for (const block of msg.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

export async function postAgentTestPrompt(req, res) {
  const sample =
    typeof req.body?.sampleTrigger === "string"
      ? req.body.sampleTrigger
      : typeof req.body?.sampleInput === "string"
        ? req.body.sampleInput
        : "";
  if (!sample.trim()) {
    badRequest(res, "sampleTrigger (or sampleInput) is required.");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    res.status(503).json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" });
    return;
  }
  try {
    const pool = getPool();
    const agent = await resolveAgent(pool, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const { rows: training } = await pool.query(
      `SELECT * FROM agent_training_examples WHERE agent_id = $1 AND is_active = true ORDER BY created_at ASC`,
      [agent.id]
    );
    const system = composeFullSystemPrompt(agent, training);
    const anthropic = getAnthropic();
    const userMsg = `Simulated trigger / input:\n${sample}\n\nRespond as this agent would (draft only; do not claim any real-world action was taken).`;
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: system || "You are an RPM Prestige operations agent.",
      messages: [{ role: "user", content: userMsg }],
    });
    const output = textFromMessage(msg);
    res.json({ output, systemPromptChars: system.length });
  } catch (e) {
    if (e.code === "AI_NOT_CONFIGURED") {
      res.status(503).json({ error: e.message, code: "AI_NOT_CONFIGURED" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not run test prompt." });
  }
}
