"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./dashboard.module.css";

const NAVY = "#1b2856";
const BLUE = "#0098d0";
const RED = "#b32317";
const GREY = "#6a737b";
const GREEN = "#1a7f4c";
const GOLD = "#c5960c";

const AGING_COLORS = { "0-30": "#0098d0", "30-60": GOLD, "60-90": "#e65100", "90+": RED };
const DOOR_GOAL = 300;

type ExecV2 = {
  portfolioHealth: { totalDoors: number; occupied: number; vacant: number; onNotice: number; occupancyRate: number };
  pmIncome: {
    revenueMtd: number; revenueYtd: number; lastYearYtd: number;
    yoyChangePercent: number; revenuePerDoor: number;
    topAccounts: { accountName: string; mtd: number; ytd: number }[];
  };
  maintenanceIncome: {
    revenueMtd: number; revenueYtd: number; cogsMtd: number; cogsYtd: number;
    profitMtd: number; profitYtd: number; marginMtd: number;
  };
  companyPL: {
    totalRevenueMtd: number; totalRevenueYtd: number;
    totalCogsMtd: number; totalCogsYtd: number;
    grossProfitMtd: number; grossProfitYtd: number;
    opexMtd: number; opexYtd: number;
    payrollMtd: number; payrollYtd: number;
    netProfitMtd: number; netProfitYtd: number;
    netMarginMtd: number; netMarginYtd: number;
  };
  delinquency: {
    totalReceivable: number; accountCount: number;
    aging: { bucket00to30: number; bucket30to60: number; bucket60to90: number; bucket90plus: number };
  };
  rentAnalysis: {
    singleFamily: { avgRent: number; avgMgmtFee: number; unitCount: number; propCount: number };
    multiFamily: { avgRent: number; avgMgmtFee: number; unitCount: number; propCount: number };
  };
  growth: {
    available: boolean; message?: string;
    newDoorsMtd?: number; doorsLostMtd?: number; netNewDoors?: number;
    churnRate?: number | null; churnMessage?: string | null;
  };
  lastSyncAt: string | null;
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number) { return `${n.toFixed(1)}%`; }

function occColor(p: number) { return p >= 95 ? GREEN : p >= 90 ? GOLD : RED; }
function marginColor(p: number) { return p >= 20 ? GREEN : p >= 10 ? GOLD : RED; }
function delinqColor(n: number) { return n > 20000 ? RED : n > 10000 ? GOLD : GREEN; }

