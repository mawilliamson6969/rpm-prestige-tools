"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import styles from "./dashboard.module.css";

const NAVY = "#1b2856";
const BLUE = "#0098d0";
const RED = "#b32317";
const GREY = "#6a737b";
const GREEN = "#1a7f4c";
const GOLD = "#c5960c";

const PIE_COLORS = [BLUE, NAVY, GOLD, RED, "#0ea599", "#7c3aed", "#e65100", "#2d8b4e", GREY, "#b34a00"];

type Filter = "all" | "inhouse" | "thirdparty";

type OpenWo = {
  workOrderNumber: string | number; workOrderId: string | number;
  status: string; priority: string; propertyName: string; unitName: string | null;
  primaryTenant: string; workOrderIssue: string; vendor: string; vendorTrade: string;
  daysOpen: number | null; estimateAmount: number; createdAt: string;
  jobDescription: string; instructions: string; estimateApprovalStatus: string;
};

type Tech = {
  technicianName: string; totalWos: number; totalWorkedHours: number; totalBillableHours: number;
  billablePercent: number | null; avgHoursPerWo: number | null; workedHoursPerWorkday: number | null;
  utilizationRate: number | null; avgJobCompletionDays: number | null; avgJobsPerWorkday: number | null;
  hoursBilledVsWorked: number | null; totalAmountBilled: number; revenuePerTech: number;
  avgRevenuePerJob: number | null; profitPerTech: number; hourlyCost: number;
};

type VendorPerf = {
  vendor: string; trade: string | null; totalWos: number; completedWos: number;
  completionRate: number; cancellationRate: number; avgDaysToComplete: number | null;
  onTimeRate: number; avgCost: number | null; totalSpendYtd: number;
  activeWos: number; lastWoDate: string | null; performanceScore: number;
};

type MaintData = {
  filter: Filter; lastSynced: string | null;
  dataAvailability: { hasWorkOrdersAll: boolean; hasLabor: boolean };
  volume: { totalYtd: number; completedYtd: number; canceledYtd: number; openCount: number };
  speed: {
    avgDaysToComplete: number | null; medianDaysToComplete: number | null;
    avgSpeedToRepair: number | null; medianSpeedToRepair: number | null;
    avgDaysWorkDoneToCompleted: number | null; pctWithin5Days: number | null;
    completedCount: number;
  };
  billing: {
    totalBillable: number; avgAmountBillable: number | null; avgDaysBillable: number | null;
    totalNoBill: number; avgAmountNoBill: number; pctNoBill: number | null;
  };
  priority: {
    urgentPercent: number;
    byPriority: { name: string; count: number }[];
    byIssue: { name: string; count: number }[];
  };
  openTable: OpenWo[];
  inHouse: {
    available: boolean;
    overall: {
      totalWorkedHours: number; totalBillableHours: number; billablePercent: number | null;
      avgHoursPerWo: number | null; avgHoursDifference: number | null;
    } | null;
    technicians: Tech[];
  };
  surveys: { available: boolean; count: number; avgSatisfaction: number | null; pctResolved: number | null; pctTimely: number | null };
  vendors: {
    available: boolean;
    summary: {
      totalActiveVendors: number;
      topVendorByVolume: { name: string; count: number } | null;
      topVendorBySpend: { name: string; spend: number } | null;
      top5ConcentrationPercent: number;
    } | null;
    performance: VendorPerf[];
    tradeBreakdown: { trade: string; totalWos: number; totalSpend: number }[];
    redFlags: VendorPerf[];
  };
};

