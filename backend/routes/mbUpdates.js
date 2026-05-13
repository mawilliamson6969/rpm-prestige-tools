/**
 * Monday-style boards: activity feed for items and subitems.
 *
 * Two parallel feeds — one per item, one per subitem — share the same
 * shape. Posting to AppFolio is a Phase 2/3 concern; the schema reserves
 * `posted_to_appfolio` and `appfolio_note_id` for then.
 */

import { getPool } from "../lib/db.js";
import {
  vIntId,
  vStringReq,
  vUpdateType,
  vJson,
} from "../lib/mb/validators.js";

export async function listItemUpdates(req, res) {
  try {
    const itemId = vIntId(req.params.itemId, "item id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT u.*, usr.display_name AS user_display_name
         FROM mb_item_updates u
         LEFT JOIN users usr ON usr.id = u.user_id
        WHERE u.item_id = $1
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT 500`,
      [itemId]
    );
    res.json({ updates: rows });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] item updates list", e);
    res.status(500).json({ error: "Could not load updates." });
  }
}

export async function createItemUpdate(req, res) {
  try {
    const itemId = vIntId(req.params.itemId, "item id");
    const body = req.body ?? {};
    const text = vStringReq(body.body, "body", { maxLen: 20_000 });
    const updateType =
      vUpdateType(body.update_type, { allowNull: true }) || "comment";
    const metadata =
      body.metadata == null
        ? {}
        : vJson(body.metadata, "metadata", { requireObject: true });

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO mb_item_updates
         (item_id, user_id, body, update_type, metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING *`,
      [itemId, req.user.id, text, updateType, JSON.stringify(metadata)]
    );
    res.status(201).json({ update: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23503") {
      return res.status(404).json({ error: "Item not found." });
    }
    console.error("[mb] item update create", e);
    res.status(500).json({ error: "Could not post update." });
  }
}

export async function listSubitemUpdates(req, res) {
  try {
    const subitemId = vIntId(req.params.subitemId, "subitem id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT u.*, usr.display_name AS user_display_name
         FROM mb_subitem_updates u
         LEFT JOIN users usr ON usr.id = u.user_id
        WHERE u.subitem_id = $1
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT 500`,
      [subitemId]
    );
    res.json({ updates: rows });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] subitem updates list", e);
    res.status(500).json({ error: "Could not load updates." });
  }
}

export async function createSubitemUpdate(req, res) {
  try {
    const subitemId = vIntId(req.params.subitemId, "subitem id");
    const body = req.body ?? {};
    const text = vStringReq(body.body, "body", { maxLen: 20_000 });
    const updateType =
      vUpdateType(body.update_type, { allowNull: true }) || "comment";
    const metadata =
      body.metadata == null
        ? {}
        : vJson(body.metadata, "metadata", { requireObject: true });

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO mb_subitem_updates
         (subitem_id, user_id, body, update_type, metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING *`,
      [subitemId, req.user.id, text, updateType, JSON.stringify(metadata)]
    );
    res.status(201).json({ update: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23503") {
      return res.status(404).json({ error: "Subitem not found." });
    }
    console.error("[mb] subitem update create", e);
    res.status(500).json({ error: "Could not post update." });
  }
}
