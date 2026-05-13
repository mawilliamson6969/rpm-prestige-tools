/**
 * Phase 3.5: board customization endpoints.
 *
 * Adds the admin-only management routes that the Edit Board drawer +
 * Manage Boards page need. Phase 1 already had board-level CRUD; this
 * file adds the missing column-, option-, and group-level operations,
 * plus the create-with-defaults flow that gives a fresh board a
 * working starting state.
 *
 * Soft-delete convention matches the rest of mb_*: archived_at IS NULL
 * = active. There is no `is_archived` boolean — single source of truth.
 *
 * Status / dropdown options live in mb_board_columns.config.options as
 * `[{label, value, color}]`. `value` is the stable identifier (preserved
 * across rename), `label` and `color` are mutable. Item values reference
 * the option by `value`, so renaming an option does NOT touch items.
 */

import { getPool } from "../lib/db.js";
import {
  vIntId,
  vStringReq,
  vStringOpt,
  vNumOpt,
  vBool,
  vSlug,
  vUserCreatableColumnType,
} from "../lib/mb/validators.js";

// ============================================================
// Color palette (mirror of frontend ColorPalette.tsx)
// ============================================================
//
// Validated server-side so a malicious client can't sneak in arbitrary
// values (CSS injection, branding drift). Keep in sync with the
// frontend palette in components/ColorPalette.tsx.

const ALLOWED_COLORS = new Set([
  "#e2445c", // red
  "#fdab3d", // orange
  "#ffcb00", // yellow
  "#00c875", // green
  "#00d4d4", // teal
  "#0086c0", // blue
  "#5559df", // indigo
  "#a25ddc", // purple
  "#ff5ac4", // pink
  "#7f5347", // brown
  "#c4c4c4", // gray
  "#333333", // dark
]);

function vPaletteColor(v, { allowNull = false } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    const e = new Error("color is required.");
    e.http = 400;
    throw e;
  }
  const s = String(v).toLowerCase();
  if (!ALLOWED_COLORS.has(s)) {
    const e = new Error(`color must be one of the 12 palette values.`);
    e.http = 400;
    throw e;
  }
  return s;
}

// ============================================================
// Helpers
// ============================================================

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "board";
}

