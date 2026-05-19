/**
 * Create a card on a board. In the unified Phase 7 schema, "process
 * board cards" are mb_items rows. We accept board_id + (optional)
 * group_id, plus title / values / assigned_to / due_in_hours. When
 * due_in_hours is provided we stamp a `due_at` ISO string into the
 * values JSONB; the rendering layer reads `values.due_at` already.
 *
 * config: {
 *   board_id, group_id?, title, description?, assigned_to?,
 *   due_in_hours?, values?
 * }
 */

import { getPool } from "../db.js";

function parseIntOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.floor(n) === n ? n : null;
}

export async function runCreateCard({ config }) {
  const boardId = parseIntOrNull(config.board_id);
  if (!boardId) {
    return { status: "failed", error: "create_card: 'board_id' is required (integer)." };
  }
  const title = String(config.title || "").trim();
  if (!title) {
    return { status: "failed", error: "create_card: 'title' is required." };
  }
  const groupId = parseIntOrNull(config.group_id);
  const assignedTo = parseIntOrNull(config.assigned_to);

  // Merge optional structured values + description + due_at into the
  // values JSONB column. mb_items has no dedicated description column —
  // we store it under values.description to match how the UI reads it.
  const values = { ...(config.values && typeof config.values === "object" ? config.values : {}) };
  if (config.description != null && String(config.description).trim() !== "") {
    values.description = String(config.description);
  }
  const dueInHours = Number(config.due_in_hours);
  if (Number.isFinite(dueInHours) && dueInHours > 0) {
    const due = new Date(Date.now() + dueInHours * 3600 * 1000);
    values.due_at = due.toISOString();
  }

  const pool = getPool();
  try {
    // Position = max(position) + 1024 within board (+ group if given),
    // matches backend/routes/mbItems.js createItem default.
    const scope = groupId == null ? "AND group_id IS NULL" : "AND group_id = $2";
    const params = groupId == null ? [boardId] : [boardId, groupId];
    const { rows: max } = await pool.query(
      `SELECT COALESCE(MAX(position), 0) AS m
         FROM mb_items WHERE board_id = $1 ${scope}`,
      params
    );
    const position = Number(max[0].m) + 1024;

    const { rows } = await pool.query(
      `INSERT INTO mb_items (board_id, title, position, group_id, values, assigned_to)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, board_id, group_id, title, assigned_to`,
      [boardId, title, position, groupId, JSON.stringify(values), assignedTo]
    );
    const card = rows[0];
    return {
      status: "success",
      output: {
        card_id: card.id,
        board_id: card.board_id,
        group_id: card.group_id,
        title: card.title,
        assigned_to: card.assigned_to,
      },
    };
  } catch (err) {
    if (err.code === "23503") {
      return { status: "failed", error: "create_card: board_id or group_id does not exist." };
    }
    return { status: "failed", error: `create_card: ${err.message}` };
  }
}
