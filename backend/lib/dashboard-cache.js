/**
 * Read KPI dashboard aggregates from PostgreSQL cache (Phase 1 sync).
 */
import { propertyLabel } from "./appfolio.js";
import { getPool } from "./db.js";

function parseFilters(req) {
  const p = req.query?.propertyIds ?? req.query?.property_ids;
  const o = req.query?.ownerIds ?? req.query?.owner_ids;
  const propertyIds = p
    ? String(p)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const ownerIds = o
    ? String(o)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return { propertyIds, ownerIds };
}

function parseQueryWithDates(req) {
  const base = parseFilters(req);
  const startDate = String(req.query?.startDate ?? req.query?.start_date ?? "").trim();
  const endDate = String(req.query?.endDate ?? req.query?.end_date ?? "").trim();
  return { ...base, startDate, endDate };
}

function extractPropertyId(data) {
  if (!data || typeof data !== "object") return null;
  return (
    data.property_id ??
    data.PropertyId ??
    data.propertyId ??
    data.property?.id ??
    data.property?.Id ??
    null
  );
}

function extractOwnerId(data) {
  if (!data || typeof data !== "object") return null;
  return (
    data.owner_id ?? data.OwnerId ?? data.ownerId ?? data.owner?.id ?? data.owner?.Id ?? null
  );
}

function matchesProperty(data, propertyIds) {
  if (!propertyIds.length) return true;
  const pid = extractPropertyId(data);
  return pid != null && propertyIds.includes(String(pid));
}

/**
 * Income/delinquency report rows often omit property_id (portfolio-level). Include those rows when filtering.
 */
function matchesPropertyFilterForReportRows(data, propertyIds) {
  if (!propertyIds.length) return true;
  const pid = extractPropertyId(data);
  if (pid == null) return true;
  return propertyIds.includes(String(pid));
}

function matchesOwner(data, ownerIds) {
  if (!ownerIds.length) return true;
  const oid = extractOwnerId(data);
  return oid != null && ownerIds.includes(String(oid));
}