async function ensureUniqueSlug(pool, baseSlug) {
  let slug = baseSlug;
  let n = 2;
  while (true) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM mb_boards WHERE slug = $1`,
      [slug]
    );
    if (rowCount === 0) return slug;
    slug = `${baseSlug}-${n++}`;
    if (n > 100) {
      const e = new Error("Could not generate a unique slug.");
      e.http = 500;
      throw e;
    }
  }
}

function generateOptionValue(label, taken) {
  const base =
    String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "option";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function generateColumnKey(name, taken) {
  const base =
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "col";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// ============================================================
// Board: create with defaults
// ============================================================
//
// Replaces Phase 1's barebones createBoard so a newly minted board
// has a working starting state: one group "Items", a text column
// "Name", and a status column "Status" with three default options.
// Phase 1's POST /mb/boards is rerouted to this in index.js.

export async function createBoardWithDefaults(req, res) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const body = req.body ?? {};
    const name = vStringReq(body.name, "name", { maxLen: 200 });
    const description = vStringOpt(body.description, { maxLen: 5000 });

    // Slug: caller may supply one; otherwise derive from name and append
    // a numeric suffix until unique.
    let slug;
    if (body.slug != null && body.slug !== "") {
      slug = vSlug(body.slug);
      const { rowCount } = await client.query(
        `SELECT 1 FROM mb_boards WHERE slug = $1`,
        [slug]
      );
      if (rowCount > 0) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: "A board with that slug already exists." });
      }
    } else {
      slug = await ensureUniqueSlug(client, slugify(name));
    }

    // 1) Board row.
    const { rows: boardRows } = await client.query(
      `INSERT INTO mb_boards (name, slug, description, default_view, created_by)
       VALUES ($1, $2, $3, 'table', $4)
       RETURNING *`,
      [name, slug, description, req.user.id]
    );
    const board = boardRows[0];

    // 2) Default group "Items".
    await client.query(
      `INSERT INTO mb_groups (board_id, name, color, position)
       VALUES ($1, 'Items', '#0086c0', 0)`,
      [board.id]
    );

    // 3) Default columns: "Name" (text) and "Status" (status with 3 options).
    await client.query(
      `INSERT INTO mb_board_columns
         (board_id, name, key, column_type, config, position, width)
       VALUES
         ($1, 'Name',   'name',   'text',   '{}'::jsonb, 10, 240),
         ($1, 'Status', 'status', 'status', $2::jsonb,   20, 160)`,
      [
        board.id,
        JSON.stringify({
          options: [
            { value: "not_started", label: "Not Started", color: "#c4c4c4" },
            { value: "in_progress", label: "In Progress", color: "#0086c0" },
            { value: "done", label: "Done", color: "#00c875" },
          ],
          defaultValue: "not_started",
        }),
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({ board });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23505") {
      return res
        .status(409)
        .json({ error: "A board with that name or slug already exists." });
    }
    console.error("[mb-customization] create board", e);
    res.status(500).json({ error: "Could not create board." });
  } finally {
    client.release();
  }
}

// ============================================================
// Columns: CRUD
// ============================================================

export async function createColumn(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const body = req.body ?? {};
    const name = vStringReq(body.name, "name", { maxLen: 200 });
    const columnType = vUserCreatableColumnType(body.column_type);
    const pool = getPool();

    // Confirm board exists and get column keys to dedupe.
    const { rows: boardRows } = await pool.query(
      `SELECT id FROM mb_boards WHERE id = $1`,
      [boardId]
    );
    if (!boardRows.length) {
      return res.status(404).json({ error: "Board not found." });
    }
    const { rows: existingCols } = await pool.query(
      `SELECT key, name, position
         FROM mb_board_columns WHERE board_id = $1`,
      [boardId]
    );
    const takenKeys = new Set(existingCols.map((c) => c.key));
    const takenNames = new Set(
      existingCols
        .filter((c) => c.archived_at == null)
        .map((c) => c.name.toLowerCase())
    );
    if (takenNames.has(name.toLowerCase())) {
      return res
        .status(409)
        .json({ error: "A column with that name already exists on this board." });
    }
    const key = generateColumnKey(name, takenKeys);
    const maxPos = existingCols.reduce(
      (m, c) => (c.position > m ? c.position : m),
      0
    );

    // Build config based on type.
    let config = {};
    if (columnType === "status" || columnType === "dropdown") {
      const rawOptions = Array.isArray(body.options) ? body.options : [];
      const optionTaken = new Set();
      const options = rawOptions.slice(0, 20).map((o) => {
        const label = vStringReq(o?.label, "option.label", { maxLen: 80 });
        const color = vPaletteColor(o?.color);
        const value =
          o?.value && typeof o.value === "string"
            ? generateOptionValue(o.value, optionTaken)
            : generateOptionValue(label, optionTaken);
        optionTaken.add(value);
        return { value, label, color };
      });
      config = { options };
    }

    const { rows } = await pool.query(
      `INSERT INTO mb_board_columns
         (board_id, name, key, column_type, config, position, width, is_required)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 160, FALSE)
       RETURNING *`,
      [boardId, name, key, columnType, JSON.stringify(config), maxPos + 10]
    );
    res.status(201).json({ column: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb-customization] create column", e);
    res.status(500).json({ error: "Could not create column." });
  }
}

export async function updateColumn(req, res) {
  try {
    const id = vIntId(req.params.id, "column id");
    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;

    if (body.name !== undefined) {
      const name = vStringReq(body.name, "name", { maxLen: 200 });
      // Uniqueness check against other active columns on the same board.
      const pool = getPool();
      const { rows: dupes } = await pool.query(
        `SELECT 1 FROM mb_board_columns
          WHERE board_id = (SELECT board_id FROM mb_board_columns WHERE id = $1)
            AND id <> $1
            AND archived_at IS NULL
            AND LOWER(name) = LOWER($2)`,
        [id, name]
      );
      if (dupes.length) {
        return res.status(409).json({
          error: "Another column with that name already exists on this board.",
        });
      }
      sets.push(`name = $${n++}`);
      vals.push(name);
    }
    if (body.position !== undefined) {
      const pos = vNumOpt(body.position, "position");
      sets.push(`position = $${n++}`);
      vals.push(pos);
    }
    if (body.width !== undefined) {
      const w = vNumOpt(body.width, "width");
      sets.push(`width = $${n++}`);
      vals.push(w);
    }
    if (body.archived !== undefined) {
      const archived = Boolean(body.archived);
      sets.push(`archived_at = ${archived ? "NOW()" : "NULL"}`);
    }

    // Block column_type changes outright (per spec).
    if (body.column_type !== undefined) {
      return res.status(400).json({
        error: "Column type cannot be changed after creation.",
      });
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }
    vals.push(id);

    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE mb_board_columns SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Column not found." });
    res.json({ column: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb-customization] update column", e);
    res.status(500).json({ error: "Could not update column." });
  }
}

export async function deleteColumn(req, res) {
  try {
    const id = vIntId(req.params.id, "column id");
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE mb_board_columns
          SET archived_at = NOW()
        WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rowCount) {
      return res
        .status(404)
        .json({ error: "Column not found or already archived." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[mb-customization] delete column", e);
    res.status(500).json({ error: "Could not archive column." });
  }
}

/**
 * Bulk reorder: body { order: [colId, colId, ...] }. Sets each column's
 * position to its index * 10. One UPDATE per column, but in a single
 * transaction so the table is never partially-reordered.
 */
export async function reorderColumns(req, res) {
  const client = await getPool().connect();
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const order = Array.isArray(req.body?.order) ? req.body.order : null;
    if (!order || order.length === 0) {
      return res.status(400).json({ error: "order array required." });
    }
    const ids = order.map((x, i) => {
      try {
        return vIntId(x, `order[${i}]`);
      } catch {
        const e = new Error(`order[${i}] is not a valid id.`);
        e.http = 400;
        throw e;
      }
    });

    await client.query("BEGIN");
    // Confirm every id belongs to this board.
    const { rows: owned } = await client.query(
      `SELECT id FROM mb_board_columns
        WHERE board_id = $1 AND id = ANY($2::int[])`,
      [boardId, ids]
    );
    if (owned.length !== ids.length) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "One or more columns do not belong to this board." });
    }
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `UPDATE mb_board_columns SET position = $1 WHERE id = $2`,
        [(i + 1) * 10, ids[i]]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb-customization] reorder columns", e);
    res.status(500).json({ error: "Could not reorder columns." });
  } finally {
    client.release();
  }
}

// ============================================================
// Column options (status / dropdown)
// ============================================================

async function loadColumnForOptions(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, board_id, column_type, config FROM mb_board_columns WHERE id = $1`,
    [id]
  );
  if (!rows.length) {
    const e = new Error("Column not found.");
    e.http = 404;
    throw e;
  }
  const col = rows[0];
  if (col.column_type !== "status" && col.column_type !== "dropdown") {
    const e = new Error("Options are only available on status and dropdown columns.");
    e.http = 400;
    throw e;
  }
  const config =
    typeof col.config === "string" ? JSON.parse(col.config) : col.config || {};
  const options = Array.isArray(config.options) ? config.options : [];
  return { col, config, options };
}

