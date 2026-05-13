/**
 * Phase 8: settings-screen endpoints.
 *
 *   Tags (any authenticated user can read; admin to mutate)
 *     GET    /inbox/tag-definitions
 *     POST   /inbox/tag-definitions             { name, color, description }
 *     PATCH  /inbox/tag-definitions/:id         { name?, color?, description? }
 *     DELETE /inbox/tag-definitions/:id
 *
 *   Canned responses (any authenticated user can read shared + own;
 *     anyone can create/edit/delete their own; admin can also do shared)
 *     GET    /inbox/canned-responses
 *     POST   /inbox/canned-responses            { name, body, shortcut?, is_shared? }
 *     PATCH  /inbox/canned-responses/:id        { name?, body?, shortcut?, is_shared? }
 *     POST   /inbox/canned-responses/:id/used   (bump use_count)
 *     DELETE /inbox/canned-responses/:id
 */

import { getPool } from "../lib/db.js";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isElevated(user) {
  return user?.role === "admin" || user?.role === "owner";
}

/* ────────────────────────── Tag definitions ────────────────────────── */

export async function getInboxTagDefinitions(_req, res) {
  try {
    const pool = getPool();
    // Join with a usage count from threads.tags (jsonb-like array column).
    // Cheap because tag_definitions is tiny.
    const { rows } = await pool.query(
      `SELECT td.id, td.name, td.color, td.description,
              td.created_by, td.created_at, td.updated_at,
              COALESCE(tc.usage, 0)::int AS usage_count
         FROM tag_definitions td
    LEFT JOIN (
           SELECT t AS name, COUNT(*) AS usage
             FROM threads, unnest(threads.tags) AS t
            WHERE threads.status <> 'closed'
            GROUP BY t
         ) tc ON tc.name = td.name
        ORDER BY td.name ASC`
    );
    res.json({ tags: rows });
  } catch (e) {
    console.error("[inbox] tag defs list", e);
    res.status(500).json({ error: "Could not load tag definitions." });
  }
}

export async function postInboxTagDefinition(req, res) {
  if (!isElevated(req.user)) {
    return res.status(403).json({ error: "Admin or owner required." });
  }
  const body = req.body ?? {};
  const name = String(body.name || "").trim();
  if (!name || name.length > 64) {
    return res.status(400).json({ error: "name must be 1–64 characters." });
  }
  const color = String(body.color || "#6A737B").trim();
  if (!HEX_COLOR_RE.test(color)) {
    return res.status(400).json({ error: "color must be a 6-digit hex like #B32317." });
  }
  const description = body.description != null ? String(body.description).trim() : null;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO tag_definitions (name, color, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, color, description, created_by, created_at, updated_at`,
      [name, color, description, req.user.id]
    );
    res.status(201).json({ tag: { ...rows[0], usage_count: 0 } });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "A tag with that name already exists." });
    }
    console.error("[inbox] tag def create", e);
    res.status(500).json({ error: "Could not create tag." });
  }
}

export async function patchInboxTagDefinition(req, res) {
  if (!isElevated(req.user)) {
    return res.status(403).json({ error: "Admin or owner required." });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
  const body = req.body ?? {};
  const sets = [];
  const vals = [];
  let n = 1;
  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v || v.length > 64) return res.status(400).json({ error: "name must be 1–64 characters." });
    sets.push(`name = $${n++}`);
    vals.push(v);
  }
  if (body.color !== undefined) {
    const v = String(body.color).trim();
    if (!HEX_COLOR_RE.test(v)) return res.status(400).json({ error: "color must be a 6-digit hex." });
    sets.push(`color = $${n++}`);
    vals.push(v);
  }
  if (body.description !== undefined) {
    sets.push(`description = $${n++}`);
    vals.push(body.description == null ? null : String(body.description).trim());
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update." });
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE tag_definitions SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Tag not found." });
    res.json({ tag: rows[0] });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "A tag with that name already exists." });
    }
    console.error("[inbox] tag def patch", e);
    res.status(500).json({ error: "Could not update tag." });
  }
}

export async function deleteInboxTagDefinition(req, res) {
  if (!isElevated(req.user)) {
    return res.status(403).json({ error: "Admin or owner required." });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const r = await pool.query(`DELETE FROM tag_definitions WHERE id = $1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: "Tag not found." });
    // Note: we don't strip the tag from existing threads.tags arrays —
    // those are free-form data. Deleting just removes the catalog entry
    // and the color metadata.
    res.json({ ok: true });
  } catch (e) {
    console.error("[inbox] tag def delete", e);
    res.status(500).json({ error: "Could not delete tag." });
  }
}

