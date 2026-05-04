import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import { getPool } from "../lib/db.js";
import { bumpActivity, logActivity } from "../lib/process-activity.js";
import {
  applyMergeContext,
  buildMergeContext,
} from "../lib/process-merge-fields.js";
import {
  resolveRecipient,
  sendProcessEmail,
  sendProcessSMS,
} from "../lib/process-messaging.js";
import { executeSuggestion } from "../lib/ai-suggestion-executor.js";
import {
  getSuggestionStats,
  runAIAnalysis,
} from "../lib/ai-suggestions-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRoot = path.join(__dirname, "..", "uploads", "process-attachments");
fs.mkdirSync(uploadRoot, { recursive: true });

/* ---------- mappers ---------- */

function mapRole(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    roleName: r.role_name,
    isRequired: r.is_required,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}

function mapAssignment(r) {
  return {
    id: r.id,
    processId: r.process_id,
    roleName: r.role_name,
    userId: r.user_id,
    userName: r.user_name ?? null,
    assignedBy: r.assigned_by,
    assignedAt: r.assigned_at,
  };
}

function mapEmailTemplate(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    subject: r.subject,
    bodyHtml: r.body_html,
    bodyText: r.body_text,
    totalSends: r.total_sends,
    totalOpens: r.total_opens,
    totalClicks: r.total_clicks,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapTextTemplate(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    body: r.body,
    totalSends: r.total_sends,
    totalDelivered: r.total_delivered,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapActivity(r) {
  return {
    id: r.id,
    processId: r.process_id,
    actionType: r.action_type,
    description: r.description,
    metadata: r.metadata,
    actorType: r.actor_type,
    actorId: r.actor_id,
    actorName: r.actor_name,
    isPinned: r.is_pinned,
    pinnedBy: r.pinned_by,
    pinnedAt: r.pinned_at,
    createdAt: r.created_at,
  };
}

function mapStageHistory(r) {
  return {
    id: r.id,
    processId: r.process_id,
    stageId: r.stage_id,
    stageName: r.stage_name,
    stageColor: r.stage_color ?? null,
    enteredAt: r.entered_at,
    exitedAt: r.exited_at,
    durationHours:
      r.entered_at && r.exited_at
        ? (new Date(r.exited_at) - new Date(r.entered_at)) / 3_600_000
        : null,
    changedBy: r.changed_by,
  };
}

function mapCommunication(r) {
  return {
    id: r.id,
    processId: r.process_id,
    channel: r.channel,
    direction: r.direction,
    subject: r.subject,
    body: r.body,
    fromAddress: r.from_address,
    toAddress: r.to_address,
    status: r.status,
    openedAt: r.opened_at,
    clickedAt: r.clicked_at,
    emailTemplateId: r.email_template_id,
    textTemplateId: r.text_template_id,
    externalId: r.external_id,
    sentBy: r.sent_by,
    sentByName: r.sent_by_name ?? null,
    createdAt: r.created_at,
  };
}

function mapAttachment(r) {
  return {
    id: r.id,
    processId: r.process_id,
    filename: r.filename,
    filePath: r.file_path,
    fileSize: r.file_size != null ? Number(r.file_size) : null,
    mimeType: r.mime_type,
    uploadedBy: r.uploaded_by,
    uploadedByName: r.uploaded_by_name ?? null,
    createdAt: r.created_at,
  };
}

function mapSuggestion(r) {
  return {
    id: r.id,
    processId: r.process_id,
    suggestionType: r.suggestion_type,
    title: r.title,
    description: r.description,
    actionType: r.action_type,
    actionPayload: r.action_payload,
    status: r.status,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    respondedBy: r.responded_by,
    respondedAt: r.responded_at,
    createdAt: r.created_at,
  };
}

/* ---------- Process Type Roles ---------- */

export async function getProcessTypeRoles(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_type_roles WHERE template_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [templateId]
    );
    res.json({ roles: rows.map(mapRole) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load roles." });
  }
}

export async function postProcessTypeRole(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  const roleName = typeof req.body?.roleName === "string" ? req.body.roleName.trim() : "";
  if (!Number.isFinite(templateId) || !roleName) {
    res.status(400).json({ error: "templateId and roleName required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: next } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM process_type_roles WHERE template_id = $1`,
      [templateId]
    );
    const { rows } = await pool.query(
      `INSERT INTO process_type_roles (template_id, role_name, is_required, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (template_id, role_name) DO NOTHING
       RETURNING *`,
      [templateId, roleName, req.body?.isRequired === true, next[0].n]
    );
    if (!rows.length) {
      res.status(409).json({ error: "A role with that name already exists on this template." });
      return;
    }
    res.status(201).json({ role: mapRole(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create role." });
  }
}

export async function putProcessTypeRole(req, res) {
  const id = Number.parseInt(req.params.roleId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid role id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof req.body?.roleName === "string" && req.body.roleName.trim()) {
    sets.push(`role_name = $${n++}`);
    vals.push(req.body.roleName.trim());
  }
  if (typeof req.body?.isRequired === "boolean") {
    sets.push(`is_required = $${n++}`);
    vals.push(req.body.isRequired);
  }
  if (Number.isFinite(Number.parseInt(req.body?.sortOrder, 10))) {
    sets.push(`sort_order = $${n++}`);
    vals.push(Number.parseInt(req.body.sortOrder, 10));
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_type_roles SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Role not found." });
      return;
    }
    res.json({ role: mapRole(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update role." });
  }
}

export async function deleteProcessTypeRole(req, res) {
  const id = Number.parseInt(req.params.roleId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid role id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM process_type_roles WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Role not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete role." });
  }
}

export async function putProcessTypeRolesReorder(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  const ids = Array.isArray(req.body?.roleIds) ? req.body.roleIds : null;
  if (!Number.isFinite(templateId) || !ids) {
    res.status(400).json({ error: "templateId and roleIds required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const rid = Number.parseInt(ids[i], 10);
      if (!Number.isFinite(rid)) continue;
      await client.query(
        `UPDATE process_type_roles SET sort_order = $1 WHERE id = $2 AND template_id = $3`,
        [i, rid, templateId]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not reorder roles." });
  } finally {
    client.release();
  }
}

/* ---------- Process Role Assignments ---------- */

export async function getProcessRoleAssignments(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: proc } = await pool.query(
      `SELECT template_id FROM processes WHERE id = $1`,
      [processId]
    );
    if (!proc.length) {
      res.status(404).json({ error: "Process not found." });
      return;
    }
    const templateId = proc[0].template_id;
    const { rows: roles } = await pool.query(
      `SELECT * FROM process_type_roles WHERE template_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [templateId]
    );
    const { rows: assignments } = await pool.query(
      `SELECT a.*, u.display_name AS user_name
       FROM process_role_assignments a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.process_id = $1`,
      [processId]
    );
    res.json({
      roles: roles.map(mapRole),
      assignments: assignments.map(mapAssignment),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load role assignments." });
  }
}

export async function putProcessRoleAssignments(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  const incoming = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
  if (!Number.isFinite(processId) || !incoming) {
    res.status(400).json({ error: "processId and assignments[] required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const a of incoming) {
      const roleName = typeof a?.roleName === "string" ? a.roleName.trim() : "";
      if (!roleName) continue;
      const userId = a?.userId == null ? null : Number.parseInt(a.userId, 10);
      const { rows } = await client.query(
        `INSERT INTO process_role_assignments (process_id, role_name, user_id, assigned_by, assigned_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (process_id, role_name) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           assigned_by = EXCLUDED.assigned_by,
           assigned_at = NOW()
         RETURNING *`,
        [processId, roleName, Number.isFinite(userId) ? userId : null, req.user?.id ?? null]
      );
      results.push(rows[0]);
    }
    await client.query("COMMIT");

    const userIds = [
      ...new Set(results.map((r) => r.user_id).filter((id) => Number.isFinite(id))),
    ];
    let names = new Map();
    if (userIds.length) {
      const { rows: us } = await pool.query(
        `SELECT id, display_name FROM users WHERE id = ANY($1::int[])`,
        [userIds]
      );
      names = new Map(us.map((u) => [u.id, u.display_name]));
    }
    res.json({
      assignments: results.map((r) =>
        mapAssignment({ ...r, user_name: names.get(r.user_id) ?? null })
      ),
    });

    setImmediate(async () => {
      try {
        await logActivity(processId, {
          actionType: "role_assigned",
          description: `Role assignments updated (${results.length})`,
          metadata: { count: results.length },
          actor: req.user,
        });
        await bumpActivity(processId, { type: "role_assigned", userId: req.user?.id });
      } catch (err) {
        console.warn("[process-settings] role-assignment log failed:", err.message);
      }
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not save role assignments." });
  } finally {
    client.release();
  }
}

/* ---------- Email Templates ---------- */

export async function getEmailTemplates(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_email_templates WHERE template_id = $1
       ORDER BY name ASC, id ASC`,
      [templateId]
    );
    res.json({ templates: rows.map(mapEmailTemplate) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load email templates." });
  }
}

export async function postEmailTemplate(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isFinite(templateId) || !name) {
    res.status(400).json({ error: "templateId and name required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO process_email_templates
         (template_id, name, subject, body_html, body_text, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        templateId,
        name,
        typeof req.body?.subject === "string" ? req.body.subject : "",
        typeof req.body?.bodyHtml === "string" ? req.body.bodyHtml : "",
        typeof req.body?.bodyText === "string" ? req.body.bodyText : null,
        req.user?.id ?? null,
      ]
    );
    res.status(201).json({ template: mapEmailTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create email template." });
  }
}

export async function putEmailTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  const fields = [
    ["name", "name"],
    ["subject", "subject"],
    ["bodyHtml", "body_html"],
    ["bodyText", "body_text"],
  ];
  for (const [k, col] of fields) {
    if (typeof req.body?.[k] === "string") {
      sets.push(`${col} = $${n++}`);
      vals.push(req.body[k]);
    }
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_email_templates SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Template not found." });
      return;
    }
    res.json({ template: mapEmailTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update email template." });
  }
}

export async function deleteEmailTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM process_email_templates WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Template not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete email template." });
  }
}

/* ---------- Text Message Templates ---------- */

export async function getTextTemplates(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(templateId)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_text_templates WHERE template_id = $1
       ORDER BY name ASC, id ASC`,
      [templateId]
    );
    res.json({ templates: rows.map(mapTextTemplate) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load text templates." });
  }
}

export async function postTextTemplate(req, res) {
  const templateId = Number.parseInt(req.params.id, 10);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isFinite(templateId) || !name) {
    res.status(400).json({ error: "templateId and name required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO process_text_templates (template_id, name, body, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [templateId, name, typeof req.body?.body === "string" ? req.body.body : "", req.user?.id ?? null]
    );
    res.status(201).json({ template: mapTextTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create text template." });
  }
}

export async function putTextTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof req.body?.name === "string" && req.body.name.trim()) {
    sets.push(`name = $${n++}`);
    vals.push(req.body.name.trim());
  }
  if (typeof req.body?.body === "string") {
    sets.push(`body = $${n++}`);
    vals.push(req.body.body);
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_text_templates SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Template not found." });
      return;
    }
    res.json({ template: mapTextTemplate(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update text template." });
  }
}

export async function deleteTextTemplate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM process_text_templates WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Template not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete text template." });
  }
}

/* ---------- Activity Log ---------- */

export async function getProcessActivity(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  const pinnedOnly = req.query.pinnedOnly === "true";
  const types =
    typeof req.query.type === "string" && req.query.type
      ? req.query.type.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
  try {
    const pool = getPool();
    const wheres = ["process_id = $1"];
    const vals = [processId];
    let n = 2;
    if (pinnedOnly) wheres.push(`is_pinned = true`);
    if (types && types.length) {
      wheres.push(`action_type = ANY($${n++}::varchar[])`);
      vals.push(types);
    }
    const { rows } = await pool.query(
      `SELECT * FROM process_activity_log
       WHERE ${wheres.join(" AND ")}
       ORDER BY is_pinned DESC, created_at DESC
       LIMIT 500`,
      vals
    );
    res.json({ activity: rows.map(mapActivity) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load activity." });
  }
}

export async function postProcessActivityNote(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  if (!Number.isFinite(processId) || !description) {
    res.status(400).json({ error: "processId and description required." });
    return;
  }
  try {
    const row = await logActivity(processId, {
      actionType: "note_added",
      description,
      metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : null,
      actor: req.user,
    });
    if (!row) {
      res.status(500).json({ error: "Could not save note." });
      return;
    }
    res.status(201).json({ activity: mapActivity(row) });
    setImmediate(() => {
      bumpActivity(processId, { type: "note_added", userId: req.user?.id }).catch(() => {});
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add note." });
  }
}

export async function putProcessActivityPin(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid activity id." });
    return;
  }
  const pin = req.body?.pinned !== false;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE process_activity_log SET
         is_pinned = $1,
         pinned_by = CASE WHEN $1 THEN $2 ELSE NULL END,
         pinned_at = CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE id = $3 RETURNING *`,
      [pin, req.user?.id ?? null, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Activity item not found." });
      return;
    }
    res.json({ activity: mapActivity(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update pin." });
  }
}

/* ---------- Stage History ---------- */

export async function getProcessStageHistory(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT h.*, s.color AS stage_color
       FROM process_stage_history h
       LEFT JOIN process_template_stages s ON s.id = h.stage_id
       WHERE h.process_id = $1
       ORDER BY h.entered_at ASC, h.id ASC`,
      [processId]
    );
    res.json({ history: rows.map(mapStageHistory) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load stage history." });
  }
}

/* ---------- Communications ---------- */

export async function getProcessCommunications(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT c.*, u.display_name AS sent_by_name
       FROM process_communications c
       LEFT JOIN users u ON u.id = c.sent_by
       WHERE c.process_id = $1
       ORDER BY c.created_at DESC
       LIMIT 500`,
      [processId]
    );
    res.json({ communications: rows.map(mapCommunication) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load communications." });
  }
}

export async function postProcessCommunication(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  const channel = typeof req.body?.channel === "string" ? req.body.channel.trim() : "";
  if (!Number.isFinite(processId) || !["email", "sms", "call", "note"].includes(channel)) {
    res.status(400).json({ error: "processId and valid channel required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO process_communications
         (process_id, channel, direction, subject, body, from_address, to_address,
          status, email_template_id, text_template_id, external_id, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        processId,
        channel,
        ["inbound", "outbound"].includes(req.body?.direction) ? req.body.direction : "outbound",
        typeof req.body?.subject === "string" ? req.body.subject.slice(0, 500) : null,
        typeof req.body?.body === "string" ? req.body.body : null,
        typeof req.body?.fromAddress === "string" ? req.body.fromAddress : null,
        typeof req.body?.toAddress === "string" ? req.body.toAddress : null,
        typeof req.body?.status === "string" ? req.body.status : "sent",
        Number.isFinite(Number.parseInt(req.body?.emailTemplateId, 10))
          ? Number.parseInt(req.body.emailTemplateId, 10)
          : null,
        Number.isFinite(Number.parseInt(req.body?.textTemplateId, 10))
          ? Number.parseInt(req.body.textTemplateId, 10)
          : null,
        typeof req.body?.externalId === "string" ? req.body.externalId : null,
        req.user?.id ?? null,
      ]
    );
    res.status(201).json({ communication: mapCommunication(rows[0]) });

    setImmediate(async () => {
      try {
        await logActivity(processId, {
          actionType: channel === "email" ? "email_sent" : channel === "sms" ? "text_sent" : `${channel}_logged`,
          description:
            channel === "note"
              ? "Note logged"
              : `${channel.toUpperCase()} ${rows[0].direction || "outbound"}: ${rows[0].subject || rows[0].to_address || "(no subject)"}`,
          metadata: { communicationId: rows[0].id, channel },
          actor: req.user,
        });
        await bumpActivity(processId, { type: "communication", userId: req.user?.id });
      } catch (err) {
        console.warn("[process-settings] comm-log failed:", err.message);
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not log communication." });
  }
}

/* ---------- Attachments ---------- */

const attachStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const id = String(Number.parseInt(req.params.processId, 10) || 0);
    const dir = path.join(uploadRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const processAttachmentMiddleware = (req, res, next) => {
  multer({ storage: attachStorage, limits: { fileSize: 25 * 1024 * 1024 } }).single("file")(
    req,
    res,
    (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ error: "File too large (max 25MB)." });
          return;
        }
        res.status(400).json({ error: err.message || "Upload failed." });
        return;
      }
      next();
    }
  );
};

export async function getProcessAttachments(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT a.*, u.display_name AS uploaded_by_name
       FROM process_attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.process_id = $1
       ORDER BY a.created_at DESC`,
      [processId]
    );
    res.json({ attachments: rows.map(mapAttachment) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load attachments." });
  }
}

export async function postProcessAttachment(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId) || !req.file) {
    res.status(400).json({ error: "processId and file required." });
    return;
  }
  const rel = `/uploads/process-attachments/${processId}/${req.file.filename}`;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO process_attachments
         (process_id, filename, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        processId,
        req.file.originalname,
        rel,
        req.file.size,
        req.file.mimetype || null,
        req.user?.id ?? null,
      ]
    );
    res.status(201).json({ attachment: mapAttachment(rows[0]) });
    setImmediate(async () => {
      try {
        await logActivity(processId, {
          actionType: "file_uploaded",
          description: `File uploaded: ${req.file.originalname}`,
          metadata: { attachmentId: rows[0].id, filename: req.file.originalname },
          actor: req.user,
        });
        await bumpActivity(processId, { type: "file_uploaded", userId: req.user?.id });
      } catch (err) {
        console.warn("[process-settings] attachment log failed:", err.message);
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save attachment." });
  }
}

export async function deleteProcessAttachment(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid attachment id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `DELETE FROM process_attachments WHERE id = $1 RETURNING file_path`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const stored = rows[0].file_path;
    if (typeof stored === "string" && stored.startsWith("/uploads/process-attachments/")) {
      const abs = path.join(__dirname, "..", stored);
      fs.unlink(abs, () => {});
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete attachment." });
  }
}

/* ---------- Custom field summary (all values across process + steps) ---------- */

function pickValueRow(r) {
  const t = r.field_type;
  if (t === "boolean") return r.value_boolean;
  if (t === "date") return r.value_date;
  if (t === "datetime") return r.value_datetime;
  if (
    t === "number" ||
    t === "currency" ||
    t === "percentage" ||
    t === "rating" ||
    t === "user"
  ) {
    return r.value_number;
  }
  if (
    t === "multiselect" ||
    t === "file" ||
    t === "property" ||
    t === "address" ||
    t === "checklist"
  ) {
    return r.value_json;
  }
  return r.value_text;
}

export async function getProcessCustomFieldSummary(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    // Process-level values + step-level values, with the step they live on.
    const { rows: procValues } = await pool.query(
      `SELECT v.id, v.field_definition_id, v.entity_type, v.entity_id,
              v.value_text, v.value_number, v.value_boolean, v.value_date,
              v.value_datetime, v.value_json, v.updated_at,
              d.field_label, d.field_type, d.field_config
       FROM custom_field_values v
       JOIN custom_field_definitions d ON d.id = v.field_definition_id
       WHERE v.entity_type = 'process' AND v.entity_id = $1
       ORDER BY d.sort_order, d.id`,
      [processId]
    );
    const { rows: stepValues } = await pool.query(
      `SELECT v.id, v.field_definition_id, v.entity_type, v.entity_id AS step_id,
              v.value_text, v.value_number, v.value_boolean, v.value_date,
              v.value_datetime, v.value_json, v.updated_at,
              d.field_label, d.field_type, d.field_config,
              s.name AS step_name, s.step_number, s.status AS step_status
       FROM custom_field_values v
       JOIN custom_field_definitions d ON d.id = v.field_definition_id
       JOIN process_steps s ON s.id = v.entity_id
       WHERE v.entity_type = 'process_step' AND s.process_id = $1
       ORDER BY s.step_number, d.sort_order, d.id`,
      [processId]
    );
    const fields = [
      ...procValues.map((r) => ({
        fieldDefinitionId: r.field_definition_id,
        label: r.field_label,
        fieldType: r.field_type,
        value: pickValueRow(r),
        scope: "process",
        stepId: null,
        stepName: null,
        stepNumber: null,
        stepStatus: null,
        updatedAt: r.updated_at,
      })),
      ...stepValues.map((r) => ({
        fieldDefinitionId: r.field_definition_id,
        label: r.field_label,
        fieldType: r.field_type,
        value: pickValueRow(r),
        scope: "process_step",
        stepId: r.step_id,
        stepName: r.step_name,
        stepNumber: r.step_number,
        stepStatus: r.step_status,
        updatedAt: r.updated_at,
      })),
    ];
    res.json({ fields });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load custom field summary." });
  }
}

/* ---------- Send / preview / recipients (Phase 3) ---------- */

export async function getProcessAvailableRecipients(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    const ctx = await buildMergeContext(processId, req.user?.id ?? null, pool);
    const tenant = ctx.tenant
      ? {
          name: ctx.tenant.tenant || ctx.tenant.name || null,
          email:
            ctx.tenant.primary_tenant_email || ctx.tenant.email || null,
          phone:
            ctx.tenant.primary_tenant_phone_number ||
            ctx.tenant.phone_numbers ||
            ctx.tenant.phone ||
            null,
        }
      : null;
    const owner = ctx.owner
      ? {
          name:
            ctx.owner.owner_name ||
            ctx.owner.name ||
            ctx.process?.contact_name ||
            null,
          email: ctx.owner.email || ctx.process?.contact_email || null,
          phone:
            ctx.owner.phone || ctx.owner.phone_number || ctx.process?.contact_phone || null,
        }
      : ctx.process?.contact_name
      ? {
          name: ctx.process.contact_name,
          email: ctx.process.contact_email || null,
          phone: ctx.process.contact_phone || null,
        }
      : null;

    const { rows: roles } = await pool.query(
      `SELECT a.role_name, u.id AS user_id, u.display_name, u.username,
              ec.mailbox_email
       FROM process_role_assignments a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN email_connections ec ON ec.user_id = a.user_id AND ec.is_active = true
       WHERE a.process_id = $1
       ORDER BY a.role_name`,
      [processId]
    );

    res.json({
      tenant,
      owner,
      roles: roles.map((r) => ({
        role: r.role_name,
        userId: r.user_id,
        name: r.display_name || r.username || null,
        email: r.mailbox_email || null,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load recipients." });
  }
}

export async function postProcessSendEmail(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  const templateId =
    req.body?.templateId == null ? null : Number.parseInt(req.body.templateId, 10);
  const recipientType =
    typeof req.body?.recipientType === "string" ? req.body.recipientType : null;
  let to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  if (!to && recipientType) {
    const r = await resolveRecipient({
      processId,
      recipientType,
      recipientValue:
        typeof req.body?.recipientValue === "string" ? req.body.recipientValue : null,
    });
    to = r.email || "";
  }
  if (!to) {
    res.status(400).json({ error: "Recipient email is required." });
    return;
  }
  try {
    const result = await sendProcessEmail({
      processId,
      templateId: Number.isFinite(templateId) ? templateId : null,
      to,
      toName: typeof req.body?.toName === "string" ? req.body.toName : null,
      subject: typeof req.body?.subject === "string" ? req.body.subject : "",
      body: typeof req.body?.body === "string" ? req.body.body : "",
      senderId: req.user?.id ?? null,
    });
    res.status(201).json({
      success: true,
      communicationId: result.communication.id,
      resolvedSubject: result.resolvedSubject,
    });
  } catch (e) {
    const status = e.code === "NO_EMAIL_CONNECTION" ? 503 : 500;
    console.error("[send-email]", e.message);
    res.status(status).json({ error: e.message || "Could not send email." });
  }
}

export async function postProcessSendText(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  const templateId =
    req.body?.templateId == null ? null : Number.parseInt(req.body.templateId, 10);
  const recipientType =
    typeof req.body?.recipientType === "string" ? req.body.recipientType : null;
  let to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  if (!to && recipientType) {
    const r = await resolveRecipient({
      processId,
      recipientType,
      recipientValue:
        typeof req.body?.recipientValue === "string" ? req.body.recipientValue : null,
    });
    to = r.phone || "";
  }
  if (!to) {
    res.status(400).json({ error: "Recipient phone is required." });
    return;
  }
  try {
    const result = await sendProcessSMS({
      processId,
      templateId: Number.isFinite(templateId) ? templateId : null,
      to,
      body: typeof req.body?.body === "string" ? req.body.body : "",
      senderId: req.user?.id ?? null,
    });
    res.status(201).json({
      success: true,
      communicationId: result.communication.id,
      resolvedBody: result.resolvedBody,
    });
  } catch (e) {
    const status = e.code === "OPENPHONE_NOT_CONFIGURED" ? 503 : 500;
    console.error("[send-text]", e.message);
    res.status(status).json({ error: e.message || "Could not send text." });
  }
}

export async function postProcessTemplatePreview(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  const templateId =
    req.body?.templateId == null ? null : Number.parseInt(req.body.templateId, 10);
  const templateType = req.body?.templateType === "text" ? "text" : "email";
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  try {
    const pool = getPool();
    let subject = typeof req.body?.subject === "string" ? req.body.subject : "";
    let body = typeof req.body?.body === "string" ? req.body.body : "";
    if (Number.isFinite(templateId)) {
      if (templateType === "email") {
        const { rows } = await pool.query(
          `SELECT subject, body_html FROM process_email_templates WHERE id = $1`,
          [templateId]
        );
        if (!rows.length) {
          res.status(404).json({ error: "Template not found." });
          return;
        }
        subject = rows[0].subject || "";
        body = rows[0].body_html || "";
      } else {
        const { rows } = await pool.query(
          `SELECT body FROM process_text_templates WHERE id = $1`,
          [templateId]
        );
        if (!rows.length) {
          res.status(404).json({ error: "Template not found." });
          return;
        }
        body = rows[0].body || "";
      }
    }
    const ctx = await buildMergeContext(processId, req.user?.id ?? null, pool);
    res.json({
      resolvedSubject: applyMergeContext(subject, ctx),
      resolvedBody: applyMergeContext(body, ctx),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not render preview." });
  }
}

/* ---------- AI Suggestions ---------- */

export async function getProcessSuggestions(req, res) {
  const processId = Number.parseInt(req.params.processId, 10);
  if (!Number.isFinite(processId)) {
    res.status(400).json({ error: "Invalid process id." });
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM process_ai_suggestions
       WHERE process_id = $1 AND status = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [processId, status]
    );
    res.json({ suggestions: rows.map(mapSuggestion) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load suggestions." });
  }
}

async function respondToSuggestion(id, status, userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE process_ai_suggestions SET
       status = $1, responded_by = $2, responded_at = NOW()
     WHERE id = $3 RETURNING *`,
    [status, userId, id]
  );
  return rows[0];
}

export async function putProcessSuggestionAccept(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid suggestion id." });
    return;
  }
  try {
    const row = await respondToSuggestion(id, "accepted", req.user?.id ?? null);
    if (!row) {
      res.status(404).json({ error: "Suggestion not found." });
      return;
    }
    let actionResult = { action: "no_action" };
    try {
      actionResult = await executeSuggestion(id, req.user?.id ?? null);
    } catch (err) {
      console.warn("[ai-suggestions] execute on accept failed:", err.message);
      actionResult = { action: "error", error: err.message || String(err) };
    }
    res.json({ suggestion: mapSuggestion(row), ...actionResult });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not accept suggestion." });
  }
}

/* ---------- AI suggestions: pending feed, stats, analyze-now ---------- */

export async function getPendingSuggestionsFeed(req, res) {
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 30)
  );
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "newest";
  try {
    const pool = getPool();
    const wheres = ["s.status = 'pending'"];
    const params = [];
    let n = 1;
    if (type && type !== "all") {
      wheres.push(`s.suggestion_type = $${n++}`);
      params.push(type);
    }
    const orderBy =
      sort === "confidence"
        ? "s.confidence DESC NULLS LAST, s.created_at DESC"
        : sort === "overdue"
        ? "p.target_completion ASC NULLS LAST, s.created_at DESC"
        : "s.created_at DESC";
    params.push(limit, offset);
    const limitIdx = n;
    const offsetIdx = n + 1;
    const { rows } = await pool.query(
      `SELECT s.*, p.name AS process_name, p.property_name, p.target_completion,
              p.template_id, t.name AS template_name, t.icon AS template_icon,
              cs.name AS stage_name
       FROM process_ai_suggestions s
       JOIN processes p ON p.id = s.process_id
       LEFT JOIN process_templates t ON t.id = p.template_id
       LEFT JOIN process_template_stages cs ON cs.id = p.current_stage_id
       WHERE ${wheres.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );
    res.json({
      suggestions: rows.map((r) => ({
        ...mapSuggestion(r),
        processName: r.process_name,
        propertyName: r.property_name,
        templateId: r.template_id,
        templateName: r.template_name,
        templateIcon: r.template_icon,
        stageName: r.stage_name,
        targetCompletion: r.target_completion,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load pending suggestions." });
  }
}

export async function getSuggestionsStats(_req, res) {
  try {
    const stats = await getSuggestionStats();
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load suggestion stats." });
  }
}

export async function postSuggestionsAnalyzeNow(_req, res) {
  try {
    const result = await runAIAnalysis({ force: true });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Analysis failed." });
  }
}

/**
 * Returns the count of pending suggestions per process for a list of process
 * ids. Used by the board view to draw the sparkle indicator without making
 * one request per card.
 */
export async function getSuggestionCountsByProcess(req, res) {
  const ids = (typeof req.query.processIds === "string" ? req.query.processIds : "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  if (!ids.length) {
    res.json({ counts: {} });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT process_id, COUNT(*)::int AS c
       FROM process_ai_suggestions
       WHERE status = 'pending' AND process_id = ANY($1::int[])
       GROUP BY process_id`,
      [ids]
    );
    const counts = {};
    for (const r of rows) counts[r.process_id] = r.c;
    res.json({ counts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load suggestion counts." });
  }
}

export async function putProcessSuggestionDismiss(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid suggestion id." });
    return;
  }
  try {
    const row = await respondToSuggestion(id, "dismissed", req.user?.id ?? null);
    if (!row) {
      res.status(404).json({ error: "Suggestion not found." });
      return;
    }
    res.json({ suggestion: mapSuggestion(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not dismiss suggestion." });
  }
}
