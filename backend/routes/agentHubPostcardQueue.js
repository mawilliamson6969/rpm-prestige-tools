/**
 * Phase 3: postcard print queue. Lori uses this UI to mark postcards
 * mailed after physically printing + posting them. Lob is intentionally
 * deferred to a future phase.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { vIntId, vStringOpt } from "../lib/agentHub/validators.js";

function mapPostcard(r) {
  if (!r) return null;
  return {
    id: r.id,
    agent_id: r.agent_id,
    agent_name: r.agent_name ?? null,
    automation_run_id: r.automation_run_id ?? null,
    template_id: r.template_id ?? null,
    template_name: r.template_name ?? null,
    rendered_subject: r.rendered_subject ?? null,
    rendered_body: r.rendered_body,
    mailing_address: r.mailing_address || {},
    generated_at: r.generated_at,
    printed_at: r.printed_at ?? null,
    mailed_at: r.mailed_at ?? null,
    mailed_by: r.mailed_by ?? null,
    cancelled_at: r.cancelled_at ?? null,
    cancelled_by: r.cancelled_by ?? null,
    cancelled_reason: r.cancelled_reason ?? null,
    notes: r.notes ?? null,
    status: r.cancelled_at
      ? "cancelled"
      : r.mailed_at
      ? "mailed"
      : r.printed_at
      ? "printed"
      : "pending",
  };
}

export async function listPostcardQueue(req, res) {
  try {
    const pool = getPool();
    const filters = [];
    const params = [];
    let p = 1;
    const status = req.query.status || "pending";
    if (status === "pending") {
      filters.push("p.mailed_at IS NULL AND p.cancelled_at IS NULL");
    } else if (status === "mailed") {
      filters.push("p.mailed_at IS NOT NULL");
    } else if (status === "cancelled") {
      filters.push("p.cancelled_at IS NOT NULL");
    }
    if (req.query.template_id) {
      filters.push(`p.template_id = $${p++}`);
      params.push(Number(req.query.template_id));
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT p.*, a.full_name AS agent_name, t.name AS template_name
         FROM agent_hub_postcard_print_queue p
         JOIN agent_hub_agents a ON a.id = p.agent_id
         LEFT JOIN agent_hub_message_templates t ON t.id = p.template_id
         ${where}
        ORDER BY p.generated_at ASC`,
      params
    );
    res.json({ postcards: rows.map(mapPostcard) });
  } catch (e) {
    console.error("[agent-hub] postcard queue list", e);
    res.status(500).json({ error: "Could not load postcard queue." });
  }
}

export async function getPostcard(req, res) {
  try {
    const id = vIntId(req.params.id, "postcard id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.*, a.full_name AS agent_name, t.name AS template_name
         FROM agent_hub_postcard_print_queue p
         JOIN agent_hub_agents a ON a.id = p.agent_id
         LEFT JOIN agent_hub_message_templates t ON t.id = p.template_id
        WHERE p.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ postcard: mapPostcard(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] postcard get", e);
    res.status(500).json({ error: "Could not load postcard." });
  }
}

export async function markPostcardMailed(req, res) {
  try {
    const id = vIntId(req.params.id, "postcard id");
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_postcard_print_queue
          SET mailed_at = NOW(),
              mailed_by = $2,
              printed_at = COALESCE(printed_at, NOW())
        WHERE id = $1 AND mailed_at IS NULL AND cancelled_at IS NULL
       RETURNING *`,
      [id, req.user.id]
    );
    if (!rows.length) {
      res.status(409).json({ error: "Postcard not in pending state." });
      return;
    }
    await logAudit(req, {
      entity_type: "postcard",
      entity_id: id,
      action: "update",
      field_name: "mailed_at",
      new_value: rows[0].mailed_at,
    });
    res.json({ postcard: mapPostcard(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] postcard mark mailed", e);
    res.status(500).json({ error: "Could not mark mailed." });
  }
}

export async function cancelPostcard(req, res) {
  try {
    const id = vIntId(req.params.id, "postcard id");
    const reason = vStringOpt(req.body?.reason, { maxLen: 500 }) || "manual_cancel";
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_postcard_print_queue
          SET cancelled_at = NOW(),
              cancelled_by = $2,
              cancelled_reason = $3
        WHERE id = $1 AND mailed_at IS NULL AND cancelled_at IS NULL
       RETURNING *`,
      [id, req.user.id, reason]
    );
    if (!rows.length) {
      res.status(409).json({ error: "Postcard cannot be cancelled." });
      return;
    }
    await logAudit(req, {
      entity_type: "postcard",
      entity_id: id,
      action: "delete",
      old_value: { reason },
    });
    res.json({ postcard: mapPostcard(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] postcard cancel", e);
    res.status(500).json({ error: "Could not cancel." });
  }
}

export async function exportPostcardQueueCsv(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.id, p.agent_id, a.full_name, p.rendered_subject, p.rendered_body,
              p.mailing_address, p.generated_at
         FROM agent_hub_postcard_print_queue p
         JOIN agent_hub_agents a ON a.id = p.agent_id
        WHERE p.mailed_at IS NULL AND p.cancelled_at IS NULL
        ORDER BY p.generated_at ASC`
    );
    const escape = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["id", "agent_id", "agent_name", "name", "address_1", "address_2", "city", "state", "zip", "subject", "body", "generated_at"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const m = r.mailing_address || {};
      lines.push([
        r.id, r.agent_id, r.full_name, m.name || r.full_name,
        m.address_1, m.address_2, m.city, m.state, m.zip,
        r.rendered_subject, r.rendered_body, r.generated_at,
      ].map(escape).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="postcards-pending-${Date.now()}.csv"`);
    res.send(lines.join("\n"));
  } catch (e) {
    console.error("[agent-hub] postcard csv", e);
    res.status(500).json({ error: "Export failed." });
  }
}
