/**
 * Phase 3 Agent Hub: message templates CRUD + preview + test-send.
 *
 * Email templates MUST contain {{unsubscribe_link}} and
 * {{physical_address}} (CAN-SPAM). Enforced both in app
 * (validateTemplate) and in the DB CHECK constraint.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { assertManagerRole } from "../lib/agentHub/permissions.js";
import { vIntId, vStringOpt, vStringReq } from "../lib/agentHub/validators.js";
import {
  buildMergeContext,
  canSendTo,
  renderTemplateStrict,
  validateTemplate,
} from "../lib/agentHub/compliance.js";
import { vEmail, vPhone } from "../lib/agentHub/validators.js";
import { sendEmail, sendSms } from "../lib/agentHub/sendChannels.js";

function mapTemplate(r) {
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? null,
    channel: r.channel,
    subject: r.subject ?? null,
    body: r.body,
    body_html: r.body_html ?? null,
    merge_fields_used: r.merge_fields_used || [],
    active: r.active === true,
    is_system: r.is_system === true,
    category: r.category ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listTemplates(req, res) {
  try {
    const pool = getPool();
    const filters = ["TRUE"];
    const params = [];
    let p = 1;
    if (req.query.channel) {
      filters.push(`channel = $${p++}`);
      params.push(String(req.query.channel));
    }
    if (req.query.category) {
      filters.push(`category = $${p++}`);
      params.push(String(req.query.category));
    }
    if (req.query.active === "true") filters.push("active = TRUE");
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_message_templates
        WHERE ${filters.join(" AND ")}
        ORDER BY is_system DESC, channel, name`,
      params
    );
    res.json({ templates: rows.map(mapTemplate) });
  } catch (e) {
    console.error("[agent-hub] templates list", e);
    res.status(500).json({ error: "Could not load templates." });
  }
}

export async function getTemplate(req, res) {
  try {
    const id = vIntId(req.params.id, "template id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM agent_hub_message_templates WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ template: mapTemplate(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] template get", e);
    res.status(500).json({ error: "Could not load template." });
  }
}

export async function createTemplate(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const body = req.body ?? {};
    const slug = vStringReq(body.slug, "slug", { maxLen: 100 });
    const name = vStringReq(body.name, "name", { maxLen: 200 });
    const channel = vStringReq(body.channel, "channel", { maxLen: 30 });
    if (!["email", "sms", "postcard", "letter"].includes(channel)) {
      res.status(400).json({ error: "channel must be email/sms/postcard/letter." });
      return;
    }
    const subject = vStringOpt(body.subject, { maxLen: 500 });
    const tBody = vStringReq(body.body, "body", { maxLen: 100000 });
    const bodyHtml = vStringOpt(body.body_html, { maxLen: 200000 });
    const description = vStringOpt(body.description, { maxLen: 1000 });
    const category = vStringOpt(body.category, { maxLen: 30 });

    const validation = validateTemplate({ channel, subject, body: tBody, body_html: bodyHtml });
    if (validation.errors.length) {
      res.status(400).json({ error: "Validation failed.", validation_errors: validation.errors });
      return;
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_message_templates
         (slug, name, description, channel, subject, body, body_html, merge_fields_used, category, is_system, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, FALSE, $10, $10)
       RETURNING *`,
      [slug, name, description, channel, subject, tBody, bodyHtml, validation.fieldsUsed, category, req.user.id]
    );
    await logAudit(req, {
      entity_type: "template",
      entity_id: rows[0].id,
      action: "create",
      new_value: { slug, channel },
    });
    res.status(201).json({ template: mapTemplate(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "Template slug already exists." });
      return;
    }
    console.error("[agent-hub] template create", e);
    res.status(500).json({ error: "Could not create template." });
  }
}

export async function updateTemplate(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "template id");
    const body = req.body ?? {};
    const pool = getPool();
    const { rows: oldRows } = await pool.query(`SELECT * FROM agent_hub_message_templates WHERE id = $1`, [id]);
    if (!oldRows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const old = oldRows[0];
    // System templates: slug + channel are locked.
    if (old.is_system) {
      if (body.slug !== undefined && body.slug !== old.slug) {
        res.status(400).json({ error: "Cannot change slug on a system template." });
        return;
      }
      if (body.channel !== undefined && body.channel !== old.channel) {
        res.status(400).json({ error: "Cannot change channel on a system template." });
        return;
      }
    }
    const updates = {};
    if (body.name !== undefined) updates.name = vStringReq(body.name, "name", { maxLen: 200 });
    if (body.description !== undefined) updates.description = vStringOpt(body.description, { maxLen: 1000 });
    if (body.subject !== undefined) updates.subject = vStringOpt(body.subject, { maxLen: 500 });
    if (body.body !== undefined) updates.body = vStringReq(body.body, "body", { maxLen: 100000 });
    if (body.body_html !== undefined) updates.body_html = vStringOpt(body.body_html, { maxLen: 200000 });
    if (body.category !== undefined) updates.category = vStringOpt(body.category, { maxLen: 30 });
    if (body.active !== undefined) updates.active = body.active === true;
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    // Re-validate if subject/body/body_html changed.
    const channel = old.channel;
    const validation = validateTemplate({
      channel,
      subject: updates.subject ?? old.subject,
      body: updates.body ?? old.body,
      body_html: updates.body_html ?? old.body_html,
    });
    if (validation.errors.length) {
      res.status(400).json({ error: "Validation failed.", validation_errors: validation.errors });
      return;
    }
    updates.merge_fields_used = validation.fieldsUsed;

    const sets = [];
    const vals = [];
    let n = 1;
    for (const [k, v] of Object.entries(updates)) {
      if (k === "merge_fields_used") {
        sets.push(`${k} = $${n++}::text[]`);
        vals.push(v);
      } else {
        sets.push(`${k} = $${n++}`);
        vals.push(v);
      }
    }
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE agent_hub_message_templates SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "template", id, old, rows[0], Object.keys(updates));
    res.json({ template: mapTemplate(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] template update", e);
    res.status(500).json({ error: "Could not update template." });
  }
}

export async function deleteTemplate(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "template id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT is_system FROM agent_hub_message_templates WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (rows[0].is_system) {
      res.status(400).json({ error: "System templates cannot be deleted. Set active=false instead." });
      return;
    }
    await pool.query(`DELETE FROM agent_hub_message_templates WHERE id = $1`, [id]);
    await logAudit(req, { entity_type: "template", entity_id: id, action: "delete" });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] template delete", e);
    res.status(500).json({ error: "Could not delete template." });
  }
}

export async function previewTemplate(req, res) {
  try {
    const id = vIntId(req.params.id, "template id");
    const agentId = vIntId(req.body?.agent_id, "agent_id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM agent_hub_message_templates WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const tpl = rows[0];
    const ctx = await buildMergeContext(agentId, {
      unsubscribe_link: "https://prestigedash.com/api/agent-hub/unsubscribe?token=PREVIEW",
    });
    const subjectR = renderTemplateStrict(tpl.subject || "", ctx);
    const bodyR = renderTemplateStrict(tpl.body || "", ctx);
    const htmlR = renderTemplateStrict(tpl.body_html || "", ctx);
    res.json({
      subject: subjectR.rendered,
      body: bodyR.rendered,
      body_html: htmlR.rendered,
      missing_merge_fields: Array.from(new Set([...subjectR.missing, ...bodyR.missing, ...htmlR.missing])),
    });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] template preview", e);
    res.status(500).json({ error: "Preview failed." });
  }
}

export async function testSendTemplate(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "template id");
    const agentId = vIntId(req.body?.agent_id, "agent_id");
    const pool = getPool();
    const { rows: tplRows } = await pool.query(`SELECT * FROM agent_hub_message_templates WHERE id = $1`, [id]);
    if (!tplRows.length) {
      res.status(404).json({ error: "Template not found." });
      return;
    }
    const template = { ...tplRows[0] };
    template.subject = `[TEST] ${template.subject || ""}`;

    const { rows: agentRows } = await pool.query(`SELECT * FROM agent_hub_agents WHERE id = $1`, [agentId]);
    if (!agentRows.length) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const agent = { ...agentRows[0] };
    // For test sends, the override is REQUIRED so we never accidentally
    // hit a real agent's inbox. CAN-SPAM applies to test sends — if we
    // hit a DNC'd or unsubscribed agent the [TEST] prefix doesn't save us.
    // Override target is presumed to be the requesting operator.
    const recipientEmailOverride = template.channel === "email"
      ? vEmail(req.body?.recipient_email_override, { allowNull: true })
      : null;
    const recipientPhoneOverride = template.channel === "sms" && req.body?.recipient_phone_override
      ? vPhone(req.body.recipient_phone_override)
      : null;

    if (template.channel === "email") {
      if (!recipientEmailOverride) {
        res.status(400).json({
          error: "recipient_email_override is required for test sends. Use your own email — never an agent's.",
          code: "OVERRIDE_REQUIRED",
        });
        return;
      }
      // Defense in depth: refuse if the override IS the agent's email.
      if (agent.email && agent.email.toLowerCase() === recipientEmailOverride.toLowerCase()) {
        res.status(400).json({
          error: "Override email cannot match the agent's actual email — this would still violate CAN-SPAM.",
          code: "OVERRIDE_MATCHES_AGENT",
        });
        return;
      }
      agent.email = recipientEmailOverride;
      // Force consent flags so canSendTo permits the override target. The
      // override is by definition the operator's own address, which they
      // implicitly consent to.
      agent.consent_to_email = true;
      agent.do_not_contact = false;
      agent.status = "active";
      agent.personal_outreach_flag = false;
    }
    if (template.channel === "sms") {
      if (!recipientPhoneOverride) {
        res.status(400).json({
          error: "recipient_phone_override is required for SMS test sends.",
          code: "OVERRIDE_REQUIRED",
        });
        return;
      }
      if (agent.phone_mobile && agent.phone_mobile === recipientPhoneOverride) {
        res.status(400).json({
          error: "Override phone cannot match the agent's actual phone.",
          code: "OVERRIDE_MATCHES_AGENT",
        });
        return;
      }
      agent.phone_mobile = recipientPhoneOverride;
      agent.consent_to_sms = true;
      agent.do_not_contact = false;
      agent.status = "active";
      agent.personal_outreach_flag = false;
    }

    // Compliance gate runs against the synthetic operator-as-recipient agent
    // record above. This catches kill-switch and rate-limit (which apply
    // even to operator test sends).
    const compliance = await canSendTo(agent, template.channel);
    if (!compliance.allowed) {
      res.status(400).json({ error: `Test send blocked: ${compliance.reason}`, code: compliance.reason });
      return;
    }
    if (template.channel === "email") {
      const sent = await sendEmail({
        agent,
        template,
        senderUserId: req.user.id,
        linkRefs: { sent_by: req.user.id },
      });
      res.json({ ok: true, channel: "email", external_id: sent.external_id });
    } else if (template.channel === "sms") {
      const sent = await sendSms({
        agent,
        template,
        linkRefs: { sent_by: req.user.id },
      });
      res.json({ ok: true, channel: "sms", external_id: sent.external_id });
    } else {
      res.status(400).json({ error: "Test-send only supported for email and SMS." });
    }
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] template test-send", e);
    res.status(500).json({ error: e.message || "Test send failed." });
  }
}