function parseMoney(v) {
  if (v == null) return 0;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const s = String(v).replace(/[$,]/g, "").trim();
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

function rowData(r) {
  return r.appfolio_data ?? r;
}

/** Rent roll `status` values (AppFolio) — occupancy uses cached_rent_roll, not cached_units. */
const RR_CURRENT = "Current";
const RR_VACANT = "Vacant-Unrented";
const RR_NOTICE = "Notice-Unrented";

function rentRollStatus(d) {
  const o = typeof d === "object" ? d : {};
  return String(o.status ?? o.Status ?? "").trim();
}

function rentRollPropertyName(d) {
  const o = typeof d === "object" ? d : {};
  return String(o.property_name ?? o.PropertyName ?? "").trim() || "Unknown property";
}

function rentRollUnitLabel(d) {
  const o = typeof d === "object" ? d : {};
  return String(
    o.unit_name ?? o.unitName ?? o.unit ?? o.Unit ?? o.unit_number ?? o.unitNumber ?? ""
  ).trim();
}

function rentRollAdvertisedRent(d) {
  const o = typeof d === "object" ? d : {};
  return parseMoney(
    o.advertised_rent ?? o.AdvertisedRent ?? o.advertisedRent ?? o.market_rent ?? o.MarketRent ?? 0
  );
}

/**
 * Occupancy from cached_rent_roll: Current + Notice-Unrented = occupied; Vacant-Unrented = vacant.
 */
function aggregateRentRollFromRows(rrRows, propertyIds) {
  const byProp = new Map();

  function bumpProp(d, bucket) {
    const name = rentRollPropertyName(d);
    const cur = byProp.get(name) || {
      propertyName: name,
      unitCount: 0,
      vacantCount: 0,
      onNoticeCount: 0,
      currentCount: 0,
    };
    cur.unitCount += 1;
    if (bucket === "vacant") cur.vacantCount += 1;
    else if (bucket === "notice") cur.onNoticeCount += 1;
    else if (bucket === "current") cur.currentCount += 1;
    byProp.set(name, cur);
  }

  let totalUnits = 0;
  let vacantUnits = 0;
  let onNoticeUnits = 0;
  let currentUnits = 0;

  for (const r of rrRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    const st = rentRollStatus(d);
    totalUnits += 1;

    if (st === RR_VACANT) {
      vacantUnits += 1;
      bumpProp(d, "vacant");
    } else if (st === RR_NOTICE) {
      onNoticeUnits += 1;
      bumpProp(d, "notice");
    } else if (st === RR_CURRENT) {
      currentUnits += 1;
      bumpProp(d, "current");
    } else {
      bumpProp(d, "other");
    }
  }

  const occupiedUnits = currentUnits + onNoticeUnits;
  const occupancyRatePercent =
    totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 1000) / 10 : 0;

  const byProperty = Array.from(byProp.values())
    .map((p) => {
      const occupiedCount = (p.currentCount ?? 0) + (p.onNoticeCount ?? 0);
      return {
        propertyName: p.propertyName,
        unitCount: p.unitCount,
        vacantCount: p.vacantCount,
        onNoticeCount: p.onNoticeCount ?? 0,
        occupiedCount,
        occupancyRatePercent:
          p.unitCount > 0 ? Math.round((occupiedCount / p.unitCount) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) =>
      a.propertyName.localeCompare(b.propertyName, undefined, { sensitivity: "base" })
    );

  return {
    totalUnits,
    vacantUnits,
    onNoticeUnits,
    currentUnits,
    occupiedUnits,
    occupancyRatePercent,
    byProperty,
  };
}

/** AppFolio chart strings like "0-40100" — income 40000 series */
function incomeStatementAccountNumber(d) {
  const o = typeof d === "object" ? d : {};
  return String(o.account_number ?? o.AccountNumber ?? "").trim();
}

function isIncomeCoaAccount(accountNumber) {
  return accountNumber.startsWith("0-4");
}

function isExpenseCoaAccount(accountNumber) {
  return accountNumber.startsWith("0-5") || accountNumber.startsWith("0-6");
}

function incomeStatementMoneyFields(d) {
  const o = typeof d === "object" ? d : {};
  return {
    ytd: parseMoney(o.year_to_date ?? o.yearToDate),
    mtd: parseMoney(o.month_to_date ?? o.monthToDate),
    lytd: parseMoney(o.last_year_to_date ?? o.lastYearToDate),
  };
}

function delinquencyAmountReceivable(d) {
  const o = typeof d === "object" ? d : {};
  return parseMoney(
    o.amount_receivable ??
      o.AmountReceivable ??
      o.balance ??
      o.Balance ??
      o.amount_due ??
      o.AmountDue ??
      o.total_balance ??
      o.TotalBalance ??
      o.balance_due ??
      0
  );
}

function delinquencyAgingSlices(d) {
  const o = typeof d === "object" ? d : {};
  return {
    d00to30: parseMoney(o["00_to30"] ?? o["00To30"]),
    d30to60: parseMoney(o["30_to60"] ?? o["30To60"]),
    d60to90: parseMoney(o["60_to90"] ?? o["60To90"]),
    d90plus: parseMoney(o["90_plus"] ?? o["90Plus"]),
  };
}

function delinquencyDetailFields(d) {
  const o = typeof d === "object" ? d : {};
  const unit =
    o.unit_name ??
    o.unitName ??
    o.unit_number ??
    o.unitNumber ??
    o.unit ??
    o.Unit ??
    "";
  return {
    tenantName: String(o.name ?? o.Name ?? o.tenant_name ?? o.tenantName ?? "").trim(),
    propertyName: String(o.property_name ?? o.PropertyName ?? "").trim(),
    unit: String(unit).trim(),
    amountReceivable: delinquencyAmountReceivable(o),
  };
}

function workOrderStatus(d) {
  const o = typeof d === "object" ? d : {};
  const s =
    o.status ??
    o.Status ??
    o.work_order_status ??
    o.WorkOrderStatus ??
    o.state ??
    "";
  return String(s).trim() || "unknown";
}

/** Open = not Completed/Canceled and no completion date (AppFolio work_order.json). */
function isAppfolioWorkOrderOpen(d) {
  const o = typeof d === "object" ? d : {};
  const st = String(o.status ?? "").trim();
  if (/^(completed|canceled)$/i.test(st)) return false;
  const co = o.completed_on ?? o.work_completed_on ?? "";
  if (co != null && String(co).trim() !== "") return false;
  return true;
}

function workOrderCreatedYmd(d) {
  const o = typeof d === "object" ? d : {};
  const raw = o.created_at ?? o.createdAt ?? "";
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return "";
}

function woMatchesCreatedDateRange(ymd, startDate, endDate) {
  if (!ymd) return true;
  if (startDate && ymd < startDate) return false;
  if (endDate && ymd > endDate) return false;
  return true;
}

function daysOpenFromYmd(createdYmd) {
  if (!createdYmd) return 0;
  const c = new Date(`${createdYmd}T12:00:00`);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - c.getTime()) / 86400000));
}

