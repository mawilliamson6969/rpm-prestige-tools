import { getPool } from "../lib/db.js";

const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
}

function clampLimit(raw, fallback, max = 50) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

async function widgetMyTasks(req) {
  const userId = Number(req.user?.id);
  const limit = clampLimit(req.query.limit, 5, 20);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.due_date, t.priority, t.status,
            p.name AS process_name, t.property_name
       FROM tasks t
  LEFT JOIN process_steps ps ON ps.id = t.process_step_id
  LEFT JOIN processes p ON p.id = ps.process_id
      WHERE t.assigned_user_id = $1
        AND t.status NOT IN ('completed','canceled')
   ORDER BY
     CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
     t.due_date ASC,
     CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
     t.created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue
       FROM tasks WHERE assigned_user_id = $1 AND status NOT IN ('completed','canceled')`,
    [userId]
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: r.due_date,
      priority: r.priority,
      status: r.status,
      processName: r.process_name,
      propertyName: r.property_name,
    })),
    total: totalRows[0]?.total ?? 0,
    overdue: totalRows[0]?.overdue ?? 0,
  };
}

async function widgetRecentActivity(req) {
  const limit = clampLimit(req.query.limit, 10, 50);
  const pool = getPool();
  const { rows } = await pool.query(
    `
    (SELECT 'task_completed' AS type, u.display_name AS user_name,
            CONCAT('Completed: ', t.title) AS description, t.completed_at AS timestamp
       FROM tasks t LEFT JOIN users u ON u.id = t.completed_by
      WHERE t.completed_at IS NOT NULL
      ORDER BY t.completed_at DESC LIMIT $1)
    UNION ALL
    (SELECT 'process_started' AS type, u.display_name AS user_name,
            CONCAT('Launched: ', p.name) AS description, p.created_at AS timestamp
       FROM processes p LEFT JOIN users u ON u.id = p.created_by
      ORDER BY p.created_at DESC LIMIT $1)
    UNION ALL
    (SELECT 'announcement_posted' AS type, NULL::text AS user_name,
            CONCAT('Posted: ', a.title) AS description, a.created_at AS timestamp
       FROM announcements a
      WHERE a.is_active = true
      ORDER BY a.created_at DESC LIMIT $1)
    ORDER BY timestamp DESC
    LIMIT $1
  `,
    [limit]
  );
  return {
    items: rows.map((r) => ({
      type: r.type,
      user: r.user_name,
      description: r.description,
      timestamp: r.timestamp,
    })),
  };
}

async function widgetOpenWorkOrders() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT appfolio_data FROM cached_work_orders_all
      WHERE appfolio_data->>'status' IS NOT NULL`
  );
  const byStatus = {};
  let total = 0;
  let urgent = 0;
  for (const r of rows) {
    const data = r.appfolio_data || {};
    const status = String(data.status || "").trim();
    if (!status || /completed|closed|canceled/i.test(status)) continue;
    byStatus[status] = (byStatus[status] || 0) + 1;
    total += 1;
    if (/urgent|emergency|priority/i.test(String(data.priority || ""))) urgent += 1;
  }
  return { total, byStatus, urgent };
}

