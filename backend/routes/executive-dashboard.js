import { getPool } from "../lib/db.js";

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function num(v) {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function pct(part, whole) {
  if (!whole || whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function buildExecutiveData() {
  const pool = getPool();

  // ---- 1. Portfolio Health ----
  const { rows: rrRows } = await pool.query(
    `SELECT appfolio_data->>'status' as status, COUNT(*)::int as cnt FROM cached_rent_roll GROUP BY 1`
  );
  const statusMap = {};
  let totalDoors = 0;
  for (const r of rrRows) { statusMap[r.status] = r.cnt; totalDoors += r.cnt; }
  const occupied = statusMap["Current"] || 0;
  const vacant = statusMap["Vacant-Unrented"] || 0;
  const onNotice = statusMap["Notice-Unrented"] || 0;
  const occupancyRate = totalDoors > 0 ? round2((occupied / totalDoors) * 100) : 0;

  // ---- Income Statement rows (excluding totals) ----
  const { rows: isRows } = await pool.query(
    `SELECT appfolio_data FROM cached_income_statement
     WHERE appfolio_data->>'account_name' NOT ILIKE '%total%'
       AND appfolio_data->>'account_number' IS NOT NULL
       AND appfolio_data->>'account_number' != ''`
  );

  // Categorize all rows
  const pmIncomeRows = [];
  const maintRevenueRows = [];
  const maintCogsRows = [];
  const otherCogsRows = [];
  const opexRows = [];
  const payrollRows = [];

  for (const r of isRows) {
    const d = r.appfolio_data;
    const acct = d.account_number || "";
    if (/^0-/.test(acct)) continue; // owner pass-through
    if (/^4[3-5]\d{2}-/.test(acct)) { maintRevenueRows.push(d); continue; }
    if (/^4\d{3}-/.test(acct)) { pmIncomeRows.push(d); continue; }
    if (/^5[2-5]\d{2}-/.test(acct)) { maintCogsRows.push(d); continue; }
    if (/^5\d{3}-/.test(acct)) { otherCogsRows.push(d); continue; }
    if (/^6\d{3}-/.test(acct)) { opexRows.push(d); continue; }
    if (/^7\d{3}-/.test(acct)) { payrollRows.push(d); continue; }
  }

  const sumField = (rows, field) => rows.reduce((s, d) => s + num(d[field]), 0);

  // ---- 2. PM Income ----
  const pmRevenueMtd = round2(sumField(pmIncomeRows, "month_to_date"));
  const pmRevenueYtd = round2(sumField(pmIncomeRows, "year_to_date"));
  const pmRevenueLyYtd = round2(sumField(pmIncomeRows, "last_year_to_date"));
  const pmYoyChange = pmRevenueLyYtd > 0 ? round2(((pmRevenueYtd - pmRevenueLyYtd) / pmRevenueLyYtd) * 100) : 0;
  const revenuePerDoor = totalDoors > 0 ? round2(pmRevenueMtd / totalDoors) : 0;

  // Top 5 PM income accounts by MTD
  const topPmAccounts = [...pmIncomeRows]
    .map((d) => ({ accountNumber: d.account_number, accountName: d.account_name, mtd: num(d.month_to_date), ytd: num(d.year_to_date) }))
    .sort((a, b) => b.mtd - a.mtd)
    .slice(0, 5);

  // ---- 3. Maintenance Income ----
  const maintRevenueMtd = round2(sumField(maintRevenueRows, "month_to_date"));
  const maintRevenueYtd = round2(sumField(maintRevenueRows, "year_to_date"));
  const maintCogsMtd = round2(sumField(maintCogsRows, "month_to_date"));
  const maintCogsYtd = round2(sumField(maintCogsRows, "year_to_date"));
  const maintProfitMtd = round2(maintRevenueMtd - maintCogsMtd);
  const maintProfitYtd = round2(maintRevenueYtd - maintCogsYtd);
  const maintMarginMtd = maintRevenueMtd > 0 ? round2((maintProfitMtd / maintRevenueMtd) * 100) : 0;

  // ---- 4. Total Company P&L ----
  const totalRevenueMtd = round2(pmRevenueMtd + maintRevenueMtd);
  const totalRevenueYtd = round2(pmRevenueYtd + maintRevenueYtd);
  const totalCogsMtd = round2(maintCogsMtd + sumField(otherCogsRows, "month_to_date"));
  const totalCogsYtd = round2(maintCogsYtd + sumField(otherCogsRows, "year_to_date"));
  const grossProfitMtd = round2(totalRevenueMtd - totalCogsMtd);
  const grossProfitYtd = round2(totalRevenueYtd - totalCogsYtd);
  const opexMtd = round2(sumField(opexRows, "month_to_date"));
  const opexYtd = round2(sumField(opexRows, "year_to_date"));
  const payrollMtd = round2(sumField(payrollRows, "month_to_date"));
  const payrollYtd = round2(sumField(payrollRows, "year_to_date"));
  const netProfitMtd = round2(grossProfitMtd - opexMtd - payrollMtd);
  const netProfitYtd = round2(grossProfitYtd - opexYtd - payrollYtd);
  const netMarginMtd = totalRevenueMtd > 0 ? round2((netProfitMtd / totalRevenueMtd) * 100) : 0;
  const netMarginYtd = totalRevenueYtd > 0 ? round2((netProfitYtd / totalRevenueYtd) * 100) : 0;

  // ---- 5. Delinquency ----
  const { rows: delRows } = await pool.query(`SELECT appfolio_data FROM cached_delinquency`);
  let totalReceivable = 0, delinqCount = delRows.length;
  let bucket00to30 = 0, bucket30to60 = 0, bucket60to90 = 0, bucket90plus = 0;
  for (const r of delRows) {
    const d = r.appfolio_data;
    totalReceivable += num(d.amount_receivable);
    bucket00to30 += num(d["00_to30"]);
    bucket30to60 += num(d["30_to60"]);
    bucket60to90 += num(d["60_to90"]);
    bucket90plus += num(d["90_plus"]);
  }
  totalReceivable = round2(totalReceivable);
  bucket00to30 = round2(bucket00to30);
  bucket30to60 = round2(bucket30to60);
  bucket60to90 = round2(bucket60to90);
  bucket90plus = round2(bucket90plus);

  // ---- 6. Rent & Fee Analysis ----
  const { rows: rentRows } = await pool.query(`
    SELECT
      COALESCE(p.appfolio_data->>'property_type', 'Unknown') as property_type,
      ROUND(AVG((r.appfolio_data->>'rent')::numeric), 0) as avg_rent,
      COUNT(*)::int as unit_count
    FROM cached_rent_roll r
    LEFT JOIN cached_properties p ON p.appfolio_data->>'property' LIKE (r.appfolio_data->>'property_name') || ' -%'
    WHERE r.appfolio_data->>'status' = 'Current'
      AND (r.appfolio_data->>'rent')::numeric > 0
    GROUP BY 1
  `);
  const rentByType = {};
  for (const r of rentRows) { rentByType[r.property_type] = { avgRent: Number(r.avg_rent), count: r.unit_count }; }

  const { rows: feeRows } = await pool.query(`
    SELECT
      appfolio_data->>'property_type' as property_type,
      ROUND(AVG((appfolio_data->>'management_fee_percent')::numeric), 2) as avg_fee,
      COUNT(*)::int as prop_count
    FROM cached_properties
    WHERE appfolio_data->>'management_fee_percent' IS NOT NULL
      AND (appfolio_data->>'management_fee_percent')::numeric > 0
    GROUP BY 1
  `);
  const feeByType = {};
  for (const r of feeRows) { feeByType[r.property_type] = { avgFee: Number(r.avg_fee), count: r.prop_count }; }

  // ---- 7. Growth ----
  let growth = { available: false, message: "Snapshot tracking not yet started." };
  try {
    const { rows: snapCheck } = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='portfolio_snapshots') as e`
    );
    if (snapCheck[0]?.e) {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const { rows: startSnap } = await pool.query(
        `SELECT total_doors, property_ids FROM portfolio_snapshots WHERE snapshot_date <= $1 ORDER BY snapshot_date ASC LIMIT 1`,
        [monthStart]
      );
      const { rows: latestSnap } = await pool.query(
        `SELECT total_doors, property_ids, snapshot_date FROM portfolio_snapshots ORDER BY snapshot_date DESC LIMIT 1`
      );
      if (startSnap.length && latestSnap.length) {
        const startIds = new Set(startSnap[0].property_ids || []);
        const currentIds = new Set(latestSnap[0].property_ids || []);
        const newDoors = [...currentIds].filter((id) => !startIds.has(id)).length;
        const lostDoors = [...startIds].filter((id) => !currentIds.has(id)).length;
        // T12 churn
        const t12Start = new Date(now);
        t12Start.setFullYear(t12Start.getFullYear() - 1);
        const { rows: t12Snaps } = await pool.query(
          `SELECT MIN(snapshot_date) as earliest FROM portfolio_snapshots`
        );
        const earliest = t12Snaps[0]?.earliest;
        let churnRate = null;
        let churnMessage = null;
        if (earliest && new Date(earliest) <= t12Start) {
          const { rows: t12Start_ } = await pool.query(
            `SELECT property_ids FROM portfolio_snapshots WHERE snapshot_date <= $1 ORDER BY snapshot_date DESC LIMIT 1`,
            [t12Start.toISOString().slice(0, 10)]
          );
          if (t12Start_.length) {
            const t12Ids = new Set(t12Start_[0].property_ids || []);
            const lost12 = [...t12Ids].filter((id) => !currentIds.has(id)).length;
            const avgDoors = (t12Ids.size + currentIds.size) / 2;
            churnRate = avgDoors > 0 ? round2((lost12 / avgDoors) * 100) : 0;
          }
        } else {
          churnMessage = `Building history — started ${earliest ? new Date(earliest).toLocaleDateString() : "N/A"}`;
        }
        growth = {
          available: true,
          newDoorsMtd: newDoors,
          doorsLostMtd: lostDoors,
          netNewDoors: newDoors - lostDoors,
          churnRate,
          churnMessage,
          snapshotDate: latestSnap[0].snapshot_date,
        };
      } else {
        growth = { available: false, message: "Collecting first snapshots — growth data available soon." };
      }
    }
  } catch {
    growth = { available: false, message: "Growth tracking initializing." };
  }

  // ---- Sync timestamp ----
  const { rows: syncRows } = await pool.query(
    `SELECT MAX(synced_at) as last_sync FROM cached_rent_roll`
  );

  return {
    portfolioHealth: { totalDoors, occupied, vacant, onNotice, occupancyRate },
    pmIncome: {
      revenueMtd: pmRevenueMtd, revenueYtd: pmRevenueYtd, lastYearYtd: pmRevenueLyYtd,
      yoyChangePercent: pmYoyChange, revenuePerDoor, topAccounts: topPmAccounts,
    },
    maintenanceIncome: {
      revenueMtd: maintRevenueMtd, revenueYtd: maintRevenueYtd,
      cogsMtd: maintCogsMtd, cogsYtd: maintCogsYtd,
      profitMtd: maintProfitMtd, profitYtd: maintProfitYtd,
      marginMtd: maintMarginMtd,
    },
    companyPL: {
      totalRevenueMtd, totalRevenueYtd,
      totalCogsMtd, totalCogsYtd,
      grossProfitMtd, grossProfitYtd,
      opexMtd, opexYtd,
      payrollMtd, payrollYtd,
      netProfitMtd, netProfitYtd,
      netMarginMtd, netMarginYtd,
    },
    delinquency: {
      totalReceivable, accountCount: delinqCount,
      aging: { bucket00to30, bucket30to60, bucket60to90, bucket90plus },
    },
    rentAnalysis: {
      singleFamily: {
        avgRent: rentByType["Single-Family"]?.avgRent ?? 0,
        avgMgmtFee: feeByType["Single-Family"]?.avgFee ?? 0,
        unitCount: rentByType["Single-Family"]?.count ?? 0,
        propCount: feeByType["Single-Family"]?.count ?? 0,
      },
      multiFamily: {
        avgRent: rentByType["Multi-Family"]?.avgRent ?? 0,
        avgMgmtFee: feeByType["Multi-Family"]?.avgFee ?? 0,
        unitCount: rentByType["Multi-Family"]?.count ?? 0,
        propCount: feeByType["Multi-Family"]?.count ?? 0,
      },
    },
    growth,
    lastSyncAt: syncRows[0]?.last_sync ?? null,
  };
}

export async function getExecutiveDashboardV2(req, res) {
  try {
    const now = Date.now();
    if (_cache && now - _cacheAt < CACHE_TTL) {
      res.json(_cache);
      return;
    }
    const data = await buildExecutiveData();
    _cache = data;
    _cacheAt = Date.now();
    res.json(data);
  } catch (e) {
    console.error("[executive-v2]", e);
    res.status(500).json({ error: "Could not load executive dashboard." });
  }
}

/** Take a daily snapshot of portfolio property IDs for growth tracking */
export async function takePortfolioSnapshot() {
  try {
    const pool = getPool();
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT DISTINCT (appfolio_data->>'property_id')::int as pid FROM cached_rent_roll WHERE appfolio_data->>'property_id' IS NOT NULL`
    );
    const propertyIds = rows.map((r) => r.pid).filter(Boolean).sort((a, b) => a - b);
    const totalDoors = propertyIds.length > 0
      ? (await pool.query(`SELECT COUNT(*)::int as c FROM cached_rent_roll`)).rows[0].c
      : 0;
    await pool.query(
      `INSERT INTO portfolio_snapshots (snapshot_date, total_doors, property_ids)
       VALUES ($1, $2, $3)
       ON CONFLICT (snapshot_date) DO UPDATE SET total_doors = $2, property_ids = $3`,
      [today, totalDoors, JSON.stringify(propertyIds)]
    );
    console.log(`[portfolio-snapshot] ${today}: ${totalDoors} doors, ${propertyIds.length} properties`);
  } catch (e) {
    console.error("[portfolio-snapshot]", e.message || e);
  }
}