function workOrderVendorName(d) {
  const o = typeof d === "object" ? d : {};
  return String(o.vendor ?? o.vendor_name ?? o.VendorName ?? "").trim() || "—";
}

function workOrderVendorTrade(d) {
  const o = typeof d === "object" ? d : {};
  return String(o.vendor_trade ?? o.vendorTrade ?? "").trim() || "—";
}

function workOrderAmountString(d) {
  const o = typeof d === "object" ? d : {};
  const n = parseMoney(o.amount ?? o.Amount ?? 0);
  return n === 0 ? "" : n.toFixed(2);
}

function workOrderBilledAmount(d) {
  const o = typeof d === "object" ? d : {};
  return parseMoney(o.vendor_bill_amount ?? o.VendorBillAmount ?? o.amount ?? o.Amount ?? 0);
}

function isOpenWorkOrderStatus(status) {
  const u = status.toLowerCase();
  if (/\b(complete|closed|cancel|void|resolved)\b/.test(u)) return false;
  if (/\b(open|pending|new|assigned|scheduled|in\s*progress|active)\b/.test(u)) return true;
  return !/\b(complete|closed|cancel)\b/.test(u);
}

let workOrderSampleKeysLogged = false;

function vendorKeyFromWorkOrder(d) {
  const o = typeof d === "object" ? d : {};
  const name =
    o.vendor ??
    o.vendor_name ??
    o.VendorName ??
    o.vendor?.name ??
    o.vendor?.Name ??
    o.trade ??
    "";
  const id = o.vendor_id ?? o.VendorId ?? o.vendor?.id ?? "";
  return String(name || id || "unknown").trim() || "unknown";
}

function propertyKeyFromRow(d) {
  const o = typeof d === "object" ? d : {};
  return (
    propertyLabel(o) ||
    String(o.property_name ?? o.PropertyName ?? o.property_id ?? "unknown")
  );
}

/**
 * Aggregate income statement rows (strings parsed as floats; COA prefixes 0-4 / 0-5 / 0-6).
 */
function aggregateIncomeFromRows(incRows, propertyIds) {
  let revenueYtd = 0;
  let expensesYtd = 0;
  let revenueMtd = 0;
  let revenueLy = 0;
  let expensesLy = 0;

  for (const r of incRows) {
    const d = rowData(r);
    if (!matchesPropertyFilterForReportRows(d, propertyIds)) continue;
    const an = incomeStatementAccountNumber(d);
    if (!an) continue;
    const { ytd, mtd, lytd } = incomeStatementMoneyFields(d);
    if (isIncomeCoaAccount(an)) {
      revenueYtd += ytd;
      revenueMtd += mtd;
      revenueLy += lytd;
    } else if (isExpenseCoaAccount(an)) {
      expensesYtd += ytd;
      expensesLy += lytd;
    }
  }

  const profitYtd = revenueYtd - expensesYtd;
  const profitMarginPercent =
    revenueYtd > 0 ? Math.round((profitYtd / revenueYtd) * 10000) / 100 : 0;

  return {
    revenueYtd,
    expensesYtd,
    profitYtd,
    profitMarginPercent,
    monthToDateRevenue: revenueMtd,
    lastYearRevenueYtd: revenueLy,
    lastYearExpensesYtd: expensesLy,
  };
}

