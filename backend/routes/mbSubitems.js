/**
 * Monday-style boards: subitem CRUD (the tasks within an item).
 */

import { getPool } from "../lib/db.js";
import {
  vIntId,
  vIntIdOpt,
  vIntOpt,
  vStringReq,
  vNumOpt,
  vSubitemStatus,
  vTimestampOpt,
  vBool,
} from "../lib/mb/validators.js";

export async function listSubitems(req, res) {
  try {
    const itemId = vIntId(req.params.itemId, "item id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM mb_subitems
         WHERE item_id = $1
         ORDER BY position ASC, id ASC`,
      [itemId]
    );
    res.json({ subitems: rows });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] subitems list", e);
    res.status(500).json({ error: "Could not load subitems." });
  }
}

export async function createSubitem(req, res) {
  try {
    const itemId = vIntId(req.params.itemId, "item id");
    const body = req.body ?? {};
    const title = vStringReq(body.title, "title", { maxLen: 500 });
    const status = vSubitemStatus(body.status, { allowNull: true }) || "pending";
    const assignedTo = vIntIdOpt(body.assigned_to, "assigned_to");
    const dueDate = vTimestampOpt(body.due_date, "due_date");
    const estimatedMinutes = vIntOpt(body.estimated_minutes, "estimated_minutes", {
      min: 0,
      max: 100000,
    });
    const isAutomated = vBool(body.is_automated, { allowNull: true }) ?? false;
    const templateId = vIntIdOpt(body.template_id, "template_id");

    const pool = getPool();
    let position = vNumOpt(body.position, "position");
    if (position == null) {
      const { rows: max } = await pool.query(
        `SELECT COALESCE(MAX(position), 0) AS m FROM mb_subitems WHERE item_id = $1`,
        [itemId]
      );
      position = Number(max[0].m) + 1024;
    }

    const { rows } = await pool.query(
      `INSERT INTO mb_subitems
         (item_id, title, position, status, assigned_to,
          due_date, estimated_minutes, is_automated, template_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        itemId,
        title,
        position,
        status,
        assignedTo,
        dueDate,
        estimatedMinutes,
        isAutomated,
        templateId,
      ]
    );
    res.status(201).json({ subitem: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23503") {
      return res.status(404).json({ error: "Item or template not found." });
    }
    console.error("[mb] subitem create", e);
    res.status(500).json({ error: "Could not create subitem." });
  }
}

export async function updateSubitem(req, res) {
  try {
    const id = vIntId(req.params.id, "subitem id");
    const body = req.body ?? {};

    const allowed = {
      title: (v) => vStringReq(v, "title", { maxLen: 500 }),
      position: (v) => vNumOpt(v, "position"),
      status: (v) => vSubitemStatus(v, { allowNull: false }),
      assigned_to: (v) => vIntIdOpt(v, "assigned_to"),
      due_date: (v) => vTimestampOpt(v, "due_date"),
      completed_at: (v) => vTimestampOpt(v, "completed_at"),
      estimated_minutes: (v) =>
        vIntOpt(v, "estimated_minutes", { min: 0, max: 100000 }),
      is_automated: (v) => vBool(v, { allowNull: false }),
      template_id: (v) => vIntIdOpt(v, "template_id"),
    };

    const sets = [];
    const vals = [];
    let n = 1;
    for (const [k, fn] of Object.entries(allowed)) {
      if (body[k] !== undefined) {
        sets.push(`${k} = $${n++}`);
        vals.push(fn(body[k]));
      }
    }

    // Auto-stamp completed_at when status flips to 'done' and caller
    // didn't pass one explicitly.
    if (
      body.status === "done" &&
      body.completed_at === undefined &&
      !sets.includes("completed_at")
    ) {
      sets.push(`completed_at = NOW()`);
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }
    sets.push(`updated_at = NOW()`);
    vals.push(id);

    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE mb_subitems SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Subitem not found." });
    res.json({ subitem: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] subitem update", e);
    res.status(500).json({ error: "Could not update subitem." });
  }
}

export async function deleteSubitem(req, res) {
  try {
    const id = vIntId(req.params.id, "subitem id");
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM mb_subitems WHERE id = $1`, [
      id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Subitem not found." });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] subitem delete", e);
    res.status(500).json({ error: "Could not delete subitem." });
  }
}
