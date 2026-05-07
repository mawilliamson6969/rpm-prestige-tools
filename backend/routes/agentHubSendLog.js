/**
 * Phase 3: send log + replies queue.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { vIntId } from "../lib/agentHub/validators.js";

function mapLog(r) {
  if (!r) return null;
  return {
    id: r.id,
    agent_id: r.agent_id,
    agent_name: r.agent_name ?? null,
    channel: r.channel,
    direction: r.direction,
    automation_run_id: r.automation_run_id ?? null,
    template_id: r.template_id ?? null,
    sent_at: r.sent_at,
    sent_by: r.sent_by ?? null,
    to_address: r.to_address,
    subject: r.subject ?? null,
    body: r.body ?? null,
    external_id: r.external_id ?? null,
    delivery_status: r.delivery_status,
    opened_at: r.opened_at ?? null,
    clicked_at: r.clicked_at ?? null,
    replied_at: r.replied_at ?? null,
    bounced_at: r.bounced_at ?? null,
    bounce_reason: r.bounce_reason ?? null,
  };
}

export async function listSendLog(req, res) {
  try {
    const pool = getPool();
    const filters = [];
    const params = [];
    let p = 1;
    if (req.query.agent_id) {
      filters.push(`s.agent_id = $${p++}`);
      params.push(Number(req.query.agent_id));
    }
    if (req.query.channel) {
      filters.push(`s.channel = $${p++}`);
      params.push(String(req.query.channel));
    }
    if (req.query.delivery_status) {
      filters.push(`s.delivery_status = $${p++}`);
      params.push(String(req.query.delivery_status));
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agent_hub_send_log s ${where}`,
      params
    );
    const { rows } = await pool.query(
      `SELECT s.*, a.full_name AS agent_name
         FROM agent_hub_send_log s
         JOIN agent_hub_agents a ON a.id = s.agent_id
         ${where}
        ORDER BY s.sent_at DESC
        LIMIT $${p++} OFFSET $${p++}`,
      [...params, perPage, offset]
    );
    res.json({ logs: rows.map(mapLog), total: countRows[0].total, page, per_page: perPage });
  } catch (e) {
    console.error("[agent-hub] send log list", e);
    res.status(500).json({ error: "Could not load send log." });
  }
}

export async function getSendLogEntry(req, res) {
  try {
    const id = vIntId(req.params.id, "send log id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.*, a.full_name AS agent_name FROM agent_hub_send_log s
         JOIN agent_hub_agents a ON a.id = s.agent_id WHERE s.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ entry: mapLog(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] send log get", e);
    res.status(500).json({ error: "Could not load entry." });
  }
}

export async function listAgentSendLog(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_send_log WHERE agent_id = $1 ORDER BY sent_at DESC LIMIT 200`,
      [agentId]
    );
    res.json({ logs: rows.map(mapLog) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] agent send log", e);
    res.status(500).json({ error: "Could not load." });
  }
}

// ============================================================
// Replies queue — sends that received an in-thread reply.
// ============================================================
export async function listReplies(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.*, a.full_name AS agent_name, a.tier AS agent_tier,
              a.personal_outreach_flag AS still_flagged
         FROM agent_hub_send_log s
         JOIN agent_hub_agents a ON a.id = s.agent_id
        WHERE s.replied_at IS NOT NULL
        ORDER BY s.replied_at DESC
        LIMIT 100`
    );
    res.json({ replies: rows });
  } catch (e) {
    console.error("[agent-hub] replies list", e);
    res.status(500).json({ error: "Could not load replies." });
  }
}

export async function markReplyHandled(req, res) {
  try {
    const id = vIntId(req.params.id, "send log id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_send_log WHERE id = $1`,
      [id]
    );
    if (!rows.length || !rows[0].replied_at) {
      res.status(404).json({ error: "Reply not found." });
      return;
    }
    // Clear personal outreach flag so future automations can resume.
    await pool.query(
      `UPDATE agent_hub_agents
          SET personal_outreach_flag = FALSE,
              personal_outreach_flagged_at = NULL
        WHERE id = $1`,
      [rows[0].agent_id]
    );
    await logAudit(req, {
      entity_type: "agent",
      entity_id: rows[0].agent_id,
      action: "update",
      field_name: "personal_outreach_flag",
      old_value: true,
      new_value: false,
      context: { source: "reply_handled", send_log_id: id },
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] reply handled", e);
    res.status(500).json({ error: "Could not mark handled." });
  }
}