function aggregateDelinquencyFromRows(delRows, propertyIds) {
  let totalDelinquency = 0;
  let delinquentAccountCount = 0;
  let aging00to30 = 0;
  let aging30to60 = 0;
  let aging60to90 = 0;
  let aging90Plus = 0;

  for (const r of delRows) {
    const d = rowData(r);
    if (!matchesPropertyFilterForReportRows(d, propertyIds)) continue;
    const amt = delinquencyAmountReceivable(d);
    totalDelinquency += amt;
    if (amt > 0) delinquentAccountCount += 1;
    const ag = delinquencyAgingSlices(d);
    aging00to30 += ag.d00to30;
    aging30to60 += ag.d30to60;
    aging60to90 += ag.d60to90;
    aging90Plus += ag.d90plus;
  }

  return {
    totalDelinquency,
    delinquentAccountCount,
    aging00to30,
    aging30to60,
    aging60to90,
    aging90Plus,
  };
}

/** GET /dashboard/occupancy — cached rent roll (hub quick KPIs). */
export async function getOccupancy(req) {
  const pool = getPool();
  const { propertyIds } = parseFilters(req);
  const { rows } = await pool.query(`SELECT appfolio_data FROM cached_rent_roll ORDER BY id`);
  const agg = aggregateRentRollFromRows(rows, propertyIds);
  return {
    totalUnitCount: agg.totalUnits,
    occupiedCount: agg.occupiedUnits,
    vacantCount: agg.vacantUnits,
    onNoticeUnits: agg.onNoticeUnits,
    occupancyRatePercent: agg.occupancyRatePercent,
    byProperty: agg.byProperty,
  };
}

/** GET /dashboard/executive */
export async function getExecutive(req) {
  const pool = getPool();
  const { propertyIds } = parseFilters(req);

  const { rows: rrRows } = await pool.query(
    `SELECT appfolio_data FROM cached_rent_roll ORDER BY id`
  );
  const rrAgg = aggregateRentRollFromRows(rrRows, propertyIds);
  const totalUnits = rrAgg.totalUnits;
  const vacant = rrAgg.vacantUnits;
  const occupied = rrAgg.occupiedUnits;
  const onNoticeUnits = rrAgg.onNoticeUnits;
  const occupancyRatePercent = rrAgg.occupancyRatePercent;

  const { rows: incRows } = await pool.query(
    `SELECT appfolio_data, period FROM cached_income_statement ORDER BY id`
  );
  const incomeKpis = aggregateIncomeFromRows(incRows, propertyIds);
  const revenuePerDoor =
    totalUnits > 0 ? Math.round((incomeKpis.revenueYtd / totalUnits) * 100) / 100 : 0;

  const { rows: woRows } = await pool.query(
    `SELECT appfolio_data FROM cached_work_orders ORDER BY id`
  );
  if (!workOrderSampleKeysLogged && woRows.length > 0) {
    const sample = rowData(woRows[0]);
    console.log("[dashboard-cache] work_orders sample row keys:", Object.keys(sample));
    workOrderSampleKeysLogged = true;
  }
  let openWorkOrders = 0;
  for (const r of woRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    if (isAppfolioWorkOrderOpen(d)) openWorkOrders += 1;
  }

  const { rows: delRows } = await pool.query(
    `SELECT appfolio_data FROM cached_delinquency ORDER BY id`
  );
  const delKpis = aggregateDelinquencyFromRows(delRows, propertyIds);

  const { rows: gcRows } = await pool.query(
    `SELECT appfolio_data FROM cached_guest_cards ORDER BY id`
  );
  let activeLeads = 0;
  for (const r of gcRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    const st = String(d.status ?? d.Status ?? d.stage ?? "").toLowerCase();
    if (st && /\b(lost|closed|cancel|duplicate)\b/.test(st)) continue;
    activeLeads += 1;
  }

  return {
    totalUnits,
    occupiedUnits: occupied,
    vacantUnits: vacant,
    occupancyRatePercent,
    totalRevenueYtd: incomeKpis.revenueYtd,
    totalExpensesYtd: incomeKpis.expensesYtd,
    profitYtd: incomeKpis.profitYtd,
    profitMarginPercent: incomeKpis.profitMarginPercent,
    monthToDateRevenue: incomeKpis.monthToDateRevenue,
    revenuePerDoor,
    lastYearRevenueYtd: incomeKpis.lastYearRevenueYtd,
    lastYearExpensesYtd: incomeKpis.lastYearExpensesYtd,
    openWorkOrders,
    totalDelinquency: delKpis.totalDelinquency,
    delinquentAccountCount: delKpis.delinquentAccountCount,
    delinquencyAging: {
      current0to30: delKpis.aging00to30,
      days30to60: delKpis.aging30to60,
      days60to90: delKpis.aging60to90,
      days90Plus: delKpis.aging90Plus,
    },
    onNoticeUnits,
    activeLeads,
    filters: { propertyIds },
  };
}

