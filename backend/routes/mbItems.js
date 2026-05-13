/**
 * Monday-style boards: item CRUD (the "rows" on a board).
 */

import { getPool } from "../lib/db.js";
import {
  vIntId,
  vIntIdOpt,
  vStringReq,
  vNumOpt,
  vJson,
  vStringOpt,
} from "../lib/mb/validators.js";
import { recordValueChangeSystemEvents } from "./mbItemDetail.js";

/**
 * GET /mb/boards/:boardId/items
 *
 * Query params:
 *   group_id     — filter to one group
 *   status       — filter by item.values.status (if present)
 *   archived     — "true" includes archived; default false
 *   sort_by      — position | created_at | updated_at | title
 *   sort_dir     — asc | desc
 *   limit, offset
 */
export async function listItems(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const pool = getPool();

    const filters = [`board_id = $1`];
    const vals = [boardId];
    let n = 2;

    if (req.query.archived !== "true") {
      filters.push(`archived_at IS NULL`);
    }
    if (req.query.group_id !== undefined && req.query.group_id !== "") {
      filters.push(`group_id = $${n++}`);
      vals.push(vIntId(req.query.group_id, "group_id"));
    }
    if (req.query.status) {
      filters.push(`values ->> 'status' = $${n++}`);
      vals.push(String(req.query.status));
    }

    const sortable = new Set(["position", "created_at", "updated_at", "title"]);
    const sortBy = sortable.has(String(req.query.sort_by))
      ? String(req.query.sort_by)
      : "position";
    const sortDir = req.query.sort_dir === "desc" ? "DESC" : "ASC";

    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows } = await pool.query(
      `SELECT * FROM mb_items
         WHERE ${filters.join(" AND ")}
         ORDER BY ${sortBy} ${sortDir}, id ASC
         LIMIT ${limit} OFFSET ${offset}`,
      vals
    );
    res.json({ items: rows, limit, offset });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] items list", e);
    res.status(500).json({ error: "Could not load items." });
  }
}

export async function createItem(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const body = req.body ?? {};
    const title = vStringReq(body.title, "title", { maxLen: 500 });
    const groupId = vIntIdOpt(body.group_id, "group_id");
    const assignedTo = vIntIdOpt(body.assigned_to, "assigned_to");
    const appfolioId = vStringOpt(body.appfolio_id, { maxLen: 64 });
    const appfolioResourceType = vStringOpt(body.appfolio_resource_type, {
      maxLen: 64,
    });
    const values = body.values == null ? {} : vJson(body.values, "values", { requireObject: true });

    const pool = getPool();
    // Default position = max(position) + 1024 within the board (or group).
    // The increment leaves room for fractional inserts on later drag-drop.
    let position = vNumOpt(body.position, "position");
    if (position == null) {
      const scope = groupId == null ? "AND group_id IS NULL" : "AND group_id = $2";
      const params = groupId == null ? [boardId] : [boardId, groupId];
      const { rows: max } = await pool.query(
        `SELECT COALESCE(MAX(position), 0) AS m
           FROM mb_items WHERE board_id = $1 ${scope}`,
        params
      );
      position = Number(max[0].m) + 1024;
    }

    const { rows } = await pool.query(
      `INSERT INTO mb_items
         (board_id, title, position, group_id, values,
          appfolio_id, appfolio_resource_type, created_by, assigned_to)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
       RETURNING *`,
      [
        boardId,
        title,
        position,
        groupId,
        JSON.stringify(values),
        appfolioId,
        appfolioResourceType,
        req.user.id,
        assignedTo,
      ]
    );
    res.status(201).json({ item: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23503") {
      return res.status(404).json({ error: "Board not found." });
    }
    console.error("[mb] item create", e);
    res.status(500).json({ error: "Could not create item." });
  }
}

export async function getItem(req, res) {
  try {
    const id = vIntId(req.params.id, "item id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM mb_items WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Item not found." });

    const { rows: subitems } = await pool.query(
      `SELECT * FROM mb_subitems WHERE item_id = $1 ORDER BY position ASC, id ASC`,
      [id]
    );
    res.json({ item: rows[0], subitems });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] item get", e);
    res.status(500).json({ error: "Could not load item." });
  }
}