type TechConfig = { id: number; technicianName: string; hourlyCost: number; isActive: boolean; notes: string | null };

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}
function fmtMoney0(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}
function fmtDays(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Math.round(n)} days`;
}
function fmtHours(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(1)}h`;
}
function relTime(iso: string | null) {
  if (!iso) return "Never";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return iso; }
}
function daysColor(n: number | null | undefined) {
  if (n == null) return undefined;
  if (n < 5) return GREEN;
  if (n <= 10) return GOLD;
  return RED;
}
function billablePctColor(p: number | null | undefined) {
  if (p == null) return undefined;
  if (p >= 85) return GREEN;
  if (p >= 70) return GOLD;
  return RED;
}
function statusClass(status: string) {
  const map: Record<string, string> = {
    "New": styles.woStatusNew,
    "Estimate Requested": styles.woStatusEstimateRequested,
    "Estimated": styles.woStatusEstimated,
    "Assigned": styles.woStatusAssigned,
    "Scheduled": styles.woStatusScheduled,
    "Waiting": styles.woStatusWaiting,
    "Work Done": styles.woStatusWorkDone,
    "Ready to Bill": styles.woStatusReadyToBill,
    "Completed": styles.woStatusCompleted,
    "Completed No Need To Bill": styles.woStatusCompleted,
    "Canceled": styles.woStatusCanceled,
  };
  return `${styles.woStatus} ${map[status] || styles.woStatusNew}`;
}
function priorityClass(priority: string) {
  if (priority === "Urgent") return `${styles.priorityBadge} ${styles.priorityUrgent}`;
  if (priority === "Emergency") return `${styles.priorityBadge} ${styles.priorityEmergency}`;
  return `${styles.priorityBadge} ${styles.priorityNormal}`;
}

