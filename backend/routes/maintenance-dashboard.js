import { getPool } from "../lib/db.js";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const _caches = { all: null, inhouse: null, thirdparty: null };
const _cacheAt = { all: 0, inhouse: 0, thirdparty: 0 };

function num(v) {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

/** Vendor type classification based on spec. */
function vendorTypeSql() {
  return `
    CASE
      WHEN LOWER(appfolio_data->>'vendor') LIKE '%moon shadow%' THEN 'in_house'
      WHEN appfolio_data->>'vendor' IS NULL OR appfolio_data->>'vendor' = '' THEN 'unassigned'
      ELSE 'third_party'
    END
  `;
}

/** Returns SQL fragment that filters by vendor type based on `filter` param. */
function vendorFilterClause(filter) {
  if (filter === "inhouse") return `LOWER(appfolio_data->>'vendor') LIKE '%moon shadow%'`;
  if (filter === "thirdparty") {
    return `(appfolio_data->>'vendor' IS NOT NULL AND appfolio_data->>'vendor' != '' AND LOWER(appfolio_data->>'vendor') NOT LIKE '%moon shadow%')`;
  }
  return "TRUE";
}

async function tableExists(pool, name) {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS e`,
    [name]
  );
  return !!rows[0]?.e;
}

async function tableRowCount(pool, name) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM ${name}`);
  return rows[0]?.c ?? 0;
}

const OPEN_STATUSES = ["New", "Estimate Requested", "Estimated", "Assigned", "Scheduled", "Waiting", "Work Done", "Ready to Bill"];
const COMPLETED_STATUSES = ["Completed", "Completed No Need To Bill"];

