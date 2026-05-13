/**
 * Monday-style boards: board CRUD.
 *
 * Mounted under /mb/boards with requireAuth. Mutations require admin
 * role for Phase 1 — until we have a board-level permission system,
 * any logged-in admin can create/edit boards. Read is open to all
 * authenticated users; access scoping per board is a Phase 2 concern.
 */

import { getPool } from "../lib/db.js";
import {
  vIntId,
  vStringReq,
  vStringOpt,
  vSlug,
  vBoardView,
} from "../lib/mb/validators.js";

export async function listBoards(req, res) {
  try {
    const pool = getPool();
    const includeArchived = req.query.include_archived === "true";
    const where = includeArchived ? "" : "WHERE archived_at IS NULL";
    const { rows } = await pool.query(
      `SELECT * FROM mb_boards ${where} ORDER BY name ASC, id ASC`
    );
    res.json({ boards: rows });
  } catch (e) {
    console.error("[mb] boards list", e);
    res.status(500).json({ error: "Could not load boards." });
  }
}

export async function createBoard(req, res) {
  try {
    const body = req.body ?? {};
    const name = vStringReq(body.name, "name", { maxLen: 200 });
    const slug = vSlug(body.slug);
    const description = vStringOpt(body.description, { maxLen: 5000 });
    const icon = vStringOpt(body.icon, { maxLen: 64 });
    const color = vStringOpt(body.color, { maxLen: 16 });
    const appfolio_resource_type = vStringOpt(body.appfolio_resource_type, {
      maxLen: 64,
    });
    const default_view = vBoardView(body.default_view) || "table";

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO mb_boards
         (name, slug, description, icon, color,
          appfolio_resource_type, default_view, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        name,
        slug,
        description,
        icon,
        color,
        appfolio_resource_type,
        default_view,
        req.user.id,
      ]
    );
    res.status(201).json({ board: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23505") {
      return res
        .status(409)
        .json({ error: "A board with that slug already exists." });
    }
    console.error("[mb] board create", e);
    res.status(500).json({ error: "Could not create board." });
  }
}

export async function getBoard(req, res) {
  try {
    const id = vIntId(req.params.id, "board id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM mb_boards WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Board not found." });

    const includeArchivedColumns = req.query.include_archived_columns === "true";
    const colFilter = includeArchivedColumns
      ? "WHERE board_id = $1"
      : "WHERE board_id = $1 AND archived_at IS NULL";
    const [columns, groups] = await Promise.all([
      pool.query(
        `SELECT * FROM mb_board_columns
          ${colFilter}
          ORDER BY position ASC, id ASC`,
        [id]
      ),
      pool.query(
        `SELECT * FROM mb_groups
          WHERE board_id = $1
          ORDER BY position ASC, id ASC`,
        [id]
      ),
    ]);

    res.json({
      board: rows[0],
      columns: columns.rows,
      groups: groups.rows,
    });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] board get", e);
    res.status(500).json({ error: "Could not load board." });
  }
}

export async function updateBoard(req, res) {
  try {
    const id = vIntId(req.params.id, "board id");
    const body = req.body ?? {};
    const allowed = {
      name: (v) => vStringReq(v, "name", { maxLen: 200 }),
      slug: (v) => vSlug(v),
      description: (v) => vStringOpt(v, { maxLen: 5000 }),
      icon: (v) => vStringOpt(v, { maxLen: 64 }),
      color: (v) => vStringOpt(v, { maxLen: 16 }),
      appfolio_resource_type: (v) => vStringOpt(v, { maxLen: 64 }),
      default_view: (v) => vBoardView(v, { allowNull: false }),
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

    // Phase 3.5: special-case "archived" toggle. PATCH with archived = false
    // is the canonical restore path; archived = true is equivalent to DELETE
    // and respects the system-board guard.
    const pool = getPool();
    if (body.archived !== undefined) {
      const archived = Boolean(body.archived);
      // Check system flag first for the archive case.
      if (archived) {
        const { rows: existing } = await pool.query(
          `SELECT is_system FROM mb_boards WHERE id = $1`,
          [id]
        );
        if (!existing.length) {
          return res.status(404).json({ error: "Board not found." });
        }
        if (existing[0].is_system) {
          return res.status(403).json({
            error: "System boards cannot be archived.",
          });
        }
      }
      sets.push(`archived_at = ${archived ? "NOW()" : "NULL"}`);
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }

    // Phase 3.5: lock name/slug on system boards.
    if (body.name !== undefined || body.slug !== undefined) {
      const { rows: existing } = await pool.query(
        `SELECT is_system FROM mb_boards WHERE id = $1`,
        [id]
      );
      if (!existing.length) {
        return res.status(404).json({ error: "Board not found." });
      }
      if (existing[0].is_system) {
        return res.status(403).json({
          error: "System boards cannot be renamed.",
        });
      }
    }

    sets.push(`updated_at = NOW()`);
    vals.push(id);

    const { rows } = await pool.query(
      `UPDATE mb_boards SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Board not found." });
    res.json({ board: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23505") {
      return res
        .status(409)
        .json({ error: "A board with that slug already exists." });
    }
    console.error("[mb] board update", e);
    res.status(500).json({ error: "Could not update board." });
  }
}

export async function deleteBoard(req, res) {
  try {
    const id = vIntId(req.params.id, "board id");
    const pool = getPool();
    // Phase 3.5: system boards (Renewals) are protected.
    const { rows: existing } = await pool.query(
      `SELECT is_system, archived_at FROM mb_boards WHERE id = $1`,
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ error: "Board not found." });
    }
    if (existing[0].is_system) {
      return res.status(403).json({
        error: "System boards cannot be archived.",
      });
    }
    if (existing[0].archived_at) {
      return res.status(404).json({ error: "Board already archived." });
    }
    await pool.query(
      `UPDATE mb_boards SET archived_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] board delete", e);
    res.status(500).json({ error: "Could not archive board." });
  }
}
