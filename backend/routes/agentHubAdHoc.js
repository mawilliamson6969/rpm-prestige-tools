/**
 * Phase 3: ad-hoc sends from the agent detail page.
 *
 * Calls canSendTo() before transmitting (same compliance as automations).
 * Logs to agent_hub_send_log AND agent_hub_activities so the timeline
 * stays in sync.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { vIntId, vStringOpt, vStringReq } from "../lib/agentHub/validators.js";
import { canSendTo, validateTemplate } from "../lib/agentHub/compliance.js";
import { sendEmail, sendSms, queuePostcard } from "../lib/agentHub/sendChannels.js";

async function loadAgent(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM agent_hub_agents WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function adHocEmail(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const body = req.body ?? {};
    const pool = getPool();
    const agent = await loadAgent(pool, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const compliance = await canSendTo(agent, "email");
    if (!compliance.allowed) {
      res.status(400).json({ error: `Cannot send: ${compliance.reason}` });
      return;
    }

    let template;
    if (body.template_id) {
      const id = vIntId(body.template_id, "template_id");
      const { rows } = await pool.query(`SELECT * FROM agent_hub_message_templates WHERE id = $1`, [id]);
      if (!rows.length || rows[0].channel !== "email") {
        res.status(400).json({ error: "Email template not found." });
        return;
      }
      template = rows[0];
    } else {
      const subject = vStringReq(body.subject, "subject", { maxLen: 500 });
      const tBody = vStringReq(body.body, "body", { maxLen: 100000 });
      const bodyHtml = vStringOpt(body.body_html, { maxLen: 200000 });
      // Compliance: even ad-hoc sends MUST contain unsubscribe + physical address.
      const validation = validateTemplate({ channel: "email", subject, body: tBody, body_html: bodyHtml });
      if (validation.errors.length) {
        res.status(400).json({ error: "Email must contain {{unsubscribe_link}} and {{physical_address}}.", validation_errors: validation.errors });
        return;
      }
      template = { id: null, channel: "email", subject, body: tBody, body_html: bodyHtml };
    }
    const sent = await sendEmail({
      agent,
      template,
      senderUserId: req.user.id,
      linkRefs: { sent_by: req.user.id },
    });
    await logAudit(req, {
      entity_type: "send",
      entity_id: sent.send_log_id,
      action: "create",
      new_value: { channel: "email", agent_id: agentId, template_id: template.id || null },
    });
    res.status(201).json({ ok: true, send_log_id: sent.send_log_id, external_id: sent.external_id });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] ad-hoc email", e);
    res.status(500).json({ error: e.message || "Send failed." });
  }
}

export async function adHocSms(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const body = req.body ?? {};
    const pool = getPool();
    const agent = await loadAgent(pool, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const compliance = await canSendTo(agent, "sms");
    if (!compliance.allowed) {
      res.status(400).json({ error: `Cannot send: ${compliance.reason}` });
      return;
    }
    let template;
    if (body.template_id) {
      const id = vIntId(body.template_id, "template_id");
      const { rows } = await pool.query(`SELECT * FROM agent_hub_message_templates WHERE id = $1`, [id]);
      if (!rows.length || rows[0].channel !== "sms") {
        res.status(400).json({ error: "SMS template not found." });
        return;
      }
      template = rows[0];
    } else {
      const tBody = vStringReq(body.body, "body", { maxLen: 1600 });
      template = { id: null, channel: "sms", body: tBody };
    }
    const sent = await sendSms({
      agent,
      template,
      linkRefs: { sent_by: req.user.id },
    });
    await logAudit(req, {
      entity_type: "send",
      entity_id: sent.send_log_id,
      action: "create",
      new_value: { channel: "sms", agent_id: agentId, template_id: template.id || null },
    });
    res.status(201).json({ ok: true, send_log_id: sent.send_log_id });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] ad-hoc sms", e);
    res.status(500).json({ error: e.message || "Send failed." });
  }
}

export async function adHocPostcard(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const body = req.body ?? {};
    const templateId = vIntId(body.template_id, "template_id");
    const pool = getPool();
    const agent = await loadAgent(pool, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const compliance = await canSendTo(agent, "postcard");
    if (!compliance.allowed) {
      res.status(400).json({ error: `Cannot queue: ${compliance.reason}` });
      return;
    }
    const { rows: tplRows } = await pool.query(`SELECT * FROM agent_hub_message_templates WHERE id = $1`, [templateId]);
    if (!tplRows.length || tplRows[0].channel !== "postcard") {
      res.status(400).json({ error: "Postcard template not found." });
      return;
    }
    const queued = await queuePostcard({
      agent,
      template: tplRows[0],
      linkRefs: { sent_by: req.user.id },
    });
    await logAudit(req, {
      entity_type: "postcard",
      entity_id: queued.postcard_queue_id,
      action: "create",
      new_value: { agent_id: agentId, template_id: templateId },
    });
    res.status(201).json({ ok: true, postcard_queue_id: queued.postcard_queue_id });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] ad-hoc postcard", e);
    res.status(500).json({ error: e.message || "Queue failed." });
  }
}
