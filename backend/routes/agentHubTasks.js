/**
 * Phase 2: lightweight task system.
 *
 * Used for:
 *   - System-generated thank-you tasks when a referral hits tenant_placed
 *     (created by referrals.advanceReferralStage; idempotent via partial
 *     unique index)
 *   - General manual followups
 *
 * Phase 3 will add automation rules that create tasks for many other
 * triggers (birthday touchpoints, dormant agents, etc.). Until then,
 * the only system-generated source is system_referral_thank_you.
 *
 * Permissions: any Hub user can create/list/edit their own tasks.
 * Reassignment to another user is manager+.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapTask } from "../lib/agentHub/mappers.js";
import {
  vDate,
  vIntId,
  vIntOpt,
  vPriority,
  vStringOpt,
  vStringReq,
  vTaskStatus,
} from "../lib/agentHub/validators.js";

const TASK_FIELDS = {
  title: (v) => vStringReq(v, "title", { maxLen: 200 }),
  description: (v) => vStringOpt(v, { maxLen: 50000 }),
  due_date: (v) => (v == null || v === "" ? null : vDate(v, "due_date")),
  priority: (v) => vPriority(v, { allowNull: false }),
  related_agent_id: (v) => (v == null || v === "" ? null : vIntId(v, "related_agent_id")),
  related_referral_id: (v) => (v == null || v === "" ? null : vIntId(v, "related_referral_id")),
  related_owner_id: (v) => (v == null || v === "" ? null : vIntId(v, "related_owner_id")),
  related_property_id: (v) => (v == null || v === "" ? null : vIntId(v, "related_property_id")),
};

export async function listTasks(req, res) {
  try {
    const pool = getPool();
    const filters = [];
    const params = [];
    let p = 1;
    // Default to current user's pending tasks if no assigned_to filter set.
    if (req.query.assigned_to !== undefined) {
      const v = req.query.assigned_to;
      if (v === "me") {
        filters.push(`t.assigned_to = $${p++}`);
        params.push(req.user.id);
      } else if (v === "unassigned") {
        filters.push(`t.assigned_to IS NULL`);
      } else if (v === "any" || v === "*") {
        // no filter
      } else if (v) {
        filters.push(`t.assigned_to = $${p++}`);
        params.push(Number(v));
      }
    } else {
      filters.push(`t.assigned_to = $${p++}`);
      params.push(req.user.id);
    }
    if (req.query.status) {
      filters.push(`t.status = $${p++}`);
      params.push(String(req.query.status));
    }
    if (req.query.related_referral_id) {
      filters.push(`t.related_referral_id = $${p++}`);
      params.push(Number(req.query.related_referral_id));
    }
    if (req.query.related_agent_id) {
      filters.push(`t.related_agent_id = $${p++}`);
      params.push(Number(req.query.related_agent_id));
    }
    if (req.query.due_before) {
      filters.push(`t.due_date <= $${p++}::date`);
      params.push(String(req.query.due_before));
    }
    if (req.query.source) {
      filters.push(`t.source = $${p++}`);
      params.push(String(req.query.source));
    }

    // Outreach role visibility: only tasks related to assigned agents OR
    // tasks assigned directly to the user.
    const allowedAgentIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedAgentIds) {
      filters.push(
        `(t.assigned_to = $${p} OR t.related_agent_id = ANY($${p + 1}::int[]))`
      );
      params.push(req.user.id);
      params.push(allowedAgentIds);
      p += 2;
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 100, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agent_hub_tasks t ${where}`,
      params
    );

    const { rows } = await pool.query(
      `SELECT t.*, u.display_name AS assigned_to_name,
              ag.full_name AS related_agent_name
         FROM agent_hub_tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         LEFT JOIN agent_hub_agents ag ON ag.id = t.related_agent_id
         ${where}
        ORDER BY
          CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1
                       WHEN 'completed' THEN 2 ELSE 3 END,
          t.due_date ASC NULLS LAST,
          t.created_at DESC
        LIMIT $${p++} OFFSET $${p++}`,
      [...params, perPage, offset]
    );
    res.json({ tasks: rows.map(mapTask), total: countRows[0].total, page, per_page: perPage });
  } catch (e) {
    console.error("[agent-hub] tasks list", e);
    res.status(500).json({ error: "Could not load tasks." });
  }
}

export async function getTask(req, res) {
  try {
    const id = vIntId(req.params.id, "task id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT t.*, u.display_name AS assigned_to_name, ag.full_name AS related_agent_name
         FROM agent_hub_tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         LEFT JOIN agent_hub_agents ag ON ag.id = t.related_agent_id
        WHERE t.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Task not found." });
      return;
    }
    res.json({ task: mapTask(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] task get", e);
    res.status(500).json({ error: "Could not load task." });
  }
}

export async function createTask(req, res) {
  try {
    const body = req.body ?? {};
    const updates = {};
    for (const [k, fn] of Object.entries(TASK_FIELDS)) {
      if (body[k] !== undefined) updates[k] = fn(body[k]);
    }
    if (!updates.title) {
      res.status(400).json({ error: "title is required." });
      return;
    }
    if (!updates.priority) updates.priority = "medium";

    // assigned_to default = creator. Reassigning to another user requires manager+.
    const assignedTo =
      body.assigned_to == null ? req.user.id : vIntOpt(body.assigned_to, "assigned_to", { min: 1 });
    if (assignedTo !== req.user.id) {
      assertManagerRole(req.agentHubPerms);
    }
    updates.assigned_to = assignedTo;
    updates.source = "manual";

    const cols = Object.keys(updates);
    const vals = cols.map((k) => updates[k]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    cols.push("created_by");
    placeholders.push(`$${vals.length + 1}`);
    vals.push(req.user.id);

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_tasks (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      vals
    );
    await logAudit(req, {
      entity_type: "task",
      entity_id: rows[0].id,
      action: "create",
      new_value: { title: rows[0].title, assigned_to: rows[0].assigned_to },
    });
    res.status(201).json({ task: mapTask(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] task create", e);
    res.status(500).json({ error: "Could not create task." });
  }
}

export async function updateTask(req, res) {
  try {
    const id = vIntId(req.params.id, "task id");
    const body = req.body ?? {};
    const pool = getPool();
    const { rows: oldRows } = await pool.query(`SELECT * FROM agent_hub_tasks WHERE id = $1`, [id]);
    if (!oldRows.length) {
      res.status(404).json({ error: "Task not found." });
      return;
    }
    const old = oldRows[0];

    // Edit gate: assignee, creator, or manager+. Status to 'completed'
    // is allowed for any of those.
    const isManager = req.agentHubPerms.role === "owner" || req.agentHubPerms.role === "manager";
    const isOwn = old.assigned_to === req.user.id || old.created_by === req.user.id;
    if (!isManager && !isOwn) {
      res.status(403).json({ error: "Not authorized to edit this task." });
      return;
    }

    const updates = {};
    for (const [k, fn] of Object.entries(TASK_FIELDS)) {
      if (body[k] !== undefined) updates[k] = fn(body[k]);
    }
    if (body.status !== undefined) {
      const s = vTaskStatus(body.status);
      updates.status = s;
      if (s === "completed") {
        updates.completed_at = new Date().toISOString();
        updates.completed_by = req.user.id;
      } else {
        updates.completed_at = null;
        updates.completed_by = null;
      }
    }
    if (body.assigned_to !== undefined) {
      const newAssignee = body.assigned_to == null ? null : vIntOpt(body.assigned_to, "assigned_to", { min: 1 });
      if (newAssignee !== old.assigned_to) {
        // Reassignment requires manager+.
        if (!isManager) {
          res.status(403).json({ error: "Reassigning a task requires manager role." });
          return;
        }
      }
      updates.assigned_to = newAssignee;
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }

    const sets = [];
    const vals = [];
    let n = 1;
    for (const k of Object.keys(updates)) {
      sets.push(`${k} = $${n++}`);
      vals.push(updates[k]);
    }
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE agent_hub_tasks SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "task", id, old, rows[0], Object.keys(updates));
    res.json({ task: mapTask(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] task update", e);
    res.status(500).json({ error: "Could not update task." });
  }
}

export async function deleteTask(req, res) {
  try {
    const id = vIntId(req.params.id, "task id");
    const pool = getPool();
    const { rows: oldRows } = await pool.query(`SELECT * FROM agent_hub_tasks WHERE id = $1`, [id]);
    if (!oldRows.length) {
      res.status(404).json({ error: "Task not found." });
      return;
    }
    const isManager = req.agentHubPerms.role === "owner" || req.agentHubPerms.role === "manager";
    const isOwn = oldRows[0].assigned_to === req.user.id || oldRows[0].created_by === req.user.id;
    if (!isManager && !isOwn) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    // Cancel rather than hard-delete so the audit trail and any system
    // task uniqueness invariants stay intact.
    await pool.query(
      `UPDATE agent_hub_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await logAudit(req, { entity_type: "task", entity_id: id, action: "delete" });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] task delete", e);
    res.status(500).json({ error: "Could not delete task." });
  }
}
