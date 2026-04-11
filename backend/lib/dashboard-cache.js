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

function delinquencyAmount(d) {
  const o = typeof d === "object" ? d : {};
  return parseMoney(
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

function incomeRowAmount(d) {
  const o = typeof d === "object" ? d : {};
  const v =
    o.amount ??
    o.Amount ??
    o.net_amount ??
    o.NetAmount ??
    o.total ??
    o.Total ??
    o.credit ??
    o.debit ??
    0;
  return parseMoney(v);
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

  const cy = String(new Date().getUTCFullYear());
  const { rows: incRows } = await pool.query(
    `SELECT appfolio_data, period FROM cached_income_statement ORDER BY id`
  );
  let totalRevenueYtd = 0;
  for (const r of incRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    const per = r.period != null ? String(r.period) : "";
    if (per && !per.startsWith(cy)) continue;
    totalRevenueYtd += Math.abs(incomeRowAmount(d));
  }

  const { rows: woRows } = await pool.query(
    `SELECT appfolio_data FROM cached_work_orders ORDER BY id`
  );
  let openWorkOrders = 0;
  for (const r of woRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    if (isOpenWorkOrderStatus(workOrderStatus(d))) openWorkOrders += 1;
  }

  const { rows: delRows } = await pool.query(
    `SELECT appfolio_data FROM cached_delinquency ORDER BY id`
  );
  let totalDelinquency = 0;
  for (const r of delRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    totalDelinquency += delinquencyAmount(d);
  }

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
    totalRevenueYtd,
    openWorkOrders,
    totalDelinquency,
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

  return {
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

  const incomeStatement = [];
  for (const r of inc) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    incomeStatement.push({ ...d, _period: r.period });
  }

  const delinquency = [];
  for (const r of del) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    const amt = delinquencyAmount(d);
    const days =
      d.days_past_due ??
      d.DaysPastDue ??
      d.days_delinquent ??
      d.age_days ??
      null;
    delinquency.push({
      ...d,
      _computedAmount: amt,
      _agingDays: days,
    });
  }

  const { rows: unitRows } = await pool.query(`SELECT appfolio_data FROM cached_units`);
  let unitCount = 0;
  for (const r of unitRows) {
    const d = rowData(r);
    if (!matchesProperty(d, propertyIds)) continue;
    unitCount += 1;
  }

  let revenueSum = 0;
  for (const row of incomeStatement) {
    revenueSum += Math.abs(incomeRowAmount(row));
  }
  const revenuePerDoor = unitCount > 0 ? Math.round((revenueSum / unitCount) * 100) / 100 : 0;

  return {
    incomeStatement,
    delinquency,
    revenuePerDoor,
    totalRevenueInCache: revenueSum,
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