async function widgetDelinquencySummary() {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT appfolio_data FROM cached_delinquency`);
  let total = 0;
  let accountCount = 0;
  let inCollections = 0;
  const aging = { current: 0, thirty: 0, sixty: 0, ninety: 0 };
  for (const r of rows) {
    const d = r.appfolio_data || {};
    const bal = Number(d.total_balance ?? d.balance_total ?? d.total ?? 0);
    if (Number.isFinite(bal) && bal > 0) {
      accountCount += 1;
      total += bal;
    }
    aging.current += Number(d.current ?? d.balance_0_30 ?? 0) || 0;
    aging.thirty += Number(d.balance_30 ?? d.balance_30_60 ?? 0) || 0;
    aging.sixty += Number(d.balance_60 ?? d.balance_60_90 ?? 0) || 0;
    aging.ninety += Number(d.balance_90 ?? d.balance_90_plus ?? 0) || 0;
    if (/collection/i.test(String(d.status || d.collection_status || ""))) inCollections += 1;
  }
  return { total: Number(total.toFixed(2)), accountCount, aging, inCollections };
}

function monthsBetween(from, to) {
  const diff = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return diff + (to.getDate() >= from.getDate() ? 0 : -1);
}

async function widgetLeaseExpirations() {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT appfolio_data FROM cached_lease_expirations`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next30 = 0;
  let next60 = 0;
  let next90 = 0;
  let notRenewed = 0;
  let monthToMonth = 0;
  for (const r of rows) {
    const d = r.appfolio_data || {};
    const rawEnd = d.lease_to_date || d.lease_end || d.end_date;
    if (!rawEnd) {
      if (String(d.lease_type || d.term || "").toLowerCase().includes("month")) monthToMonth += 1;
      continue;
    }
    const end = new Date(rawEnd);
    if (!Number.isFinite(end.getTime())) continue;
    const days = Math.floor((end.getTime() - today.getTime()) / 86400000);
    if (days >= 0 && days <= 30) next30 += 1;
    if (days >= 0 && days <= 60) next60 += 1;
    if (days >= 0 && days <= 90) next90 += 1;
    if (days < 0 && days > -30) notRenewed += 1;
  }
  return { next30, next60, next90, notRenewed, monthToMonth };
}

async function widgetUnreadInbox(req) {
  const userId = Number(req.user?.id);
  const pool = getPool();
  try {
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets t
        WHERE t.is_read = false AND (t.assigned_to = $1 OR t.assigned_to IS NULL)`,
      [userId]
    );
    const { rows } = await pool.query(
      `SELECT subject, sender_email, received_at
         FROM tickets t
        WHERE t.is_read = false AND (t.assigned_to = $1 OR t.assigned_to IS NULL)
     ORDER BY received_at DESC NULLS LAST LIMIT 3`,
      [userId]
    );
    return {
      unreadCount: countRows[0]?.c ?? 0,
      recent: rows.map((r) => ({
        subject: r.subject,
        from: r.sender_email,
        receivedAt: r.received_at,
      })),
    };
  } catch {
    return { unreadCount: 0, recent: [] };
  }
}

async function widgetActiveProcesses() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.status, p.target_completion, pt.name AS template_name
       FROM processes p
  LEFT JOIN process_templates pt ON pt.id = p.template_id
      WHERE p.status IN ('active','in_progress','pending')`
  );
  const today = new Date();
  const byTemplateMap = new Map();
  let total = rows.length;
  let overdueTotal = 0;
  for (const r of rows) {
    const key = r.template_name || "Untitled";
    const current = byTemplateMap.get(key) || { template: key, count: 0, overdue: 0 };
    current.count += 1;
    if (r.target_completion && new Date(r.target_completion) < today) {
      current.overdue += 1;
      overdueTotal += 1;
    }
    byTemplateMap.set(key, current);
  }
  const byTemplate = Array.from(byTemplateMap.values()).sort((a, b) => b.count - a.count);
  return { total, byTemplate, overdue: overdueTotal };
}

async function widgetAnnouncements(req) {
  const limit = clampLimit(req.query.limit, 3, 10);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, title, content, created_at
       FROM announcements
      WHERE is_active = true AND status = 'active'
   ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      author: null,
      createdAt: r.created_at,
    })),
  };
}

