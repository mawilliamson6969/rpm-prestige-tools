/**
 * Phase 2: saved views.
 *
 * A view is a named filter set saved against `threads`. Owned views are
 * private to the owner; shared views show up for everyone. The list
 * endpoint optionally returns live counts for each view.
 *
 * View filters reuse the same shape that /inbox/threads accepts via query
 * params, so applying a view in the UI is just "set these filters". The
 * server-side count + execute paths build a synthetic `req.query` and
 * delegate to the existing buildThreadWhere helper.
 */

import { getPool } from "../lib/db.js";
import { getAllowedConnectionIds } from "../lib/inbox/inbox-permissions.js";
import { buildThreadWhere, getInboxThreads } from "./inboxThreads.js";

function mapView(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? null,
    owner_id: row.owner_id ?? null,
    is_shared: row.is_shared === true,
    filters: row.filters ?? {},
    sort: row.sort ?? null,
    position: row.position ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isAdminUser(req) {
  const role = req.user?.role;
  return role === "admin" || role === "owner";
}

/** Synthesize a `req.query`-shaped object from a view's filters JSON so we
 *  can reuse buildThreadWhere. Filters are passed through as-is for keys
 *  buildThreadWhere already understands. */
function reqQueryFromFilters(filters, sort) {
  const f = filters && typeof filters === "object" ? filters : {};
  const q = { ...f };
  if (sort && typeof sort === "object" && typeof sort.sort === "string") {
    q.sort = sort.sort;
  }
  return q;
}

async function loadViewsForUser(pool, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM saved_views
      WHERE is_shared = TRUE OR owner_id = $1
      ORDER BY is_shared DESC, position ASC, id ASC`,
    [userId]
  );
  return rows.map(mapView);
}

/** GET /inbox/views — list views visible to the current user. Pass
 *  ?with_counts=true to include `open_count` per view. */
export async function getInboxViews(req, res) {
  try {
    const pool = getPool();
    const views = await loadViewsForUser(pool, req.user.id);
    if (req.query.with_counts !== "true") {
      res.json({ views });
      return;
    }
    const allowed = await getAllowedConnectionIds(pool, req.user.id);
    if (!allowed.length) {
      res.json({ views: views.map((v) => ({ ...v, open_count: 0 })) });
      return;
    }
    // Run one COUNT per view. Bounded by the number of views per user (~10-20).
    const enriched = [];
    for (const v of views) {
      const fakeReq = { query: reqQueryFromFilters(v.filters, v.sort), user: req.user };
      const { where, params } = buildThreadWhere(fakeReq, allowed);
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS c FROM threads th WHERE ${where}`,
          params
        );
        enriched.push({ ...v, open_count: rows[0]?.c ?? 0 });
      } catch (e) {
        console.error("[inbox] view count failed", v.id, e.message || e);
        enriched.push({ ...v, open_count: null });
      }
    }
    res.json({ views: enriched });
  } catch (e) {
    console.error("[inbox] views list", e);
    res.status(500).json({ error: "Could not load views." });
  }
}

/** POST /inbox/views — create a view. Body: { name, icon?, filters, sort?, is_shared? } */
export async function postInboxView(req, res) {
  try {
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
    const sort = body.sort && typeof body.sort === "object" ? body.sort : null;
    const isShared = body.is_shared === true;
    if (isShared && !isAdminUser(req)) {
      res.status(403).json({ error: "Only admins can create shared views." });
      return;
    }
    const icon = typeof body.icon === "string" ? body.icon.trim() || null : null;
    const ownerId = isShared ? null : req.user.id;
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO saved_views (name, icon, owner_id, is_shared, filters, sort, position)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb,
         COALESCE((SELECT MAX(position) + 1 FROM saved_views
                    WHERE (is_shared = $4 AND ($4 = TRUE OR owner_id = $3))), 0))
       RETURNING *`,
      [name, icon, ownerId, isShared, JSON.stringify(filters), sort ? JSON.stringify(sort) : null]
    );
    res.status(201).json({ view: mapView(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      res.status(409).json({ error: "A shared view with that name already exists." });
      return;
    }
    console.error("[inbox] create view", e);
    res.status(500).json({ error: "Could not create view." });
  }
}

async function loadViewById(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM saved_views WHERE id = $1`, [id]);
  return rows[0] || null;
}

