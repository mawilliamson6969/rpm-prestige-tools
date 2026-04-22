import { getPool } from "../lib/db.js";

const DEFAULT_PREFS = {
  hubLayout: [],
  sidebarOrder: [],
  sidebarCollapsed: [],
  sidebarPinned: [],
  sidebarHidden: [],
  hubWidgets: [],
};

function mapRow(row) {
  if (!row) return { ...DEFAULT_PREFS };
  return {
    hubLayout: Array.isArray(row.hub_layout) ? row.hub_layout : [],
    sidebarOrder: Array.isArray(row.sidebar_order) ? row.sidebar_order : [],
    sidebarCollapsed: Array.isArray(row.sidebar_collapsed) ? row.sidebar_collapsed : [],
    sidebarPinned: Array.isArray(row.sidebar_pinned) ? row.sidebar_pinned : [],
    sidebarHidden: Array.isArray(row.sidebar_hidden) ? row.sidebar_hidden : [],
    hubWidgets: Array.isArray(row.hub_widgets) ? row.hub_widgets : [],
  };
}

export async function getLayoutPrefs(req, res) {
  const userId = Number(req.user?.id);
  if (!Number.isFinite(userId)) {
    res.status(401).json({ error: "Auth required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT hub_layout, sidebar_order, sidebar_collapsed, sidebar_pinned, sidebar_hidden, hub_widgets
         FROM user_layout_preferences WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    res.json(mapRow(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load layout preferences." });
  }
}

function sanitizeArray(v) {
  return Array.isArray(v) ? v : [];
}

export async function putLayoutPrefs(req, res) {
  const userId = Number(req.user?.id);
  if (!Number.isFinite(userId)) {
    res.status(401).json({ error: "Auth required." });
    return;
  }
  const body = req.body || {};
  const hubLayout = sanitizeArray(body.hubLayout);
  const sidebarOrder = sanitizeArray(body.sidebarOrder);
  const sidebarCollapsed = sanitizeArray(body.sidebarCollapsed);
  const sidebarPinned = sanitizeArray(body.sidebarPinned);
  const sidebarHidden = sanitizeArray(body.sidebarHidden);
  const hubWidgets = sanitizeArray(body.hubWidgets);

  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO user_layout_preferences
        (user_id, hub_layout, sidebar_order, sidebar_collapsed, sidebar_pinned, sidebar_hidden, hub_widgets, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         hub_layout = EXCLUDED.hub_layout,
         sidebar_order = EXCLUDED.sidebar_order,
         sidebar_collapsed = EXCLUDED.sidebar_collapsed,
         sidebar_pinned = EXCLUDED.sidebar_pinned,
         sidebar_hidden = EXCLUDED.sidebar_hidden,
         hub_widgets = EXCLUDED.hub_widgets,
         updated_at = NOW()`,
      [
        userId,
        JSON.stringify(hubLayout),
        JSON.stringify(sidebarOrder),
        JSON.stringify(sidebarCollapsed),
        JSON.stringify(sidebarPinned),
        JSON.stringify(sidebarHidden),
        JSON.stringify(hubWidgets),
      ]
    );
    res.json({
      hubLayout,
      sidebarOrder,
      sidebarCollapsed,
      sidebarPinned,
      sidebarHidden,
      hubWidgets,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save layout preferences." });
  }
}

export async function resetLayoutPrefs(req, res) {
  const userId = Number(req.user?.id);
  if (!Number.isFinite(userId)) {
    res.status(401).json({ error: "Auth required." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM user_layout_preferences WHERE user_id = $1`, [userId]);
    res.json({ ...DEFAULT_PREFS });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not reset layout preferences." });
  }
}