async function buildMaintenanceData(filter) {
  const pool = getPool();
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const vFilter = vendorFilterClause(filter);

  // Check if cached_work_orders_all has data
  const hasAll = (await tableExists(pool, "cached_work_orders_all")) &&
    (await tableRowCount(pool, "cached_work_orders_all")) > 0;

  const allTable = hasAll ? "cached_work_orders_all" : "cached_work_orders";

  // -------- Section 1: Volume --------
  const { rows: volRows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE (appfolio_data->>'created_at')::date >= $1::date
      )::int AS total_ytd,
      COUNT(*) FILTER (
        WHERE appfolio_data->>'status' = ANY($2::text[])
          AND (appfolio_data->>'completed_on')::date >= $1::date
      )::int AS completed_ytd,
      COUNT(*) FILTER (
        WHERE appfolio_data->>'status' = 'Canceled'
          AND COALESCE((appfolio_data->>'canceled_on')::date, (appfolio_data->>'created_at')::date) >= $1::date
      )::int AS canceled_ytd,
      COUNT(*) FILTER (
        WHERE appfolio_data->>'status' = ANY($3::text[])
      )::int AS open_count
    FROM ${allTable}
    WHERE ${vFilter}
  `, [yearStart, COMPLETED_STATUSES, OPEN_STATUSES]);

  const volume = {
    totalYtd: volRows[0]?.total_ytd ?? 0,
    completedYtd: volRows[0]?.completed_ytd ?? 0,
    canceledYtd: volRows[0]?.canceled_ytd ?? 0,
    openCount: volRows[0]?.open_count ?? 0,
  };

  // -------- Section 2: Speed --------
  let speed = {
    avgDaysToComplete: null, medianDaysToComplete: null,
    avgSpeedToRepair: null, medianSpeedToRepair: null,
    avgDaysWorkDoneToCompleted: null, pctWithin5Days: null,
    completedCount: 0,
  };
  if (hasAll) {
    const { rows: spRows } = await pool.query(`
      WITH c AS (
        SELECT
          NULLIF(appfolio_data->>'created_at', '')::date AS created_at,
          NULLIF(appfolio_data->>'completed_on', '')::date AS completed_on,
          NULLIF(appfolio_data->>'work_completed_on', '')::date AS work_completed_on
        FROM ${allTable}
        WHERE appfolio_data->>'status' = ANY($1::text[])
          AND NULLIF(appfolio_data->>'completed_on','') IS NOT NULL
          AND (appfolio_data->>'completed_on')::date >= $2::date
          AND ${vFilter}
      )
      SELECT
        COUNT(*)::int AS cnt,
        AVG(completed_on - created_at)::numeric AS avg_complete,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY completed_on - created_at) AS median_complete,
        AVG(work_completed_on - created_at)::numeric AS avg_repair,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY work_completed_on - created_at) AS median_repair,
        AVG(completed_on - work_completed_on)::numeric AS avg_wd_to_c,
        (COUNT(*) FILTER (WHERE completed_on - created_at <= 5)::numeric * 100.0 / NULLIF(COUNT(*), 0))::numeric AS pct_5
      FROM c
    `, [COMPLETED_STATUSES, yearStart]);

    if (spRows[0]) {
      const r = spRows[0];
      speed = {
        completedCount: r.cnt ?? 0,
        avgDaysToComplete: r.avg_complete != null ? round1(Number(r.avg_complete)) : null,
        medianDaysToComplete: r.median_complete != null ? round1(Number(r.median_complete)) : null,
        avgSpeedToRepair: r.avg_repair != null ? round1(Number(r.avg_repair)) : null,
        medianSpeedToRepair: r.median_repair != null ? round1(Number(r.median_repair)) : null,
        avgDaysWorkDoneToCompleted: r.avg_wd_to_c != null ? round1(Number(r.avg_wd_to_c)) : null,
        pctWithin5Days: r.pct_5 != null ? round1(Number(r.pct_5)) : null,
      };
    }
  }

  // -------- Section 3: Billing --------
  let billing = {
    totalBillable: 0, avgAmountBillable: null, avgDaysBillable: null,
    totalNoBill: 0, avgAmountNoBill: 0, pctNoBill: null,
  };
  if (hasAll) {
    const { rows: bilRows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE appfolio_data->>'status' = 'Completed')::int AS billable_cnt,
        AVG(
          COALESCE((appfolio_data->>'vendor_bill_amount')::numeric, 0) +
          COALESCE((appfolio_data->>'tenant_total_charge_amount')::numeric, 0)
        ) FILTER (WHERE appfolio_data->>'status' = 'Completed')::numeric AS avg_amount,
        AVG((appfolio_data->>'completed_on')::date - (appfolio_data->>'created_at')::date)
          FILTER (WHERE appfolio_data->>'status' = 'Completed'
            AND NULLIF(appfolio_data->>'completed_on','') IS NOT NULL)::numeric AS avg_days,
        COUNT(*) FILTER (WHERE appfolio_data->>'status' = 'Completed No Need To Bill')::int AS no_bill_cnt
      FROM ${allTable}
      WHERE appfolio_data->>'status' = ANY($1::text[])
        AND NULLIF(appfolio_data->>'completed_on','') IS NOT NULL
        AND (appfolio_data->>'completed_on')::date >= $2::date
        AND ${vFilter}
    `, [COMPLETED_STATUSES, yearStart]);

    const r = bilRows[0];
    const totalCompleted = (r?.billable_cnt ?? 0) + (r?.no_bill_cnt ?? 0);
    billing = {
      totalBillable: r?.billable_cnt ?? 0,
      avgAmountBillable: r?.avg_amount != null ? round2(Number(r.avg_amount)) : null,
      avgDaysBillable: r?.avg_days != null ? round1(Number(r.avg_days)) : null,
      totalNoBill: r?.no_bill_cnt ?? 0,
      avgAmountNoBill: 0,
      pctNoBill: totalCompleted > 0 ? round1(((r?.no_bill_cnt ?? 0) / totalCompleted) * 100) : null,
    };
  }

  // -------- Section 4: Priority & Issue --------
  const { rows: priRows } = await pool.query(`
    SELECT appfolio_data->>'priority' AS priority, COUNT(*)::int AS cnt
    FROM ${allTable}
    WHERE (appfolio_data->>'created_at')::date >= $1::date AND ${vFilter}
    GROUP BY 1 ORDER BY 2 DESC
  `, [yearStart]);
  const { rows: issueRows } = await pool.query(`
    SELECT appfolio_data->>'work_order_issue' AS issue, COUNT(*)::int AS cnt
    FROM ${allTable}
    WHERE (appfolio_data->>'created_at')::date >= $1::date
      AND appfolio_data->>'work_order_issue' IS NOT NULL
      AND appfolio_data->>'work_order_issue' != ''
      AND ${vFilter}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `, [yearStart]);
  const urgentCount = priRows.filter((r) => ["Urgent", "Emergency"].includes(r.priority)).reduce((s, r) => s + r.cnt, 0);
  const totalYtdCount = priRows.reduce((s, r) => s + r.cnt, 0);
  const priority = {
    urgentPercent: totalYtdCount > 0 ? round1((urgentCount / totalYtdCount) * 100) : 0,
    byPriority: priRows.map((r) => ({ name: r.priority || "Unspecified", count: r.cnt })),
    byIssue: issueRows.map((r) => ({ name: r.issue, count: r.cnt })),
  };

  // -------- Section 5: Open WO Table (from cached_work_orders, not _all) --------
  const { rows: openRows } = await pool.query(`
    SELECT appfolio_data
    FROM cached_work_orders
    WHERE appfolio_data->>'status' = ANY($1::text[])
      AND ${vFilter}
    ORDER BY (appfolio_data->>'created_at')::date ASC
    LIMIT 500
  `, [OPEN_STATUSES]);

  const openTable = openRows.map((r) => {
    const d = r.appfolio_data;
    const createdAt = d.created_at;
    const daysOpen = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : null;
    return {
      workOrderNumber: d.work_order_number,
      workOrderId: d.work_order_id,
      status: d.status,
      priority: d.priority,
      propertyName: d.property_name,
      unitName: d.unit_name,
      primaryTenant: d.primary_tenant,
      workOrderIssue: d.work_order_issue,
      vendor: d.vendor,
      vendorTrade: d.vendor_trade,
      daysOpen,
      estimateAmount: num(d.estimate_amount),
      createdAt,
      jobDescription: d.job_description,
      instructions: d.instructions,
      estimateApprovalStatus: d.estimate_approval_status,
    };
  });

  // -------- Section 6: In-House Metrics --------
  const hasLabor = (await tableExists(pool, "cached_work_order_labor")) &&
    (await tableRowCount(pool, "cached_work_order_labor")) > 0;

  let inHouse = { available: false, overall: null, technicians: [] };
  if (hasLabor) {
    const { rows: ovRows } = await pool.query(`
      SELECT
        SUM((appfolio_data->>'worked_hours')::numeric) AS worked,
        SUM((appfolio_data->>'hours')::numeric) AS billable,
        AVG((appfolio_data->>'hours_difference')::numeric) AS avg_diff,
        COUNT(DISTINCT appfolio_data->>'work_order_id')::int AS wo_count
      FROM cached_work_order_labor
      WHERE (appfolio_data->>'date')::date >= $1::date
    `, [yearStart]);

    const worked = Number(ovRows[0]?.worked ?? 0);
    const billable = Number(ovRows[0]?.billable ?? 0);
    const woCount = ovRows[0]?.wo_count ?? 0;
    const overall = {
      totalWorkedHours: round2(worked),
      totalBillableHours: round2(billable),
      billablePercent: worked > 0 ? round1((billable / worked) * 100) : null,
      avgHoursPerWo: woCount > 0 ? round2(worked / woCount) : null,
      avgHoursDifference: ovRows[0]?.avg_diff != null ? round2(Number(ovRows[0].avg_diff)) : null,
    };

    const { rows: techRows } = await pool.query(`
      WITH labor AS (
        SELECT
          appfolio_data->>'maintenance_tech' AS tech,
          appfolio_data->>'work_order_id' AS wo_id,
          appfolio_data->>'date' AS labor_date,
          (appfolio_data->>'worked_hours')::numeric AS worked,
          (appfolio_data->>'hours')::numeric AS billable
        FROM cached_work_order_labor
        WHERE appfolio_data->>'maintenance_tech' IS NOT NULL
          AND appfolio_data->>'maintenance_tech' != ''
          AND (appfolio_data->>'date')::date >= $1::date
      ),
      wo AS (
        SELECT
          appfolio_data->>'work_order_id' AS wo_id,
          NULLIF(appfolio_data->>'created_at','')::date AS created_at,
          NULLIF(appfolio_data->>'completed_on','')::date AS completed_on,
          COALESCE((appfolio_data->>'vendor_bill_amount')::numeric, 0) AS bill_amount,
          COALESCE((appfolio_data->>'tenant_total_charge_amount')::numeric, 0) AS tenant_amount,
          appfolio_data->>'status' AS status
        FROM cached_work_orders_all
      ),
      agg AS (
        SELECT
          l.tech,
          COUNT(DISTINCT l.wo_id)::int AS wo_count,
          SUM(l.worked) AS worked,
          SUM(l.billable) AS billable,
          COUNT(DISTINCT l.labor_date)::int AS workdays,
          AVG(w.completed_on - w.created_at) FILTER (WHERE w.completed_on IS NOT NULL AND w.created_at IS NOT NULL) AS avg_complete_days,
          SUM(w.bill_amount + w.tenant_amount) AS revenue
        FROM labor l
        LEFT JOIN wo w ON w.wo_id = l.wo_id
        GROUP BY l.tech
      )
      SELECT a.*, COALESCE(tc.hourly_cost, 25.00) AS hourly_cost
      FROM agg a
      LEFT JOIN technician_config tc ON tc.technician_name = a.tech
      ORDER BY revenue DESC NULLS LAST
    `, [yearStart]);

    const technicians = techRows.map((r) => {
      const worked = Number(r.worked ?? 0);
      const billable = Number(r.billable ?? 0);
      const workdays = r.workdays ?? 0;
      const woCount = r.wo_count ?? 0;
      const revenue = Number(r.revenue ?? 0);
      const cost = worked * Number(r.hourly_cost);
      return {
        technicianName: r.tech,
        totalWos: woCount,
        totalWorkedHours: round2(worked),
        totalBillableHours: round2(billable),
        billablePercent: worked > 0 ? round1((billable / worked) * 100) : null,
        avgHoursPerWo: woCount > 0 ? round2(worked / woCount) : null,
        workedHoursPerWorkday: workdays > 0 ? round2(worked / workdays) : null,
        utilizationRate: workdays > 0 ? round1((billable / (workdays * 8)) * 100) : null,
        avgJobCompletionDays: r.avg_complete_days != null ? round1(Number(r.avg_complete_days)) : null,
        avgJobsPerWorkday: workdays > 0 ? round2(woCount / workdays) : null,
        hoursBilledVsWorked: worked > 0 ? round2(billable / worked) : null,
        totalAmountBilled: round2(revenue),
        revenuePerTech: round2(revenue),
        avgRevenuePerJob: woCount > 0 ? round2(revenue / woCount) : null,
        profitPerTech: round2(revenue - cost),
        hourlyCost: Number(r.hourly_cost),
      };
    });

    inHouse = { available: true, overall, technicians };
  }

  // -------- Section 7: Surveys --------
  let surveys = { available: false, count: 0, avgSatisfaction: null, pctResolved: null, pctTimely: null };
  try {
    const { rows: sRows } = await pool.query(`
      SELECT
        COUNT(*)::int AS cnt,
        AVG(satisfaction_score)::numeric AS avg_sat,
        (COUNT(*) FILTER (WHERE completely_resolved = true)::numeric * 100.0 / NULLIF(COUNT(*), 0))::numeric AS pct_r,
        (COUNT(*) FILTER (WHERE timely_completion = true)::numeric * 100.0 / NULLIF(COUNT(*), 0))::numeric AS pct_t
      FROM maintenance_surveys
      WHERE submitted_at IS NOT NULL
    `);
    const r = sRows[0];
    surveys = {
      available: (r?.cnt ?? 0) > 0,
      count: r?.cnt ?? 0,
      avgSatisfaction: r?.avg_sat != null ? round1(Number(r.avg_sat)) : null,
      pctResolved: r?.pct_r != null ? round1(Number(r.pct_r)) : null,
      pctTimely: r?.pct_t != null ? round1(Number(r.pct_t)) : null,
    };
  } catch {
    /* surveys table may not exist yet */
  }

  // -------- Section 8: Vendors --------
  let vendors = { available: false, summary: null, performance: [], tradeBreakdown: [], redFlags: [] };
  if (hasAll) {
    const thirdPartyFilter = `(appfolio_data->>'vendor' IS NOT NULL AND appfolio_data->>'vendor' != '' AND LOWER(appfolio_data->>'vendor') NOT LIKE '%moon shadow%')`;

    const { rows: sumRows } = await pool.query(`
      SELECT
        COUNT(DISTINCT appfolio_data->>'vendor') FILTER (
          WHERE (appfolio_data->>'created_at')::date >= (CURRENT_DATE - INTERVAL '90 days')
        )::int AS active_vendors_90d
      FROM ${allTable}
      WHERE ${thirdPartyFilter}
    `);

    const { rows: topVolRows } = await pool.query(`
      SELECT appfolio_data->>'vendor' AS vendor, COUNT(*)::int AS cnt
      FROM ${allTable}
      WHERE (appfolio_data->>'created_at')::date >= $1::date AND ${thirdPartyFilter}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 5
    `, [yearStart]);

    const { rows: topSpendRows } = await pool.query(`
      SELECT
        appfolio_data->>'vendor' AS vendor,
        SUM(COALESCE((appfolio_data->>'vendor_bill_amount')::numeric, 0))::numeric AS spend
      FROM ${allTable}
      WHERE (appfolio_data->>'created_at')::date >= $1::date AND ${thirdPartyFilter}
      GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 1
    `, [yearStart]);

    const totalYtdThirdParty = topVolRows.reduce((s, r) => s + r.cnt, 0);
    const { rows: totalYtdRows } = await pool.query(`
      SELECT COUNT(*)::int AS c FROM ${allTable}
      WHERE (appfolio_data->>'created_at')::date >= $1::date AND ${thirdPartyFilter}
    `, [yearStart]);
    const totalYtd = totalYtdRows[0]?.c ?? 0;
    const top5Concentration = totalYtd > 0 ? round1((totalYtdThirdParty / totalYtd) * 100) : 0;

    vendors.summary = {
      totalActiveVendors: sumRows[0]?.active_vendors_90d ?? 0,
      topVendorByVolume: topVolRows[0] ? { name: topVolRows[0].vendor, count: topVolRows[0].cnt } : null,
      topVendorBySpend: topSpendRows[0] ? { name: topSpendRows[0].vendor, spend: round2(Number(topSpendRows[0].spend ?? 0)) } : null,
      top5ConcentrationPercent: top5Concentration,
    };

    const { rows: perfRows } = await pool.query(`
      SELECT
        appfolio_data->>'vendor' AS vendor,
        MAX(appfolio_data->>'vendor_trade') AS trade,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE appfolio_data->>'status' = ANY($1::text[]))::int AS completed,
        COUNT(*) FILTER (WHERE appfolio_data->>'status' = 'Canceled')::int AS canceled,
        COUNT(*) FILTER (WHERE appfolio_data->>'status' = ANY($2::text[]))::int AS open_count,
        AVG((appfolio_data->>'completed_on')::date - (appfolio_data->>'created_at')::date)
          FILTER (WHERE appfolio_data->>'status' = ANY($1::text[])
            AND NULLIF(appfolio_data->>'completed_on','') IS NOT NULL)::numeric AS avg_days,
        (COUNT(*) FILTER (WHERE appfolio_data->>'status' = ANY($1::text[])
          AND NULLIF(appfolio_data->>'completed_on','') IS NOT NULL
          AND (appfolio_data->>'completed_on')::date - (appfolio_data->>'created_at')::date <= 5)::numeric * 100.0 /
          NULLIF(COUNT(*) FILTER (WHERE appfolio_data->>'status' = ANY($1::text[])), 0))::numeric AS on_time_rate,
        AVG((appfolio_data->>'vendor_bill_amount')::numeric)
          FILTER (WHERE (appfolio_data->>'vendor_bill_amount')::numeric > 0)::numeric AS avg_cost,
        SUM(COALESCE((appfolio_data->>'vendor_bill_amount')::numeric, 0))
          FILTER (WHERE (appfolio_data->>'created_at')::date >= $3::date)::numeric AS spend_ytd,
        MAX((appfolio_data->>'created_at')::date) AS last_wo_date
      FROM ${allTable}
      WHERE ${thirdPartyFilter}
        AND (appfolio_data->>'created_at')::date >= $3::date
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 20
    `, [COMPLETED_STATUSES, OPEN_STATUSES, yearStart]);

    vendors.performance = perfRows.map((r) => {
      const total = r.total ?? 0;
      const completed = r.completed ?? 0;
      const canceled = r.canceled ?? 0;
      const completionRate = total > 0 ? (completed / total) * 100 : 0;
      const cancelRate = total > 0 ? (canceled / total) * 100 : 0;
      const onTimeRate = Number(r.on_time_rate ?? 0);
      const perfScore = (completionRate * 0.3) + (onTimeRate * 0.4) + ((100 - cancelRate) * 0.3);
      return {
        vendor: r.vendor,
        trade: r.trade,
        totalWos: total,
        completedWos: completed,
        completionRate: round1(completionRate),
        cancellationRate: round1(cancelRate),
        avgDaysToComplete: r.avg_days != null ? round1(Number(r.avg_days)) : null,
        onTimeRate: round1(onTimeRate),
        avgCost: r.avg_cost != null ? round2(Number(r.avg_cost)) : null,
        totalSpendYtd: round2(Number(r.spend_ytd ?? 0)),
        activeWos: r.open_count ?? 0,
        lastWoDate: r.last_wo_date,
        performanceScore: round1(perfScore),
      };
    });

    const { rows: tradeRows } = await pool.query(`
      SELECT
        appfolio_data->>'vendor_trade' AS trade,
        COUNT(*)::int AS total,
        SUM(COALESCE((appfolio_data->>'vendor_bill_amount')::numeric, 0))::numeric AS spend
      FROM ${allTable}
      WHERE (appfolio_data->>'created_at')::date >= $1::date
        AND ${thirdPartyFilter}
        AND appfolio_data->>'vendor_trade' IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    `, [yearStart]);
    vendors.tradeBreakdown = tradeRows.map((r) => ({
      trade: r.trade,
      totalWos: r.total,
      totalSpend: round2(Number(r.spend ?? 0)),
    }));

    vendors.redFlags = vendors.performance.filter((v) => {
      const stale = v.lastWoDate && (Date.now() - new Date(v.lastWoDate).getTime()) > 90 * 86400000;
      return v.cancellationRate > 20 || (v.avgDaysToComplete != null && v.avgDaysToComplete > 10) || stale;
    });

    vendors.available = true;
  }

  // -------- Sync timestamp --------
  let lastSynced = null;
  try {
    const { rows: syncRows } = await pool.query(
      `SELECT MAX(synced_at) AS t FROM ${hasAll ? "cached_work_orders_all" : "cached_work_orders"}`
    );
    lastSynced = syncRows[0]?.t ?? null;
  } catch { /* ignore */ }

  return {
    filter,
    lastSynced,
    dataAvailability: { hasWorkOrdersAll: hasAll, hasLabor },
    volume,
    speed,
    billing,
    priority,
    openTable,
    inHouse,
    surveys,
    vendors,
  };
}