/* ────────────────────────── Canned responses ────────────────────────── */

function mapCanned(row) {
  return {
    id: row.id,
    name: row.name,
    shortcut: row.shortcut,
    body: row.body,
    owner_id: row.owner_id,
    is_shared: row.is_shared === true,
    use_count: row.use_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getInboxCannedResponses(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM canned_responses
        WHERE is_shared = TRUE OR owner_id = $1
        ORDER BY is_shared DESC, name ASC`,
      [req.user.id]
    );
    res.json({ canned: rows.map(mapCanned) });
  } catch (e) {
    console.error("[inbox] canned list", e);
    res.status(500).json({ error: "Could not load canned responses." });
  }
}

export async function postInboxCannedResponse(req, res) {
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const responseBody = typeof body.body === "string" ? body.body.trim() : "";
  const shortcut =
    typeof body.shortcut === "string" && body.shortcut.trim().length
      ? body.shortcut.trim()
      : null;
  const isShared = body.is_shared === true;
  if (!name || name.length > 200) {
    return res.status(400).json({ error: "name must be 1–200 characters." });
  }
  if (!responseBody) {
    return res.status(400).json({ error: "body is required." });
  }
  if (isShared && !isElevated(req.user)) {
    return res.status(403).json({ error: "Only admins can create shared responses." });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO canned_responses (name, shortcut, body, owner_id, is_shared)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, shortcut, responseBody, isShared ? null : req.user.id, isShared]
    );
    res.status(201).json({ canned: mapCanned(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "A shared response with that name already exists." });
    }
    console.error("[inbox] canned create", e);
    res.status(500).json({ error: "Could not create canned response." });
  }
}

export async function patchInboxCannedResponse(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT * FROM canned_responses WHERE id = $1`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ error: "Not found." });
    const row = existing[0];
    const isOwn = row.owner_id === req.user.id;
    const canTouchShared = isElevated(req.user);
    if (!isOwn && !canTouchShared) {
      return res.status(403).json({ error: "Only the owner or an admin can edit this response." });
    }

    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;
    if (body.name !== undefined) {
      const v = String(body.name).trim();
      if (!v || v.length > 200) return res.status(400).json({ error: "name must be 1–200 characters." });
      sets.push(`name = $${n++}`);
      vals.push(v);
    }
    if (body.shortcut !== undefined) {
      const v = body.shortcut == null ? null : String(body.shortcut).trim() || null;
      sets.push(`shortcut = $${n++}`);
      vals.push(v);
    }
    if (body.body !== undefined) {
      const v = String(body.body).trim();
      if (!v) return res.status(400).json({ error: "body cannot be empty." });
      sets.push(`body = $${n++}`);
      vals.push(v);
    }
    if (body.is_shared !== undefined) {
      const next = body.is_shared === true;
      if (next && !canTouchShared) {
        return res.status(403).json({ error: "Only admins can promote a response to shared." });
      }
      sets.push(`is_shared = $${n++}`);
      vals.push(next);
      // Owner becomes NULL when sharing, otherwise stays with the actor.
      sets.push(`owner_id = $${n++}`);
      vals.push(next ? null : (row.owner_id ?? req.user.id));
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update." });
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE canned_responses SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    res.json({ canned: mapCanned(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "A shared response with that name already exists." });
    }
    console.error("[inbox] canned patch", e);
    res.status(500).json({ error: "Could not update canned response." });
  }
}

export async function deleteInboxCannedResponse(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    const { rows: existing } = await pool.query(
      `SELECT owner_id, is_shared FROM canned_responses WHERE id = $1`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ error: "Not found." });
    const row = existing[0];
    const isOwn = row.owner_id === req.user.id;
    const canTouchShared = isElevated(req.user);
    if (!isOwn && !canTouchShared) {
      return res.status(403).json({ error: "Only the owner or an admin can delete this response." });
    }
    await pool.query(`DELETE FROM canned_responses WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[inbox] canned delete", e);
    res.status(500).json({ error: "Could not delete canned response." });
  }
}

export async function postInboxCannedResponseUsed(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE canned_responses SET use_count = use_count + 1, updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[inbox] canned used", e);
    res.status(500).json({ error: "Could not record usage." });
  }
}
