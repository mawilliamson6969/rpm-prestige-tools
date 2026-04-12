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

/** LeadSimple JSON timestamps / booleans (cached_leadsimple_* tables). */
function lsParseTimeMs(val) {
  if (val == null) return null;
  if (typeof val === "number") {
    if (val > 1e12) return val;
    if (val > 1e9) return val * 1000;
    return val < 1e11 ? val * 1000 : val;
  }
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, d] = s.split("-").map((x) => parseInt(x, 10));
    return new Date(y, mo - 1, d).getTime();
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n > 1e12 ? n : n * 1000;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function lsStartOfLocalTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function lsIsCompleted(d) {
  const o = typeof d === "object" && d ? d : {};
  const c = o.completed ?? o.Completed;
  if (c === true || c === 1) return true;
  if (c === false || c === 0) return false;
  const s = String(c ?? "").toLowerCase();
  return s === "true" || s === "1" || s === "yes";
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

function incomeStatementMoneyFields(d) {
  const o = typeof d === "object" ? d : {};
  return {
    ytd: parseMoney(o.year_to_date ?? o.yearToDate),
    mtd: parseMoney(o.month_to_date ?? o.monthToDate),
    lytd: parseMoney(o.last_year_to_date ?? o.lastYearToDate),
  };
}

/** Property-level pass-through (owner) revenue — 0-4xxxx, not company books. */
function isPropertyOwnerRevenueAccount(accountNumber) {
  return accountNumber.startsWith("0-4");
}

/** Company revenue — 4xxxxx (excludes property 0-4 prefix). */
function isCompanyRevenueAccount(accountNumber) {
  if (!accountNumber) return false;
  return accountNumber.startsWith("4") && !accountNumber.startsWith("0-4");
}

/** Cost of services / COGS — 5xxxxx (not 0-5 property lines). */
function isCostOfServicesAccount(accountNumber) {
  if (!accountNumber) return false;
  return accountNumber.startsWith("5") && !accountNumber.startsWith("0-5");
}

/** Operating expenses — 6xxxxx (not 0-6). */
function isOperatingExpenseAccount(accountNumber) {
  if (!accountNumber) return false;
  return accountNumber.startsWith("6") && !accountNumber.startsWith("0-6");
}

/** Payroll — 7xxxxx (not 0-7). */
function isPayrollAccount(accountNumber) {
  if (!accountNumber) return false;
  return accountNumber.startsWith("7") && !accountNumber.startsWith("0-7");
}

function shouldSkipIncomeStatementRow(d, accountNumberStr) {
  const an = accountNumberStr.trim();
  if (an !== "") return false;
  const nm = String(d.account_name ?? d.AccountName ?? "")
    .trim()
    .toLowerCase();
  if (nm === "total income" || nm === "total expense") return true;
  return true;
}

function categorizeOwnerRevenueBucket(accountNumber) {
  if (/^0-401/.test(accountNumber)) return "rent";
  if (/^0-42/.test(accountNumber)) return "tenantFees";
  return "other";
}

/** Donut: company revenue (4xxxxx) sub-buckets. */
function categorizeCompanyRevenueDonut(accountNumber) {
  if (accountNumber.startsWith("4050")) return "management";
  if (accountNumber.startsWith("4000-3") || accountNumber.startsWith("4000-2")) return "leasingAdmin";
  if (
    accountNumber.startsWith("4300") ||
    accountNumber.startsWith("4350") ||
    accountNumber.startsWith("4390")
  )
    return "maintenance";
  if (
    accountNumber.startsWith("4700") ||
    accountNumber.startsWith("4800") ||
    accountNumber.startsWith("4850") ||
    accountNumber.startsWith("4900")
  )
    return "tenantFees";
  return "other";
}

/** Operating expense detail (6xxxxx). */
function categorizeOperatingExpensePrefix(accountNumber) {
  if (accountNumber.startsWith("6100")) return "advertising";
  if (accountNumber.startsWith("6300")) return "professional";
  if (accountNumber.startsWith("6400")) return "feesRoyalties";
  if (accountNumber.startsWith("6500")) return "office";
  if (accountNumber.startsWith("6600")) return "travel";
  if (accountNumber.startsWith("6800")) return "insurance";
  return "other";
}

function bucket() {
  return { ytd: 0, mtd: 0, ly: 0 };
}

function addB(b, ytd, mtd, ly) {
  b.ytd += ytd;
  b.mtd += mtd;
  b.ly += ly;
}

function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Portfolio income statement: property 0-4 = owner pass-through; 4/5/6/7 = company P&amp;L.
 * Skips rows with empty account_number (including Total Income / Total Expense rollup lines).
 */
function aggregatePortfolioIncomeStatement(incRows, propertyIds) {
  const companyRevenue = bucket();
  const costOfServices = bucket();
  const operatingExpenses = bucket();
  const payroll = bucket();

  const donut = {
    managementFees: bucket(),
    leasingAdmin: bucket(),
    maintenanceRevenue: bucket(),
    tenantFees: bucket(),
    otherRevenue: bucket(),
  };

  const opexDetail = {
    advertising: bucket(),
    professional: bucket(),
    feesRoyalties: bucket(),
    office: bucket(),
    travel: bucket(),
    insurance: bucket(),
    other: bucket(),
  };

  const ownerRevenue = bucket();
  const ownerRent = bucket();
  const ownerTenantFees = bucket();
  const ownerOther = bucket();

  for (const r of incRows) {
    const d = rowData(r);
    if (!matchesPropertyFilterForReportRows(d, propertyIds)) continue;
    const anRaw = incomeStatementAccountNumber(d);
    if (shouldSkipIncomeStatementRow(d, anRaw)) continue;
    const an = anRaw.trim();
    const { ytd, mtd, lytd } = incomeStatementMoneyFields(d);

    if (isPropertyOwnerRevenueAccount(an)) {
      addB(ownerRevenue, ytd, mtd, lytd);
      const ob = categorizeOwnerRevenueBucket(an);
      if (ob === "rent") addB(ownerRent, ytd, mtd, lytd);
      else if (ob === "tenantFees") addB(ownerTenantFees, ytd, mtd, lytd);
      else addB(ownerOther, ytd, mtd, lytd);
      continue;
    }

    if (isCompanyRevenueAccount(an)) {
      addB(companyRevenue, ytd, mtd, lytd);
      const cat = categorizeCompanyRevenueDonut(an);
      if (cat === "management") addB(donut.managementFees, ytd, mtd, lytd);
      else if (cat === "leasingAdmin") addB(donut.leasingAdmin, ytd, mtd, lytd);
      else if (cat === "maintenance") addB(donut.maintenanceRevenue, ytd, mtd, lytd);
      else if (cat === "tenantFees") addB(donut.tenantFees, ytd, mtd, lytd);
      else addB(donut.otherRevenue, ytd, mtd, lytd);
      continue;
    }

    if (isCostOfServicesAccount(an)) {
      addB(costOfServices, ytd, mtd, lytd);
      continue;
    }

    if (isOperatingExpenseAccount(an)) {
      addB(operatingExpenses, ytd, mtd, lytd);
      const tag = categorizeOperatingExpensePrefix(an);
      addB(opexDetail[tag] ?? opexDetail.other, ytd, mtd, lytd);
      continue;
    }

    if (isPayrollAccount(an)) {
      addB(payroll, ytd, mtd, lytd);
    }
  }

  const grossProfit = {
    ytd: companyRevenue.ytd - costOfServices.ytd,
    mtd: companyRevenue.mtd - costOfServices.mtd,
    ly: companyRevenue.ly - costOfServices.ly,
  };

  const totalExpenses = {
    ytd: costOfServices.ytd + operatingExpenses.ytd + payroll.ytd,
    mtd: costOfServices.mtd + operatingExpenses.mtd + payroll.mtd,
    ly: costOfServices.ly + operatingExpenses.ly + payroll.ly,
  };

  const netProfit = {
    ytd: companyRevenue.ytd - totalExpenses.ytd,
    mtd: companyRevenue.mtd - totalExpenses.mtd,
    ly: companyRevenue.ly - totalExpenses.ly,
  };

  const profitMarginPercent =
    companyRevenue.ytd > 0 ? Math.round((netProfit.ytd / companyRevenue.ytd) * 10000) / 100 : 0;

  const profitMarginPercentMtd =
    companyRevenue.mtd > 0 ? Math.round((netProfit.mtd / companyRevenue.mtd) * 10000) / 100 : 0;

  const yoyChange =
    companyRevenue.ly > 0
      ? Math.round(((companyRevenue.ytd - companyRevenue.ly) / companyRevenue.ly) * 10000) / 100
      : companyRevenue.ytd > 0
        ? 100
        : 0;

  return {
    companyRevenue,
    costOfServices,
    grossProfit,
    operatingExpenses,
    payroll,
    totalExpenses,
    netProfit,
    profitMarginPercent,
    profitMarginPercentMtd,
    yoyChange,
    donut,
    opexDetail,
    ownerRevenue,
    ownerBuckets: {
      rent: ownerRent,
      tenantFees: ownerTenantFees,
      other: ownerOther,
    },
    monthToDateRevenue: companyRevenue.mtd,
    lastYearRevenueYtd: companyRevenue.ly,
    lastYearExpensesYtd: totalExpenses.ly,
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

function delinquencyTenantUnit(d) {
  const o = typeof d === "object" ? d : {};
  const u =
    o.unit ??
    o.unit_name ??
    o.unitName ??
    o.unit_number ??
    o.unitNumber ??
    o.Unit ??
    "";
  return String(u).trim();
}

function daysDelinquentFromRow(d) {
  const o = typeof d === "object" ? d : {};
  const raw =
    o.days_past_due ?? o.DaysPastDue ?? o.days_delinquent ?? o.delinquent_days ?? o.age_days ?? o.AgeDays;
  if (raw != null && String(raw).trim() !== "") {
    const n = parseFloat(String(raw).replace(/[$,]/g, ""));
    if (!Number.isNaN(n)) return Math.round(n);
  }
  return 0;
}

function lastPaymentFromRow(d) {
  const o = typeof d === "object" ? d : {};
  return String(o.last_payment ?? o.LastPayment ?? "").trim();
}

function inCollectionsFromRow(d) {
  const o = typeof d === "object" ? d : {};
  return String(o.in_collections ?? o.InCollections ?? "").trim();
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

/** Maps portfolio P&amp;L to legacy executive finance KPI field names. */
function aggregateIncomeFromRows(incRows, propertyIds) {
  const p = aggregatePortfolioIncomeStatement(incRows, propertyIds);
  return {
    revenueYtd: p.companyRevenue.ytd,
    expensesYtd: p.totalExpenses.ytd,
    profitYtd: p.netProfit.ytd,
    profitMarginPercent: p.profitMarginPercent,
    monthToDateRevenue: p.companyRevenue.mtd,
    lastYearRevenueYtd: p.companyRevenue.ly,
    lastYearExpensesYtd: p.totalExpenses.ly,
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
  const pnl = aggregatePortfolioIncomeStatement(incRows, propertyIds);
  const monthsElapsedExec = Math.max(1, new Date().getMonth() + 1);
  const revenuePerDoor =
    totalUnits > 0
      ? Math.round((pnl.companyRevenue.ytd / monthsElapsedExec / totalUnits) * 100) / 100
      : 0;

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

  const { rows: reLeadRowsExec } = await pool.query(`SELECT COUNT(*)::int AS c FROM cached_rentengine_leads`);
  const rentEngineLeadCount = reLeadRowsExec[0]?.c ?? 0;

  const { rows: boomCountRows } = await pool.query(`SELECT COUNT(*)::int AS c FROM cached_boom_applications`);
  const screeningsTotal = boomCountRows[0]?.c ?? 0;

  const { rows: lsTaskExecRows } = await pool.query(`SELECT appfolio_data FROM cached_leadsimple_tasks`);
  const { rows: lsDealExecRows } = await pool.query(`SELECT appfolio_data FROM cached_leadsimple_deals`);
  const today0 = lsStartOfLocalTodayMs();
  let leadSimpleOverdueTasks = 0;
  for (const r of lsTaskExecRows) {
    const d = rowData(r);
    if (lsIsCompleted(d)) continue;
    const due = lsParseTimeMs(d.due_date ?? d.dueDate);
    if (due != null && due < today0) leadSimpleOverdueTasks += 1;
  }
  let leadSimpleOpenDeals = 0;
  for (const r of lsDealExecRows) {
    const d = rowData(r);
    if (String(d.status ?? "").trim().toLowerCase() === "open") leadSimpleOpenDeals += 1;
  }

  const { rows: gcRows } = await pool.query(
    `SELECT appfolio_data FROM cached_guest_cards ORDER BY id`
  );
  let activeLeads = 0;
  if (rentEngineLeadCount > 0) {
    activeLeads = rentEngineLeadCount;
  } else {
    for (const r of gcRows) {
      const d = rowData(r);
      if (!matchesProperty(d, propertyIds)) continue;
      const st = String(d.status ?? d.Status ?? d.stage ?? "").toLowerCase();
      if (st && /\b(lost|closed|cancel|duplicate)\b/.test(st)) continue;
      activeLeads += 1;
    }
  }

  return {
    totalUnits,
    occupiedUnits: occupied,
    vacantUnits: vacant,
    occupancyRatePercent,
    totalRevenueYtd: pnl.companyRevenue.ytd,
    totalExpensesYtd: pnl.totalExpenses.ytd,
    costOfServicesYtd: pnl.costOfServices.ytd,
    grossProfitYtd: pnl.grossProfit.ytd,
    operatingExpensesYtd: pnl.operatingExpenses.ytd,
    payrollYtd: pnl.payroll.ytd,
    profitYtd: pnl.netProfit.ytd,
    profitMarginPercent: pnl.profitMarginPercent,
    monthToDateRevenue: pnl.companyRevenue.mtd,
    revenuePerDoor,
    lastYearRevenueYtd: pnl.companyRevenue.ly,
    lastYearExpensesYtd: pnl.totalExpenses.ly,
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
    screeningsTotal,
    leadSimpleOverdueTasks,
    leadSimpleOpenDeals,
    filters: { propertyIds },
  };
}

function leasingStrField(d, ...keys) {
  const o = typeof d === "object" ? d : {};
  for (const k of keys) {
    if (o[k] != null && String(o[k]).trim() !== "") return String(o[k]).trim();
  }
  return "";
}

function leasingParseYmd(s) {
  const raw = String(s ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const t = Date.parse(`${raw}T12:00:00`);
  return Number.isNaN(t) ? null : t;
}

function leasingCanonicalMonthLabel(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

function leasingNextTwelveMonthLabels() {
  const now = new Date();
  const out = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(leasingCanonicalMonthLabel(d));
  }
  return out;
}

function leasingParseMonthLabelToTime(label) {
  const s = String(label ?? "").trim();
  if (!s) return null;
  const t = Date.parse(`${s} 01`);
  return Number.isNaN(t) ? null : t;
}

function reParseCreatedAtMs(d) {
  const raw = d.created_at ?? d.createdAt;
  if (raw == null) return null;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? null : t;
}

function reStatusLeasedLike(status) {
  const x = String(status ?? "").toLowerCase();
  if (!x) return false;
  return (
    /\b(leased|moved in|placed|approved|closed|converted|tenant|occupied)\b/.test(x) ||
    x.includes("lease signed") ||
    x.includes("moved-in")
  );
}

function buildRentEnginePayload(reLeadRows, reUnitRows) {
  if (!reLeadRows.length) {
    return { hasData: false };
  }
  const prospects = reLeadRows.map((r) => rowData(r));
  const unitMap = new Map();
  for (const r of reUnitRows) {
    const d = rowData(r);
    const uid = d.id ?? d.unit_id ?? d.unitId;
    if (uid != null) unitMap.set(Number(uid), d);
  }
  const byStatus = {};
  const bySource = {};
  let prescreenedYes = 0;
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  let newThisMonth = 0;
  let newLast30 = 0;
  let leasedLike = 0;

  for (const d of prospects) {
    const st = String(d.status ?? "Unknown").trim() || "Unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;
    const src = String(d.source ?? "Unknown").trim() || "Unknown";
    bySource[src] = (bySource[src] || 0) + 1;
    if (d.prescreened === true) prescreenedYes += 1;
    const ct = reParseCreatedAtMs(d);
    if (ct != null) {
      if (ct >= startOfMonth) newThisMonth += 1;
      if (ct >= thirtyDaysAgo) newLast30 += 1;
    }
    if (reStatusLeasedLike(d.status)) leasedLike += 1;
  }

  const n = prospects.length;
  const prescreenedRatePercent = n > 0 ? Math.round((prescreenedYes / n) * 10000) / 100 : 0;
  const leadToLeaseConversionPercent =
    n > 0 ? Math.round((leasedLike / n) * 10000) / 100 : 0;

  const W = 7 * 86400000;
  const nowMs = Date.now();
  function startOfUtcWeekMonday(t) {
    const dd = new Date(t);
    const day = dd.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    dd.setUTCDate(dd.getUTCDate() + diff);
    dd.setUTCHours(0, 0, 0, 0);
    return dd.getTime();
  }
  const currentWeekStart = startOfUtcWeekMonday(nowMs);
  const weeklyVolume = [];
  for (let i = 12; i >= 0; i--) {
    const weekStart = currentWeekStart - i * W;
    const weekEnd = weekStart + W;
    let cnt = 0;
    for (const d of prospects) {
      const ct = reParseCreatedAtMs(d);
      if (ct != null && ct >= weekStart && ct < weekEnd) cnt += 1;
    }
    const wd = new Date(weekStart);
    const weekLabel = wd.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    weeklyVolume.push({ weekLabel, count: cnt });
  }

  const chartSourcePie = Object.entries(bySource)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const chartStatusBar = Object.entries(byStatus)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const prospectRows = prospects
    .map((d) => {
      const uid = d.unit_of_interest ?? d.unitOfInterest;
      let unitLabel = "—";
      if (uid != null) {
        const u = unitMap.get(Number(uid));
        if (u) {
          unitLabel =
            String(
              u.unit_name ??
                u.name ??
                u.address ??
                u.street ??
                u.full_address ??
                u.unit ??
                uid
            ).trim() || String(uid);
        } else unitLabel = String(uid);
      }
      const createdRaw = d.created_at ?? d.createdAt;
      let createdAt = "";
      if (createdRaw) {
        try {
          createdAt = new Date(createdRaw).toISOString().slice(0, 10);
        } catch {
          createdAt = String(createdRaw).slice(0, 10);
        }
      }
      return {
        id: d.id ?? null,
        name: String(d.name ?? "").trim() || "—",
        email: String(d.email ?? "").trim() || "—",
        phone: String(d.phone ?? "").trim() || "—",
        status: String(d.status ?? "").trim() || "—",
        source: String(d.source ?? "").trim() || "—",
        unitLabel,
        prescreened: Boolean(d.prescreened),
        createdAt,
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return {
    hasData: true,
    activeLeadsTotal: n,
    leadsByStatus: byStatus,
    leadsBySource: bySource,
    prescreenedRatePercent,
    newLeadsThisMonth: newThisMonth,
    newLeadsLast30Days: newLast30,
    leadToLeaseConversionPercent,
    chartSourcePie,
    chartStatusBar,
    weeklyVolume,
    prospects: prospectRows,
  };
}

function boomStr(o, ...keys) {
  const obj = o && typeof o === "object" ? o : {};
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") return String(obj[k]).trim();
  }
  return "";
}

function parseBoomDateMs(v) {
  if (v == null) return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

function buildBoomPayload(boomAppRows) {
  if (!boomAppRows.length) {
    return { hasData: false };
  }
  const rows = boomAppRows.map((r) => rowData(r));
  const byStatus = {};
  const timeToDecisionHours = [];
  const screeningApplications = [];

  for (const d of rows) {
    const st = boomStr(d, "status", "application_status", "state") || "Unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;

    const subMs = parseBoomDateMs(
      d.submitted_at ?? d.submittedAt ?? d.created_at ?? d.createdAt ?? d.created
    );
    const doneMs = parseBoomDateMs(
      d.decided_at ??
        d.decidedAt ??
        d.completed_at ??
        d.completedAt ??
        d.reviewed_at ??
        d.updated_at ??
        d.updatedAt
    );
    if (subMs != null && doneMs != null && doneMs > subMs) {
      timeToDecisionHours.push((doneMs - subMs) / 3600000);
    }

    const applicant =
      (d.applicant && typeof d.applicant === "object" ? d.applicant : null) ??
      (d.primary_applicant && typeof d.primary_applicant === "object" ? d.primary_applicant : null) ??
      (Array.isArray(d.applicants) && d.applicants[0] && typeof d.applicants[0] === "object"
        ? d.applicants[0]
        : null) ??
      d;

    let applicantName =
      boomStr(applicant, "full_name", "fullName", "name") ||
      [boomStr(applicant, "first_name", "firstName"), boomStr(applicant, "last_name", "lastName")]
        .filter(Boolean)
        .join(" ")
        .trim();
    if (!applicantName) applicantName = boomStr(d, "applicant_name", "applicantName", "name") || "—";

    let propertyName = "—";
    if (d.property && typeof d.property === "object") {
      propertyName =
        boomStr(d.property, "name", "property_name", "propertyName", "address", "street") || "—";
    } else {
      propertyName = boomStr(d, "property_name", "propertyName", "property") || "—";
    }

    let unitLabel = "—";
    if (d.unit && typeof d.unit === "object") {
      unitLabel = boomStr(d.unit, "name", "unit_name", "unitName", "label", "number") || "—";
    } else {
      unitLabel = boomStr(d, "unit_name", "unitName", "unit") || "—";
    }

    const decision =
      boomStr(d, "decision", "screening_decision", "verification_decision", "outcome") || "—";

    let submitted = "";
    const rawSub = d.submitted_at ?? d.submittedAt ?? d.created_at ?? d.createdAt;
    if (rawSub) {
      try {
        submitted = new Date(rawSub).toISOString().slice(0, 10);
      } catch {
        submitted = String(rawSub).slice(0, 10);
      }
    }

    screeningApplications.push({
      id: d.id ?? null,
      applicantName,
      property: propertyName,
      unit: unitLabel,
      status: st,
      decision,
      submitted,
    });
  }

  screeningApplications.sort((a, b) => (a.submitted < b.submitted ? 1 : a.submitted > b.submitted ? -1 : 0));

  const avgTimeToDecisionHours =
    timeToDecisionHours.length > 0
      ? Math.round((timeToDecisionHours.reduce((x, y) => x + y, 0) / timeToDecisionHours.length) * 10) / 10
      : null;

  const chartStatusBar = Object.entries(byStatus)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return {
    hasData: true,
    totalScreened: rows.length,
    applicationsByStatus: byStatus,
    avgTimeToDecisionHours,
    chartStatusBar,
    screeningApplications,
  };
}

/** GET /dashboard/leasing */
export async function getLeasing(req) {
  const pool = getPool();
  const { propertyIds } = parseFilters(req);

  const { rows: rrRows } = await pool.query(`SELECT appfolio_data FROM cached_rent_roll ORDER BY id`);
  const { rows: raRows } = await pool.query(
    `SELECT appfolio_data FROM cached_rental_applications ORDER BY id`
  );
  const { rows: leRows } = await pool.query(`SELECT appfolio_data FROM cached_lease_expirations ORDER BY id`);
  const { rows: reLeadRows } = await pool.query(`SELECT appfolio_data FROM cached_rentengine_leads ORDER BY id`);
  const { rows: reUnitRows } = await pool.query(`SELECT appfolio_data FROM cached_rentengine_units ORDER BY id`);
  const { rows: boomAppRows } = await pool.query(`SELECT appfolio_data FROM cached_boom_applications ORDER BY id`);

  let vacantUnitCount = 0;
  let onNoticeCount = 0;
  const vacantList = [];

  for (const r of rrRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    const st = rentRollStatus(d);
    if (st === RR_VACANT) {
      vacantUnitCount += 1;
      vacantList.push({
        propertyName: rentRollPropertyName(d),
        unit: rentRollUnitLabel(d),
        advertisedRent: leasingStrField(d, "advertised_rent", "advertisedRent", "rent", "Rent"),
        marketRent: leasingStrField(d, "market_rent", "marketRent"),
        sqft: leasingStrField(d, "sqft", "Sqft"),
        bdBa: leasingStrField(d, "bd_ba", "bdBa", "bed_bath"),
        rent: leasingStrField(d, "rent", "Rent"),
        status: "Vacant-Unrented",
      });
    } else if (st === RR_NOTICE) {
      onNoticeCount += 1;
      vacantList.push({
        propertyName: rentRollPropertyName(d),
        unit: rentRollUnitLabel(d),
        advertisedRent: leasingStrField(d, "advertised_rent", "advertisedRent", "rent", "Rent"),
        marketRent: leasingStrField(d, "market_rent", "marketRent"),
        sqft: leasingStrField(d, "sqft", "Sqft"),
        bdBa: leasingStrField(d, "bd_ba", "bdBa", "bed_bath"),
        rent: leasingStrField(d, "rent", "Rent"),
        status: "Notice-Unrented",
      });
    }
  }

  vacantList.sort((a, b) => {
    const c = a.propertyName.localeCompare(b.propertyName, undefined, { sensitivity: "base" });
    if (c !== 0) return c;
    return a.unit.localeCompare(b.unit, undefined, { sensitivity: "base" });
  });

  const monthLabels = leasingNextTwelveMonthLabels();
  const monthMap = new Map(monthLabels.map((m) => [m, 0]));
  for (const r of rrRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    const lm = leasingStrField(d, "lease_expires_month", "leaseExpiresMonth");
    if (!lm) continue;
    const tt = leasingParseMonthLabelToTime(lm);
    if (tt == null) continue;
    const canon = leasingCanonicalMonthLabel(new Date(tt));
    if (monthMap.has(canon)) monthMap.set(canon, (monthMap.get(canon) ?? 0) + 1);
  }

  const nowMs = Date.now();
  const ms90 = 90 * 86400000;
  const byMonth = monthLabels.map((month) => {
    const tt = leasingParseMonthLabelToTime(month);
    const mid = tt != null ? tt + 15 * 86400000 : null;
    const within90 =
      mid != null && mid >= nowMs && mid <= nowMs + ms90;
    return { month, count: monthMap.get(month) ?? 0, within90 };
  });

  const apps = raRows.map(rowData).filter((d) => matchesProperty(d, propertyIds));
  const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const appsYtd = apps.filter((d) => {
    const rec = leasingParseYmd(d.received ?? d.Received);
    return rec != null && rec >= ytdStart;
  });
  const byAppStatus = {};
  for (const d of apps) {
    const s = leasingStrField(d, "status", "Status") || "Unknown";
    byAppStatus[s] = (byAppStatus[s] || 0) + 1;
  }
  const convertedYtd = appsYtd.filter((d) => leasingStrField(d, "status", "Status") === "Converted").length;
  const conversionRatePct =
    appsYtd.length > 0 ? Math.round((convertedYtd / appsYtd.length) * 10000) / 100 : 0;

  const ttcVals = apps
    .filter((d) => leasingStrField(d, "status", "Status") === "Converted")
    .map((d) => parseMoney(d.time_to_conversion ?? d.timeToConversion))
    .filter((n) => n > 0);
  const avgTimeToConversion =
    ttcVals.length > 0
      ? Math.round((ttcVals.reduce((a, b) => a + b, 0) / ttcVals.length) * 10) / 10
      : 0;

  const recentApplications = apps
    .map((d) => ({
      applicants: leasingStrField(d, "applicants", "Applicants"),
      propertyName: leasingStrField(d, "property_name", "propertyName"),
      unit: leasingStrField(d, "unit_name", "unitName", "unit"),
      status: leasingStrField(d, "status", "Status"),
      received: leasingStrField(d, "received", "Received"),
      moveInDate: leasingStrField(d, "move_in_date", "moveInDate"),
      leadSource: leasingStrField(d, "lead_source", "leadSource"),
      timeToConversion: parseMoney(d.time_to_conversion ?? d.timeToConversion) || null,
    }))
    .sort((a, b) => (leasingParseYmd(b.received) ?? 0) - (leasingParseYmd(a.received) ?? 0));

  const leList = leRows.map(rowData).filter((d) => matchesProperty(d, propertyIds));
  const byLeStatus = {};
  for (const d of leList) {
    const s = leasingStrField(d, "status", "Status") || "Unknown";
    byLeStatus[s] = (byLeStatus[s] || 0) + 1;
  }
  const renewed = byLeStatus["Renewed"] ?? 0;
  const notEligible = byLeStatus["Not Eligible"] ?? 0;
  const renewalRatePct =
    renewed + notEligible > 0 ? Math.round((renewed / (renewed + notEligible)) * 10000) / 100 : 0;

  const upcoming90Days = [];
  let leaseExpiringNext90Days = 0;
  const horizon = nowMs + ms90;
  for (const d of leList) {
    const exp = leasingParseYmd(d.lease_expires ?? d.leaseExpires);
    if (exp == null) continue;
    if (exp < nowMs || exp > horizon) continue;
    leaseExpiringNext90Days += 1;
    const daysUntil = Math.max(0, Math.ceil((exp - nowMs) / 86400000));
    upcoming90Days.push({
      tenantName: leasingStrField(d, "tenant_name", "tenantName", "name"),
      propertyName: leasingStrField(d, "property_name", "propertyName"),
      unit: leasingStrField(d, "unit", "Unit", "unit_name"),
      leaseExpires: String(d.lease_expires ?? d.leaseExpires ?? "").trim().slice(0, 10),
      rent: leasingStrField(d, "rent", "Rent"),
      marketRent: leasingStrField(d, "market_rent", "marketRent"),
      status: leasingStrField(d, "status", "Status"),
      daysUntilExpiration: daysUntil,
    });
  }
  upcoming90Days.sort((a, b) => {
    const ta = leasingParseYmd(a.leaseExpires) ?? 0;
    const tb = leasingParseYmd(b.leaseExpires) ?? 0;
    return ta - tb;
  });

  const rentEngine = buildRentEnginePayload(reLeadRows, reUnitRows);
  const boom = buildBoomPayload(boomAppRows);

  return {
    dataSources: {
      appfolio: true,
      rentengine: rentEngine.hasData === true,
      boom: boom.hasData === true,
    },
    rentEngine,
    boom,
    vacancy: {
      vacantUnits: vacantUnitCount,
      onNotice: onNoticeCount,
      vacantList,
    },
    applications: {
      total: apps.length,
      ytdTotal: appsYtd.length,
      conversionRatePercent: conversionRatePct,
      byStatus: byAppStatus,
      avgTimeToConversion,
      recentApplications,
    },
    leaseExpirations: {
      total: leList.length,
      byStatus: byLeStatus,
      byMonth,
      upcoming90Days,
      leaseExpiringNext90Days,
      renewalRatePercent: renewalRatePct,
    },
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

const FINANCE_GOAL_ANNUAL = 775_000;
const FINANCE_REV_PER_DOOR_GOAL = 215;
const FINANCE_MARGIN_GOAL = 20;

function breakdownPercent(part, total) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/** GET /dashboard/finance */
export async function getFinance(req) {
  const pool = getPool();
  const { propertyIds } = parseFilters(req);

  const { rows: inc } = await pool.query(
    `SELECT appfolio_data, period FROM cached_income_statement ORDER BY id`
  );
  const { rows: del } = await pool.query(`SELECT appfolio_data FROM cached_delinquency ORDER BY id`);

  const pnl = aggregatePortfolioIncomeStatement(inc, propertyIds);
  const delKpis = aggregateDelinquencyFromRows(del, propertyIds);

  const incomeStatement = [];
  for (const r of inc) {
    const d = rowData(r);
    if (!matchesPropertyFilterForReportRows(d, propertyIds)) continue;
    incomeStatement.push({ ...d, _period: r.period });
  }

  const { rows: rrCountRows } = await pool.query(`SELECT appfolio_data FROM cached_rent_roll ORDER BY id`);
  const rrCountAgg = aggregateRentRollFromRows(rrCountRows, propertyIds);
  const unitCount = rrCountAgg.totalUnits;

  const monthsElapsed = Math.max(1, new Date().getMonth() + 1);
  /** Average company revenue per door per month: (YTD ÷ months elapsed) ÷ units. */
  const revenuePerDoor =
    unitCount > 0
      ? Math.round((pnl.companyRevenue.ytd / monthsElapsed / unitCount) * 100) / 100
      : 0;
  const revenuePerDoorMonthlyAvg = revenuePerDoor;

  const goalProgress =
    FINANCE_GOAL_ANNUAL > 0
      ? Math.round((pnl.companyRevenue.ytd / FINANCE_GOAL_ANNUAL) * 1000) / 10
      : 0;

  const companyYtdTotal = pnl.companyRevenue.ytd;
  const d = pnl.donut;

  const companyRevenueBreakdown = [
    {
      category: "Management Fees",
      ytd: roundMoney2(d.managementFees.ytd),
      mtd: roundMoney2(d.managementFees.mtd),
      lastYearYtd: roundMoney2(d.managementFees.ly),
      percent: breakdownPercent(d.managementFees.ytd, companyYtdTotal),
    },
    {
      category: "Leasing & Admin Fees",
      ytd: roundMoney2(d.leasingAdmin.ytd),
      mtd: roundMoney2(d.leasingAdmin.mtd),
      lastYearYtd: roundMoney2(d.leasingAdmin.ly),
      percent: breakdownPercent(d.leasingAdmin.ytd, companyYtdTotal),
    },
    {
      category: "Maintenance Revenue",
      ytd: roundMoney2(d.maintenanceRevenue.ytd),
      mtd: roundMoney2(d.maintenanceRevenue.mtd),
      lastYearYtd: roundMoney2(d.maintenanceRevenue.ly),
      percent: breakdownPercent(d.maintenanceRevenue.ytd, companyYtdTotal),
    },
    {
      category: "Tenant Fees",
      ytd: roundMoney2(d.tenantFees.ytd),
      mtd: roundMoney2(d.tenantFees.mtd),
      lastYearYtd: roundMoney2(d.tenantFees.ly),
      percent: breakdownPercent(d.tenantFees.ytd, companyYtdTotal),
    },
    {
      category: "Other Revenue",
      ytd: roundMoney2(d.otherRevenue.ytd),
      mtd: roundMoney2(d.otherRevenue.mtd),
      lastYearYtd: roundMoney2(d.otherRevenue.ly),
      percent: breakdownPercent(d.otherRevenue.ytd, companyYtdTotal),
    },
  ];

  const bo = pnl.ownerBuckets;
  const ownerRevenueBreakdown = [
    {
      category: "Rent Income",
      ytd: roundMoney2(bo.rent.ytd),
      mtd: roundMoney2(bo.rent.mtd),
      lastYearYtd: roundMoney2(bo.rent.ly),
    },
    {
      category: "Tenant Fees",
      ytd: roundMoney2(bo.tenantFees.ytd),
      mtd: roundMoney2(bo.tenantFees.mtd),
      lastYearYtd: roundMoney2(bo.tenantFees.ly),
    },
    {
      category: "Other",
      ytd: roundMoney2(bo.other.ytd),
      mtd: roundMoney2(bo.other.mtd),
      lastYearYtd: roundMoney2(bo.other.ly),
    },
  ];

  const ox = pnl.opexDetail;
  const expenseBreakdown = [
    {
      category: "Cost of Services",
      ytd: roundMoney2(pnl.costOfServices.ytd),
      mtd: roundMoney2(pnl.costOfServices.mtd),
      lastYearYtd: roundMoney2(pnl.costOfServices.ly),
    },
    {
      category: "Advertising & Marketing",
      ytd: roundMoney2(ox.advertising.ytd),
      mtd: roundMoney2(ox.advertising.mtd),
      lastYearYtd: roundMoney2(ox.advertising.ly),
    },
    {
      category: "Professional Services",
      ytd: roundMoney2(ox.professional.ytd),
      mtd: roundMoney2(ox.professional.mtd),
      lastYearYtd: roundMoney2(ox.professional.ly),
    },
    {
      category: "Office Expenses",
      ytd: roundMoney2(ox.office.ytd),
      mtd: roundMoney2(ox.office.mtd),
      lastYearYtd: roundMoney2(ox.office.ly),
    },
    {
      category: "Fees & Royalties",
      ytd: roundMoney2(ox.feesRoyalties.ytd),
      mtd: roundMoney2(ox.feesRoyalties.mtd),
      lastYearYtd: roundMoney2(ox.feesRoyalties.ly),
    },
    {
      category: "Travel",
      ytd: roundMoney2(ox.travel.ytd),
      mtd: roundMoney2(ox.travel.mtd),
      lastYearYtd: roundMoney2(ox.travel.ly),
    },
    {
      category: "Insurance",
      ytd: roundMoney2(ox.insurance.ytd),
      mtd: roundMoney2(ox.insurance.mtd),
      lastYearYtd: roundMoney2(ox.insurance.ly),
    },
    {
      category: "Other Operating",
      ytd: roundMoney2(ox.other.ytd),
      mtd: roundMoney2(ox.other.mtd),
      lastYearYtd: roundMoney2(ox.other.ly),
    },
    {
      category: "Payroll",
      ytd: roundMoney2(pnl.payroll.ytd),
      mtd: roundMoney2(pnl.payroll.mtd),
      lastYearYtd: roundMoney2(pnl.payroll.ly),
    },
  ];

  const profitAndLoss = {
    companyRevenue: {
      ytd: roundMoney2(pnl.companyRevenue.ytd),
      mtd: roundMoney2(pnl.companyRevenue.mtd),
      lastYearYtd: roundMoney2(pnl.companyRevenue.ly),
    },
    costOfServices: {
      ytd: roundMoney2(pnl.costOfServices.ytd),
      mtd: roundMoney2(pnl.costOfServices.mtd),
      lastYearYtd: roundMoney2(pnl.costOfServices.ly),
    },
    grossProfit: {
      ytd: roundMoney2(pnl.grossProfit.ytd),
      mtd: roundMoney2(pnl.grossProfit.mtd),
      lastYearYtd: roundMoney2(pnl.grossProfit.ly),
    },
    operatingExpenses: {
      ytd: roundMoney2(pnl.operatingExpenses.ytd),
      mtd: roundMoney2(pnl.operatingExpenses.mtd),
      lastYearYtd: roundMoney2(pnl.operatingExpenses.ly),
    },
    payroll: {
      ytd: roundMoney2(pnl.payroll.ytd),
      mtd: roundMoney2(pnl.payroll.mtd),
      lastYearYtd: roundMoney2(pnl.payroll.ly),
    },
    totalExpenses: {
      ytd: roundMoney2(pnl.totalExpenses.ytd),
      mtd: roundMoney2(pnl.totalExpenses.mtd),
      lastYearYtd: roundMoney2(pnl.totalExpenses.ly),
    },
    netProfit: {
      ytd: roundMoney2(pnl.netProfit.ytd),
      mtd: roundMoney2(pnl.netProfit.mtd),
      lastYearYtd: roundMoney2(pnl.netProfit.ly),
    },
  };

  const tenantRows = [];
  for (const r of del) {
    const d = rowData(r);
    if (!matchesPropertyFilterForReportRows(d, propertyIds)) continue;
    const amt = delinquencyAmountReceivable(d);
    if (amt <= 0) continue;
    const ag = delinquencyAgingSlices(d);
    tenantRows.push({
      name: String(d.name ?? d.Name ?? "").trim() || "—",
      amount: roundMoney2(amt),
      property: String(d.property_name ?? d.PropertyName ?? "").trim() || "—",
      unit: delinquencyTenantUnit(d) || "—",
      lastPayment: lastPaymentFromRow(d) || "—",
      daysDelinquent: daysDelinquentFromRow(d),
      aging: {
        current: roundMoney2(ag.d00to30),
        days30to60: roundMoney2(ag.d30to60),
        days60to90: roundMoney2(ag.d60to90),
        days90plus: roundMoney2(ag.d90plus),
      },
      inCollections: inCollectionsFromRow(d) || "—",
    });
  }
  tenantRows.sort((a, b) => b.amount - a.amount);

  const delAccountCount = delKpis.delinquentAccountCount;
  const avgPerAccount =
    delAccountCount > 0 ? roundMoney2(delKpis.totalDelinquency / delAccountCount) : 0;

  return {
    profitAndLoss,
    companyRevenue: {
      ytd: roundMoney2(pnl.companyRevenue.ytd),
      mtd: roundMoney2(pnl.companyRevenue.mtd),
      lastYearYtd: roundMoney2(pnl.companyRevenue.ly),
      yoyChange: roundMoney2(pnl.yoyChange),
      goalAnnual: FINANCE_GOAL_ANNUAL,
      goalProgress,
      revenuePerDoor,
      revenuePerDoorMonthlyAvg,
      revenuePerDoorGoal: FINANCE_REV_PER_DOOR_GOAL,
    },
    companyRevenueBreakdown,
    expenseBreakdown,
    ownerRevenue: {
      ytd: roundMoney2(pnl.ownerRevenue.ytd),
      mtd: roundMoney2(pnl.ownerRevenue.mtd),
      lastYearYtd: roundMoney2(pnl.ownerRevenue.ly),
    },
    ownerRevenueBreakdown,
    profitMargin: {
      current: pnl.profitMarginPercent,
      monthToDate: pnl.profitMarginPercentMtd,
      goal: FINANCE_MARGIN_GOAL,
    },
    delinquency: {
      totalAmount: roundMoney2(delKpis.totalDelinquency),
      accountCount: delKpis.delinquentAccountCount,
      aging: {
        current: roundMoney2(delKpis.aging00to30),
        days30to60: roundMoney2(delKpis.aging30to60),
        days60to90: roundMoney2(delKpis.aging60to90),
        days90plus: roundMoney2(delKpis.aging90Plus),
      },
      avgPerAccount,
      tenants: tenantRows,
    },
    incomeStatement,
    totalRevenueInCache: roundMoney2(pnl.companyRevenue.ytd),
    revenuePerDoor,
    filters: { propertyIds },
  };
}

function portfolioPropString(d, ...keys) {
  const o = typeof d === "object" ? d : {};
  for (const k of keys) {
    if (o[k] != null && String(o[k]).trim() !== "") return String(o[k]).trim();
  }
  return "";
}

function portfolioNormalizeName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase();
}

function portfolioOccupancyAggregate(rrRows, propertyName) {
  const target = portfolioNormalizeName(propertyName);
  let hasVac = false;
  let hasNotice = false;
  for (const r of rrRows) {
    const d = rowData(r);
    if (portfolioNormalizeName(rentRollPropertyName(d)) !== target) continue;
    const st = rentRollStatus(d);
    if (st === RR_VACANT) hasVac = true;
    else if (st === RR_NOTICE) hasNotice = true;
  }
  if (hasVac) return "Vacant";
  if (hasNotice) return "Notice";
  return "Current";
}

function portfolioCountOpenWo(woRows, propertyName) {
  const target = portfolioNormalizeName(propertyName);
  let n = 0;
  for (const r of woRows) {
    const d = rowData(r);
    if (!isAppfolioWorkOrderOpen(d)) continue;
    const pn = portfolioNormalizeName(String(d.property_name ?? d.PropertyName ?? "").trim());
    if (pn !== target) continue;
    n += 1;
  }
  return n;
}

function portfolioSumDelinquency(delRows, propertyName) {
  const target = portfolioNormalizeName(propertyName);
  let s = 0;
  for (const r of delRows) {
    const d = rowData(r);
    if (portfolioNormalizeName(String(d.property_name ?? d.PropertyName ?? "").trim()) !== target)
      continue;
    s += delinquencyAmountReceivable(d);
  }
  return roundMoney2(s);
}

function portfolioListOpenWos(woRows, propertyName) {
  const target = portfolioNormalizeName(propertyName);
  const out = [];
  for (const r of woRows) {
    const d = rowData(r);
    if (!isAppfolioWorkOrderOpen(d)) continue;
    if (portfolioNormalizeName(String(d.property_name ?? d.PropertyName ?? "").trim()) !== target)
      continue;
    out.push({
      workOrderNumber: String(d.work_order_number ?? d.workOrderNumber ?? "").trim() || "—",
      status: workOrderStatus(d),
      priority: String(d.priority ?? d.Priority ?? "Normal").trim(),
      issue:
        String(d.work_order_issue ?? d.work_order_type ?? "").trim() || "—",
      vendor: workOrderVendorName(d),
      createdAt: workOrderCreatedYmd(d),
    });
  }
  return out;
}

function portfolioListDelinquentTenants(delRows, propertyName) {
  const target = portfolioNormalizeName(propertyName);
  const out = [];
  for (const r of delRows) {
    const d = rowData(r);
    if (portfolioNormalizeName(String(d.property_name ?? d.PropertyName ?? "").trim()) !== target)
      continue;
    const amt = delinquencyAmountReceivable(d);
    if (amt <= 0) continue;
    out.push({
      name: String(d.name ?? d.Name ?? "").trim() || "—",
      unit: delinquencyTenantUnit(d) || "—",
      amount: roundMoney2(amt),
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

function portfolioFormatAddress(d) {
  const line = portfolioPropString(d, "property_address", "PropertyAddress");
  const city = portfolioPropString(d, "property_city", "propertyCity");
  const st = portfolioPropString(d, "property_state", "propertyState");
  const zip = portfolioPropString(d, "property_zip", "propertyZip");
  if (line && city) return `${line} ${city}, ${st} ${zip}`.replace(/\s+/g, " ").trim();
  if (line) return line;
  return [city, st, zip].filter(Boolean).join(", ");
}

/** @returns { "ok" | "expired" | "expiring90" | "none" } */
function portfolioExpiryFlag(isoRaw) {
  const s = String(isoRaw ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return "none";
  const t = Date.parse(`${s}T12:00:00`);
  if (Number.isNaN(t)) return "none";
  const now = Date.now();
  const end90 = now + 90 * 86400000;
  if (t < now) return "expired";
  if (t <= end90) return "expiring90";
  return "ok";
}

function portfolioCountOwnedFromText(propertiesOwnedText) {
  const s = String(propertiesOwnedText ?? "").trim();
  if (!s) return 0;
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean).length;
}

function portfolioParseOwnershipLines(propertiesOwnedText) {
  const s = String(propertiesOwnedText ?? "");
  const out = [];
  const re = /([^,]+?)\s*\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push({ propertyName: m[1].trim(), ownershipPercent: m[2].trim() });
  }
  return out;
}

function portfolioFirstPhone(phoneRaw) {
  const s = String(phoneRaw ?? "").trim();
  if (!s) return "";
  const first = s.split(",")[0];
  return first ? first.trim() : "";
}

/** GET /dashboard/portfolio */
export async function getPortfolio(req) {
  const pool = getPool();
  const { propertyIds, ownerIds } = parseFilters(req);

  const { rows: propsRows } = await pool.query(
    `SELECT appfolio_data FROM cached_properties ORDER BY id`
  );
  const { rows: ownersRows } = await pool.query(`SELECT appfolio_data FROM cached_owners ORDER BY id`);
  const { rows: rr } = await pool.query(`SELECT appfolio_data FROM cached_rent_roll ORDER BY id`);
  const { rows: woRows } = await pool.query(`SELECT appfolio_data FROM cached_work_orders ORDER BY id`);
  const { rows: delRows } = await pool.query(`SELECT appfolio_data FROM cached_delinquency ORDER BY id`);

  const propertyDirectory = propsRows.map(rowData).filter((d) => matchesProperty(d, propertyIds));

  const rrAgg = aggregateRentRollFromRows(rr, propertyIds);

  const byType = {};
  let mgmtSum = 0;
  let mgmtN = 0;
  let insuranceExpiring90 = 0;
  let insuranceExpired = 0;
  let warrantyExpiring90 = 0;
  let warrantyExpired = 0;
  let propertiesOnNotice = 0;

  const properties = [];

  for (const d of propertyDirectory) {
    const propertyName = portfolioPropString(d, "property_name", "PropertyName");
    if (!propertyName) continue;

    const propertyType = portfolioPropString(d, "property_type", "propertyType") || "Unknown";
    byType[propertyType] = (byType[propertyType] || 0) + 1;

    const mfp = portfolioPropString(d, "management_fee_percent", "managementFeePercent");
    if (mfp !== "") {
      const n = parseMoney(mfp);
      mgmtSum += n;
      mgmtN += 1;
    }

    const occ = portfolioOccupancyAggregate(rr, propertyName);
    if (occ === "Notice") propertiesOnNotice += 1;

    const insFlag = portfolioExpiryFlag(d.insurance_expiration ?? d.insuranceExpiration);
    if (insFlag === "expiring90") insuranceExpiring90 += 1;
    if (insFlag === "expired") insuranceExpired += 1;

    const warFlag = portfolioExpiryFlag(d.home_warranty_expiration ?? d.homeWarrantyExpiration);
    if (warFlag === "expiring90") warrantyExpiring90 += 1;
    if (warFlag === "expired") warrantyExpired += 1;

    const pid =
      extractPropertyId(d) ??
      d.property_id ??
      d.PropertyId ??
      d.propertyId ??
      null;

    const openWo = portfolioCountOpenWo(woRows, propertyName);
    const delSum = portfolioSumDelinquency(delRows, propertyName);

    const insExp = portfolioPropString(d, "insurance_expiration", "insuranceExpiration");
    const warExp = portfolioPropString(d, "home_warranty_expiration", "homeWarrantyExpiration");

    properties.push({
      propertyId: pid != null ? pid : propertyName,
      propertyName,
      address: portfolioFormatAddress(d),
      city: portfolioPropString(d, "property_city", "propertyCity"),
      state: portfolioPropString(d, "property_state", "propertyState"),
      zip: portfolioPropString(d, "property_zip", "propertyZip"),
      propertyType,
      units: parseMoney(d.units ?? d.Units ?? 0) || 0,
      sqft: portfolioPropString(d, "sqft", "Sqft"),
      yearBuilt: portfolioPropString(d, "year_built", "yearBuilt"),
      marketRent: portfolioPropString(d, "market_rent", "marketRent"),
      managementFeePercent: mfp,
      managementStartDate: portfolioPropString(d, "management_start_date", "managementStartDate"),
      maintenanceLimit: portfolioPropString(d, "maintenance_limit", "maintenanceLimit"),
      reserve: portfolioPropString(d, "reserve", "Reserve"),
      owners: portfolioPropString(d, "owners", "Owners"),
      insuranceExpiration: insExp,
      homeWarrantyExpiration: warExp,
      insuranceExpiryFlag: insFlag,
      warrantyExpiryFlag: warFlag,
      occupancy: occ,
      openWorkOrders: openWo,
      delinquency: delSum,
      expandDetails: {
        propertyAddressFull: portfolioFormatAddress(d),
        sqft: portfolioPropString(d, "sqft", "Sqft"),
        yearBuilt: portfolioPropString(d, "year_built", "yearBuilt"),
        managementFeeType: portfolioPropString(d, "management_fee_type", "managementFeeType"),
        managementFlatFee: portfolioPropString(d, "management_flat_fee", "managementFlatFee"),
        managementEndDate: portfolioPropString(d, "management_end_date", "managementEndDate"),
        leaseFeePercent: portfolioPropString(d, "lease_fee_percent", "leaseFeePercent"),
        leaseFeeType: portfolioPropString(d, "lease_fee_type", "leaseFeeType"),
        leaseFlatFee: portfolioPropString(d, "lease_flat_fee", "leaseFlatFee"),
        renewalFeePercent: portfolioPropString(d, "renewal_fee_percent", "renewalFeePercent"),
        renewalFeeType: portfolioPropString(d, "renewal_fee_type", "renewalFeeType"),
        renewalFlatFee: portfolioPropString(d, "renewal_flat_fee", "renewalFlatFee"),
        lateFeeType: portfolioPropString(d, "late_fee_type", "lateFeeType"),
        lateFeeBaseAmount: portfolioPropString(d, "late_fee_base_amount", "lateFeeBaseAmount"),
        lateFeeGracePeriod: portfolioPropString(d, "late_fee_grace_period", "lateFeeGracePeriod"),
        portfolio: portfolioPropString(d, "portfolio", "Portfolio"),
        visibility: portfolioPropString(d, "visibility", "Visibility"),
        openWorkOrdersList: portfolioListOpenWos(woRows, propertyName),
        delinquentTenants: portfolioListDelinquentTenants(delRows, propertyName),
      },
    });
  }

  properties.sort((a, b) =>
    String(a.propertyName).localeCompare(b.propertyName, undefined, { sensitivity: "base" })
  );

  const ownerRowsFiltered = ownersRows
    .map(rowData)
    .filter((d) => matchesOwner(d, ownerIds))
    .filter((d) => {
      if (!propertyIds.length) return true;
      const pid = extractPropertyId(d);
      if (pid == null) return true;
      return propertyIds.includes(String(pid));
    });

  const owners = ownerRowsFiltered.map((d) => {
    const oid = d.owner_id ?? d.OwnerId ?? d.ownerId ?? null;
    const propsOwned = portfolioPropString(d, "properties_owned", "propertiesOwned");
    const pc = portfolioCountOwnedFromText(propsOwned);
    return {
      ownerId: oid != null ? oid : portfolioPropString(d, "name", "Name"),
      name: portfolioPropString(d, "name", "Name") || "—",
      email: portfolioPropString(d, "email", "Email"),
      phone: portfolioFirstPhone(d.phone_numbers ?? d.phoneNumbers ?? d.phone),
      propertiesOwned: propsOwned,
      propertyCount: pc > 0 ? pc : portfolioParseOwnershipLines(propsOwned).length,
      lastPaymentDate: portfolioPropString(d, "last_payment_date", "lastPaymentDate"),
      tags: portfolioPropString(d, "tags", "Tags"),
      ownershipLines: portfolioParseOwnershipLines(propsOwned),
    };
  });

  owners.sort((a, b) =>
    String(a.name).localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  const avgManagementFee = mgmtN > 0 ? Math.round((mgmtSum / mgmtN) * 100) / 100 : 0;

  const summary = {
    totalProperties: properties.length,
    totalUnits: rrAgg.totalUnits,
    byType,
    totalOwners: owners.length,
    avgManagementFee,
    insuranceExpiringNext90Days: insuranceExpiring90,
    insuranceExpiredCount: insuranceExpired,
    warrantyExpiringNext90Days: warrantyExpiring90,
    warrantyExpiredCount: warrantyExpired,
    propertiesOnNotice,
  };

  return {
    summary,
    properties,
    owners,
    occupancyByProperty: rrAgg.byProperty,
    propertyDirectory,
    filters: { propertyIds, ownerIds },
  };
}

/** GET /dashboard/crm — LeadSimple aggregates (company-wide; ignores property filters). */
export async function getCrm(_req) {
  const pool = getPool();
  const [
    { rows: dealRows },
    { rows: taskRows },
    { rows: contactRows },
    { rows: processRows },
    { rows: convRows },
  ] = await Promise.all([
    pool.query(`SELECT appfolio_data FROM cached_leadsimple_deals`),
    pool.query(`SELECT appfolio_data FROM cached_leadsimple_tasks`),
    pool.query(`SELECT appfolio_data FROM cached_leadsimple_contacts`),
    pool.query(`SELECT appfolio_data FROM cached_leadsimple_processes`),
    pool.query(`SELECT appfolio_data FROM cached_leadsimple_conversations`),
  ]);

  const deals = dealRows.map((r) => rowData(r));
  const tasks = taskRows.map((r) => rowData(r));
  const contacts = contactRows.map((r) => rowData(r));
  const processes = processRows.map((r) => rowData(r));
  const conversations = convRows.map((r) => rowData(r));

  const byDealStatus = { open: 0, won: 0, lost: 0, cancelled: 0 };
  let dealOther = 0;
  for (const d of deals) {
    let k = String(d.status ?? "").trim().toLowerCase();
    if (k === "canceled") k = "cancelled";
    if (k in byDealStatus) byDealStatus[k] += 1;
    else dealOther += 1;
  }
  const byStatusOut = { ...byDealStatus };
  if (dealOther > 0) byStatusOut.other = dealOther;

  const recentDeals = [...deals]
    .sort((a, b) => (lsParseTimeMs(b.updated_at ?? b.updatedAt) ?? 0) - (lsParseTimeMs(a.updated_at ?? a.updatedAt) ?? 0))
    .slice(0, 20);

  const todayStart = lsStartOfLocalTodayMs();
  const weekEnd = todayStart + 7 * 86400000;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let overdue = 0;
  let dueThisWeek = 0;
  let completedThisMonth = 0;
  for (const d of tasks) {
    const due = lsParseTimeMs(d.due_date ?? d.dueDate);
    if (lsIsCompleted(d)) {
      const doneAt = lsParseTimeMs(d.completed_at ?? d.completedAt) ?? lsParseTimeMs(d.updated_at ?? d.updatedAt);
      if (doneAt != null && doneAt >= monthStart) completedThisMonth += 1;
      continue;
    }
    if (due != null && due < todayStart) overdue += 1;
    if (due != null && due >= todayStart && due < weekEnd) dueThisWeek += 1;
  }

  const incompleteTasks = tasks.filter((d) => !lsIsCompleted(d));
  const recentTasks = [...incompleteTasks]
    .sort((a, b) => {
      const da = lsParseTimeMs(a.due_date ?? a.dueDate);
      const db = lsParseTimeMs(b.due_date ?? b.dueDate);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    })
    .slice(0, 20);

  const byType = { owner: 0, tenant: 0, vendor: 0 };
  let contactOther = 0;
  for (const c of contacts) {
    const k = String(c.contact_type ?? c.contactType ?? "").trim().toLowerCase();
    if (k in byType) byType[k] += 1;
    else contactOther += 1;
  }
  const byTypeOut = { ...byType };
  if (contactOther > 0) byTypeOut.other = contactOther;

  const byProcStatus = { open: 0, completed: 0, cancelled: 0 };
  let procOther = 0;
  for (const p of processes) {
    const k = String(p.status ?? "").trim().toLowerCase();
    if (k in byProcStatus) byProcStatus[k] += 1;
    else procOther += 1;
  }
  const byProcOut = { ...byProcStatus };
  if (procOther > 0) byProcOut.other = procOther;

  const openProcesses = processes.filter((p) => String(p.status ?? "").trim().toLowerCase() === "open");
  const recentProcesses = [...openProcesses]
    .sort((a, b) => (lsParseTimeMs(b.updated_at ?? b.updatedAt) ?? 0) - (lsParseTimeMs(a.updated_at ?? a.updatedAt) ?? 0))
    .slice(0, 20);

  let convOpen = 0;
  for (const c of conversations) {
    if (String(c.status ?? "").trim().toLowerCase() === "open") convOpen += 1;
  }

  return {
    deals: {
      total: deals.length,
      byStatus: byStatusOut,
      recentDeals,
    },
    tasks: {
      total: tasks.length,
      overdue,
      dueThisWeek,
      completedThisMonth,
      recentTasks,
    },
    contacts: {
      total: contacts.length,
      byType: byTypeOut,
    },
    processes: {
      total: processes.length,
      byStatus: byProcOut,
      recentProcesses,
    },
    conversations: {
      total: conversations.length,
      open: convOpen,
    },
  };
}
