"use client";

import { Fragment, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./dashboard.module.css";

const GOLD = "#c5960c";
const NAVY = "#1b2856";
const BLUE = "#0098d0";
const RED = "#b32317";
const GREY = "#6a737b";

const DOOR_GOAL = 300;
const REVENUE_GOAL = 775_000;
const MARGIN_GOAL = 20;

const PIE_COLORS = [BLUE, NAVY, GREY, GOLD, RED];

/** AppFolio work order status colors (aligned with Maintenance tab). */
const WO_STATUS_PIE_FILL: Record<string, string> = {
  New: RED,
  Assigned: BLUE,
  Estimated: GOLD,
  Scheduled: "#2d8b4e",
  Completed: GREY,
  Canceled: GREY,
};

type Exec = {
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  onNoticeUnits?: number;
  occupancyRatePercent: number;
  totalRevenueYtd: number;
  openWorkOrders: number;
  totalDelinquency: number;
  activeLeads: number;
};

type FinanceRow = Record<string, unknown> & { _period?: string };

type Finance = {
  incomeStatement: FinanceRow[];
  totalRevenueInCache?: number;
};

type Maintenance = {
  summary?: { byStatus?: Record<string, number> };
  workOrdersByStatus: Record<string, number>;
  workOrdersByProperty: Record<string, number>;
};

type PropRow = {
  propertyName: string;
  unitCount: number;
  vacantCount: number;
  onNoticeCount?: number;
  occupiedCount?: number;
  occupancyRatePercent: number;
};

type Portfolio = {
  properties: PropRow[];
  propertyDirectory?: Record<string, unknown>[];
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    n
  );
}

function occupancyColor(p: number) {
  if (p > 95) return "#1a7f4c";
  if (p >= 90) return GOLD;
  return RED;
}

function vacantColor(n: number) {
  if (n < 5) return "#1a7f4c";
  if (n <= 10) return GOLD;
  return RED;
}

function delinqColor(n: number) {
  return n > 5000 ? RED : NAVY;
}

function marginColor(_p: number) {
  return GREY;
}