export async function getMaintenanceDashboardV2(req, res) {
  try {
    const raw = String(req.query.filter || "all").toLowerCase();
    const filter = raw === "inhouse" ? "inhouse" : raw === "thirdparty" ? "thirdparty" : "all";
    const now = Date.now();
    if (_caches[filter] && now - _cacheAt[filter] < CACHE_TTL) {
      res.json(_caches[filter]);
      return;
    }
    const data = await buildMaintenanceData(filter);
    _caches[filter] = data;
    _cacheAt[filter] = Date.now();
    res.json(data);
  } catch (e) {
    console.error("[maintenance-v2]", e);
    res.status(500).json({ error: "Could not load maintenance dashboard." });
  }
}

/* ---- Technician config admin ---- */

export async function getTechnicianConfig(req, res) {
  try {
    const pool = getPool();
    // Ensure rows for any tech in labor that isn't in config yet
    try {
      await pool.query(`
        INSERT INTO technician_config (technician_name, hourly_cost, is_active)
        SELECT DISTINCT appfolio_data->>'maintenance_tech', 25.00, true
        FROM cached_work_order_labor
        WHERE appfolio_data->>'maintenance_tech' IS NOT NULL
          AND appfolio_data->>'maintenance_tech' != ''
        ON CONFLICT (technician_name) DO NOTHING
      `);
    } catch { /* labor table may be empty */ }

    const { rows } = await pool.query(
      `SELECT id, technician_name, hourly_cost, is_active, notes, created_at, updated_at
       FROM technician_config ORDER BY technician_name ASC`
    );
    res.json({
      technicians: rows.map((r) => ({
        id: r.id,
        technicianName: r.technician_name,
        hourlyCost: Number(r.hourly_cost),
        isActive: r.is_active,
        notes: r.notes,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load technician config." });
  }
}

export async function putTechnicianConfig(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const b = req.body ?? {};
  const fields = [];
  const vals = [];
  let n = 1;
  if (b.hourlyCost != null) { fields.push(`hourly_cost = $${n++}`); vals.push(Number(b.hourlyCost)); }
  if (typeof b.isActive === "boolean") { fields.push(`is_active = $${n++}`); vals.push(b.isActive); }
  if (b.notes !== undefined) { fields.push(`notes = $${n++}`); vals.push(typeof b.notes === "string" ? b.notes.trim() || null : null); }
  if (fields.length === 0) { res.status(400).json({ error: "Nothing to update." }); return; }
  fields.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE technician_config SET ${fields.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) { res.status(404).json({ error: "Technician not found." }); return; }
    // Invalidate maintenance caches since profit calc depends on hourly_cost
    Object.keys(_caches).forEach((k) => { _caches[k] = null; _cacheAt[k] = 0; });
    res.json({ technician: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update technician." });
  }
}