export async function updateItem(req, res) {
  try {
    const id = vIntId(req.params.id, "item id");
    const body = req.body ?? {};

    const allowed = {
      title: (v) => vStringReq(v, "title", { maxLen: 500 }),
      position: (v) => vNumOpt(v, "position"),
      group_id: (v) => vIntIdOpt(v, "group_id"),
      assigned_to: (v) => vIntIdOpt(v, "assigned_to"),
      values: (v) =>
        v == null ? {} : vJson(v, "values", { requireObject: true }),
      appfolio_id: (v) => vStringOpt(v, { maxLen: 64 }),
      appfolio_resource_type: (v) => vStringOpt(v, { maxLen: 64 }),
      completed_at: (v) => (v == null ? null : new Date(v).toISOString()),
    };

    const sets = [];
    const vals = [];
    let n = 1;
    for (const [k, fn] of Object.entries(allowed)) {
      if (body[k] !== undefined) {
        const val = fn(body[k]);
        if (k === "values") {
          sets.push(`values = $${n++}::jsonb`);
          vals.push(JSON.stringify(val));
        } else {
          sets.push(`${k} = $${n++}`);
          vals.push(val);
        }
      }
    }
    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }
    sets.push(`updated_at = NOW()`);
    vals.push(id);

    const pool = getPool();

    // Phase 4: snapshot the BEFORE values so we can diff and emit
    // system-event entries for the updates feed. We only do this when
    // the caller is touching `values` — title/position/group_id changes
    // are intentionally not logged (they're noise; can revisit later).
    let beforeValues = null;
    if (body.values !== undefined) {
      const { rows: prev } = await pool.query(
        `SELECT values FROM mb_items WHERE id = $1`,
        [id]
      );
      beforeValues = prev[0]?.values ?? {};
    }

    const { rows } = await pool.query(
      `UPDATE mb_items SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Item not found." });

    if (beforeValues != null) {
      const afterValues = rows[0].values ?? {};
      const changedKeys = new Set([
        ...Object.keys(beforeValues),
        ...Object.keys(afterValues),
      ]);
      const changes = [];
      for (const k of changedKeys) {
        const before = beforeValues[k];
        const after = afterValues[k];
        if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue;
        changes.push({ key: k, before, after });
      }
      if (changes.length > 0) {
        // Fetch column meta so the system entry can render with human names.
        const { rows: cols } = await pool.query(
          `SELECT key, name, column_type, config
             FROM mb_board_columns
            WHERE board_id = $1`,
          [rows[0].board_id]
        );
        // For status columns, resolve option value → label so the entry
        // reads "Status: Not Started → In Progress" instead of raw values.
        const colByKey = new Map(cols.map((c) => [c.key, c]));
        const resolved = changes.map((ch) => {
          const c = colByKey.get(ch.key);
          if (c && (c.column_type === "status" || c.column_type === "dropdown")) {
            const cfg = typeof c.config === "string" ? JSON.parse(c.config) : c.config || {};
            const options = Array.isArray(cfg.options) ? cfg.options : [];
            const label = (v) =>
              options.find((o) => String(o.value) === String(v))?.label ?? v;
            return { ...ch, before: label(ch.before), after: label(ch.after) };
          }
          return ch;
        });
        // Fire and forget — don't block the response on logging.
        recordValueChangeSystemEvents({
          pool,
          itemId: id,
          userId: req.user.id,
          changes: resolved,
          columns: cols,
        }).catch((e) =>
          console.error("[mb] record value-change system events failed:", e.message)
        );
      }
    }

    res.json({ item: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] item update", e);
    res.status(500).json({ error: "Could not update item." });
  }
}

export async function deleteItem(req, res) {
  try {
    const id = vIntId(req.params.id, "item id");
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE mb_items SET archived_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rowCount) {
      return res
        .status(404)
        .json({ error: "Item not found or already archived." });
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] item delete", e);
    res.status(500).json({ error: "Could not archive item." });
  }
}
