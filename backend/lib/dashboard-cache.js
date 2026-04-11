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