/** GET /dashboard/leasing */
export async function getLeasing(req) {
  const pool = getPool();
  const { propertyIds } = parseFilters(req);

  const { rows: gc } = await pool.query(`SELECT appfolio_data FROM cached_guest_cards ORDER BY id`);
  const { rows: ra } = await pool.query(
    `SELECT appfolio_data FROM cached_rental_applications ORDER BY id`
  );
  const { rows: rrVacant } = await pool.query(`SELECT appfolio_data FROM cached_rent_roll ORDER BY id`);
  const { rows: le } = await pool.query(
    `SELECT appfolio_data FROM cached_lease_expirations ORDER BY id`
  );

  const guestCards = gc.map(rowData).filter((d) => matchesProperty(d, propertyIds));
  const rentalApplications = ra.map(rowData).filter((d) => matchesProperty(d, propertyIds));
  const vacantUnits = [];
  for (const r of rrVacant) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    if (rentRollStatus(d) !== RR_VACANT) continue;
    vacantUnits.push({
      ...d,
      property_name: rentRollPropertyName(d),
      unit: rentRollUnitLabel(d),
      advertised_rent: rentRollAdvertisedRent(d),
    });
  }
  const leaseExpirations = le.map(rowData).filter((d) => matchesProperty(d, propertyIds));

  return {
    guestCards,
    rentalApplications,
    vacantUnits,
    leaseExpirations,
    filters: { propertyIds },
  };
}

