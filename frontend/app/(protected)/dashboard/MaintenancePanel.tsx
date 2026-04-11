"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./dashboard.module.css";

const BLUE = "#0098d0";
const RED = "#b32317";
const GREY = "#6a737b";
const GOLD = "#c5960c";
const GREEN = "#2d8b4e";

const STATUS_COLORS: Record<string, string> = {
  New: "#b32317",
  Assigned: "#0098d0",
  Estimated: "#c5960c",
  Scheduled: "#2d8b4e",
  Completed: "#6a737b",
  Canceled: "#6a737b",
};

type WoDetail = {
  jobDescription?: string;
  serviceRequestDescription?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  workOrderType?: string;
  submittedByTenant?: unknown;
  vendorBillAmount?: string;
  estimateAmount?: string;
};

export type WorkOrderRow = {
  workOrderNumber: string;
  status: string;
  priority: string;
  propertyName: string;
  unitName: string;
  vendor: string;
  vendorTrade: string;
  issue: string;
  description: string;
  createdAt: string;
  daysOpen: number;
  amount: string;
  tenant: string;
  assignedUser: string;
  detail?: WoDetail;
};

type MaintPayload = {
  summary?: {
    totalOpen?: number;
    byStatus?: Record<string, number>;
    byPriority?: Record<string, number>;
    avgDaysOpen?: number;
    urgentCount?: number;
    newCount?: number;
  };
  workOrders?: WorkOrderRow[];
  byProperty?: { propertyName: string; openCount: number }[];
  byVendor?: { vendor: string; trade: string; openCount: number; totalBilled: number }[];
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    n
  );
}

function statusBadgeColor(status: string) {
  return STATUS_COLORS[status] ?? GREY;
}

function totalOpenColor(n: number) {
  if (n < 10) return GREEN;
  if (n <= 20) return GOLD;
  return RED;
}

function avgDaysColor(n: number) {
  if (n <= 7) return GREEN;
  if (n <= 14) return GOLD;
  return RED;
}

function priorityWeight(p: string) {
  return p.toLowerCase() === "urgent" ? 2 : 1;
}

function defaultSort(a: WorkOrderRow, b: WorkOrderRow) {
  const pr = priorityWeight(b.priority) - priorityWeight(a.priority);
  if (pr !== 0) return pr;
  return b.daysOpen - a.daysOpen;
}

type SortCol =
  | "workOrderNumber"
  | "status"
  | "priority"
  | "propertyName"
  | "unitName"
  | "issue"
  | "vendor"
  | "createdAt"
  | "daysOpen"
  | "amount";

type ExecKpi = { openWorkOrders?: number };

