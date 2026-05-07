/**
 * Phase 3 Agent Hub: automations CRUD + simulate + manual trigger.
 *
 * System automations (is_system=true) cannot be deleted — only
 * disabled. Their name/slug/trigger_type are also locked; only
 * enabled, requires_approval, conditions, actions are editable.
 *
 * Enabling an automation requires the system launch checklist
 * (agent_hub_system_config.launch_checklist_complete = true).
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { assertManagerRole, assertPermission } from "../lib/agentHub/permissions.js";
import { vIntId, vStringOpt, vStringReq } from "../lib/agentHub/validators.js";
import { simulateAutomation, emitEvent } from "../lib/agentHub/engine.js";
import { getSystemConfig } from "../lib/agentHub/compliance.js";

function mapAutomation(r) {
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? null,
    enabled: r.enabled === true,
    is_system: r.is_system === true,
    trigger_type: r.trigger_type,
    trigger_config: r.trigger_config || {},
    conditions: r.conditions || [],
    actions: r.actions || [],
    cooldown_period_days: r.cooldown_period_days ?? null,
    max_runs_per_agent: r.max_runs_per_agent ?? null,
    requires_approval: r.requires_approval === true,
    approval_window_hours: r.approval_window_hours,
    created_at: r.created_at,
    updated_at: r.updated_at,
    runs_30d: r.runs_30d != null ? Number(r.runs_30d) : undefined,
    completed_30d: r.completed_30d != null ? Number(r.completed_30d) : undefined,
    skipped_30d: r.skipped_30d != null ? Number(r.skipped_30d) : undefined,
    failed_30d: r.failed_30d != null ? Number(r.failed_30d) : undefined,
  };
}

export async function listAutomations(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM agent_hub_automation_runs r
                WHERE r.automation_id = a.id AND r.triggered_at >= NOW() - INTERVAL '30 days'
                  AND r.triggered_by != 'simulator') AS runs_30d,
              (SELECT COUNT(*)::int FROM agent_hub_automation_runs r
                WHERE r.automation_id = a.id AND r.triggered_at >= NOW() - INTERVAL '30 days'
                  AND r.status = 'completed') AS completed_30d,
              (SELECT COUNT(*)::int FROM agent_hub_automation_runs r
                WHERE r.automation_id = a.id AND r.triggered_at >= NOW() - INTERVAL '30 days'
                  AND r.status = 'skipped') AS skipped_30d,
              (SELECT COUNT(*)::int FROM agent_hub_automation_runs r
                WHERE r.automation_id = a.id AND r.triggered_at >= NOW() - INTERVAL '30 days'
                  AND r.status = 'failed') AS failed_30d
         FROM agent_hub_automations a
        ORDER BY a.is_system DESC, a.name ASC`
    );
    res.json({ automations: rows.map(mapAutomation) });
  } catch (e) {
    console.error("[agent-hub] automations list", e);
    res.status(500).json({ error: "Could not load automations." });
  }
}

export async function getAutomation(req, res) {
  try {
    const id = vIntId(req.params.id, "automation id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM agent_hub_automations WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    // Recent runs (last 50)
    const { rows: runs } = await pool.query(
      `SELECT r.*, a.full_name AS agent_name
         FROM agent_hub_automation_runs r
         JOIN agent_hub_agents a ON a.id = r.agent_id
        WHERE r.automation_id = $1
        ORDER BY r.triggered_at DESC
        LIMIT 50`,
      [id]
    );
    res.json({ automation: mapAutomation(rows[0]), recent_runs: runs });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] automation get", e);
    res.status(500).json({ error: "Could not load automation." });
  }
}

export async function createAutomation(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const body = req.body ?? {};
    const slug = vStringReq(body.slug, "slug", { maxLen: 100 });
    const name = vStringReq(body.name, "name", { maxLen: 200 });
    const description = vStringOpt(body.description, { maxLen: 5000 });
    const triggerType = vStringReq(body.trigger_type, "trigger_type", { maxLen: 30 });
    if (!["time_based", "event_based", "manual"].includes(triggerType)) {
      res.status(400).json({ error: "trigger_type must be time_based, event_based, or manual." });
      return;
    }
    const triggerConfig = body.trigger_config && typeof body.trigger_config === "object" ? body.trigger_config : {};
    const conditions = Array.isArray(body.conditions) ? body.conditions : [];
    const actions = Array.isArray(body.actions) ? body.actions : [];
    const cooldown = body.cooldown_period_days != null ? Number(body.cooldown_period_days) : null;
    const maxRuns = body.max_runs_per_agent != null ? Number(body.max_runs_per_agent) : null;
    const requiresApproval = body.requires_approval !== false;
    const approvalWindow = body.approval_window_hours != null ? Number(body.approval_window_hours) : 48;

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_automations
         (slug, name, description, trigger_type, trigger_config, conditions, actions,
          cooldown_period_days, max_runs_per_agent, requires_approval, approval_window_hours,
          enabled, is_system, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11,
               FALSE, FALSE, $12, $12)
       RETURNING *`,
      [
        slug, name, description, triggerType,
        JSON.stringify(triggerConfig), JSON.stringify(conditions), JSON.stringify(actions),
        cooldown, maxRuns, requiresApproval, approvalWindow, req.user.id,
      ]
    );
    await logAudit(req, {
      entity_type: "automation",
      entity_id: rows[0].id,
      action: "create",
      new_value: { slug, name, trigger_type: triggerType },
    });
    res.status(201).json({ automation: mapAutomation(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "An automation with that slug or name already exists." });
      return;
    }
    console.error("[agent-hub] automation create", e);
    res.status(500).json({ error: "Could not create automation." });
  }
}

export async function updateAutomation(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "automation id");
    const body = req.body ?? {};
    const pool = getPool();
    const { rows: oldRows } = await pool.query(`SELECT * FROM agent_hub_automations WHERE id = $1`, [id]);
    if (!oldRows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const old = oldRows[0];

    // System automations: only enabled / requires_approval / conditions / actions /
    // cooldown_period_days / max_runs_per_agent / approval_window_hours / description editable.
    const SYSTEM_EDITABLE = new Set([
      "enabled",
      "requires_approval",
      "conditions",
      "actions",
      "cooldown_period_days",
      "max_runs_per_agent",
      "approval_window_hours",
      "description",
    ]);

    const updates = {};
    const fields = ["name", "slug", "description", "trigger_type", "trigger_config", "conditions", "actions",
      "cooldown_period_days", "max_runs_per_agent", "requires_approval", "approval_window_hours", "enabled"];
    for (const k of fields) {
      if (body[k] === undefined) continue;
      if (old.is_system && !SYSTEM_EDITABLE.has(k)) {
        res.status(400).json({ error: `Field '${k}' is locked on system automations.` });
        return;
      }
      updates[k] = body[k];
    }

    if (updates.enabled === true) {
      // Launch checklist gate.
      const config = await getSystemConfig({ force: true });
      if (!config?.launch_checklist_complete) {
        res.status(400).json({
          error: "Launch checklist not complete. Owner must complete it before any automation is enabled.",
          code: "LAUNCH_CHECKLIST_INCOMPLETE",
        });
        return;
      }
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    const sets = [];
    const vals = [];
    let n = 1;
    for (const [k, v] of Object.entries(updates)) {
      const isJson = ["trigger_config", "conditions", "actions"].includes(k);
      sets.push(`${k} = $${n}${isJson ? "::jsonb" : ""}`);
      vals.push(isJson ? JSON.stringify(v) : v);
      n++;
    }
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE agent_hub_automations SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "automation", id, old, rows[0], Object.keys(updates));
    res.json({ automation: mapAutomation(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] automation update", e);
    res.status(500).json({ error: "Could not update automation." });
  }
}

export async function deleteAutomation(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "automation id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT is_system FROM agent_hub_automations WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (rows[0].is_system) {
      res.status(400).json({ error: "System automations cannot be deleted. Disable it instead." });
      return;
    }
    await pool.query(`DELETE FROM agent_hub_automations WHERE id = $1`, [id]);
    await logAudit(req, { entity_type: "automation", entity_id: id, action: "delete" });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] automation delete", e);
    res.status(500).json({ error: "Could not delete automation." });
  }
}

export async function simulateAutomationRoute(req, res) {
  try {
    const id = vIntId(req.params.id, "automation id");
    const result = await simulateAutomation(id);
    res.json(result);
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] simulate", e);
    res.status(500).json({ error: e.message || "Simulation failed." });
  }
}

export async function triggerAutomationManual(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "automation id");
    const agentId = vIntId(req.body?.agent_id, "agent_id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM agent_hub_automations WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (rows[0].trigger_type !== "manual") {
      res.status(400).json({ error: "Only manual-trigger automations can be triggered this way." });
      return;
    }
    if (!rows[0].enabled) {
      res.status(400).json({ error: "Automation is disabled." });
      return;
    }
    // Reuse engine.createRunIfEligible by emitting an event-shaped manual trigger.
    // We use a synthetic event id keyed on (automation, agent, today) so two
    // manual triggers in the same day don't double-run.
    const today = new Date().toISOString().slice(0, 10);
    const fired = await emitEvent("manual_trigger", { agent_id: agentId }, `manual:${id}:${agentId}:${today}`);
    res.json({ ok: true, fired });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] manual trigger", e);
    res.status(500).json({ error: "Could not trigger." });
  }
}