async function saveColumnConfig(pool, columnId, config) {
  await pool.query(
    `UPDATE mb_board_columns SET config = $1::jsonb WHERE id = $2`,
    [JSON.stringify(config), columnId]
  );
}

export async function createColumnOption(req, res) {
  try {
    const colId = vIntId(req.params.id, "column id");
    const label = vStringReq(req.body?.label, "label", { maxLen: 80 });
    const color = vPaletteColor(req.body?.color);
    const pool = getPool();
    const { config, options } = await loadColumnForOptions(pool, colId);
    if (options.length >= 20) {
      return res
        .status(400)
        .json({ error: "Maximum of 20 options per column." });
    }
    if (
      options.some((o) => String(o.label).toLowerCase() === label.toLowerCase())
    ) {
      return res
        .status(409)
        .json({ error: "An option with that label already exists." });
    }
    const taken = new Set(options.map((o) => String(o.value)));
    const value = generateOptionValue(label, taken);
    options.push({ value, label, color });
    config.options = options;
    await saveColumnConfig(pool, colId, config);
    res.status(201).json({ option: { value, label, color }, options });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb-customization] create option", e);
    res.status(500).json({ error: "Could not add option." });
  }
}

export async function updateColumnOption(req, res) {
  try {
    const colId = vIntId(req.params.id, "column id");
    const optionId = String(req.params.option_id ?? "");
    if (!optionId) return res.status(400).json({ error: "option_id required." });
    const pool = getPool();
    const { config, options } = await loadColumnForOptions(pool, colId);
    const idx = options.findIndex((o) => String(o.value) === optionId);
    if (idx < 0) return res.status(404).json({ error: "Option not found." });

    const next = { ...options[idx] };
    if (req.body?.label !== undefined) {
      const label = vStringReq(req.body.label, "label", { maxLen: 80 });
      if (
        options.some(
          (o, i) =>
            i !== idx && String(o.label).toLowerCase() === label.toLowerCase()
        )
      ) {
        return res
          .status(409)
          .json({ error: "Another option already uses that label." });
      }
      next.label = label;
    }
    if (req.body?.color !== undefined) {
      next.color = vPaletteColor(req.body.color);
    }
    options[idx] = next;
    config.options = options;
    await saveColumnConfig(pool, colId, config);
    res.json({ option: next, options });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb-customization] update option", e);
    res.status(500).json({ error: "Could not update option." });
  }
}