export default function MaintenancePanel(props: {
  maintenance: MaintPayload | null;
  executive: ExecKpi | null;
  loading: boolean;
  error: string | null;
}) {
  const { maintenance, executive, loading, error } = props;
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  const summary = maintenance?.summary;
  const byVendor = maintenance?.byVendor ?? [];
  const byPropertyChart = maintenance?.byProperty ?? [];

  const pieStatusData = useMemo(() => {
    const raw = summary?.byStatus ?? {};
    return Object.entries(raw)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  }, [summary?.byStatus]);

  const priorityBarData = useMemo(() => {
    const raw = summary?.byPriority ?? {};
    return Object.entries(raw).map(([name, value]) => ({ name, value }));
  }, [summary?.byPriority]);

  const filteredSortedRows = useMemo(() => {
    const rows = [...(maintenance?.workOrders ?? [])];
    const q = search.trim().toLowerCase();
    let list = q
      ? rows.filter((r) => {
          const hay = [
            r.propertyName,
            r.vendor,
            r.issue,
            r.description,
            r.workOrderNumber,
            r.unitName,
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : rows;

    if (sortCol) {
      const dir = sortDir === "asc" ? 1 : -1;
      const cmpNum = (a: number, b: number) => dir * (a - b);
      const cmpStr = (a: string, b: string) => dir * a.localeCompare(b, undefined, { sensitivity: "base" });
      list = [...list].sort((a, b) => {
        switch (sortCol) {
          case "workOrderNumber":
            return cmpStr(a.workOrderNumber, b.workOrderNumber);
          case "status":
            return cmpStr(a.status, b.status);
          case "priority":
            return cmpNum(priorityWeight(a.priority), priorityWeight(b.priority));
          case "propertyName":
            return cmpStr(a.propertyName, b.propertyName);
          case "unitName":
            return cmpStr(a.unitName, b.unitName);
          case "issue":
            return cmpStr(a.issue, b.issue);
          case "vendor":
            return cmpStr(a.vendor, b.vendor);
          case "createdAt":
            return cmpStr(a.createdAt, b.createdAt);
          case "daysOpen":
            return cmpNum(a.daysOpen, b.daysOpen);
          case "amount": {
            const pa = parseFloat(String(a.amount).replace(/[$,]/g, "")) || 0;
            const pb = parseFloat(String(b.amount).replace(/[$,]/g, "")) || 0;
            return cmpNum(pa, pb);
          }
          default:
            return 0;
        }
      });
    } else {
      list.sort(defaultSort);
    }
    return list;
  }, [maintenance?.workOrders, search, sortCol, sortDir]);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  if (loading && !maintenance) {
    return (
      <>
        <div className={styles.skeletonGrid} style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeleton} style={{ minHeight: 100 }} />
          ))}
        </div>
        <div className={styles.chartRow}>
          <div className={styles.skeleton} style={{ minHeight: 280 }} />
          <div className={styles.skeleton} style={{ minHeight: 280 }} />
        </div>
        <div className={styles.skeleton} style={{ minHeight: 200, marginBottom: "1rem" }} />
      </>
    );
  }

  if (error) {
    return (
      <div className={styles.alert} role="alert">
        <strong>Could not load maintenance data.</strong> {error}
      </div>
    );
  }

  if (!maintenance || !summary) {
    return (
      <p style={{ color: GREY }}>
        No maintenance data yet. Run a sync from Refresh Data (admins) after work orders are cached.
      </p>
    );
  }

  const totalOpen = summary.totalOpen ?? 0;
  const urgentCount = summary.urgentCount ?? 0;
  const newCount = summary.newCount ?? 0;
  const avgDays = summary.avgDaysOpen ?? 0;

  return (
    <>
      <p style={{ fontSize: "0.85rem", color: GREY, marginTop: 0, marginBottom: "0.5rem" }}>
        Open work orders from cached AppFolio data (status not Completed/Canceled, no completion date). Filtered by
        date range and properties above.
      </p>
      {typeof executive?.openWorkOrders === "number" ? (
        <p style={{ fontSize: "0.8rem", color: GREY, marginTop: 0, marginBottom: "1rem" }}>
          Executive summary KPI: <strong>{executive.openWorkOrders}</strong> open work orders (property filter only; no
          created-date filter).
        </p>
      ) : null}

      <div className={styles.grid4}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total open work orders</div>
          <div className={styles.kpiValue} style={{ color: totalOpenColor(totalOpen) }}>
            {totalOpen}
          </div>
          <div className={styles.kpiSub}>Portfolio (filtered)</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Urgent</div>
          <div className={styles.kpiValue} style={{ color: urgentCount > 0 ? RED : GREEN }}>
            {urgentCount}
          </div>
          <div className={styles.kpiSub}>Priority = Urgent</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Average days open</div>
          <div className={styles.kpiValue} style={{ color: avgDaysColor(avgDays) }}>
            {avgDays}
          </div>
          <div className={styles.kpiSub}>Since created date</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>New / unassigned</div>
          <div className={styles.kpiValue} style={{ color: newCount > 0 ? RED : GREEN }}>
            {newCount}
          </div>
          <div className={styles.kpiSub}>Status = New</div>
        </div>
      </div>

      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Work orders by status</h3>
          {pieStatusData.length === 0 ? (
            <div className={styles.chartPlaceholder}>No open work orders in range.</div>
          ) : (
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={pieStatusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {pieStatusData.map((entry, i) => (
                      <Cell key={i} fill={statusBadgeColor(entry.name)} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Work orders by priority</h3>
          {priorityBarData.length === 0 ? (
            <div className={styles.chartPlaceholder}>No data.</div>
          ) : (
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={priorityBarData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke={GREY} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={GREY} />
                  <Tooltip />
                  <Bar dataKey="value" fill={BLUE} radius={[6, 6, 0, 0]} name="Count" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className={styles.tableCard} style={{ marginBottom: "1.25rem" }}>
        <h3 className={styles.chartTitle}>Top vendors (open)</h3>
        <div className={`${styles.tableWrap} ${styles.maintTableDesktop}`}>
          <table className={`${styles.table} ${styles.maintVendorTable}`}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Trade</th>
                <th>Open WOs</th>
                <th>Total billed</th>
              </tr>
            </thead>
            <tbody>
              {byVendor.map((v) => (
                <tr key={v.vendor}>
                  <td>
                    <button type="button" className={styles.rowBtn} disabled title="Coming soon">
                      {v.vendor}
                    </button>
                  </td>
                  <td>{v.trade}</td>
                  <td>{v.openCount}</td>
                  <td>{fmtMoney(v.totalBilled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.maintCardOnly}>
          {byVendor.map((v) => (
            <div key={v.vendor} className={styles.maintMobileCard}>
              <strong>{v.vendor}</strong>
              <div>{v.trade}</div>
              <div>
                Open: {v.openCount} · Billed {fmtMoney(v.totalBilled)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.chartCard} style={{ marginBottom: "1.25rem" }}>
        <h3 className={styles.chartTitle}>Open work orders by property</h3>
        {byPropertyChart.length === 0 ? (
          <div className={styles.chartPlaceholder}>No properties with open work orders.</div>
        ) : (
          <div style={{ width: "100%", height: Math.min(420, 40 + byPropertyChart.length * 28) }}>
            <ResponsiveContainer>
              <BarChart
                layout="vertical"
                data={byPropertyChart}
                margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke={GREY} />
                <YAxis
                  type="category"
                  dataKey="propertyName"
                  width={140}
                  tick={{ fontSize: 10 }}
                  stroke={GREY}
                />
                <Tooltip />
                <Bar dataKey="openCount" fill={BLUE} name="Open WOs" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className={styles.tableCard}>
        <h3 className={styles.chartTitle} style={{ marginBottom: "0.65rem" }}>
          All open work orders
        </h3>
        <div className={styles.tableSearch}>
          <input
            type="search"
            placeholder="Search property, vendor, issue, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search work orders"
          />
        </div>

        <div className={`${styles.tableWrap} ${styles.maintTableDesktop}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort("workOrderNumber")}>WO#</th>
                <th onClick={() => toggleSort("status")}>Status</th>
                <th onClick={() => toggleSort("priority")}>Priority</th>
                <th onClick={() => toggleSort("propertyName")}>Property</th>
                <th onClick={() => toggleSort("unitName")}>Unit</th>
                <th onClick={() => toggleSort("issue")}>Issue</th>
                <th onClick={() => toggleSort("vendor")}>Vendor</th>
                <th onClick={() => toggleSort("createdAt")}>Created</th>
                <th onClick={() => toggleSort("daysOpen")}>Days open</th>
                <th onClick={() => toggleSort("amount")}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {filteredSortedRows.map((row) => {
                const key = `${row.workOrderNumber}-${row.propertyName}-${row.createdAt}`;
                const open = expanded === key;
                return (
                  <Fragment key={key}>
                    <tr className={open ? styles.maintRowOpen : undefined}>
                      <td>
                        <button
                          type="button"
                          className={styles.rowBtn}
                          onClick={() => setExpanded((e) => (e === key ? null : key))}
                        >
                          {row.workOrderNumber}
                        </button>
                      </td>
                      <td>
                        <span
                          className={styles.statusBadge}
                          style={{ background: `${statusBadgeColor(row.status)}22`, color: statusBadgeColor(row.status) }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td>
                        {row.priority.toLowerCase() === "urgent" ? (
                          <span className={styles.statusBadge} style={{ background: "rgba(179,35,23,0.15)", color: RED }}>
                            Urgent
                          </span>
                        ) : (
                          row.priority
                        )}
                      </td>
                      <td>{row.propertyName}</td>
                      <td>{row.unitName || "—"}</td>
                      <td>{row.issue}</td>
                      <td>{row.vendor}</td>
                      <td>{row.createdAt}</td>
                      <td>{row.daysOpen}</td>
                      <td>{row.amount ? `$${row.amount}` : "—"}</td>
                    </tr>
                    {open && row.detail && (
                      <tr className={styles.expandRow}>
                        <td colSpan={10}>
                          <div className={styles.maintExpand}>
                            <p>
                              <strong>Description:</strong> {row.description || "—"}
                            </p>
                            {row.detail.jobDescription ? (
                              <p>
                                <strong>Job description:</strong> {row.detail.jobDescription}
                              </p>
                            ) : null}
                            {row.detail.serviceRequestDescription ? (
                              <p>
                                <strong>Tenant request:</strong> {row.detail.serviceRequestDescription}
                              </p>
                            ) : null}
                            <p>
                              <strong>Tenant:</strong> {row.tenant} · <strong>Assigned:</strong> {row.assignedUser}
                            </p>
                            <p>
                              <strong>Scheduled:</strong> {row.detail.scheduledStart || "—"} →{" "}
                              {row.detail.scheduledEnd || "—"}
                            </p>
                            <p>
                              <strong>Type:</strong> {row.detail.workOrderType || "—"} · <strong>Vendor trade:</strong>{" "}
                              {row.vendorTrade}
                            </p>
                            <p>
                              <strong>Vendor bill:</strong> {row.detail.vendorBillAmount || "—"} ·{" "}
                              <strong>Estimate:</strong> {row.detail.estimateAmount || "—"} ·{" "}
                              <strong>Tenant submitted:</strong> {String(row.detail.submittedByTenant ?? "—")}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.maintCardOnly}>
          {filteredSortedRows.map((row) => {
            const key = `${row.workOrderNumber}-${row.propertyName}-${row.createdAt}`;
            return (
              <div key={key} className={styles.maintMobileCard}>
                <div className={styles.maintMobileCardHead}>
                  <strong>{row.workOrderNumber}</strong>
                  <span
                    className={styles.statusBadge}
                    style={{ background: `${statusBadgeColor(row.status)}22`, color: statusBadgeColor(row.status) }}
                  >
                    {row.status}
                  </span>
                </div>
                <div>
                  {row.propertyName} {row.unitName ? `· ${row.unitName}` : ""}
                </div>
                <div>{row.issue}</div>
                <div>
                  {row.vendor} · {row.daysOpen}d open
                </div>
                <button
                  type="button"
                  className={styles.rowBtn}
                  onClick={() => setExpanded((e) => (e === key ? null : key))}
                >
                  {expanded === key ? "Hide details" : "Details"}
                </button>
                {expanded === key && row.detail ? (
                  <div className={styles.maintExpand}>
                    <p>
                      <strong>Description:</strong> {row.description || "—"}
                    </p>
                    {row.detail.jobDescription ? (
                      <p>
                        <strong>Job description:</strong> {row.detail.jobDescription}
                      </p>
                    ) : null}
                    {row.detail.serviceRequestDescription ? (
                      <p>
                        <strong>Tenant request:</strong> {row.detail.serviceRequestDescription}
                      </p>
                    ) : null}
                    <p>
                      <strong>Tenant:</strong> {row.tenant} · <strong>Assigned:</strong> {row.assignedUser}
                    </p>
                    <p>
                      <strong>Scheduled:</strong> {row.detail.scheduledStart || "—"} → {row.detail.scheduledEnd || "—"}
                    </p>
                    <p>
                      <strong>Type:</strong> {row.detail.workOrderType || "—"} · <strong>Vendor trade:</strong>{" "}
                      {row.vendorTrade}
                    </p>
                    <p>
                      <strong>Vendor bill:</strong> {row.detail.vendorBillAmount || "—"} · <strong>Estimate:</strong>{" "}
                      {row.detail.estimateAmount || "—"} · <strong>Tenant submitted:</strong>{" "}
                      {String(row.detail.submittedByTenant ?? "—")}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