/** GET /dashboard/maintenance */
export async function getMaintenance(req) {
  const pool = getPool();
  const { propertyIds, startDate, endDate } = parseQueryWithDates(req);

  const { rows: woRows } = await pool.query(
    `SELECT appfolio_data FROM cached_work_orders ORDER BY id`
  );
  if (!workOrderSampleKeysLogged && woRows.length > 0) {
    const sample = rowData(woRows[0]);
    console.log("[dashboard-cache] work_orders sample row keys:", Object.keys(sample));
    workOrderSampleKeysLogged = true;
  }

  const openRows = [];
  for (const r of woRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    if (!isAppfolioWorkOrderOpen(d)) continue;
    const createdYmd = workOrderCreatedYmd(d);
    if (!woMatchesCreatedDateRange(createdYmd, startDate, endDate)) continue;
    openRows.push(d);
  }

  const byStatus = {};
  const byPriority = {};
  const daysOpens = [];
  const byPropertyMap = new Map();
  const vendorAgg = new Map();

  for (const d of openRows) {
    const st = workOrderStatus(d);
    byStatus[st] = (byStatus[st] || 0) + 1;
    const pr = String(d.priority ?? d.Priority ?? "Normal").trim() || "Normal";
    byPriority[pr] = (byPriority[pr] || 0) + 1;

    const createdYmd = workOrderCreatedYmd(d);
    const daysOpen = daysOpenFromYmd(createdYmd);
    daysOpens.push(daysOpen);

    const pName = String(d.property_name ?? d.PropertyName ?? propertyKeyFromRow(d)).trim() || "Unknown";
    const curP = byPropertyMap.get(pName) || { propertyName: pName, openCount: 0 };
    curP.openCount += 1;
    byPropertyMap.set(pName, curP);

    const vName = workOrderVendorName(d);
    const trade = workOrderVendorTrade(d);
    const curV = vendorAgg.get(vName) || {
      vendor: vName,
      trade: trade || "—",
      openCount: 0,
      totalBilled: 0,
    };
    curV.openCount += 1;
    curV.totalBilled += workOrderBilledAmount(d);
    if (trade && curV.trade === "—") curV.trade = trade;
    vendorAgg.set(vName, curV);
  }

  const totalOpen = openRows.length;
  const avgDaysOpen =
    daysOpens.length > 0
      ? Math.round((daysOpens.reduce((a, b) => a + b, 0) / daysOpens.length) * 10) / 10
      : 0;

  const workOrders = openRows.map((d) => {
    const createdYmd = workOrderCreatedYmd(d);
    const issue =
      String(d.work_order_issue ?? d.workOrderIssue ?? d.work_order_type ?? d.issue ?? "").trim() ||
      "—";
    const desc =
      String(d.job_description ?? d.jobDescription ?? d.service_request_description ?? "").trim() || "—";
    const vb = parseMoney(d.vendor_bill_amount ?? d.VendorBillAmount ?? 0);
    const est = parseMoney(d.estimate_amount ?? d.EstimateAmount ?? 0);
    return {
      workOrderNumber: String(d.work_order_number ?? d.workOrderNumber ?? "").trim() || "—",
      status: workOrderStatus(d),
      priority: String(d.priority ?? d.Priority ?? "Normal").trim() || "Normal",
      propertyName: String(d.property_name ?? d.PropertyName ?? "").trim() || "—",
      unitName: String(d.unit_name ?? d.unitName ?? "").trim() || "",
      vendor: workOrderVendorName(d),
      vendorTrade: workOrderVendorTrade(d),
      issue,
      description: desc,
      createdAt: createdYmd,
      daysOpen: daysOpenFromYmd(createdYmd),
      amount: workOrderAmountString(d),
      tenant: String(d.primary_tenant ?? d.primaryTenant ?? "").trim() || "—",
      assignedUser: String(d.assigned_user ?? d.assignedUser ?? "").trim() || "—",
      detail: {
        jobDescription: String(d.job_description ?? "").trim(),
        serviceRequestDescription: String(d.service_request_description ?? "").trim(),
        scheduledStart: String(d.scheduled_start ?? d.scheduledStart ?? "").trim(),
        scheduledEnd: String(d.scheduled_end ?? d.scheduledEnd ?? "").trim(),
        workOrderType: String(d.work_order_type ?? "").trim(),
        submittedByTenant: d.submitted_by_tenant ?? d.submittedByTenant,
        vendorBillAmount: vb === 0 ? "" : vb.toFixed(2),
        estimateAmount: est === 0 ? "" : est.toFixed(2),
      },
    };
  });

  const byProperty = Array.from(byPropertyMap.values()).sort((a, b) => b.openCount - a.openCount);

  const byVendor = Array.from(vendorAgg.values())
    .map((v) => ({
      vendor: v.vendor,
      trade: v.trade,
      openCount: v.openCount,
      totalBilled: Math.round(v.totalBilled * 100) / 100,
    }))
    .sort((a, b) => b.openCount - a.openCount);

  const urgentCount = Object.entries(byPriority).reduce(
    (s, [k, v]) => s + (/^urgent$/i.test(String(k).trim()) ? v : 0),
    0
  );
  const newCount = Object.entries(byStatus).reduce((s, [k, v]) => s + (k === "New" ? v : 0), 0);

  const summary = {
    totalOpen,
    byStatus,
    byPriority,
    avgDaysOpen,
    urgentCount,
    newCount,
  };

  return {
    summary,
    workOrders,
    byProperty,
    byVendor,
    openWorkOrders: totalOpen,
    workOrdersByStatus: byStatus,
    workOrdersByProperty: Object.fromEntries(
      byProperty.map((p) => [p.propertyName, p.openCount])
    ),
    topVendors: byVendor.slice(0, 15).map((v) => ({ name: v.vendor, workOrderCount: v.openCount })),
    filters: { propertyIds, startDate, endDate },
  };
}