function pickAmount(row: FinanceRow): number {
  const v =
    (row.amount as number | string | undefined) ??
    (row.Amount as number | string | undefined) ??
    (row.net_amount as number | string | undefined) ??
    (row.NetAmount as number | string | undefined) ??
    (row.total as number | string | undefined) ??
    0;
  if (typeof v === "number" && !Number.isNaN(v)) return Math.abs(v);
  const s = String(v).replace(/[$,]/g, "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : Math.abs(n);
}

function monthKeyFromRow(row: FinanceRow): string | null {
  const per = row._period ?? row.period ?? row.posted_on ?? row.PostedOn;
  if (per == null) return null;
  const s = String(per);
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return null;
}

function last12MonthKeys(endStr: string): string[] {
  const [y0, mo0] = endStr.split("-").map(Number);
  const out: string[] = [];
  let yy = y0;
  let mm = mo0;
  for (let i = 0; i < 12; i++) {
    out.unshift(`${yy}-${String(mm).padStart(2, "0")}`);
    mm -= 1;
    if (mm < 1) {
      mm = 12;
      yy -= 1;
    }
  }
  return out;
}

function bucketWoStatus(label: string): string {
  const s = label.toLowerCase();
  if (/complete|closed|resolved|cancel/.test(s)) return "Completed";
  if (/hold|paused/.test(s)) return "On Hold";
  if (/progress|in progress/.test(s)) return "In Progress";
  if (/open|pending|new|assigned|scheduled|active/.test(s)) return "Open";
  return "Other";
}

type SortKey = "propertyName" | "unitCount" | "occupied" | "vacant" | "onNotice" | "occPct" | "wo";

export default function ExecutivePanel(props: {
  executive: Exec | null;
  finance: Finance | null;
  maintenance: Maintenance | null;
  portfolio: Portfolio | null;
  loading: boolean;
  error: string | null;
  dateLabel: string;
  rangeStart: string;
  rangeEnd: string;
}) {
  const { executive, finance, maintenance, portfolio, loading, error, dateLabel, rangeStart, rangeEnd } = props;

  const [sortKey, setSortKey] = useState<SortKey>("propertyName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const doorPct = executive
    ? Math.min(100, Math.round((executive.totalUnits / DOOR_GOAL) * 1000) / 10)
    : 0;
  const revPct = executive
    ? Math.min(100, Math.round((executive.totalRevenueYtd / REVENUE_GOAL) * 1000) / 10)
    : 0;

  const monthly = useMemo(() => {
    if (!finance?.incomeStatement?.length) {
      return { points: [] as { month: string; revenue: number }[], hasData: false };
    }
    const keys = last12MonthKeys(rangeEnd);
    const amounts = new Map<string, number>();
    for (const k of keys) amounts.set(k, 0);
    const rs = rangeStart.slice(0, 7);
    const re = rangeEnd.slice(0, 7);
    for (const row of finance.incomeStatement) {
      const mk = monthKeyFromRow(row);
      if (!mk || !amounts.has(mk)) continue;
      if (mk < rs || mk > re) continue;
      amounts.set(mk, (amounts.get(mk) ?? 0) + pickAmount(row));
    }
    const points = keys.map((m) => ({
      month: m,
      revenue: amounts.get(m) ?? 0,
    }));
    const hasData = points.some((p) => p.revenue > 0);
    return { points, hasData };
  }, [finance, rangeStart, rangeEnd]);

  const pieData = useMemo(() => {
    const raw =
      maintenance?.summary?.byStatus ?? maintenance?.workOrdersByStatus ?? {};
    const appfolioKeys = new Set([
      "New",
      "Assigned",
      "Estimated",
      "Scheduled",
      "Completed",
      "Canceled",
    ]);
    const keys = Object.keys(raw);
    const looksAppfolio = keys.some((k) => appfolioKeys.has(k));
    if (looksAppfolio) {
      return Object.entries(raw)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }));
    }
    const agg: Record<string, number> = {
      Open: 0,
      "In Progress": 0,
      Completed: 0,
      "On Hold": 0,
      Other: 0,
    };
    for (const [k, v] of Object.entries(raw)) {
      const b = bucketWoStatus(k);
      if (b in agg) agg[b] += v;
      else agg.Other += v;
    }
    return Object.entries(agg)
      .filter(([, n]) => n > 0)
      .map(([name, value]) => ({ name, value }));
  }, [maintenance]);

  const tableRows = useMemo(() => {
    const propsList = portfolio?.properties ?? [];
    const wo = maintenance?.workOrdersByProperty ?? {};
    return propsList.map((p) => {
      const occ = p.occupiedCount ?? p.unitCount - p.vacantCount;
      const occPct = p.occupancyRatePercent;
      const onNotice = p.onNoticeCount ?? 0;
      const woCount =
        wo[p.propertyName] ??
        Object.entries(wo).find(([k]) => k.toLowerCase() === p.propertyName.toLowerCase())?.[1] ??
        0;
      return {
        propertyName: p.propertyName,
        unitCount: p.unitCount,
        occupied: occ,
        vacant: p.vacantCount,
        onNotice,
        occPct,
        woCount: typeof woCount === "number" ? woCount : 0,
      };
    });
  }, [portfolio, maintenance]);

  const sortedFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = tableRows.filter((r) => !q || r.propertyName.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      switch (sortKey) {
        case "propertyName":
          va = a.propertyName;
          vb = b.propertyName;
          return dir * String(va).localeCompare(String(vb));
        case "unitCount":
          va = a.unitCount;
          vb = b.unitCount;
          break;
        case "occupied":
          va = a.occupied;
          vb = b.occupied;
          break;
        case "vacant":
          va = a.vacant;
          vb = b.vacant;
          break;
        case "onNotice":
          va = a.onNotice;
          vb = b.onNotice;
          break;
        case "occPct":
          va = a.occPct;
          vb = b.occPct;
          break;
        case "wo":
          va = a.woCount;
          vb = b.woCount;
          break;
        default:
          return 0;
      }
      return dir * ((va as number) - (vb as number));
    });
    return rows;
  }, [tableRows, search, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const expandedDetail = useMemo(() => {
    if (!expanded || !portfolio?.propertyDirectory) return null;
    const match = portfolio.propertyDirectory.find(
      (row) =>
        String(
          (row as { property_name?: string }).property_name ??
            (row as { PropertyName?: string }).PropertyName ??
            ""
        ).toLowerCase() === expanded.toLowerCase()
    );
    return match ?? { note: "No extra directory row matched this property name." };
  }, [expanded, portfolio]);

  if (loading && !executive) {
    return (
      <>
        <div className={styles.skeletonGrid}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
        <div className={styles.skeletonGrid}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
        <div className={styles.chartRow}>
          <div className={styles.skeleton} style={{ minHeight: 300 }} />
          <div className={styles.skeleton} style={{ minHeight: 300 }} />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <div className={styles.alert} role="alert">
        <strong>Could not load dashboard.</strong> {error}
      </div>
    );
  }

  if (!executive) {
    return <p style={{ color: GREY }}>No executive data yet. Run a sync from the admin refresh control.</p>;
  }

  return (
    <>
      <p style={{ fontSize: "0.85rem", color: GREY, marginTop: 0, marginBottom: "1rem" }}>
        Date context: <strong>{dateLabel}</strong> ({rangeStart} → {rangeEnd}) · Revenue chart uses cached income
        rows in range.
      </p>

      <div className={styles.grid4}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total doors</div>
          <div className={styles.kpiValue}>{executive.totalUnits}</div>
          <div className={styles.kpiSub}>Goal: {DOOR_GOAL} units</div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${doorPct}%`, background: GOLD }} />
          </div>
          <div className={styles.kpiSub}>{doorPct}% of goal</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Occupancy rate</div>
          <div className={styles.kpiValue} style={{ color: occupancyColor(executive.occupancyRatePercent) }}>
            {executive.occupancyRatePercent}%
          </div>
          <div className={styles.kpiSub}>
            {executive.occupiedUnits} occupied · {executive.vacantUnits} vacant
          </div>
          {(executive.onNoticeUnits ?? 0) > 0 ? (
            <div className={styles.kpiSub} style={{ marginTop: "0.35rem", fontWeight: 600 }}>
              {executive.onNoticeUnits} on notice
            </div>
          ) : null}
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>YTD revenue</div>
          <div className={styles.kpiValue}>{fmtMoney(executive.totalRevenueYtd)}</div>
          <div className={styles.kpiSub}>Goal {fmtMoney(REVENUE_GOAL)} · {revPct}% of goal</div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${revPct}%`, background: BLUE }} />
          </div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Profit margin</div>
          <div className={styles.kpiValue} style={{ color: marginColor(0) }}>
            —
          </div>
          <div className={styles.kpiSub}>Target {MARGIN_GOAL}% · expense lines not in cache yet</div>
        </div>
      </div>

      <div className={styles.grid4b}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Open work orders</div>
          <div className={styles.kpiValue}>{executive.openWorkOrders}</div>
          <div className={styles.kpiSub}>Avg. days to complete — (timing fields in a later phase)</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total delinquency</div>
          <div className={styles.kpiValue} style={{ color: delinqColor(executive.totalDelinquency) }}>
            {fmtMoney(executive.totalDelinquency)}
          </div>
          <div className={styles.kpiSub}>{executive.totalDelinquency > 5000 ? "Above $5K threshold" : "Within range"}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Active leads</div>
          <div className={styles.kpiValue}>{executive.activeLeads}</div>
          <div className={styles.kpiSub}>Guest cards (non-closed statuses)</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Vacant units</div>
          <div className={styles.kpiValue} style={{ color: vacantColor(executive.vacantUnits) }}>
            {executive.vacantUnits}
          </div>
          <div className={styles.kpiSub}>Rent roll (Vacant-Unrented)</div>
        </div>
      </div>

      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Monthly revenue trend</h3>
          {!monthly.hasData ? (
            <div className={styles.chartPlaceholder}>Revenue data syncing… (no amounts in selected range yet)</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={monthly.points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke={GREY} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke={GREY}
                    tickFormatter={(v) =>
                      new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)
                    }
                  />
                  <Tooltip
                    formatter={(v: number) => fmtMoney(v)}
                    labelFormatter={(l) => `Month ${l}`}
                  />
                  <Line type="monotone" dataKey="revenue" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Work orders by status</h3>
          {pieData.length === 0 ? (
            <div className={styles.chartPlaceholder}>No work order data in cache.</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={WO_STATUS_PIE_FILL[entry.name] ?? PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className={styles.tableCard}>
        <h3 className={styles.chartTitle} style={{ marginBottom: "0.65rem" }}>
          Property performance
        </h3>
        <div className={styles.tableSearch}>
          <input
            type="search"
            placeholder="Search properties…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search properties"
          />
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort("propertyName")}>Property {sortKey === "propertyName" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
                <th onClick={() => toggleSort("unitCount")}>Units</th>
                <th onClick={() => toggleSort("occupied")}>Occupied</th>
                <th onClick={() => toggleSort("vacant")}>Vacant</th>
                <th onClick={() => toggleSort("onNotice")}>On notice</th>
                <th onClick={() => toggleSort("occPct")}>Occ %</th>
                <th onClick={() => toggleSort("wo")}>Open WO</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((row) => (
                <Fragment key={row.propertyName}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className={styles.rowBtn}
                        onClick={() =>
                          setExpanded((e) => (e === row.propertyName ? null : row.propertyName))
                        }
                      >
                        {row.propertyName}
                      </button>
                    </td>
                    <td>{row.unitCount}</td>
                    <td>{row.occupied}</td>
                    <td>{row.vacant}</td>
                    <td>{row.onNotice}</td>
                    <td>{row.occPct}%</td>
                    <td>{row.woCount}</td>
                  </tr>
                  {expanded === row.propertyName && (
                    <tr className={styles.expandRow}>
                      <td colSpan={7}>
                        <strong>Details</strong>
                        <pre className={styles.expandPre}>{JSON.stringify(expandedDetail, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