export async function deleteColumnOption(req, res) {
  try {
    const colId = vIntId(req.params.id, "column id");
    const optionId = String(req.params.option_id ?? "");
    if (!optionId) return res.status(400).json({ error: "option_id required." });
    const pool = getPool();
    const { col, config, options } = await loadColumnForOptions(pool, colId);
    const idx = options.findIndex((o) => String(o.value) === optionId);
    if (idx < 0) return res.status(404).json({ error: "Option not found." });

    // Block if any non-archived item on this board currently uses the
    // value. The column.key is the JSONB path into mb_items.values.
    const { rows: keyRow } = await pool.query(
      `SELECT key FROM mb_board_columns WHERE id = $1`,
      [colId]
    );
    const key = keyRow[0]?.key;
    if (key) {
      const { rows: usage } = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM mb_items
          WHERE board_id = $1
            AND archived_at IS NULL
            AND values ->> $2 = $3`,
        [col.board_id, key, optionId]
      );
      if (usage[0]?.n > 0) {
        return res.status(409).json({
          error: `${usage[0].n} item${usage[0].n === 1 ? "" : "s"} use this value; change them first.`,
          items_using: usage[0].n,
        });
      }
    }

    options.splice(idx, 1);
    config.options = options;
    await saveColumnConfig(pool, colId, config);
    res.json({ ok: true, options });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb-customization] delete option", e);
    res.status(500).json({ error: "Could not delete option." });
  }
}

// ============================================================
// Groups: CRUD + reorder
// ============================================================

export async function createGroup(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const name = vStringReq(req.body?.name, "name", { maxLen: 120 });
    const color = req.body?.color
      ? vPaletteColor(req.body.color)
      : "#c4c4c4";
    const pool = getPool();

    const { rows: existing } = await pool.query(
      `SELECT name, position FROM mb_groups WHERE board_id = $1`,
      [boardId]
    );
    if (
      existing.some((g) => g.name.toLowerCase() === name.toLowerCase())
    ) {
      return res
        .status(409)
        .json({ error: "A group with that name already exists on this board." });
    }
    const maxPos = existing.reduce(
      (m, g) => (g.position > m ? g.position : m),
      -1
    );

    const { rows } = await pool.query(
      `INSERT INTO mb_groups (board_id, name, color, position)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [boardId, name, color, maxPos + 1]
    );
    res.status(201).json({ group: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23503") {
      return res.status(404).json({ error: "Board not found." });
    }
    console.error("[mb-customization] create group", e);
    res.status(500).json({ error: "Could not create group." });
  }
}

export async function updateGroup(req, res) {
  try {
    const id = vIntId(req.params.id, "group id");
    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;

    if (body.name !== undefined) {
      const name = vStringReq(body.name, "name", { maxLen: 120 });
      const pool = getPool();
      const { rows: dupes } = await pool.query(
        `SELECT 1 FROM mb_groups
          WHERE board_id = (SELECT board_id FROM mb_groups WHERE id = $1)
            AND id <> $1
            AND LOWER(name) = LOWER($2)`,
        [id, name]
      );
      if (dupes.length) {
        return res.status(409).json({
          error: "Another group with that name already exists on this board.",
        });
      }
      sets.push(`name = $${n++}`);
      vals.push(name);
    }
    if (body.color !== undefined) {
      sets.push(`color = $${n++}`);
      vals.push(vPaletteColor(body.color));
    }
    if (body.position !== undefined) {
      sets.push(`position = $${n++}`);
      vals.push(vNumOpt(body.position, "position"));
    }
    if (body.is_collapsed !== undefined) {
      sets.push(`is_collapsed = $${n++}`);
      vals.push(vBool(body.is_collapsed, { allowNull: false }));
    }
    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }
    vals.push(id);

    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE mb_groups SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Group not found." });
    res.json({ group: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb-customization] update group", e);
    res.status(500).json({ error: "Could not update group." });
  }
}

export async function deleteGroup(req, res) {
  try {
    const id = vIntId(req.params.id, "group id");
    const pool = getPool();
    const { rows: items } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM mb_items
        WHERE group_id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (items[0]?.n > 0) {
      return res.status(409).json({
        error: `Group has ${items[0].n} item${items[0].n === 1 ? "" : "s"}. Move them to another group first.`,
        items_in_group: items[0].n,
      });
    }
    const { rowCount } = await pool.query(`DELETE FROM mb_groups WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ error: "Group not found." });
    res.json({ ok: true });
  } catch (e) {
    console.error("[mb-customization] delete group", e);
    res.status(500).json({ error: "Could not delete group." });
  }
}

export async function reorderGroups(req, res) {
  const client = await getPool().connect();
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const order = Array.isArray(req.body?.order) ? req.body.order : null;
    if (!order || order.length === 0) {
      return res.status(400).json({ error: "order array required." });
    }
    const ids = order.map((x, i) => vIntId(x, `order[${i}]`));

    await client.query("BEGIN");
    const { rows: owned } = await client.query(
      `SELECT id FROM mb_groups
        WHERE board_id = $1 AND id = ANY($2::int[])`,
      [boardId, ids]
    );
    if (owned.length !== ids.length) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "One or more groups do not belong to this board." });
    }
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `UPDATE mb_groups SET position = $1 WHERE id = $2`,
        [i, ids[i]]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb-customization] reorder groups", e);
    res.status(500).json({ error: "Could not reorder groups." });
  } finally {
    client.release();
  }
}
