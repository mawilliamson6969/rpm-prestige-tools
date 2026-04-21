import { getPool } from "../lib/db.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const contextCache = new Map(); // key → { at: ms, body }

function cacheGet(key) {
  const entry = contextCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    contextCache.delete(key);
    return null;
  }
  return entry.body;
}

function cacheSet(key, body) {
  contextCache.set(key, { at: Date.now(), body });
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}

function truthy(v) {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1" || s === "y";
  }
  if (typeof v === "number") return v !== 0;
  return false;
}

/**
 * Resolve a property by id OR name.
 * Returns { id, name, row } or null.
 */
async function resolveProperty(pool, { propertyId, propertyName }) {
  if (Number.isFinite(propertyId)) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_properties
       WHERE appfolio_data->>'property_id' = $1::text
       LIMIT 1`,
      [propertyId]
    );
    if (rows.length) {
      const d = rows[0].appfolio_data || {};
      return {
        id: Number(d.property_id) || propertyId,
        name: d.property_name || d.property || String(propertyName || ""),
        row: d,
      };
    }
  }
  if (propertyName && typeof propertyName === "string" && propertyName.trim()) {
    const name = propertyName.trim();
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_properties
       WHERE LOWER(appfolio_data->>'property_name') = LOWER($1)
          OR LOWER(appfolio_data->>'property') = LOWER($1)
          OR appfolio_data->>'property' ILIKE $1 || ' -%'
          OR LOWER(appfolio_data->>'property_name') LIKE LOWER($1) || '%'
       ORDER BY
         CASE WHEN LOWER(appfolio_data->>'property_name') = LOWER($1) THEN 0 ELSE 1 END,
         LENGTH(appfolio_data->>'property_name')
       LIMIT 1`,
      [name]
    );
    if (rows.length) {
      const d = rows[0].appfolio_data || {};
      return {
        id: Number(d.property_id) || null,
        name: d.property_name || d.property || name,
        row: d,
      };
    }
    // Property not in cache — return what we know from the name alone.
    return { id: null, name, row: null };
  }
  return null;
}