/** GET /dashboard/finance */
export async function getFinance(req) {
  const pool = getPool();
  const { propertyIds } = parseFilters(req);

  const { rows: inc } = await pool.query(
    `SELECT appfolio_data, period FROM cached_income_statement ORDER BY id`
  );
  const { rows: del } = await pool.query(`SELECT appfolio_data FROM cached_delinquency ORDER BY id`);

  const incomeKpis = aggregateIncomeFromRows(inc, propertyIds);
  const delKpis = aggregateDelinquencyFromRows(del, propertyIds);

  const incomeStatement = [];
  for (const r of inc) {
    const d = rowData(r);
    if (!matchesPropertyFilterForReportRows(d, propertyIds)) continue;
    incomeStatement.push({ ...d, _period: r.period });
  }

  const delinquency = [];
  for (const r of del) {
    const d = rowData(r);
    if (!matchesPropertyFilterForReportRows(d, propertyIds)) continue;
    const amt = delinquencyAmountReceivable(d);
    const detail = delinquencyDetailFields(d);
    const ag = delinquencyAgingSlices(d);
    const daysPast =
      d.days_past_due ??
      d.DaysPastDue ??
      d.days_delinquent ??
      d.age_days ??
      null;
    delinquency.push({
      ...d,
      _computedAmount: amt,
      _tenantName: detail.tenantName,
      _propertyName: detail.propertyName,
      _unit: detail.unit,
      _aging: ag,
      _agingDays: daysPast,
    });
  }

  const { rows: rrCountRows } = await pool.query(`SELECT appfolio_data FROM cached_rent_roll ORDER BY id`);
  const rrCountAgg = aggregateRentRollFromRows(rrCountRows, propertyIds);
  const unitCount = rrCountAgg.totalUnits;

  const revenuePerDoor =
    unitCount > 0 ? Math.round((incomeKpis.revenueYtd / unitCount) * 100) / 100 : 0;

  return {
    finance: {
      revenueYtd: incomeKpis.revenueYtd,
      expensesYtd: incomeKpis.expensesYtd,
      profitYtd: incomeKpis.profitYtd,
      profitMarginPercent: incomeKpis.profitMarginPercent,
      monthToDateRevenue: incomeKpis.monthToDateRevenue,
      revenuePerDoor,
      lastYearRevenueYtd: incomeKpis.lastYearRevenueYtd,
      lastYearExpensesYtd: incomeKpis.lastYearExpensesYtd,
    },
    delinquencyTotals: {
      totalAmount: delKpis.totalDelinquency,
      delinquentAccountCount: delKpis.delinquentAccountCount,
      aging00to30: delKpis.aging00to30,
      aging30to60: delKpis.aging30to60,
      aging60to90: delKpis.aging60to90,
      aging90Plus: delKpis.aging90Plus,
    },
    incomeStatement,
    delinquency,
    totalRevenueInCache: incomeKpis.revenueYtd,
    revenuePerDoor,
    filters: { propertyIds },
  };
}

/** GET /dashboard/portfolio */
export async function getPortfolio(req) {
  const pool = getPool();
  const { propertyIds, ownerIds } = parseFilters(req);

  const { rows: props } = await pool.query(`SELECT appfolio_data FROM cached_properties ORDER BY id`);
  const { rows: owners } = await pool.query(`SELECT appfolio_data FROM cached_owners ORDER BY id`);
  const { rows: rr } = await pool.query(`SELECT appfolio_data FROM cached_rent_roll ORDER BY id`);

  const rrAgg = aggregateRentRollFromRows(rr, propertyIds);
  const propertiesList = rrAgg.byProperty;

  const ownerDirectory = owners
    .map(rowData)
    .filter((d) => matchesOwner(d, ownerIds))
    .filter((d) => {
      if (!propertyIds.length) return true;
      const pid = extractPropertyId(d);
      if (pid == null) return true;
      return propertyIds.includes(String(pid));
    });

  const rentRoll = rr
    .map(rowData)
    .filter((d) => matchesProperty(d, propertyIds));

  return {
    properties: propertiesList,
    propertyDirectory: props.map(rowData).filter((d) => matchesProperty(d, propertyIds)),
    ownerDirectory,
    rentRoll,
    filters: { propertyIds, ownerIds },
  };
}