function canEditView(req, row) {
  if (!row) return false;
  if (row.is_shared) return isAdminUser(req);
  return Number(row.owner_id) === Number(req.user?.id);
}

/** PATCH /inbox/views/:id — rename, edit filters/sort/icon, reorder, toggle shared. */
export async function patchInboxView(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid view id." });
      return;
    }
    const pool = getPool();
    const row = await loadViewById(pool, id);
    if (!row) {
      res.status(404).json({ error: "View not found." });
      return;
    }
    if (!canEditView(req, row)) {
      res.status(403).json({ error: "You don't have permission to edit this view." });
      return;
    }
    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;
    if (typeof body.name === "string") {
      const v = body.name.trim();
      if (!v) {
        res.status(400).json({ error: "name cannot be empty." });
        return;
      }
      sets.push(`name = $${n++}`);
      vals.push(v);
    }
    if (body.icon !== undefined) {
      sets.push(`icon = $${n++}`);
      vals.push(typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : null);
    }
    if (body.filters !== undefined) {
      if (!body.filters || typeof body.filters !== "object") {
        res.status(400).json({ error: "filters must be an object." });
        return;
      }
      sets.push(`filters = $${n++}::jsonb`);
      vals.push(JSON.stringify(body.filters));
    }
    if (body.sort !== undefined) {
      sets.push(`sort = $${n++}::jsonb`);
      vals.push(body.sort ? JSON.stringify(body.sort) : null);
    }
    if (body.position !== undefined) {
      const pos = Number(body.position);
      if (!Number.isFinite(pos)) {
        res.status(400).json({ error: "position must be a number." });
        return;
      }
      sets.push(`position = $${n++}`);
      vals.push(pos);
    }
    if (body.is_shared !== undefined) {
      const next = body.is_shared === true;
      if (next !== !!row.is_shared && !isAdminUser(req)) {
        res.status(403).json({ error: "Only admins can change sharing." });
        return;
      }
      sets.push(`is_shared = $${n++}`);
      vals.push(next);
      sets.push(`owner_id = $${n++}`);
      vals.push(next ? null : req.user.id);
    }
    if (!sets.length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE saved_views SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    res.json({ view: mapView(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      res.status(409).json({ error: "A shared view with that name already exists." });
      return;
    }
    console.error("[inbox] patch view", e);
    res.status(500).json({ error: "Could not update view." });
  }
}

/** DELETE /inbox/views/:id — owner or admin (for shared views). */
export async function deleteInboxView(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid view id." });
      return;
    }
    const pool = getPool();
    const row = await loadViewById(pool, id);
    if (!row) {
      res.status(404).json({ error: "View not found." });
      return;
    }
    if (!canEditView(req, row)) {
      res.status(403).json({ error: "You don't have permission to delete this view." });
      return;
    }
    await pool.query(`DELETE FROM saved_views WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[inbox] delete view", e);
    res.status(500).json({ error: "Could not delete view." });
  }
}

/** GET /inbox/views/:id/threads — execute the view's filters against
 *  /inbox/threads. Mostly a convenience for places that want to apply a
 *  view without the UI knowing its filter shape. */
export async function getInboxViewThreads(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid view id." });
      return;
    }
    const pool = getPool();
    const row = await loadViewById(pool, id);
    if (!row) {
      res.status(404).json({ error: "View not found." });
      return;
    }
    if (!row.is_shared && Number(row.owner_id) !== Number(req.user.id)) {
      res.status(403).json({ error: "You don't have access to this view." });
      return;
    }
    const synthQuery = {
      ...reqQueryFromFilters(row.filters, row.sort),
      limit: req.query.limit,
      offset: req.query.offset,
    };
    const fakeReq = { query: synthQuery, user: req.user };
    return getInboxThreads(fakeReq, res);
  } catch (e) {
    console.error("[inbox] view threads", e);
    res.status(500).json({ error: "Could not run view." });
  }
}
