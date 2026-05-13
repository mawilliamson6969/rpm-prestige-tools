/**
 * Monday-style boards: subitem templates (reusable step definitions
 * with structured instructions).
 *
 * The `instructions` JSONB is loosely validated at this layer — the
 * schema is documented in /frontend/types/mb.ts (Instructions). Phase 1
 * accepts whatever the caller sends; Phase 2 can tighten validation
 * once we know the exact authoring flow.
 */

import { getPool } from "../lib/db.js";
import {
  vIntId,
  vStringReq,
  vStringOpt,
  vIntOpt,
  vBool,
  vJson,
} from "../lib/mb/validators.js";

export async function listSubitemTemplates(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM mb_subitem_templates
         WHERE board_id = $1
         ORDER BY position ASC, id ASC`,
      [boardId]
    );
    res.json({ templates: rows });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] templates list", e);
    res.status(500).json({ error: "Could not load templates." });
  }
}

export async function createSubitemTemplate(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const body = req.body ?? {};
    const name = vStringReq(body.name, "name", { maxLen: 200 });
    const description = vStringOpt(body.description, { maxLen: 5000 });
    const position = vIntOpt(body.position, "position", { min: 0 }) ?? 0;
    const defaultAssigneeRole = vStringOpt(body.default_assignee_role, {
      maxLen: 64,
    });
    const defaultDueOffsetDays = vIntOpt(
      body.default_due_offset_days,
      "default_due_offset_days",
      { min: -3650, max: 3650 }
    );
    const estimatedMinutes = vIntOpt(body.estimated_minutes, "estimated_minutes", {
      min: 0,
      max: 100000,
    });
    const isAutomated = vBool(body.is_automated, { allowNull: true }) ?? false;
    const instructions =
      body.instructions == null
        ? {}
        : vJson(body.instructions, "instructions", { requireObject: true });
    const escalationTriggers =
      body.escalation_triggers == null
        ? []
        : vJson(body.escalation_triggers, "escalation_triggers");
    const completionChecklist =
      body.completion_checklist == null
        ? []
        : vJson(body.completion_checklist, "completion_checklist");

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO mb_subitem_templates
         (board_id, name, description, position, default_assignee_role,
          default_due_offset_days, estimated_minutes, is_automated,
          instructions, escalation_triggers, completion_checklist)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)
       RETURNING *`,
      [
        boardId,
        name,
        description,
        position,
        defaultAssigneeRole,
        defaultDueOffsetDays,
        estimatedMinutes,
        isAutomated,
        JSON.stringify(instructions),
        JSON.stringify(escalationTriggers),
        JSON.stringify(completionChecklist),
      ]
    );
    res.status(201).json({ template: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23503") {
      return res.status(404).json({ error: "Board not found." });
    }
    console.error("[mb] template create", e);
    res.status(500).json({ error: "Could not create template." });
  }
}

export async function updateSubitemTemplate(req, res) {
  try {
    const id = vIntId(req.params.id, "template id");
    const body = req.body ?? {};
    const jsonFields = new Set([
      "instructions",
      "escalation_triggers",
      "completion_checklist",
    ]);

    const allowed = {
      name: (v) => vStringReq(v, "name", { maxLen: 200 }),
      description: (v) => vStringOpt(v, { maxLen: 5000 }),
      position: (v) => vIntOpt(v, "position", { min: 0 }),
      default_assignee_role: (v) => vStringOpt(v, { maxLen: 64 }),
      default_due_offset_days: (v) =>
        vIntOpt(v, "default_due_offset_days", { min: -3650, max: 3650 }),
      estimated_minutes: (v) =>
        vIntOpt(v, "estimated_minutes", { min: 0, max: 100000 }),
      is_automated: (v) => vBool(v, { allowNull: false }),
      instructions: (v) =>
        v == null ? {} : vJson(v, "instructions", { requireObject: true }),
      escalation_triggers: (v) =>
        v == null ? [] : vJson(v, "escalation_triggers"),
      completion_checklist: (v) =>
        v == null ? [] : vJson(v, "completion_checklist"),
    };

    const sets = [];
    const vals = [];
    let n = 1;
    for (const [k, fn] of Object.entries(allowed)) {
      if (body[k] === undefined) continue;
      const val = fn(body[k]);
      if (jsonFields.has(k)) {
        sets.push(`${k} = $${n++}::jsonb`);
        vals.push(JSON.stringify(val));
      } else {
        sets.push(`${k} = $${n++}`);
        vals.push(val);
      }
    }
    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }
    sets.push(`updated_at = NOW()`);
    vals.push(id);

    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE mb_subitem_templates SET ${sets.join(", ")}
         WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Template not found." });
    res.json({ template: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] template update", e);
    res.status(500).json({ error: "Could not update template." });
  }
}

export async function deleteSubitemTemplate(req, res) {
  try {
    const id = vIntId(req.params.id, "template id");
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM mb_subitem_templates WHERE id = $1`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "Template not found." });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] template delete", e);
    res.status(500).json({ error: "Could not delete template." });
  }
}