async function buildContext(pool, resolved) {
  const { id: propertyId, name: propertyName, row: propertyRow } = resolved;

  const alerts = [];

  // --- cached_rent_roll (occupancy) ---
  const rentRollQuery = propertyId
    ? await pool.query(
        `SELECT appfolio_data FROM cached_rent_roll
         WHERE appfolio_data->>'property_id' = $1::text
         LIMIT 1`,
        [propertyId]
      )
    : await pool.query(
        `SELECT appfolio_data FROM cached_rent_roll
         WHERE LOWER(appfolio_data->>'property_name') = LOWER($1)
         LIMIT 1`,
        [propertyName]
      );
  const rent = rentRollQuery.rows[0]?.appfolio_data || null;

  const occupancy = rent
    ? {
        status: rent.status || null,
        tenant_name: rent.tenant || null,
        tenant_email: rent.primary_tenant_email || null,
        tenant_phone: rent.primary_tenant_phone_number || rent.phone_numbers || null,
        rent: toNum(rent.rent),
        market_rent: toNum(rent.market_rent),
        lease_from: rent.lease_from || null,
        lease_to: rent.lease_to || null,
        move_in: rent.move_in || null,
        past_due: toNum(rent.past_due),
        deposit: toNum(rent.deposit),
        additional_tenants: rent.additional_tenants || null,
        unit: rent.unit || null,
      }
    : null;

  if (occupancy?.status === "Vacant-Unrented") {
    alerts.push({ severity: "bad", message: "Vacant" });
  } else if (occupancy?.status === "Notice-Unrented") {
    alerts.push({ severity: "warning", message: "On Notice — tenant moving out" });
  }

  // --- cached_delinquency ---
  const delinqRows = await pool.query(
    `SELECT appfolio_data FROM cached_delinquency
     WHERE LOWER(appfolio_data->>'property_name') = LOWER($1)
     LIMIT 1`,
    [propertyName]
  );
  const del = delinqRows.rows[0]?.appfolio_data || null;
  const amountReceivable = toNum(del?.amount_receivable);
  const delinquency = del
    ? {
        amount_receivable: amountReceivable,
        aging: {
          current: toNum(del["00_to30"]),
          thirty: toNum(del["30_to60"]),
          sixty: toNum(del["60_to90"]),
          ninety: toNum(del["90_plus"]),
        },
        last_payment: del.last_payment || null,
        in_collections: truthy(del.in_collections),
        tenant_email: del.primary_tenant_email || null,
        tenant_phone: del.phone_numbers || null,
      }
    : null;

  if (amountReceivable >= 1000) {
    alerts.push({
      severity: "bad",
      message: `Delinquent: $${amountReceivable.toFixed(2)} past due${
        delinquency?.aging.ninety ? ` (90+: $${delinquency.aging.ninety.toFixed(2)})` : ""
      }`,
    });
  } else if (amountReceivable >= 500) {
    alerts.push({
      severity: "warning",
      message: `Delinquent: $${amountReceivable.toFixed(2)} past due`,
    });
  }
  if (delinquency?.in_collections) {
    alerts.push({ severity: "bad", message: "In Collections" });
  }

  // --- cached_owners (matched through cached_properties.owner_i_ds or name) ---
  let ownerRow = null;
  const propOwnerIds = Array.isArray(propertyRow?.owner_i_ds)
    ? propertyRow.owner_i_ds
    : typeof propertyRow?.owner_i_ds === "string"
    ? propertyRow.owner_i_ds
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (propOwnerIds.length) {
    const { rows: ownerRows } = await pool.query(
      `SELECT appfolio_data FROM cached_owners
       WHERE appfolio_data->>'owner_id' = ANY($1::text[])
       LIMIT 1`,
      [propOwnerIds.map(String)]
    );
    ownerRow = ownerRows[0]?.appfolio_data || null;
  }
  if (!ownerRow && propertyRow?.owners) {
    const ownerNames =
      typeof propertyRow.owners === "string"
        ? propertyRow.owners
        : JSON.stringify(propertyRow.owners);
    const { rows: ownerRows } = await pool.query(
      `SELECT appfolio_data FROM cached_owners
       WHERE $1 ILIKE '%' || appfolio_data->>'name' || '%'
          OR appfolio_data->>'name' ILIKE '%' || $1 || '%'
       LIMIT 1`,
      [ownerNames]
    );
    ownerRow = ownerRows[0]?.appfolio_data || null;
  }
  const owner = ownerRow
    ? {
        owner_name: ownerRow.name || `${ownerRow.first_name || ""} ${ownerRow.last_name || ""}`.trim(),
        owner_email: ownerRow.email || null,
        owner_phone: ownerRow.phone_numbers || null,
      }
    : null;

  // --- cached_lease_expirations ---
  const leaseRows = await pool.query(
    `SELECT appfolio_data FROM cached_lease_expirations
     WHERE LOWER(appfolio_data->>'property_name') = LOWER($1)
     ORDER BY appfolio_data->>'lease_expires' DESC NULLS LAST
     LIMIT 1`,
    [propertyName]
  );
  const lx = leaseRows.rows[0]?.appfolio_data || null;
  const lease = lx
    ? {
        lease_expires: lx.lease_expires || null,
        lease_expires_month: lx.lease_expires_month || null,
        status: lx.status || null,
        notice_given_date: lx.notice_given_date || null,
      }
    : occupancy?.lease_to
    ? {
        lease_expires: occupancy.lease_to,
        lease_expires_month: null,
        status: null,
        notice_given_date: null,
      }
    : null;

  const leaseExpiresIn = daysUntil(lease?.lease_expires);
  if (
    lease &&
    leaseExpiresIn !== null &&
    leaseExpiresIn <= 45 &&
    leaseExpiresIn >= 0 &&
    lease.status !== "Renewed"
  ) {
    alerts.push({
      severity: "warning",
      message: `Lease expires in ${leaseExpiresIn} day${
        leaseExpiresIn === 1 ? "" : "s"
      } — not yet renewed`,
    });
  }

  // --- cached_work_orders (open) ---
  const woRows = propertyId
    ? await pool.query(
        `SELECT appfolio_data FROM cached_work_orders
         WHERE appfolio_data->>'property_id' = $1::text
           AND appfolio_data->>'status' NOT IN ('Completed', 'Canceled')
         ORDER BY appfolio_data->>'created_at' DESC NULLS LAST
         LIMIT 20`,
        [propertyId]
      )
    : await pool.query(
        `SELECT appfolio_data FROM cached_work_orders
         WHERE LOWER(appfolio_data->>'property_name') = LOWER($1)
           AND appfolio_data->>'status' NOT IN ('Completed', 'Canceled')
         ORDER BY appfolio_data->>'created_at' DESC NULLS LAST
         LIMIT 20`,
        [propertyName]
      );
  const openOrders = woRows.rows.map((r) => {
    const d = r.appfolio_data || {};
    return {
      work_order_number: d.work_order_number || null,
      status: d.status || null,
      priority: d.priority || null,
      vendor: d.vendor || null,
      work_order_issue: d.work_order_issue || null,
      job_description: d.job_description || null,
      created_at: d.created_at || null,
      days_open: daysSince(d.created_at),
    };
  });
  const workOrders = { open_count: openOrders.length, orders: openOrders };

  const urgentOld = openOrders.find(
    (w) => w.priority === "Urgent" && (w.days_open ?? 0) >= 3
  );
  if (urgentOld) {
    alerts.push({
      severity: "bad",
      message: `Emergency work order open for ${urgentOld.days_open} days`,
    });
  } else if (openOrders.length > 5) {
    alerts.push({ severity: "bad", message: `${openOrders.length} open work orders` });
  } else if (openOrders.length >= 3) {
    alerts.push({ severity: "warning", message: `${openOrders.length} open work orders` });
  }

  // --- cached_work_orders_all (historical stats, YTD) ---
  let workOrderHistory = null;
  try {
    const yearStart = `${new Date().getUTCFullYear()}-01-01`;
    const histQuery = propertyId
      ? await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE appfolio_data->>'created_at' >= $2) AS total_ytd,
             COUNT(*) FILTER (WHERE appfolio_data->>'status' = 'Completed' AND appfolio_data->>'completed_on' >= $2) AS completed_ytd,
             COALESCE(SUM((appfolio_data->>'vendor_bill_amount')::numeric)
               FILTER (WHERE appfolio_data->>'completed_on' >= $2), 0) AS total_spend_ytd,
             AVG(
               EXTRACT(EPOCH FROM (
                 (appfolio_data->>'completed_on')::timestamp -
                 (appfolio_data->>'created_at')::timestamp
               )) / 86400
             ) FILTER (WHERE
               appfolio_data->>'status' = 'Completed'
               AND appfolio_data->>'completed_on' IS NOT NULL
               AND appfolio_data->>'completed_on' >= $2
             ) AS avg_days_to_complete
           FROM cached_work_orders_all
           WHERE appfolio_data->>'property_id' = $1::text`,
          [propertyId, yearStart]
        )
      : await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE appfolio_data->>'created_at' >= $2) AS total_ytd,
             COUNT(*) FILTER (WHERE appfolio_data->>'status' = 'Completed' AND appfolio_data->>'completed_on' >= $2) AS completed_ytd,
             COALESCE(SUM((appfolio_data->>'vendor_bill_amount')::numeric)
               FILTER (WHERE appfolio_data->>'completed_on' >= $2), 0) AS total_spend_ytd,
             AVG(
               EXTRACT(EPOCH FROM (
                 (appfolio_data->>'completed_on')::timestamp -
                 (appfolio_data->>'created_at')::timestamp
               )) / 86400
             ) FILTER (WHERE
               appfolio_data->>'status' = 'Completed'
               AND appfolio_data->>'completed_on' IS NOT NULL
               AND appfolio_data->>'completed_on' >= $2
             ) AS avg_days_to_complete
           FROM cached_work_orders_all
           WHERE LOWER(appfolio_data->>'property_name') = LOWER($1)`,
          [propertyName, yearStart]
        );
    const h = histQuery.rows[0] || {};
    workOrderHistory = {
      total_ytd: Number(h.total_ytd) || 0,
      completed_ytd: Number(h.completed_ytd) || 0,
      avg_days_to_complete:
        h.avg_days_to_complete !== null ? Math.round(Number(h.avg_days_to_complete)) : null,
      total_spend_ytd: Number(h.total_spend_ytd) || 0,
    };
  } catch (err) {
    /* cached_work_orders_all may not exist on older deployments */
    workOrderHistory = null;
  }

  // --- cached_leadsimple_deals + tasks ---
  const dealsRows = await pool.query(
    `SELECT appfolio_data FROM cached_leadsimple_deals
     WHERE (appfolio_data->'property'->>'name' ILIKE '%' || $1 || '%'
        OR appfolio_data->>'property' ILIKE '%' || $1 || '%')
       AND appfolio_data->>'status' IN ('open', 'won')
     ORDER BY appfolio_data->>'created_at' DESC NULLS LAST
     LIMIT 10`,
    [propertyName]
  );
  const tasksRows = await pool.query(
    `SELECT COUNT(*)::int AS c FROM cached_leadsimple_tasks
     WHERE (appfolio_data->'property'->>'name' ILIKE '%' || $1 || '%'
        OR appfolio_data->>'property' ILIKE '%' || $1 || '%')
       AND (appfolio_data->>'completed' IS NULL OR appfolio_data->>'completed' = 'false')`,
    [propertyName]
  );
  const leadsimple = {
    active_deals: dealsRows.rows.map((r) => {
      const d = r.appfolio_data || {};
      const pipelineName = typeof d.pipeline === "object" ? d.pipeline?.name : d.pipeline;
      return {
        pipeline_name: pipelineName || null,
        stage: typeof d.stage === "object" ? d.stage?.name : d.stage || null,
        deal_name: d.name || null,
        created_at: d.created_at || null,
      };
    }),
    open_tasks_count: Number(tasksRows.rows[0]?.c) || 0,
  };

  // --- cached_rentengine_leads ---
  const rentengineRows = await pool.query(
    `SELECT appfolio_data FROM cached_rentengine_leads
     WHERE (appfolio_data->>'property_name' ILIKE '%' || $1 || '%'
        OR appfolio_data->>'unit_of_interest' = $2::text)
     ORDER BY appfolio_data->>'created_at' DESC NULLS LAST
     LIMIT 5`,
    [propertyName, propertyId ? String(propertyId) : null]
  );
  const rentengine = {
    active_leads_count: rentengineRows.rows.length,
    recent_leads: rentengineRows.rows.map((r) => {
      const d = r.appfolio_data || {};
      return {
        name: d.name || null,
        email: d.email || null,
        phone: d.phone || null,
        status: d.status || null,
        source: d.source || null,
        created_at: d.created_at || null,
      };
    }),
  };

  if (occupancy?.status === "Vacant-Unrented" && rentengine.active_leads_count === 0) {
    alerts.push({ severity: "bad", message: "Vacant — no active leads" });
  }

  // --- cached_boom_applications ---
  const boomRows = await pool.query(
    `SELECT appfolio_data FROM cached_boom_applications
     WHERE appfolio_data::text ILIKE '%' || $1 || '%'
     ORDER BY appfolio_data->>'created_at' DESC NULLS LAST
     LIMIT 10`,
    [propertyName]
  );
  const boom = {
    pending_applications_count: boomRows.rows.filter((r) => {
      const s = String(r.appfolio_data?.status || "").toLowerCase();
      return s === "pending" || s === "in_review" || s === "submitted";
    }).length,
    applications: boomRows.rows.slice(0, 5).map((r) => {
      const d = r.appfolio_data || {};
      return {
        applicant_name:
          d.applicant_name ||
          d.name ||
          [d.first_name, d.last_name].filter(Boolean).join(" ") ||
          null,
        status: d.status || null,
        created_at: d.created_at || null,
      };
    }),
  };

  // --- Health score ---
  let score = 100;
  const factors = {
    occupancy: "good",
    delinquency: "good",
    workOrders: "good",
    leaseStatus: "good",
  };
  if (occupancy?.status === "Vacant-Unrented") {
    score -= 30;
    factors.occupancy = "bad";
  } else if (occupancy?.status === "Notice-Unrented") {
    score -= 15;
    factors.occupancy = "warning";
  }
  if (amountReceivable >= 1000) {
    score -= 30;
    factors.delinquency = "bad";
  } else if (amountReceivable >= 500) {
    score -= 20;
    factors.delinquency = "warning";
  }
  if (openOrders.length > 5) {
    score -= 20;
    factors.workOrders = "bad";
  } else if (openOrders.length > 3) {
    score -= 10;
    factors.workOrders = "warning";
  }
  if (
    lease &&
    leaseExpiresIn !== null &&
    leaseExpiresIn <= 30 &&
    leaseExpiresIn >= 0 &&
    lease.status !== "Renewed"
  ) {
    score -= 15;
    factors.leaseStatus = "warning";
  } else if (lease?.status === "Month-To-Month" || lease?.status === "Month-to-Month") {
    factors.leaseStatus = "warning";
  } else if (lease?.status === "Renewed") {
    factors.leaseStatus = "good";
  }
  if (delinquency?.in_collections) {
    score -= 10;
  }
  score = Math.max(0, Math.min(100, score));

  // --- lastSyncedAt (most recent across relevant tables) ---
  const { rows: syncRows } = await pool.query(
    `SELECT MAX(synced_at) AS last_sync FROM (
       SELECT synced_at FROM cached_rent_roll
       UNION ALL SELECT synced_at FROM cached_delinquency
       UNION ALL SELECT synced_at FROM cached_work_orders
       UNION ALL SELECT synced_at FROM cached_lease_expirations
     ) t`
  );

  return {
    property: {
      property_name: propertyName,
      property_id: propertyId,
      property_address: propertyRow?.property_address || null,
      property_city: propertyRow?.property_city || null,
      property_state: propertyRow?.property_state || null,
      property_zip: propertyRow?.property_zip || null,
      property_type: propertyRow?.property_type || null,
      management_fee_percent: propertyRow?.management_fee_percent
        ? Number(propertyRow.management_fee_percent)
        : null,
    },
    alerts,
    occupancy,
    owner,
    lease: lease ? { ...lease, expires_in_days: leaseExpiresIn } : null,
    delinquency,
    workOrders,
    workOrderHistory,
    leadsimple,
    rentengine,
    boom,
    healthScore: { score, factors },
    lastSyncedAt: syncRows[0]?.last_sync || null,
  };
}