function relTime(iso: string | null) {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export default function ExecutivePanel({ data, loading, error }: {
  data: ExecV2 | null; loading: boolean; error: string | null;
}) {
  if (loading && !data) {
    return (
      <>
        <div className={styles.skeletonGrid}>{[1, 2, 3, 4, 5].map((i) => <div key={i} className={styles.skeleton} />)}</div>
        <div className={styles.chartRow}><div className={styles.skeleton} style={{ minHeight: 200 }} /><div className={styles.skeleton} style={{ minHeight: 200 }} /></div>
      </>
    );
  }
  if (error) return <div className={styles.alert} role="alert"><strong>Could not load dashboard.</strong> {error}</div>;
  if (!data) return <p style={{ color: GREY }}>No data yet. Run a sync from admin controls.</p>;

  const { portfolioHealth: ph, pmIncome: pm, maintenanceIncome: mi, companyPL: pl, delinquency: dq, rentAnalysis: ra, growth: gr } = data;

  const agingTotal = dq.aging.bucket00to30 + dq.aging.bucket30to60 + dq.aging.bucket60to90 + dq.aging.bucket90plus;
  const agingData = [
    { name: "0-30 days", value: dq.aging.bucket00to30, fill: AGING_COLORS["0-30"] },
    { name: "30-60 days", value: dq.aging.bucket30to60, fill: AGING_COLORS["30-60"] },
    { name: "60-90 days", value: dq.aging.bucket60to90, fill: AGING_COLORS["60-90"] },
    { name: "90+ days", value: dq.aging.bucket90plus, fill: AGING_COLORS["90+"] },
  ];

  const doorPct = Math.min(100, Math.round((ph.totalDoors / DOOR_GOAL) * 1000) / 10);

  return (
    <>
      <p style={{ fontSize: "0.82rem", color: GREY, marginTop: 0, marginBottom: "1rem" }}>
        Last synced: <strong>{relTime(data.lastSyncAt)}</strong> · All amounts from AppFolio GL accounts · Owner pass-through (0-xxxx) excluded
      </p>

      {/* ---- Section 1: Portfolio Health ---- */}
      <h3 className={styles.sectionLabel}>Portfolio Health</h3>
      <div className={styles.grid5}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total doors</div>
          <div className={styles.kpiValue}>{ph.totalDoors}</div>
          <div className={styles.kpiSub}>Goal: {DOOR_GOAL}</div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${doorPct}%`, background: GOLD }} />
          </div>
          <div className={styles.kpiSub}>{doorPct}%</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Occupied</div>
          <div className={styles.kpiValue}>{ph.occupied}</div>
          <div className={styles.kpiSub}>Current tenants</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Vacant</div>
          <div className={styles.kpiValue} style={{ color: ph.vacant > 10 ? RED : ph.vacant > 5 ? GOLD : GREEN }}>{ph.vacant}</div>
          <div className={styles.kpiSub}>Vacant-Unrented</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>On notice</div>
          <div className={styles.kpiValue}>{ph.onNotice}</div>
          <div className={styles.kpiSub}>Notice-Unrented</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Occupancy rate</div>
          <div className={styles.kpiValue} style={{ color: occColor(ph.occupancyRate) }}>{fmtPct(ph.occupancyRate)}</div>
          <div className={styles.kpiSub}>{ph.occupancyRate >= 95 ? "On target" : ph.occupancyRate >= 90 ? "Below target" : "Critical"}</div>
        </div>
      </div>

      {/* ---- Section 2 & 3: PM Income + Maintenance Income ---- */}
      <h3 className={styles.sectionLabel}>Revenue Breakdown</h3>
      <div className={styles.chartRow}>
        <div className={styles.incomeCard}>
          <div className={styles.incomeCardTitle}>PM Income (Management Revenue)</div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>Revenue MTD</span>
            <span className={styles.incomeRowValue}>{fmtMoney(pm.revenueMtd)}</span>
          </div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>Revenue YTD</span>
            <span className={styles.incomeRowValue}>{fmtMoney(pm.revenueYtd)}</span>
          </div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>Last Year YTD</span>
            <span className={styles.incomeRowValue}>{fmtMoney(pm.lastYearYtd)}</span>
          </div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>YoY Change</span>
            <span className={pm.yoyChangePercent >= 0 ? styles.arrowUp : styles.arrowDown}>
              {pm.yoyChangePercent >= 0 ? "↑" : "↓"} {Math.abs(pm.yoyChangePercent).toFixed(1)}%
            </span>
          </div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>Revenue Per Door (MTD)</span>
            <span className={styles.incomeRowValue}>{fmtMoney(pm.revenuePerDoor)}</span>
          </div>
          {pm.topAccounts.length > 0 ? (
            <>
              <div style={{ fontSize: "0.78rem", color: GREY, marginTop: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Top PM Revenue Accounts (MTD)
              </div>
              <ul className={styles.topAccountsList}>
                {pm.topAccounts.filter((a) => a.mtd > 0).map((a) => (
                  <li key={a.accountName}><span>{a.accountName}</span><span>{fmtMoney(a.mtd)}</span></li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div className={styles.incomeCard}>
          <div className={styles.incomeCardTitle}>Maintenance Income</div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>Revenue MTD</span>
            <span className={styles.incomeRowValue}>{fmtMoney(mi.revenueMtd)}</span>
          </div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>COGS MTD</span>
            <span className={styles.incomeRowValue}>{fmtMoney(mi.cogsMtd)}</span>
          </div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>Gross Profit MTD</span>
            <span className={styles.incomeRowValue} style={{ color: mi.profitMtd >= 0 ? GREEN : RED }}>{fmtMoney(mi.profitMtd)}</span>
          </div>
          <div className={styles.incomeRow}>
            <span className={styles.incomeRowLabel}>Margin MTD</span>
            <span className={styles.incomeRowValue}>{fmtPct(mi.marginMtd)}</span>
          </div>
          <div style={{ borderTop: "1px solid rgba(27,40,86,0.08)", marginTop: "0.65rem", paddingTop: "0.65rem" }}>
            <div className={styles.incomeRow}>
              <span className={styles.incomeRowLabel}>Revenue YTD</span>
              <span className={styles.incomeRowValue}>{fmtMoney(mi.revenueYtd)}</span>
            </div>
            <div className={styles.incomeRow}>
              <span className={styles.incomeRowLabel}>COGS YTD</span>
              <span className={styles.incomeRowValue}>{fmtMoney(mi.cogsYtd)}</span>
            </div>
            <div className={styles.incomeRow}>
              <span className={styles.incomeRowLabel}>Profit YTD</span>
              <span className={styles.incomeRowValue} style={{ color: mi.profitYtd >= 0 ? GREEN : RED }}>{fmtMoney(mi.profitYtd)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Section 4: Total Company P&L ---- */}
      <h3 className={styles.sectionLabel}>Total Company P&L</h3>
      <div className={styles.tableCard}>
        <table className={styles.plTable}>
          <thead>
            <tr>
              <td className={styles.plColHeader}> </td>
              <td className={styles.plColHeader}>MTD</td>
              <td className={styles.plColHeader}>YTD</td>
            </tr>
          </thead>
          <tbody>
            <tr><td>Total Revenue</td><td style={{ textAlign: "right" }}>{fmtMoney(pl.totalRevenueMtd)}</td><td style={{ textAlign: "right" }}>{fmtMoney(pl.totalRevenueYtd)}</td></tr>
            <tr><td>Cost of Goods Sold</td><td style={{ textAlign: "right" }}>({fmtMoney(pl.totalCogsMtd)})</td><td style={{ textAlign: "right" }}>({fmtMoney(pl.totalCogsYtd)})</td></tr>
            <tr className={styles.plRowTotal}><td>Gross Profit</td><td style={{ textAlign: "right" }}>{fmtMoney(pl.grossProfitMtd)}</td><td style={{ textAlign: "right" }}>{fmtMoney(pl.grossProfitYtd)}</td></tr>
            <tr><td>Operating Expenses</td><td style={{ textAlign: "right" }}>({fmtMoney(pl.opexMtd)})</td><td style={{ textAlign: "right" }}>({fmtMoney(pl.opexYtd)})</td></tr>
            <tr><td>Payroll</td><td style={{ textAlign: "right" }}>({fmtMoney(pl.payrollMtd)})</td><td style={{ textAlign: "right" }}>({fmtMoney(pl.payrollYtd)})</td></tr>
            <tr className={styles.plRowTotal}>
              <td>Net Profit</td>
              <td style={{ textAlign: "right", color: pl.netProfitMtd >= 0 ? GREEN : RED }}>{fmtMoney(pl.netProfitMtd)}</td>
              <td style={{ textAlign: "right", color: pl.netProfitYtd >= 0 ? GREEN : RED }}>{fmtMoney(pl.netProfitYtd)}</td>
            </tr>
            <tr>
              <td>Net Margin</td>
              <td style={{ textAlign: "right", color: marginColor(pl.netMarginMtd), fontWeight: 700 }}>{fmtPct(pl.netMarginMtd)}</td>
              <td style={{ textAlign: "right", color: marginColor(pl.netMarginYtd), fontWeight: 700 }}>{fmtPct(pl.netMarginYtd)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---- Section 5: Delinquency ---- */}
      <h3 className={styles.sectionLabel}>Delinquency</h3>
      <div className={styles.chartRow}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total delinquency</div>
          <div className={styles.kpiValue} style={{ color: delinqColor(dq.totalReceivable) }}>{fmtMoney(dq.totalReceivable)}</div>
          <div className={styles.kpiSub}>{dq.accountCount} delinquent accounts</div>
          <div className={styles.kpiSub} style={{ marginTop: "0.25rem" }}>
            {dq.totalReceivable > 20000 ? "⚠ Above $20K threshold" : dq.totalReceivable > 10000 ? "⚠ Above $10K threshold" : "Within acceptable range"}
          </div>
        </div>
        <div className={styles.chartCard} style={{ minHeight: "auto" }}>
          <h3 className={styles.chartTitle}>Aging Breakdown</h3>
          {agingTotal > 0 ? (
            <>
              <div className={styles.agingBarWrap}>
                {agingData.map((d) => (
                  d.value > 0 ? (
                    <div key={d.name} style={{ width: `${(d.value / agingTotal) * 100}%`, background: d.fill }}>
                      {(d.value / agingTotal) > 0.12 ? fmtMoney(d.value) : ""}
                    </div>
                  ) : null
                ))}
              </div>
              <div className={styles.agingLegend}>
                {agingData.map((d) => (
                  <span key={d.name} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: d.fill, flexShrink: 0 }} />
                    {d.name}: {fmtMoney(d.value)}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.chartPlaceholder}>No delinquency data.</div>
          )}
        </div>
      </div>

      {/* ---- Section 6: Rent & Fee Analysis ---- */}
      <h3 className={styles.sectionLabel}>Rent &amp; Fee Analysis</h3>
      <div className={styles.tableCard}>
        <div className={styles.compGrid}>
          <div className={styles.compGridHeader}> </div>
          <div className={styles.compGridHeader} style={{ textAlign: "right" }}>Avg Rent</div>
          <div className={styles.compGridHeader} style={{ textAlign: "right" }}>Avg Mgmt Fee %</div>

          <div className={styles.compGridLabel}>Single-Family ({ra.singleFamily.unitCount} units)</div>
          <div className={styles.compGridValue}>{fmtMoney(ra.singleFamily.avgRent)}</div>
          <div className={styles.compGridValue}>{ra.singleFamily.avgMgmtFee > 0 ? `${ra.singleFamily.avgMgmtFee}%` : "—"}</div>

          <div className={styles.compGridLabel}>Multi-Family ({ra.multiFamily.unitCount} units)</div>
          <div className={styles.compGridValue}>{fmtMoney(ra.multiFamily.avgRent)}</div>
          <div className={styles.compGridValue}>{ra.multiFamily.avgMgmtFee > 0 ? `${ra.multiFamily.avgMgmtFee}%` : "—"}</div>
        </div>
      </div>

      {/* ---- Section 7: Growth ---- */}
      <h3 className={styles.sectionLabel}>Growth</h3>
      {gr.available ? (
        <div className={styles.grid4}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>New doors (MTD)</div>
            <div className={styles.kpiValue} style={{ color: GREEN }}>{gr.newDoorsMtd ?? 0}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Doors lost (MTD)</div>
            <div className={styles.kpiValue} style={{ color: (gr.doorsLostMtd ?? 0) > 0 ? RED : NAVY }}>{gr.doorsLostMtd ?? 0}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Net new doors</div>
            <div className={styles.kpiValue} style={{ color: (gr.netNewDoors ?? 0) >= 0 ? GREEN : RED }}>
              {(gr.netNewDoors ?? 0) >= 0 ? "+" : ""}{gr.netNewDoors ?? 0}
            </div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>T12 churn rate</div>
            <div className={styles.kpiValue}>
              {gr.churnRate != null ? fmtPct(gr.churnRate) : "—"}
            </div>
            <div className={styles.kpiSub}>{gr.churnMessage || "Trailing 12-month"}</div>
          </div>
        </div>
      ) : (
        <div className={styles.kpiCard} style={{ marginBottom: "1rem" }}>
          <div className={styles.kpiSub}>{gr.message}</div>
        </div>
      )}
    </>
  );
}