async function widgetRecentSubmissions(req) {
  const limit = clampLimit(req.query.limit, 5, 20);
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT fs.id, fs.submitted_at, fs.status, f.name AS form_name,
              fs.contact_name, fs.contact_email
         FROM form_submissions fs
    LEFT JOIN forms f ON f.id = fs.form_id
     ORDER BY fs.submitted_at DESC NULLS LAST
        LIMIT $1`,
      [limit]
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        formName: r.form_name,
        contactName: r.contact_name || r.contact_email || "Anonymous",
        submittedAt: r.submitted_at,
        status: r.status,
      })),
    };
  } catch {
    return { items: [] };
  }
}

async function widgetQuickStat(req) {
  const metric = String(req.query.metric || "occupancy_rate").trim();
  const pool = getPool();
  switch (metric) {
    case "occupancy_rate": {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE appfolio_data->>'unit_vacancy_status' = 'Occupied')::int AS occ
           FROM cached_units`
      );
      const total = rows[0]?.total || 0;
      const occ = rows[0]?.occ || 0;
      const value = total > 0 ? Number(((occ / total) * 100).toFixed(1)) : 0;
      return { label: "Occupancy Rate", value, suffix: "%", color: value >= 90 ? "green" : value >= 80 ? "yellow" : "red" };
    }
    case "total_doors": {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM cached_units`);
      return { label: "Total Doors", value: rows[0]?.c || 0, suffix: "", color: "blue" };
    }
    case "vacant_units": {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM cached_units WHERE appfolio_data->>'unit_vacancy_status' = 'Vacant'`
      );
      const v = rows[0]?.c || 0;
      return { label: "Vacant Units", value: v, suffix: "", color: v <= 5 ? "green" : v <= 10 ? "yellow" : "red" };
    }
    case "total_delinquency": {
      const sum = await widgetDelinquencySummary();
      return {
        label: "Total Delinquency",
        value: Number(sum.total.toFixed(0)),
        suffix: "",
        prefix: "$",
        color: sum.total >= 20000 ? "red" : "yellow",
      };
    }
    case "open_work_orders": {
      const wo = await widgetOpenWorkOrders();
      return { label: "Open Work Orders", value: wo.total, suffix: "", color: "blue" };
    }
    case "active_processes": {
      const ap = await widgetActiveProcesses();
      return { label: "Active Processes", value: ap.total, suffix: "", color: "blue" };
    }
    case "active_leads": {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM cached_leadsimple_deals`);
      return { label: "Active Leads", value: rows[0]?.c || 0, suffix: "", color: "blue" };
    }
    case "revenue_mtd": {
      return { label: "Revenue MTD", value: 0, suffix: "", prefix: "$", color: "blue" };
    }
    case "profit_margin": {
      return { label: "Profit Margin", value: 0, suffix: "%", color: "blue" };
    }
    case "avg_rent": {
      const { rows } = await pool.query(
        `SELECT AVG((appfolio_data->>'rent')::numeric) AS avg_rent FROM cached_units
          WHERE appfolio_data->>'rent' ~ '^[0-9]+(\\.[0-9]+)?$'`
      );
      const v = Number(rows[0]?.avg_rent || 0);
      return { label: "Avg Rent", value: Number(v.toFixed(0)), suffix: "", prefix: "$", color: "blue" };
    }
    default:
      return { label: metric, value: 0, suffix: "", color: "blue" };
  }
}

const HANDLERS = {
  my_tasks: widgetMyTasks,
  recent_activity: widgetRecentActivity,
  open_work_orders: widgetOpenWorkOrders,
  delinquency_summary: widgetDelinquencySummary,
  lease_expirations: widgetLeaseExpirations,
  unread_inbox: widgetUnreadInbox,
  active_processes: widgetActiveProcesses,
  announcements: widgetAnnouncements,
  recent_submissions: widgetRecentSubmissions,
  quick_stat: widgetQuickStat,
};

export async function getWidgetData(req, res) {
  const widgetId = String(req.params.widgetId || "").trim();
  const handler = HANDLERS[widgetId];
  if (!handler) {
    res.status(404).json({ error: `Unknown widget: ${widgetId}` });
    return;
  }
  const userId = req.user?.id ?? "anon";
  const qs = new URLSearchParams(req.query).toString();
  const cacheKey = `${widgetId}:${userId}:${qs}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Widget-Cache", "hit");
    res.json(cached);
    return;
  }
  try {
    const data = await handler(req);
    cacheSet(cacheKey, data);
    res.json(data);
  } catch (e) {
    console.error(`[widget ${widgetId}]`, e);
    res.status(500).json({ error: "Could not load widget data." });
  }
}