export async function getPropertyContextById(req, res) {
  const propertyId = Number.parseInt(req.params.propertyId, 10);
  if (!Number.isFinite(propertyId)) {
    res.status(400).json({ error: "Invalid propertyId." });
    return;
  }
  const cacheKey = `id:${propertyId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.json({ ...cached, cached: true });
    return;
  }
  try {
    const pool = getPool();
    const resolved = await resolveProperty(pool, { propertyId });
    if (!resolved) {
      res.status(404).json({ error: "Property not found in cache." });
      return;
    }
    const body = await buildContext(pool, resolved);
    cacheSet(cacheKey, body);
    res.json(body);
  } catch (e) {
    console.error("[property-context]", e);
    res.status(500).json({ error: "Could not load property context." });
  }
}

export async function getPropertyContextByName(req, res) {
  const propertyName = decodeURIComponent(String(req.params.propertyName || "")).trim();
  if (!propertyName) {
    res.status(400).json({ error: "Property name required." });
    return;
  }
  const cacheKey = `name:${propertyName.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.json({ ...cached, cached: true });
    return;
  }
  try {
    const pool = getPool();
    const resolved = await resolveProperty(pool, { propertyName });
    if (!resolved) {
      res.status(404).json({ error: "Property not found." });
      return;
    }
    const body = await buildContext(pool, resolved);
    cacheSet(cacheKey, body);
    res.json(body);
  } catch (e) {
    console.error("[property-context]", e);
    res.status(500).json({ error: "Could not load property context." });
  }
}