export default function MaintenancePanel() {
  const { authHeaders, isAdmin, token } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [data, setData] = useState<MaintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiUrl(`/dashboard/maintenance-v2?filter=${filter}`), {
        cache: "no-store", headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Failed to load");
      setData(body as MaintData);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); setData(null); }
    finally { setLoading(false); }
  }, [authHeaders, token, filter]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <>
        <div className={styles.skeletonGrid}>{[1, 2, 3, 4].map((i) => <div key={i} className={styles.skeleton} />)}</div>
        <div className={styles.chartRow}><div className={styles.skeleton} style={{ minHeight: 240 }} /><div className={styles.skeleton} style={{ minHeight: 240 }} /></div>
      </>
    );
  }
  if (error) return <div className={styles.alert}>{error}</div>;
  if (!data) return <p style={{ color: GREY }}>No maintenance data.</p>;

  const showInHouse = filter === "all" || filter === "inhouse";
  const showVendors = filter === "all" || filter === "thirdparty";
  const needsFullHistory = !data.dataAvailability.hasWorkOrdersAll;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "1rem" }}>
        <div className={styles.filterToggle} role="tablist" aria-label="Vendor type filter">
          {(["all", "inhouse", "thirdparty"] as const).map((f) => (
            <button key={f} type="button"
              className={`${styles.filterToggleBtn} ${filter === f ? styles.filterToggleBtnActive : ""}`}
              onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "inhouse" ? "In-House" : "3rd Party"}
            </button>
          ))}
        </div>
        <div style={{ fontSize: "0.82rem", color: GREY }}>
          Last synced: <strong>{relTime(data.lastSynced)}</strong>
        </div>
      </div>

      {needsFullHistory ? (
        <div className={styles.maintCaption}>
          Full historical work-order data syncs nightly at 2 AM. Speed, billing, and vendor metrics will populate after the first daily sync.
        </div>
      ) : null}

      {/* Section 1: Volume */}
      <h3 className={styles.sectionLabel}>Volume Metrics</h3>
      <div className={styles.grid4}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total WOs (YTD)</div>
          <div className={styles.kpiValue}>{data.volume.totalYtd}</div>
          <div className={styles.kpiSub}>Created this year</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Completed (YTD)</div>
          <div className={styles.kpiValue} style={{ color: GREEN }}>{data.volume.completedYtd}</div>
          <div className={styles.kpiSub}>All completed statuses</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Canceled (YTD)</div>
          <div className={styles.kpiValue} style={{ color: data.volume.canceledYtd > 0 ? GREY : NAVY }}>{data.volume.canceledYtd}</div>
          <div className={styles.kpiSub}>Canceled this year</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Open WOs</div>
          <div className={styles.kpiValue} style={{ color: data.volume.openCount > 30 ? RED : NAVY }}>{data.volume.openCount}</div>
          <div className={styles.kpiSub}>Not yet closed</div>
        </div>
      </div>

      {/* Section 2: Speed */}
      <h3 className={styles.sectionLabel}>Speed Metrics</h3>
      {data.speed.completedCount === 0 ? (
        <div className={styles.maintCaption}>No completed work orders in the selected filter for this year yet.</div>
      ) : (
        <div className={styles.grid3}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Avg days to complete</div>
            <div className={styles.kpiValue} style={{ color: daysColor(data.speed.avgDaysToComplete) }}>
              {fmtDays(data.speed.avgDaysToComplete)}
            </div>
            <div className={styles.kpiSub}>Median: {fmtDays(data.speed.medianDaysToComplete)}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Avg speed to repair</div>
            <div className={styles.kpiValue} style={{ color: daysColor(data.speed.avgSpeedToRepair) }}>
              {fmtDays(data.speed.avgSpeedToRepair)}
            </div>
            <div className={styles.kpiSub}>Median: {fmtDays(data.speed.medianSpeedToRepair)}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Work done &rarr; completed</div>
            <div className={styles.kpiValue}>{fmtDays(data.speed.avgDaysWorkDoneToCompleted)}</div>
            <div className={styles.kpiSub}>Billing turnaround</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>% within 5 days</div>
            <div className={styles.kpiValue} style={{
              color: data.speed.pctWithin5Days != null && data.speed.pctWithin5Days >= 60 ? GREEN
                : data.speed.pctWithin5Days != null && data.speed.pctWithin5Days >= 40 ? GOLD : RED,
            }}>
              {fmtPct(data.speed.pctWithin5Days)}
            </div>
            <div className={styles.kpiSub}>Completed fast</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Completed WOs</div>
            <div className={styles.kpiValue}>{data.speed.completedCount}</div>
            <div className={styles.kpiSub}>YTD with dates</div>
          </div>
        </div>
      )}

      {/* Section 3: Billing */}
      <h3 className={styles.sectionLabel}>Billing Metrics</h3>
      <div className={styles.grid3}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total billable completed</div>
          <div className={styles.kpiValue}>{data.billing.totalBillable}</div>
          <div className={styles.kpiSub}>Status = Completed</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Avg WO amount</div>
          <div className={styles.kpiValue}>{fmtMoney0(data.billing.avgAmountBillable)}</div>
          <div className={styles.kpiSub}>Vendor bill + tenant charges</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Avg days to complete (billable)</div>
          <div className={styles.kpiValue} style={{ color: daysColor(data.billing.avgDaysBillable) }}>
            {fmtDays(data.billing.avgDaysBillable)}
          </div>
          <div className={styles.kpiSub}>Status = Completed only</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>No-Need-To-Bill completed</div>
          <div className={styles.kpiValue}>{data.billing.totalNoBill}</div>
          <div className={styles.kpiSub}>Warranty / goodwill / owner-direct</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Avg amount (no-bill)</div>
          <div className={styles.kpiValue}>$0.00</div>
          <div className={styles.kpiSub}>By definition</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>% no-bill of total completed</div>
          <div className={styles.kpiValue}>{fmtPct(data.billing.pctNoBill)}</div>
          <div className={styles.kpiSub}>Share of closed WOs</div>
        </div>
      </div>

      {/* Section 4: Priority & Issue */}
      <h3 className={styles.sectionLabel}>Priority &amp; Issue Breakdown</h3>
      <div style={{ marginBottom: "0.75rem" }}>
        <span className={styles.kpiLabel} style={{ marginRight: "0.5rem" }}>Urgent share (YTD):</span>
        <strong style={{ color: data.priority.urgentPercent > 20 ? RED : data.priority.urgentPercent > 10 ? GOLD : GREEN }}>
          {fmtPct(data.priority.urgentPercent)}
        </strong>
      </div>
      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>By priority</h3>
          {data.priority.byPriority.length === 0 ? <div className={styles.chartPlaceholder}>No data.</div> : (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={data.priority.byPriority}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke={GREY} />
                  <YAxis tick={{ fontSize: 11 }} stroke={GREY} />
                  <Tooltip />
                  <Bar dataKey="count" fill={BLUE} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>By issue (top 10)</h3>
          {data.priority.byIssue.length === 0 ? <div className={styles.chartPlaceholder}>No data.</div> : (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={data.priority.byIssue} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke={GREY} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke={GREY} width={130} />
                  <Tooltip />
                  <Bar dataKey="count" fill={NAVY} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Section 5: Open WO Table */}
      <h3 className={styles.sectionLabel}>Open Work Orders ({data.openTable.length})</h3>
      <OpenWorkOrdersTable rows={data.openTable} />

      {/* Section 6: In-House */}
      {showInHouse ? (
        <>
          <h3 className={styles.sectionLabel}>In-House Metrics (Moon Shadow Home Services)</h3>
          {!data.inHouse.available ? (
            <div className={styles.maintCaption}>
              Labor report data not yet synced. Set <code>APPFOLIO_WO_LABOR_UUID</code> in .env and wait for the next 2 AM daily sync.
            </div>
          ) : (
            <>
              <div className={styles.grid5}>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Worked hours (YTD)</div>
                  <div className={styles.kpiValue}>{fmtHours(data.inHouse.overall!.totalWorkedHours)}</div>
                </div>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Billable hours (YTD)</div>
                  <div className={styles.kpiValue}>{fmtHours(data.inHouse.overall!.totalBillableHours)}</div>
                </div>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Billable %</div>
                  <div className={styles.kpiValue} style={{ color: billablePctColor(data.inHouse.overall!.billablePercent) }}>
                    {fmtPct(data.inHouse.overall!.billablePercent)}
                  </div>
                </div>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Avg hours / WO</div>
                  <div className={styles.kpiValue}>{fmtHours(data.inHouse.overall!.avgHoursPerWo)}</div>
                </div>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Avg hours difference</div>
                  <div className={styles.kpiValue}>{data.inHouse.overall!.avgHoursDifference?.toFixed(2) ?? "—"}</div>
                </div>
              </div>
              <TechnicianTable rows={data.inHouse.technicians} />
              {isAdmin ? <TechnicianConfigSection onChanged={load} /> : null}
            </>
          )}
        </>
      ) : null}

      {/* Section 7: Surveys */}
      <h3 className={styles.sectionLabel}>Maintenance Survey Scores</h3>
      <div className={styles.grid4}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Surveys received</div>
          <div className={styles.kpiValue}>{data.surveys.available ? data.surveys.count : "—"}</div>
          <div className={styles.kpiSub}>Survey system coming soon</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Avg satisfaction</div>
          <div className={styles.kpiValue}>{data.surveys.avgSatisfaction != null ? `${data.surveys.avgSatisfaction}/5` : "—"}</div>
          <div className={styles.kpiSub}>Survey system coming soon</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>% resolved</div>
          <div className={styles.kpiValue}>{fmtPct(data.surveys.pctResolved)}</div>
          <div className={styles.kpiSub}>Survey system coming soon</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>% timely</div>
          <div className={styles.kpiValue}>{fmtPct(data.surveys.pctTimely)}</div>
          <div className={styles.kpiSub}>Survey system coming soon</div>
        </div>
      </div>

      {/* Section 8: Vendors */}
      {showVendors ? (
        <>
          <h3 className={styles.sectionLabel}>Vendor KPIs (3rd Party)</h3>
          {!data.vendors.available ? (
            <div className={styles.maintCaption}>Vendor metrics require historical WO data — available after the 2 AM daily sync.</div>
          ) : (
            <>
              <div className={styles.grid4}>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Active vendors (90d)</div>
                  <div className={styles.kpiValue}>{data.vendors.summary!.totalActiveVendors}</div>
                </div>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Top vendor by volume</div>
                  <div className={styles.kpiValue} style={{ fontSize: "1rem" }}>
                    {data.vendors.summary!.topVendorByVolume?.name ?? "—"}
                  </div>
                  <div className={styles.kpiSub}>{data.vendors.summary!.topVendorByVolume?.count ?? 0} WOs</div>
                </div>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Top vendor by spend</div>
                  <div className={styles.kpiValue} style={{ fontSize: "1rem" }}>
                    {data.vendors.summary!.topVendorBySpend?.name ?? "—"}
                  </div>
                  <div className={styles.kpiSub}>{fmtMoney0(data.vendors.summary!.topVendorBySpend?.spend)}</div>
                </div>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiLabel}>Top 5 concentration</div>
                  <div className={styles.kpiValue} style={{
                    color: data.vendors.summary!.top5ConcentrationPercent > 60 ? RED
                      : data.vendors.summary!.top5ConcentrationPercent > 40 ? GOLD : GREEN,
                  }}>
                    {fmtPct(data.vendors.summary!.top5ConcentrationPercent)}
                  </div>
                  <div className={styles.kpiSub}>
                    {data.vendors.summary!.top5ConcentrationPercent > 60 ? "High risk"
                      : data.vendors.summary!.top5ConcentrationPercent > 40 ? "Medium" : "Low"}
                  </div>
                </div>
              </div>
              <VendorPerformanceTable rows={data.vendors.performance} />
              <div className={styles.chartRow} style={{ marginTop: "1.25rem" }}>
                <div className={styles.chartCard}>
                  <h3 className={styles.chartTitle}>WOs by trade (top 10)</h3>
                  {data.vendors.tradeBreakdown.length === 0 ? <div className={styles.chartPlaceholder}>No data.</div> : (
                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer>
                        <BarChart data={data.vendors.tradeBreakdown} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                          <XAxis type="number" tick={{ fontSize: 11 }} stroke={GREY} />
                          <YAxis dataKey="trade" type="category" tick={{ fontSize: 10 }} stroke={GREY} width={120} />
                          <Tooltip />
                          <Bar dataKey="totalWos" fill={BLUE} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
                <div className={styles.chartCard}>
                  <h3 className={styles.chartTitle}>Spend by trade</h3>
                  {data.vendors.tradeBreakdown.length === 0 ? <div className={styles.chartPlaceholder}>No data.</div> : (
                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={data.vendors.tradeBreakdown} dataKey="totalSpend" nameKey="trade" cx="50%" cy="50%" outerRadius={90} label={(e) => e.trade}>
                            {data.vendors.tradeBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmtMoney0(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
              {data.vendors.redFlags.length > 0 ? (
                <>
                  <h3 className={styles.sectionLabel} style={{ color: RED }}>Red Flag Vendors</h3>
                  <div className={styles.tableCard}>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr><th>Vendor</th><th>Cancel %</th><th>Avg days</th><th>Last WO</th></tr>
                        </thead>
                        <tbody>
                          {data.vendors.redFlags.map((v) => (
                            <tr key={v.vendor}>
                              <td>{v.vendor}</td>
                              <td style={{ color: v.cancellationRate > 20 ? RED : undefined }}>{fmtPct(v.cancellationRate)}</td>
                              <td style={{ color: daysColor(v.avgDaysToComplete) }}>{fmtDays(v.avgDaysToComplete)}</td>
                              <td>{fmtDate(v.lastWoDate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </>
  );
}

/* ---- Open WO Table ---- */
type OpenSortKey = "workOrderNumber" | "status" | "priority" | "propertyName" | "daysOpen" | "estimateAmount" | "createdAt";
function OpenWorkOrdersTable({ rows }: { rows: OpenWo[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<OpenSortKey>("daysOpen");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | number | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) =>
      !q || r.propertyName?.toLowerCase().includes(q) || r.primaryTenant?.toLowerCase().includes(q) ||
      r.workOrderIssue?.toLowerCase().includes(q) || r.vendor?.toLowerCase().includes(q) ||
      String(r.workOrderNumber).includes(q)
    );
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[sortKey] ?? "";
      const vb = (b as unknown as Record<string, unknown>)[sortKey] ?? "";
      if (typeof va === "number" && typeof vb === "number") return dir * (va - vb);
      return dir * String(va).localeCompare(String(vb));
    });
    return out;
  }, [rows, search, sortKey, sortDir]);

  const toggleSort = (k: OpenSortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableSearch}>
        <input type="search" placeholder="Search work orders…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th onClick={() => toggleSort("workOrderNumber")}>WO #</th>
              <th onClick={() => toggleSort("status")}>Status</th>
              <th onClick={() => toggleSort("priority")}>Priority</th>
              <th onClick={() => toggleSort("propertyName")}>Property</th>
              <th>Tenant</th>
              <th>Issue</th>
              <th>Vendor</th>
              <th onClick={() => toggleSort("daysOpen")}>Days Open</th>
              <th onClick={() => toggleSort("estimateAmount")}>Est. Amount</th>
              <th onClick={() => toggleSort("createdAt")}>Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className={styles.chartPlaceholder}>No open work orders.</td></tr>
            ) : filtered.map((r) => {
              const isMoonShadow = r.vendor && r.vendor.toLowerCase().includes("moon shadow");
              return (
                <Fragment key={r.workOrderId}>
                  <tr>
                    <td>
                      <button type="button" className={styles.rowBtn}
                        onClick={() => setExpanded((e) => e === r.workOrderId ? null : r.workOrderId)}>
                        {r.workOrderNumber}
                      </button>
                    </td>
                    <td><span className={statusClass(r.status)}>{r.status}</span></td>
                    <td><span className={priorityClass(r.priority)}>{r.priority || "Normal"}</span></td>
                    <td>{r.propertyName}{r.unitName ? ` · ${r.unitName}` : ""}</td>
                    <td>{r.primaryTenant || "—"}</td>
                    <td>{r.workOrderIssue || "—"}</td>
                    <td>{r.vendor || "—"}{isMoonShadow ? " 🏠" : ""}</td>
                    <td style={{ color: daysColor(r.daysOpen) }}>{r.daysOpen ?? "—"}</td>
                    <td>{r.estimateAmount > 0 ? fmtMoney0(r.estimateAmount) : "—"}</td>
                    <td>{fmtDate(r.createdAt)}</td>
                  </tr>
                  {expanded === r.workOrderId ? (
                    <tr className={styles.expandRow}>
                      <td colSpan={10}>
                        <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.82rem" }}>
                          <div><strong>Job description:</strong> {r.jobDescription || "—"}</div>
                          <div><strong>Instructions:</strong> {r.instructions || "—"}</div>
                          <div><strong>Estimate approval:</strong> {r.estimateApprovalStatus || "—"}</div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- Technician Table ---- */
type TechSortKey = keyof Tech;
function TechnicianTable({ rows }: { rows: Tech[] }) {
  const [sortKey, setSortKey] = useState<TechSortKey>("revenuePerTech");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = (a[sortKey] as number | string | null | undefined) ?? 0;
      const vb = (b[sortKey] as number | string | null | undefined) ?? 0;
      if (typeof va === "number" && typeof vb === "number") return dir * (va - vb);
      return dir * String(va).localeCompare(String(vb));
    });
  }, [rows, sortKey, sortDir]);
  const toggle = (k: TechSortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  return (
    <div className={styles.tableCard} style={{ marginTop: "1rem" }}>
      <h3 className={styles.chartTitle}>Per-technician performance</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th onClick={() => toggle("technicianName")}>Technician</th>
              <th onClick={() => toggle("totalWos")}>WOs</th>
              <th onClick={() => toggle("totalWorkedHours")}>Worked</th>
              <th onClick={() => toggle("totalBillableHours")}>Billable</th>
              <th onClick={() => toggle("billablePercent")}>Bill %</th>
              <th onClick={() => toggle("avgHoursPerWo")}>Avg hrs/WO</th>
              <th onClick={() => toggle("workedHoursPerWorkday")}>Hrs/day</th>
              <th onClick={() => toggle("utilizationRate")}>Utilization</th>
              <th onClick={() => toggle("avgJobCompletionDays")}>Avg days</th>
              <th onClick={() => toggle("avgJobsPerWorkday")}>Jobs/day</th>
              <th onClick={() => toggle("totalAmountBilled")}>Billed $</th>
              <th onClick={() => toggle("avgRevenuePerJob")}>Avg rev/job</th>
              <th onClick={() => toggle("profitPerTech")}>Profit</th>
              <th onClick={() => toggle("hourlyCost")}>Cost/hr</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={14} className={styles.chartPlaceholder}>No technician data.</td></tr>
            ) : sorted.map((t) => (
              <tr key={t.technicianName}>
                <td style={{ fontWeight: 600, color: NAVY }}>{t.technicianName}</td>
                <td>{t.totalWos}</td>
                <td>{fmtHours(t.totalWorkedHours)}</td>
                <td>{fmtHours(t.totalBillableHours)}</td>
                <td style={{ color: billablePctColor(t.billablePercent) }}>{fmtPct(t.billablePercent)}</td>
                <td>{fmtHours(t.avgHoursPerWo)}</td>
                <td>{fmtHours(t.workedHoursPerWorkday)}</td>
                <td>{fmtPct(t.utilizationRate)}</td>
                <td style={{ color: daysColor(t.avgJobCompletionDays) }}>{fmtDays(t.avgJobCompletionDays)}</td>
                <td>{t.avgJobsPerWorkday?.toFixed(1) ?? "—"}</td>
                <td>{fmtMoney0(t.totalAmountBilled)}</td>
                <td>{fmtMoney0(t.avgRevenuePerJob)}</td>
                <td style={{ color: t.profitPerTech >= 0 ? GREEN : RED, fontWeight: 600 }}>{fmtMoney0(t.profitPerTech)}</td>
                <td>{fmtMoney(t.hourlyCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- Vendor Performance Table ---- */
type VSortKey = keyof VendorPerf;
function VendorPerformanceTable({ rows }: { rows: VendorPerf[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<VSortKey>("totalWos");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => !q || r.vendor?.toLowerCase().includes(q) || r.trade?.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = (a[sortKey] as number | string | null | undefined) ?? 0;
      const vb = (b[sortKey] as number | string | null | undefined) ?? 0;
      if (typeof va === "number" && typeof vb === "number") return dir * (va - vb);
      return dir * String(va).localeCompare(String(vb));
    });
    return out;
  }, [rows, search, sortKey, sortDir]);
  const toggle = (k: VSortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  return (
    <div className={styles.tableCard} style={{ marginTop: "1rem" }}>
      <h3 className={styles.chartTitle}>Vendor performance (top 20)</h3>
      <div className={styles.tableSearch}>
        <input type="search" placeholder="Search vendors…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th onClick={() => toggle("vendor")}>Vendor</th>
              <th>Trade</th>
              <th onClick={() => toggle("totalWos")}>Total</th>
              <th onClick={() => toggle("completedWos")}>Completed</th>
              <th onClick={() => toggle("completionRate")}>Completion %</th>
              <th onClick={() => toggle("cancellationRate")}>Cancel %</th>
              <th onClick={() => toggle("avgDaysToComplete")}>Avg days</th>
              <th onClick={() => toggle("onTimeRate")}>On-time %</th>
              <th onClick={() => toggle("avgCost")}>Avg cost</th>
              <th onClick={() => toggle("totalSpendYtd")}>Spend YTD</th>
              <th onClick={() => toggle("activeWos")}>Active</th>
              <th onClick={() => toggle("lastWoDate")}>Last WO</th>
              <th onClick={() => toggle("performanceScore")}>Score</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={13} className={styles.chartPlaceholder}>No vendor data.</td></tr>
            ) : filtered.map((v) => (
              <tr key={v.vendor}>
                <td style={{ fontWeight: 600, color: NAVY }}>{v.vendor}</td>
                <td>{v.trade || "—"}</td>
                <td>{v.totalWos}</td>
                <td>{v.completedWos}</td>
                <td>{fmtPct(v.completionRate)}</td>
                <td style={{ color: v.cancellationRate > 20 ? RED : undefined }}>{fmtPct(v.cancellationRate)}</td>
                <td style={{ color: daysColor(v.avgDaysToComplete) }}>{fmtDays(v.avgDaysToComplete)}</td>
                <td>{fmtPct(v.onTimeRate)}</td>
                <td>{fmtMoney0(v.avgCost)}</td>
                <td>{fmtMoney0(v.totalSpendYtd)}</td>
                <td>{v.activeWos}</td>
                <td>{fmtDate(v.lastWoDate)}</td>
                <td style={{ fontWeight: 700, color: v.performanceScore >= 80 ? GREEN : v.performanceScore >= 60 ? GOLD : RED }}>
                  {v.performanceScore.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- Technician Config Admin ---- */
function TechnicianConfigSection({ onChanged }: { onChanged: () => void }) {
  const { authHeaders } = useAuth();
  const [techs, setTechs] = useState<TechConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<number, { hourlyCost: string; isActive: boolean; notes: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/admin/technician-config"), { headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.technicians)) setTechs(j.technicians);
    } finally { setLoading(false); }
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  const save = async (id: number) => {
    const e = editing[id]; if (!e) return;
    const res = await fetch(apiUrl(`/admin/technician-config/${id}`), {
      method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ hourlyCost: Number(e.hourlyCost), isActive: e.isActive, notes: e.notes || null }),
    });
    if (res.ok) {
      setEditing((m) => { const n = { ...m }; delete n[id]; return n; });
      await load();
      onChanged();
    } else {
      alert("Save failed");
    }
  };

  if (loading) return <p style={{ color: GREY, marginTop: "1rem" }}>Loading technicians…</p>;
  if (techs.length === 0) return null;

  return (
    <details className={styles.tableCard} style={{ marginTop: "1rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: NAVY, padding: "0.35rem 0" }}>
        Admin: Configure technician hourly cost ({techs.length})
      </summary>
      <div className={styles.tableWrap} style={{ marginTop: "0.75rem" }}>
        <table className={styles.table}>
          <thead>
            <tr><th>Technician</th><th>Hourly cost</th><th>Active</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {techs.map((t) => {
              const ed = editing[t.id];
              return (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600, color: NAVY }}>{t.technicianName}</td>
                  <td>
                    <input type="number" step="0.01" style={{ width: "100px", padding: "0.3rem", border: "1px solid rgba(27,40,86,0.15)", borderRadius: 6 }}
                      value={ed ? ed.hourlyCost : String(t.hourlyCost)}
                      onChange={(e) => setEditing((m) => ({ ...m, [t.id]: { hourlyCost: e.target.value, isActive: ed?.isActive ?? t.isActive, notes: ed?.notes ?? t.notes ?? "" } }))} />
                  </td>
                  <td>
                    <input type="checkbox"
                      checked={ed ? ed.isActive : t.isActive}
                      onChange={(e) => setEditing((m) => ({ ...m, [t.id]: { hourlyCost: ed?.hourlyCost ?? String(t.hourlyCost), isActive: e.target.checked, notes: ed?.notes ?? t.notes ?? "" } }))} />
                  </td>
                  <td>
                    <input type="text" style={{ width: "200px", padding: "0.3rem", border: "1px solid rgba(27,40,86,0.15)", borderRadius: 6 }}
                      value={ed ? ed.notes : (t.notes ?? "")}
                      onChange={(e) => setEditing((m) => ({ ...m, [t.id]: { hourlyCost: ed?.hourlyCost ?? String(t.hourlyCost), isActive: ed?.isActive ?? t.isActive, notes: e.target.value } }))} />
                  </td>
                  <td>
                    {ed ? (
                      <button type="button" style={{ padding: "0.3rem 0.75rem", background: BLUE, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
                        onClick={() => save(t.id)}>Save</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
