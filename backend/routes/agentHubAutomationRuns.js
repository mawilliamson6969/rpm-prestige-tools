/**
 * Phase 3 Agent Hub: automation runs + approval queue.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { assertManagerRole } from "../lib/agentHub/permissions.js";
import { vIntId, vStringOpt } from "../lib/agentHub/validators.js";

function mapRun(r) {
  if (!r) return null;
  return {
    id: r.id,
    automation_id: r.automation_id,
    automation_name: r.automation_name ?? null,
    agent_id: r.agent_id,
    agent_name: r.agent_name ?? null,
    triggered_at: r.triggered_at,
    triggered_by: r.triggered_by,
    triggered_by_event_id: r.triggered_by_event_id ?? null,
    status: r.status,
    skipped_reason: r.skipped_reason ?? null,
    approval_required_until: r.approval_required_until ?? null,
    approved_at: r.approved_at ?? null,
    approved_by: r.approved_by ?? null,
    cancelled_at: r.cancelled_at ?? null,
    cancelled_by: r.cancelled_by ?? null,
    cancelled_reason: r.cancelled_reason ?? null,
    completed_at: r.completed_at ?? null,
    actions_total: r.actions_total,
    actions_completed: r.actions_completed,
    actions_failed: r.actions_failed,
    error_log: r.error_log || [],
    simulator_output: r.simulator_output ?? null,
  };
}

export async function listRuns(req, res) {
  try {
    const pool = getPool();
    const filters = [];
    const params = [];
    let p = 1;
    if (req.query.automation_id) {
      filters.push(`r.automation_id = $${p++}`);
      params.push(Number(req.query.automation_id));
    }
    if (req.query.agent_id) {
      filters.push(`r.agent_id = $${p++}`);
      params.push(Number(req.query.agent_id));
    }
    if (req.query.status) {
      filters.push(`r.status = $${p++}`);
      params.push(String(req.query.status));
    }
    if (req.query.from_date) {
      filters.push(`r.triggered_at >= $${p++}::timestamptz`);
      params.push(String(req.query.from_date));
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agent_hub_automation_runs r ${where}`,
      params
    );
    const { rows } = await pool.query(
      `SELECT r.*, a.full_name AS agent_name, au.name AS automation_name
         FROM agent_hub_automation_runs r
         JOIN agent_hub_agents a ON a.id = r.agent_id
         JOIN agent_hub_automations au ON au.id = r.automation_id
         ${where}
        ORDER BY r.triggered_at DESC
        LIMIT $${p++} OFFSET $${p++}`,
      [...params, perPage, offset]
    );
    res.json({ runs: rows.map(mapRun), total: countRows[0].total, page, per_page: perPage });
  } catch (e) {
    console.error("[agent-hub] runs list", e);
    res.status(500).json({ error: "Could not load runs." });
  }
}

export async function getRun(req, res) {
  try {
    const id = vIntId(req.params.id, "run id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT r.*, a.full_name AS agent_name, au.name AS automation_name
         FROM agent_hub_automation_runs r
         JOIN agent_hub_agents a ON a.id = r.agent_id
         JOIN agent_hub_automations au ON au.id = r.automation_id
        WHERE r.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const { rows: queue } = await pool.query(
      `SELECT * FROM agent_hub_automation_action_queue
        WHERE automation_run_id = $1
        ORDER BY sequence_index ASC`,
      [id]
    );
    res.json({ run: mapRun(rows[0]), action_queue: queue });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] run get", e);
    res.status(500).json({ error: "Could not load run." });
  }
}

export async function approveRun(req, res) {
  try {
    const id = vIntId(req.params.id, "run id");
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_automation_runs
          SET status = 'approved',
              approved_at = NOW(),
              approved_by = $2
        WHERE id = $1 AND status = 'pending_approval'
       RETURNING *`,
      [id, req.user.id]
    );
    if (!rows.length) {
      res.status(409).json({ error: "Run is not pending approval." });
      return;
    }
    await logAudit(req, {
      entity_type: "automation_run",
      entity_id: id,
      action: "approve",
    });
    res.json({ run: mapRun(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] run approve", e);
    res.status(500).json({ error: "Could not approve." });
  }
}

export async function cancelRun(req, res) {
  try {
    const id = vIntId(req.params.id, "run id");
    const reason = vStringOpt(req.body?.reason, { maxLen: 500 }) || "manual_cancel";
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_automation_runs
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_by = $2,
              cancelled_reason = $3
        WHERE id = $1 AND status IN ('pending_approval','approved','running')
       RETURNING *`,
      [id, req.user.id, reason]
    );
    if (!rows.length) {
      res.status(409).json({ error: "Run is not in a cancellable state." });
      return;
    }
    // Skip any pending actions.
    await pool.query(
      `UPDATE agent_hub_automation_action_queue
          SET status = 'skipped', error_text = 'run_cancelled'
        WHERE automation_run_id = $1 AND status IN ('pending','executing')`,
      [id]
    );
    await logAudit(req, {
      entity_type: "automation_run",
      entity_id: id,
      action: "delete",
      old_value: { reason },
    });
    res.json({ run: mapRun(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] run cancel", e);
    res.status(500).json({ error: "Could not cancel." });
  }
}

// ============================================================
// Approval queue
// ============================================================
export async function getApprovalQueue(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT r.*, a.full_name AS agent_name, a.tier AS agent_tier,
              a.photo_url AS agent_photo_url, au.name AS automation_name,
              au.slug AS automation_slug
         FROM agent_hub_automation_runs r
         JOIN agent_hub_agents a ON a.id = r.agent_id
         JOIN agent_hub_automations au ON au.id = r.automation_id
        WHERE r.status = 'pending_approval'
        ORDER BY r.approval_required_until ASC NULLS LAST, r.triggered_at ASC`
    );
    // Also fetch the action queue preview for each (first 3 actions).
    const runIds = rows.map((r) => r.id);
    let queueByRun = new Map();
    if (runIds.length) {
      const { rows: q } = await pool.query(
        `SELECT * FROM agent_hub_automation_action_queue
          WHERE automation_run_id = ANY($1::int[])
          ORDER BY automation_run_id, sequence_index`,
        [runIds]
      );
      for (const row of q) {
        if (!queueByRun.has(row.automation_run_id)) queueByRun.set(row.automation_run_id, []);
        queueByRun.get(row.automation_run_id).push(row);
      }
    }
    res.json({
      runs: rows.map((r) => ({
        ...mapRun(r),
        agent_tier: r.agent_tier,
        agent_photo_url: r.agent_photo_url,
        automation_slug: r.automation_slug,
        action_preview: (queueByRun.get(r.id) || []).slice(0, 3).map((q) => ({
          sequence_index: q.sequence_index,
          action_type: q.action_type,
          action_config: q.action_config,
          scheduled_for: q.scheduled_for,
        })),
      })),
    });
  } catch (e) {
    console.error("[agent-hub] approval queue", e);
    res.status(500).json({ error: "Could not load approval queue." });
  }
}

export async function bulkApprove(req, res) {
  try {
    const ids = Array.isArray(req.body?.run_ids) ? req.body.run_ids.map(Number).filter(Number.isFinite) : [];
    if (!ids.length) {
      res.status(400).json({ error: "run_ids required." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_automation_runs
          SET status = 'approved', approved_at = NOW(), approved_by = $2
        WHERE id = ANY($1::int[]) AND status = 'pending_approval'
       RETURNING id`,
      [ids, req.user.id]
    );
    await logAudit(req, {
      entity_type: "automation_run",
      action: "bulk_update",
      field_name: "status",
      new_value: "approved",
      context: { ids: rows.map((r) => r.id) },
    });
    res.json({ approved: rows.length });
  } catch (e) {
    console.error("[agent-hub] bulk approve", e);
    res.status(500).json({ error: "Bulk approve failed." });
  }
}

export async function bulkCancel(req, res) {
  try {
    const ids = Array.isArray(req.body?.run_ids) ? req.body.run_ids.map(Number).filter(Number.isFinite) : [];
    if (!ids.length) {
      res.status(400).json({ error: "run_ids required." });
      return;
    }
    const reason = vStringOpt(req.body?.reason, { maxLen: 500 }) || "bulk_cancel";
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_automation_runs
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2, cancelled_reason = $3
        WHERE id = ANY($1::int[]) AND status IN ('pending_approval','approved','running')
       RETURNING id`,
      [ids, req.user.id, reason]
    );
    await pool.query(
      `UPDATE agent_hub_automation_action_queue
          SET status = 'skipped', error_text = 'bulk_cancelled'
        WHERE automation_run_id = ANY($1::int[]) AND status IN ('pending','executing')`,
      [rows.map((r) => r.id)]
    );
    await logAudit(req, {
      entity_type: "automation_run",
      action: "bulk_update",
      field_name: "status",
      new_value: "cancelled",
      context: { ids: rows.map((r) => r.id), reason },
    });
    res.json({ cancelled: rows.length });
  } catch (e) {
    console.error("[agent-hub] bulk cancel", e);
    res.status(500).json({ error: "Bulk cancel failed." });
  }
}