export async function getPropertySearch(req, res) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length < 2) {
    res.json({ properties: [] });
    return;
  }
  try {
    const pool = getPool();
    const { rows: props } = await pool.query(
      `SELECT appfolio_data FROM cached_properties
       WHERE appfolio_data->>'property_name' ILIKE '%' || $1 || '%'
          OR appfolio_data->>'property_address' ILIKE '%' || $1 || '%'
          OR appfolio_data->>'property' ILIKE '%' || $1 || '%'
       ORDER BY appfolio_data->>'property_name' ASC
       LIMIT 25`,
      [q]
    );
    const statusByProp = new Map();
    if (props.length) {
      const ids = props
        .map((r) => r.appfolio_data?.property_id)
        .filter((v) => v !== null && v !== undefined)
        .map(String);
      const names = props.map((r) => r.appfolio_data?.property_name).filter(Boolean);
      const { rows: statusRows } = await pool.query(
        `SELECT appfolio_data->>'property_id' AS pid,
                appfolio_data->>'property_name' AS pname,
                appfolio_data->>'status' AS status
         FROM cached_rent_roll
         WHERE appfolio_data->>'property_id' = ANY($1::text[])
            OR appfolio_data->>'property_name' = ANY($2::text[])`,
        [ids, names]
      );
      for (const s of statusRows) {
        const key = s.pid || `name:${(s.pname || "").toLowerCase()}`;
        statusByProp.set(key, s.status);
      }
    }
    const results = props.map((r) => {
      const d = r.appfolio_data || {};
      const pid = d.property_id != null ? String(d.property_id) : null;
      const status =
        (pid && statusByProp.get(pid)) ||
        statusByProp.get(`name:${(d.property_name || "").toLowerCase()}`) ||
        null;
      return {
        property_id: pid ? Number(pid) : null,
        property_name: d.property_name || d.property || null,
        property_address: d.property_address || null,
        property_type: d.property_type || null,
        occupancy_status: status,
      };
    });
    res.json({ properties: results });
  } catch (e) {
    console.error("[property-search]", e);
    res.status(500).json({ error: "Could not search properties." });
  }
}
