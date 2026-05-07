/**
 * Phase 3: system config + kill switch + launch checklist + unsubscribe.
 *
 * Kill switch is owner-only. The launch checklist is owner+manager but
 * the final "complete" toggle is owner-only.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { vStringOpt } from "../lib/agentHub/validators.js";
import { invalidateSystemConfigCache, processUnsubscribe } from "../lib/agentHub/compliance.js";

function mapConfig(r) {
  if (!r) return null;
  return {
    id: r.id,
    kill_switch_enabled: r.kill_switch_enabled === true,
    kill_switch_reason: r.kill_switch_reason ?? null,
    kill_switch_engaged_by: r.kill_switch_engaged_by ?? null,
    kill_switch_engaged_at: r.kill_switch_engaged_at ?? null,
    rate_limit_emails_per_hour: r.rate_limit_emails_per_hour,
    rate_limit_emails_per_day: r.rate_limit_emails_per_day,
    rate_limit_sms_per_hour: r.rate_limit_sms_per_hour,
    rate_limit_sms_per_day: r.rate_limit_sms_per_day,
    default_sender_email: r.default_sender_email ?? null,
    default_sender_name: r.default_sender_name ?? null,
    physical_address: r.physical_address ?? null,
    referral_fee_offer_text: r.referral_fee_offer_text ?? null,
    referral_fee_landing_url: r.referral_fee_landing_url ?? null,
    launch_checklist_complete: r.launch_checklist_complete === true,
    launch_checklist_completed_by: r.launch_checklist_completed_by ?? null,
    launch_checklist_completed_at: r.launch_checklist_completed_at ?? null,
    updated_at: r.updated_at,
    updated_by: r.updated_by ?? null,
  };
}

export async function getConfig(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM agent_hub_system_config WHERE id = 1`);
    res.json({ config: mapConfig(rows[0] || null) });
  } catch (e) {
    console.error("[agent-hub] system config get", e);
    res.status(500).json({ error: "Could not load config." });
  }
}

export async function updateConfig(req, res) {
  try {
    if (req.agentHubPerms.role !== "owner" && req.agentHubPerms.role !== "manager") {
      res.status(403).json({ error: "Owner or manager only." });
      return;
    }
    const body = req.body ?? {};
    const pool = getPool();
    const { rows: oldRows } = await pool.query(`SELECT * FROM agent_hub_system_config WHERE id = 1`);
    const old = oldRows[0];
    const updates = {};

    const intFields = [
      "rate_limit_emails_per_hour",
      "rate_limit_emails_per_day",
      "rate_limit_sms_per_hour",
      "rate_limit_sms_per_day",
    ];
    for (const f of intFields) {
      if (body[f] !== undefined) {
        const n = Number(body[f]);
        if (!Number.isFinite(n) || n < 0 || n > 10000) {
          res.status(400).json({ error: `${f} must be 0-10000.` });
          return;
        }
        updates[f] = n;
      }
    }
    const stringFields = ["default_sender_email", "default_sender_name", "physical_address",
      "referral_fee_offer_text", "referral_fee_landing_url"];
    for (const f of stringFields) {
      if (body[f] !== undefined) updates[f] = vStringOpt(body[f], { maxLen: 5000 });
    }
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    const sets = [];
    const vals = [];
    let n = 1;
    for (const [k, v] of Object.entries(updates)) {
      sets.push(`${k} = $${n++}`);
      vals.push(v);
    }
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    const { rows } = await pool.query(
      `UPDATE agent_hub_system_config SET ${sets.join(", ")} WHERE id = 1 RETURNING *`,
      vals
    );
    invalidateSystemConfigCache();
    await logFieldDiff(req, "system_config", 1, old, rows[0], Object.keys(updates));
    res.json({ config: mapConfig(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] system config update", e);
    res.status(500).json({ error: "Could not update config." });
  }
}

export async function toggleKillSwitch(req, res) {
  try {
    if (req.agentHubPerms.role !== "owner") {
      res.status(403).json({ error: "Owner only." });
      return;
    }
    const engaged = req.body?.engaged === true;
    const reason = vStringOpt(req.body?.reason, { maxLen: 1000 });
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_system_config
          SET kill_switch_enabled = $1,
              kill_switch_reason = $2,
              kill_switch_engaged_by = CASE WHEN $1 THEN $3 ELSE NULL END,
              kill_switch_engaged_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
              updated_by = $3
        WHERE id = 1
       RETURNING *`,
      [engaged, engaged ? reason : null, req.user.id]
    );
    invalidateSystemConfigCache();
    await logAudit(req, {
      entity_type: "system_config",
      entity_id: 1,
      action: "update",
      field_name: "kill_switch_enabled",
      new_value: engaged,
      context: { reason },
    });
    res.json({ config: mapConfig(rows[0]) });
  } catch (e) {
    console.error("[agent-hub] kill switch", e);
    res.status(500).json({ error: "Could not toggle kill switch." });
  }
}

export async function completeLaunchChecklist(req, res) {
  try {
    if (req.agentHubPerms.role !== "owner") {
      res.status(403).json({ error: "Only the owner can mark the launch checklist complete." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_system_config
          SET launch_checklist_complete = TRUE,
              launch_checklist_completed_by = $1,
              launch_checklist_completed_at = NOW(),
              updated_by = $1
        WHERE id = 1
       RETURNING *`,
      [req.user.id]
    );
    invalidateSystemConfigCache();
    await logAudit(req, {
      entity_type: "system_config",
      entity_id: 1,
      action: "update",
      field_name: "launch_checklist_complete",
      new_value: true,
    });
    res.json({ config: mapConfig(rows[0]) });
  } catch (e) {
    console.error("[agent-hub] launch checklist", e);
    res.status(500).json({ error: "Could not mark complete." });
  }
}

// ============================================================
// Public unsubscribe handler (no auth — token is the auth)
// ============================================================
export async function publicUnsubscribe(req, res) {
  const token = String(req.query?.token || "").trim();
  if (!token) {
    res.status(400).type("text/html").send(htmlPage("Invalid request", "<p>Missing token.</p>"));
    return;
  }
  const result = await processUnsubscribe(token);
  if (result.ok) {
    res.type("text/html").send(htmlPage("You're unsubscribed",
      "<p>You won't receive further automated emails or SMS from RPM Prestige.</p>" +
      "<p>If this was a mistake, contact us directly and we'll restore your preferences.</p>"));
  } else if (result.reason === "invalid_token") {
    res.status(404).type("text/html").send(htmlPage("Invalid link",
      "<p>This unsubscribe link is not valid. It may have been tampered with.</p>"));
  } else if (result.reason === "already_unsubscribed") {
    res.type("text/html").send(htmlPage("Already unsubscribed",
      "<p>You're already unsubscribed.</p>"));
  } else {
    res.status(500).type("text/html").send(htmlPage("Something went wrong",
      "<p>Please contact us directly and we'll handle it manually.</p>"));
  }
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 4rem auto; padding: 0 1rem; color: #1b2856; }
  h1 { font-size: 1.5rem; }
  p { line-height: 1.5; color: #374151; }
</style>
</head>
<body>
<h1>${title}</h1>
${body}
<p style="color:#6a737b;font-size:0.85rem;margin-top:2rem;">— RPM Prestige</p>
</body>
</html>`;
}
