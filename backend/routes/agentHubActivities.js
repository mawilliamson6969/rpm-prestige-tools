/**
 * Phase 1 Agent Hub: activities (timeline) + attachments.
 *
 * Edit window: an activity can be edited within 24 hours of creation by the
 * user who created it, or anytime by an owner/manager. After 24h the activity
 * is effectively immutable for non-managers — the timeline is a record of
 * what happened, not a wiki.
 *
 * Soft delete only. Setting deleted_at hides the row from the timeline but
 * keeps it in the DB for audit. Permanent deletion happens via a future
 * retention job (out of scope for Phase 1).
 *
 * Bumping last_interaction_date on the agent record happens via DB trigger
 * (see migration). Don't replicate that logic here.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import multer from "multer";

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor } from "../lib/agentHub/permissions.js";
import { clearAgentHubDashboardCache } from "./agentHubDashboard.js";
import { mapActivity, mapAttachment } from "../lib/agentHub/mappers.js";
import {
  vActivityType,
  vDirection,
  vIntId,
  vStringOpt,
  vTimestamp,
} from "../lib/agentHub/validators.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Stored OUTSIDE the static-served `uploads/` tree. Backend-only; download
// must go through the auth-gated /agent-hub/attachments/:id/download route.
const ATTACH_ROOT = path.join(__dirname, "..", "uploads-private", "agent-hub");
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB per file

async function ensureAttachRoot() {
  await fs.mkdir(ATTACH_ROOT, { recursive: true });
}

const attachStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureAttachRoot();
      cb(null, ATTACH_ROOT);
    } catch (e) {
      cb(e);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const uploadActivityAttachmentMiddleware = multer({
  storage: attachStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 },
}).array("files", 10);

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

async function loadAgentForOps(pool, agentId, perms) {
  const allowedIds = allowedAgentIdsFor(perms);
  if (allowedIds && !allowedIds.includes(agentId)) {
    throw Object.assign(new Error("Not authorized to access this agent."), { http: 403 });
  }
  const { rows } = await pool.query(
    `SELECT id, status FROM agent_hub_agents WHERE id = $1`,
    [agentId]
  );
  if (!rows.length) {
    throw Object.assign(new Error("Agent not found."), { http: 404 });
  }
  return rows[0];
}

// ============================================================
// LIST activities for an agent
// ============================================================
export async function listAgentHubActivities(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const pool = getPool();
    await loadAgentForOps(pool, agentId, req.agentHubPerms);

    const filters = [`a.agent_id = $1`, `a.deleted_at IS NULL`];
    const params = [agentId];
    let p = 2;
    if (req.query.type) {
      filters.push(`a.type = $${p++}`);
      params.push(String(req.query.type));
    }
    if (req.query.direction) {
      filters.push(`a.direction = $${p++}`);
      params.push(String(req.query.direction));
    }
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;

    const where = filters.join(" AND ");
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agent_hub_activities a WHERE ${where}`,
      params
    );

    const { rows } = await pool.query(
      `SELECT a.*,
              COALESCE(json_agg(json_build_object(
                'id', att.id,
                'activity_id', att.activity_id,
                'filename', att.filename,
                'file_url', att.file_url,
                'file_type', att.file_type,
                'file_size_bytes', att.file_size_bytes,
                'uploaded_at', att.uploaded_at,
                'uploaded_by', att.uploaded_by
              ) ORDER BY att.uploaded_at)
              FILTER (WHERE att.id IS NOT NULL), '[]'::json) AS attachments
         FROM agent_hub_activities a
         LEFT JOIN agent_hub_activity_attachments att ON att.activity_id = a.id
        WHERE ${where}
        GROUP BY a.id
        ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT $${p++} OFFSET $${p++}`,
      [...params, perPage, offset]
    );
    res.json({
      activities: rows.map(mapActivity),
      total: countRows[0].total,
      page,
      per_page: perPage,
    });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] activities list", e);
    res.status(500).json({ error: "Could not load activities." });
  }
}

// ============================================================
// CREATE activity
// ============================================================
export async function createAgentHubActivity(req, res) {
  try {
    const agentId = vIntId(req.params.id, "agent id");
    const pool = getPool();
    const agent = await loadAgentForOps(pool, agentId, req.agentHubPerms);
    if (agent.status === "deleted") {
      res.status(409).json({ error: "Cannot log activity on a deleted agent." });
      return;
    }

    const body = req.body ?? {};
    const type = vActivityType(body.type);
    const direction = vDirection(body.direction);
    const subject = vStringOpt(body.subject, { maxLen: 500 });
    const summary = vStringOpt(body.summary, { maxLen: 5000 });
    const activityBody = vStringOpt(body.body, { maxLen: 200000 });
    const externalId = vStringOpt(body.external_id, { maxLen: 500 });
    const occurredAt = body.occurred_at
      ? vTimestamp(body.occurred_at, "occurred_at")
      : new Date().toISOString();
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

    let row;
    try {
      const { rows } = await pool.query(
        `INSERT INTO agent_hub_activities
           (agent_id, type, direction, subject, summary, body,
            external_id, metadata, occurred_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz,$10,$10)
         RETURNING *`,
        [
          agentId,
          type,
          direction,
          subject,
          summary,
          activityBody,
          externalId,
          JSON.stringify(metadata),
          occurredAt,
          req.user.id,
        ]
      );
      row = rows[0];
    } catch (e) {
      if (e.code === "23505") {
        // external_id collision — idempotent: return the existing row.
        const { rows } = await pool.query(
          `SELECT * FROM agent_hub_activities WHERE external_id = $1`,
          [externalId]
        );
        if (rows.length) {
          res.status(200).json({ activity: mapActivity(rows[0]), idempotent: true });
          return;
        }
      }
      throw e;
    }

    // Attach uploaded files (multer added them to req.files).
    // disk_basename is the on-disk filename (random UUID + extension) and lives
    // in uploads-private/agent-hub/, OUTSIDE the static-served `/uploads` tree.
    // file_url is an auth-gated download route — clients NEVER access disk paths directly.
    const files = Array.isArray(req.files) ? req.files : [];
    const attachments = [];
    for (const f of files) {
      const diskBasename = path.basename(f.path);
      const { rows: inserted } = await pool.query(
        `INSERT INTO agent_hub_activity_attachments
           (activity_id, filename, file_url, disk_basename, file_type, file_size_bytes, uploaded_by)
         VALUES ($1, $2, '', $3, $4, $5, $6)
         RETURNING id`,
        [row.id, f.originalname || f.filename, diskBasename, f.mimetype || null, f.size || null, req.user.id]
      );
      const downloadUrl = `/agent-hub/attachments/${inserted[0].id}/download`;
      const { rows: finalRows } = await pool.query(
        `UPDATE agent_hub_activity_attachments SET file_url = $1 WHERE id = $2 RETURNING *`,
        [downloadUrl, inserted[0].id]
      );
      attachments.push(mapAttachment(finalRows[0]));
    }

    await logAudit(req, {
      entity_type: "activity",
      entity_id: row.id,
      action: "create",
      new_value: { type, direction, subject: subject ?? null, agent_id: agentId },
    });
    clearAgentHubDashboardCache();

    res.status(201).json({ activity: { ...mapActivity(row), attachments } });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] activity create", e);
    res.status(500).json({ error: "Could not log activity." });
  }
}

// ============================================================
// UPDATE activity (24h window or manager+)
// ============================================================
export async function updateAgentHubActivity(req, res) {
  try {
    const id = vIntId(req.params.id, "activity id");
    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT * FROM agent_hub_activities WHERE id = $1`,
      [id]
    );
    if (!existing.length) {
      res.status(404).json({ error: "Activity not found." });
      return;
    }
    const old = existing[0];
    if (old.deleted_at) {
      res.status(409).json({ error: "Activity is deleted." });
      return;
    }

    // Edit-window check: only the creator within 24h, or any manager+.
    const isManager =
      req.agentHubPerms.role === "owner" || req.agentHubPerms.role === "manager";
    const isCreator = old.created_by === req.user.id;
    const ageMs = Date.now() - new Date(old.created_at).getTime();
    const withinWindow = ageMs < EDIT_WINDOW_MS;
    if (!(isManager || (isCreator && withinWindow))) {
      res.status(403).json({
        error: "Edit window expired. Only the original author within 24h, or a manager, can edit this.",
      });
      return;
    }

    const body = req.body ?? {};
    const updates = {};
    if (body.subject !== undefined) updates.subject = vStringOpt(body.subject, { maxLen: 500 });
    if (body.summary !== undefined) updates.summary = vStringOpt(body.summary, { maxLen: 5000 });
    if (body.body !== undefined) updates.body = vStringOpt(body.body, { maxLen: 200000 });
    if (body.metadata !== undefined && typeof body.metadata === "object") {
      updates.metadata = body.metadata;
    }
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }

    const cols = Object.keys(updates);
    const sets = [];
    const vals = [];
    let n = 1;
    for (const k of cols) {
      if (k === "metadata") {
        sets.push(`${k} = $${n}::jsonb`);
        vals.push(JSON.stringify(updates[k]));
      } else {
        sets.push(`${k} = $${n}`);
        vals.push(updates[k]);
      }
      n++;
    }
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(id);

    const { rows } = await pool.query(
      `UPDATE agent_hub_activities SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "activity", id, old, rows[0], cols);
    res.json({ activity: mapActivity(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] activity update", e);
    res.status(500).json({ error: "Could not update activity." });
  }
}

// ============================================================
// DOWNLOAD attachment (auth-gated; never via static)
// ============================================================
export async function downloadAgentHubAttachment(req, res) {
  try {
    const id = vIntId(req.params.id, "attachment id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT att.*, act.agent_id, act.deleted_at
         FROM agent_hub_activity_attachments att
         JOIN agent_hub_activities act ON act.id = att.activity_id
        WHERE att.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const att = rows[0];
    if (att.deleted_at) {
      res.status(404).json({ error: "Activity is deleted." });
      return;
    }
    // Outreach role: confirm agent_id is in their allowed list.
    const allowedIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedIds && !allowedIds.includes(att.agent_id)) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    if (!att.disk_basename) {
      res.status(500).json({ error: "Attachment has no on-disk reference (legacy row?)." });
      return;
    }
    const filePath = path.resolve(ATTACH_ROOT, att.disk_basename);
    // Defense-in-depth: verify the resolved path is still inside ATTACH_ROOT
    // (multer's filename function uses random UUIDs so this should always pass,
    // but we guard against any future code that takes user input here).
    if (!filePath.startsWith(path.resolve(ATTACH_ROOT) + path.sep)) {
      res.status(400).json({ error: "Invalid attachment path." });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="${att.filename.replace(/"/g, '')}"`);
    if (att.file_type) res.setHeader("Content-Type", att.file_type);
    // Default to attachment disposition (never inline) so SVG / HTML uploads
    // can't render scripts in the user's session.
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        console.error("[agent-hub] attachment send", err);
        res.status(500).json({ error: "Could not send file." });
      }
    });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] attachment download", e);
    res.status(500).json({ error: "Could not download attachment." });
  }
}

// ============================================================
// DELETE activity (soft)
// ============================================================
export async function deleteAgentHubActivity(req, res) {
  try {
    const id = vIntId(req.params.id, "activity id");
    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT * FROM agent_hub_activities WHERE id = $1`,
      [id]
    );
    if (!existing.length) {
      res.status(404).json({ error: "Activity not found." });
      return;
    }
    const old = existing[0];
    if (old.deleted_at) {
      res.json({ ok: true, idempotent: true });
      return;
    }
    // Same gate as edit
    const isManager =
      req.agentHubPerms.role === "owner" || req.agentHubPerms.role === "manager";
    const isCreator = old.created_by === req.user.id;
    const ageMs = Date.now() - new Date(old.created_at).getTime();
    const withinWindow = ageMs < EDIT_WINDOW_MS;
    if (!(isManager || (isCreator && withinWindow))) {
      res.status(403).json({ error: "Only the original author (within 24h) or a manager can delete." });
      return;
    }
    await pool.query(
      `UPDATE agent_hub_activities
          SET deleted_at = NOW(),
              deleted_by = $2,
              updated_by = $2
        WHERE id = $1`,
      [id, req.user.id]
    );
    await logAudit(req, {
      entity_type: "activity",
      entity_id: id,
      action: "delete",
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] activity delete", e);
    res.status(500).json({ error: "Could not delete activity." });
  }
}
