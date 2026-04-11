/**
 * Read KPI dashboard aggregates from PostgreSQL cache (Phase 1 sync).
 */
import { isUnitVacant, propertyLabel } from "./appfolio.js";
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

/** GET /dashboard/executive */
export async function getExecutive(req) {
  const pool = getPool();
  const { propertyIds } = parseFilters(req);

  const { rows: unitRows } = await pool.query(
    `SELECT appfolio_data FROM cached_units ORDER BY id`
  );
  let totalUnits = 0;
  let vacant = 0;
  for (const r of unitRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    totalUnits += 1;
    if (isUnitVacant(d)) vacant += 1;
  }
  const occupied = totalUnits - vacant;
  const occupancyRatePercent =
    totalUnits > 0 ? Math.round((occupied / totalUnits) * 1000) / 10 : 0;

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
    if (isOpenWorkOrderStatus(workOrderStatus(d))) openWorkOrders += 1;
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
  const { rows: units } = await pool.query(`SELECT appfolio_data FROM cached_units ORDER BY id`);
  const { rows: le } = await pool.query(
    `SELECT appfolio_data FROM cached_lease_expirations ORDER BY id`
  );

  const guestCards = gc.map(rowData).filter((d) => matchesProperty(d, propertyIds));
  const rentalApplications = ra.map(rowData).filter((d) => matchesProperty(d, propertyIds));
  const vacantUnits = units
    .map(rowData)
    .filter((d) => matchesProperty(d, propertyIds))
    .filter((d) => isUnitVacant(d));
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
  const { propertyIds } = parseFilters(req);

  const { rows: woRows } = await pool.query(
    `SELECT appfolio_data FROM cached_work_orders ORDER BY id`
  );
  if (!workOrderSampleKeysLogged && woRows.length > 0) {
    const sample = rowData(woRows[0]);
    console.log("[dashboard-cache] work_orders sample row keys:", Object.keys(sample));
    workOrderSampleKeysLogged = true;
  }
  const byStatus = {};
  const byProperty = {};
  const vendorCounts = {};

  for (const r of woRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    const st = workOrderStatus(d);
    byStatus[st] = (byStatus[st] || 0) + 1;
    const pk = propertyKeyFromRow(d);
    byProperty[pk] = (byProperty[pk] || 0) + 1;
    const vk = vendorKeyFromWorkOrder(d);
    vendorCounts[vk] = (vendorCounts[vk] || 0) + 1;
  }

  const topVendors = Object.entries(vendorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, workOrderCount: count }));

  let openWorkOrders = 0;
  for (const r of woRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    if (isOpenWorkOrderStatus(workOrderStatus(d))) openWorkOrders += 1;
  }

  return {
    openWorkOrders,
    workOrdersByStatus: byStatus,
    workOrdersByProperty: byProperty,
    topVendors,
    filters: { propertyIds },
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

  const { rows: unitRows } = await pool.query(`SELECT appfolio_data FROM cached_units`);
  let unitCount = 0;
  for (const r of unitRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    unitCount += 1;
  }

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
  const { rows: units } = await pool.query(`SELECT appfolio_data FROM cached_units ORDER BY id`);
  const { rows: owners } = await pool.query(`SELECT appfolio_data FROM cached_owners ORDER BY id`);
  const { rows: rr } = await pool.query(`SELECT appfolio_data FROM cached_rent_roll ORDER BY id`);

  const byProp = new Map();
  for (const r of units) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    const name = propertyLabel(d);
    const cur = byProp.get(name) || { propertyName: name, unitCount: 0, vacantCount: 0 };
    cur.unitCount += 1;
    if (isUnitVacant(d)) cur.vacantCount += 1;
    byProp.set(name, cur);
  }
  const propertiesList = Array.from(byProp.values()).map((p) => ({
    ...p,
    occupiedCount: p.unitCount - p.vacantCount,
    occupancyRatePercent:
      p.unitCount > 0
        ? Math.round(((p.unitCount - p.vacantCount) / p.unitCount) * 1000) / 10
        : 0,
  }));

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
