"use client";

import { useMemo, useState } from "react";
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

const NAVY = "#1b2856";
const BLUE = "#0098d0";
const RED = "#b32317";
const GREY = "#6a737b";
const AMBER = "#c5960c";
const GREEN = "#2d8b4e";

const STATUS_DONUT = {
  Eligible: BLUE,
  "Not Eligible": RED,
  Renewed: GREEN,
};

type LeasingPayload = {
  dataSources?: { appfolio?: boolean; rentengine?: boolean; boom?: boolean };
  vacancy?: {
    vacantUnits: number;
    onNotice: number;
    vacantList: {
      propertyName: string;
      unit: string;
      advertisedRent: string;
      marketRent: string;
      sqft: string;
      bdBa: string;
      rent: string;
      status: string;
    }[];
  };
  applications?: {
    total: number;
    ytdTotal: number;
    conversionRatePercent: number;
    byStatus: Record<string, number>;
    avgTimeToConversion: number;
    recentApplications: {
      applicants: string;
      propertyName: string;
      unit: string;
      status: string;
      received: string;
      moveInDate: string;
      leadSource: string;
      timeToConversion: number | null;
    }[];
  };
  leaseExpirations?: {
    total: number;
    byStatus: Record<string, number>;
    byMonth: { month: string; count: number; within90: boolean }[];
    upcoming90Days: {
      tenantName: string;
      propertyName: string;
      unit: string;
      leaseExpires: string;
      rent: string;
      marketRent: string;
      status: string;
      daysUntilExpiration: number;
    }[];
    leaseExpiringNext90Days: number;
    renewalRatePercent: number;
  };
};

function vacantColor(n: number) {
  if (n < 5) return GREEN;
  if (n <= 10) return AMBER;
  return RED;
}

function appStatusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "converted") return { label: status, bg: "rgba(45,139,78,0.15)", color: GREEN };
  if (s === "canceled" || s === "cancelled") return { label: status, bg: "rgba(179,35,23,0.12)", color: RED };
  return { label: status, bg: "rgba(197,150,12,0.2)", color: AMBER };
}

function leaseStatusBadge(status: string) {
  const s = status.toLowerCase();
  if (s.includes("eligible") && !s.includes("not")) return { bg: "rgba(0,152,208,0.12)", color: BLUE };
  if (s.includes("renewed")) return { bg: "rgba(45,139,78,0.12)", color: GREEN };
  return { bg: "rgba(179,35,23,0.1)", color: RED };
}

function vacancyRowBadge(status: string) {
  if (status === "Vacant-Unrented") return { bg: "rgba(179,35,23,0.12)", color: RED };
  return { bg: "rgba(197,150,12,0.2)", color: AMBER };
}

function expiryRowClass(days: number) {
  if (days <= 30) return styles.leasingRow30;
  if (days <= 60) return styles.leasingRow60;
  return styles.leasingRow90;
}

type VSort =
  | "propertyName"
  | "unit"
  | "bdBa"
  | "sqft"
  | "advertisedRent"
  | "marketRent"
  | "status";

type ExpSort = "tenantName" | "propertyName" | "leaseExpires" | "daysUntilExpiration" | "rent" | "status";
type AppSort = "applicants" | "propertyName" | "status" | "received" | "leadSource";

export default function LeasingPanel(props: {
  leasing: LeasingPayload | null;
  loading: boolean;
  error: string | null;
}) {
  const { leasing, loading, error } = props;
  const [vacSearch, setVacSearch] = useState("");
  const [vacSort, setVacSort] = useState<VSort>("propertyName");
  const [vacDir, setVacDir] = useState<"asc" | "desc">("asc");

  const [expSearch, setExpSearch] = useState("");
  const [expSort, setExpSort] = useState<ExpSort>("leaseExpires");
  const [expDir, setExpDir] = useState<"asc" | "desc">("asc");

  const [appSearch, setAppSearch] = useState("");
  const [appSort, setAppSort] = useState<AppSort>("received");
  const [appDir, setAppDir] = useState<"asc" | "desc">("desc");

  const vac = leasing?.vacancy;
  const apps = leasing?.applications;
  const le = leasing?.leaseExpirations;
  const rentengine = leasing?.dataSources?.rentengine;

  const donutData = useMemo(() => {
    const b = le?.byStatus ?? {};
    return ["Eligible", "Not Eligible", "Renewed"]
      .map((name) => ({ name, value: b[name] ?? 0 }))
      .filter((x) => x.value > 0);
  }, [le?.byStatus]);

  const filteredVac = useMemo(() => {
    const rows = [...(vac?.vacantList ?? [])];
    const q = vacSearch.trim().toLowerCase();
    const list = q
      ? rows.filter((r) => {
          const hay = `${r.propertyName} ${r.unit} ${r.advertisedRent}`.toLowerCase();
          return hay.includes(q);
        })
      : rows;
    const dir = vacDir === "asc" ? 1 : -1;
    const numStr = (s: string) => parseFloat(String(s).replace(/[$,]/g, "")) || 0;
    return [...list].sort((a, b) => {
      switch (vacSort) {
        case "propertyName":
          return dir * a.propertyName.localeCompare(b.propertyName, undefined, { sensitivity: "base" });
        case "unit":
          return dir * a.unit.localeCompare(b.unit, undefined, { sensitivity: "base" });
        case "bdBa":
          return dir * a.bdBa.localeCompare(b.bdBa);
        case "sqft":
          return dir * (numStr(a.sqft) - numStr(b.sqft));
        case "advertisedRent":
          return dir * (numStr(a.advertisedRent) - numStr(b.advertisedRent));
        case "marketRent":
          return dir * (numStr(a.marketRent) - numStr(b.marketRent));
        case "status":
          return dir * a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });
  }, [vac?.vacantList, vacSearch, vacSort, vacDir]);

  const filteredExp = useMemo(() => {
    const rows = [...(le?.upcoming90Days ?? [])];
    const q = expSearch.trim().toLowerCase();
    let list = q
      ? rows.filter((r) => {
          const hay = `${r.tenantName} ${r.propertyName}`.toLowerCase();
          return hay.includes(q);
        })
      : rows;
    const dir = expDir === "asc" ? 1 : -1;
    const rentNum = (s: string) => parseFloat(String(s).replace(/[$,]/g, "")) || 0;
    list = [...list].sort((a, b) => {
      switch (expSort) {
        case "tenantName":
          return dir * a.tenantName.localeCompare(b.tenantName, undefined, { sensitivity: "base" });
        case "propertyName":
          return dir * a.propertyName.localeCompare(b.propertyName, undefined, { sensitivity: "base" });
        case "leaseExpires":
          return dir * a.leaseExpires.localeCompare(b.leaseExpires);
        case "daysUntilExpiration":
          return dir * (a.daysUntilExpiration - b.daysUntilExpiration);
        case "rent":
          return dir * (rentNum(a.rent) - rentNum(b.rent));
        case "status":
          return dir * a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });
    return list;
  }, [le?.upcoming90Days, expSearch, expSort, expDir]);

  const filteredApps = useMemo(() => {
    const rows = [...(apps?.recentApplications ?? [])];
    const q = appSearch.trim().toLowerCase();
    let list = q
      ? rows.filter((r) => {
          const hay = `${r.applicants} ${r.propertyName} ${r.status}`.toLowerCase();
          return hay.includes(q);
        })
      : rows;
    const dir = appDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (appSort) {
        case "applicants":
          return dir * a.applicants.localeCompare(b.applicants, undefined, { sensitivity: "base" });
        case "propertyName":
          return dir * a.propertyName.localeCompare(b.propertyName, undefined, { sensitivity: "base" });
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "received":
          return dir * a.received.localeCompare(b.received);
        case "leadSource":
          return dir * a.leadSource.localeCompare(b.leadSource);
        default:
          return 0;
      }
    });
    return list;
  }, [apps?.recentApplications, appSearch, appSort, appDir]);

  const toggleVacSort = (k: VSort) => {
    if (vacSort === k) setVacDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setVacSort(k);
      setVacDir("asc");
    }
  };

  const toggleExpSort = (k: ExpSort) => {
    if (expSort === k) setExpDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setExpSort(k);
      setExpDir("asc");
    }
  };

  const toggleAppSort = (k: AppSort) => {
    if (appSort === k) setAppDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setAppSort(k);
      setAppDir("desc");
    }
  };

  if (loading && !leasing) {
    return (
      <>
        <div className={styles.skeletonGrid} style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeleton} style={{ minHeight: 100 }} />
          ))}
        </div>
        <div className={styles.chartRow}>
          <div className={styles.skeleton} style={{ minHeight: 260 }} />
          <div className={styles.skeleton} style={{ minHeight: 260 }} />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <div className={styles.alert} role="alert">
        <strong>Could not load leasing data.</strong> {error}
      </div>
    );
  }

  if (!leasing || !vac || !apps || !le) {
    return (
      <p style={{ color: GREY }}>No leasing data yet. Sync rent roll, applications, and lease expirations.</p>
    );
  }

  const vu = vac.vacantUnits;

  return (
    <>
      <p style={{ fontSize: "0.85rem", color: GREY, marginTop: 0, marginBottom: "1rem" }}>
        Vacancy and applications from cached rent roll and rental applications; lease renewals from lease
        expirations. Property filter above applies.
      </p>

      <div className={styles.grid4}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Vacant units</div>
          <div className={styles.kpiValue} style={{ color: vacantColor(vu) }}>
            {vu}
          </div>
          <div className={styles.kpiSub}>{vac.onNotice} on notice</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Applications (YTD)</div>
          <div className={styles.kpiValue} style={{ color: NAVY }}>
            {apps.ytdTotal}
          </div>
          <div className={styles.kpiSub}>
            {apps.conversionRatePercent.toFixed(1)}% converted · {apps.total} all-time
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Lease expirations (90 days)</div>
          <div className={styles.kpiValue} style={{ color: BLUE }}>
            {le.leaseExpiringNext90Days}
          </div>
          <div className={styles.kpiSub}>{le.total} tracked in cache</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Renewal rate</div>
          <div className={styles.kpiValue} style={{ color: GREEN }}>
            {le.renewalRatePercent.toFixed(1)}%
          </div>
          <div className={styles.kpiSub}>Renewed ÷ (Renewed + Not Eligible)</div>
        </div>
      </div>

      {!rentengine ? (
        <div className={styles.leasingInfoBanner} role="status">
          Lead and showing data will be available when RentEngine is connected. Currently showing AppFolio
          application and lease data only.
        </div>
      ) : null}

      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Lease expiration schedule (next 12 months)</h3>
          <p style={{ fontSize: "0.78rem", color: GREY, marginTop: 0 }}>
            From rent roll <code className={styles.codeInline}>lease_expires_month</code>. Amber = month midpoint
            within 90 days.
          </p>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={le.byMonth} margin={{ top: 8, right: 16, left: 8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                <XAxis dataKey="month" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" height={70} stroke={GREY} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={GREY} />
                <Tooltip />
                <Bar dataKey="count" name="Leases expiring" radius={[4, 4, 0, 0]}>
                  {le.byMonth.map((entry, i) => (
                    <Cell key={i} fill={entry.within90 ? AMBER : BLUE} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Lease expiration status</h3>
          {donutData.length === 0 ? (
            <div className={styles.chartPlaceholder}>No lease expiration rows.</div>
          ) : (
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={86}
                    paddingAngle={2}
                  >
                    {donutData.map((e, i) => (
                      <Cell key={i} fill={STATUS_DONUT[e.name as keyof typeof STATUS_DONUT] ?? GREY} />
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

      <div className={styles.tableCard} style={{ marginBottom: "1.25rem" }}>
        <h3 className={styles.chartTitle}>Vacant &amp; notice units</h3>
        <div className={styles.tableSearch}>
          <input
            type="search"
            placeholder="Search property, unit, rent…"
            value={vacSearch}
            onChange={(e) => setVacSearch(e.target.value)}
            aria-label="Search vacant units"
          />
        </div>
        <div className={`${styles.tableWrap} ${styles.maintTableDesktop}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleVacSort("propertyName")}>Property</th>
                <th onClick={() => toggleVacSort("unit")}>Unit</th>
                <th onClick={() => toggleVacSort("bdBa")}>Bd/Ba</th>
                <th onClick={() => toggleVacSort("sqft")}>Sq ft</th>
                <th onClick={() => toggleVacSort("advertisedRent")}>Advertised rent</th>
                <th onClick={() => toggleVacSort("marketRent")}>Market rent</th>
                <th onClick={() => toggleVacSort("status")}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredVac.map((r) => {
                const vb = vacancyRowBadge(r.status);
                return (
                  <tr key={`${r.propertyName}-${r.unit}-${r.status}`}>
                    <td>{r.propertyName}</td>
                    <td>{r.unit || "—"}</td>
                    <td>{r.bdBa || "—"}</td>
                    <td>{r.sqft || "—"}</td>
                    <td>{r.advertisedRent || "—"}</td>
                    <td>{r.marketRent || "—"}</td>
                    <td>
                      <span className={styles.statusBadge} style={{ background: vb.bg, color: vb.color }}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.maintCardOnly}>
          {filteredVac.map((r) => {
            const vb = vacancyRowBadge(r.status);
            return (
              <div key={`${r.propertyName}-${r.unit}-${r.status}`} className={styles.maintMobileCard}>
                <strong>{r.propertyName}</strong>
                <div>Unit {r.unit}</div>
                <span className={styles.statusBadge} style={{ background: vb.bg, color: vb.color }}>
                  {r.status}
                </span>
                <div>
                  {r.bdBa} · {r.sqft} sqft · Adv {r.advertisedRent} · Mkt {r.marketRent}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.tableCard} style={{ marginBottom: "1.25rem" }}>
        <h3 className={styles.chartTitle}>Upcoming lease expirations (90 days)</h3>
        <div className={styles.tableSearch}>
          <input
            type="search"
            placeholder="Search tenant or property…"
            value={expSearch}
            onChange={(e) => setExpSearch(e.target.value)}
            aria-label="Search expirations"
          />
        </div>
        <div className={`${styles.tableWrap} ${styles.maintTableDesktop}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleExpSort("tenantName")}>Tenant</th>
                <th onClick={() => toggleExpSort("propertyName")}>Property</th>
                <th>Unit</th>
                <th onClick={() => toggleExpSort("leaseExpires")}>Lease expires</th>
                <th onClick={() => toggleExpSort("rent")}>Current rent</th>
                <th>Market rent</th>
                <th onClick={() => toggleExpSort("status")}>Status</th>
                <th onClick={() => toggleExpSort("daysUntilExpiration")}>Days</th>
              </tr>
            </thead>
            <tbody>
              {filteredExp.map((r) => {
                const sb = leaseStatusBadge(r.status);
                return (
                  <tr key={`${r.tenantName}-${r.propertyName}-${r.leaseExpires}`} className={expiryRowClass(r.daysUntilExpiration)}>
                    <td>{r.tenantName}</td>
                    <td>{r.propertyName}</td>
                    <td>{r.unit || "—"}</td>
                    <td>{r.leaseExpires}</td>
                    <td>{r.rent ? `$${r.rent}` : "—"}</td>
                    <td>{r.marketRent ? `$${r.marketRent}` : "—"}</td>
                    <td>
                      <span className={styles.statusBadge} style={{ background: sb.bg, color: sb.color }}>
                        {r.status}
                      </span>
                    </td>
                    <td>{r.daysUntilExpiration}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.maintCardOnly}>
          {filteredExp.map((r) => (
            <div
              key={`${r.tenantName}-${r.propertyName}-${r.leaseExpires}`}
              className={styles.maintMobileCard}
              style={{
                background:
                  r.daysUntilExpiration <= 30
                    ? "rgba(179,35,23,0.06)"
                    : r.daysUntilExpiration <= 60
                      ? "rgba(197,150,12,0.08)"
                      : "rgba(0,152,208,0.06)",
              }}
            >
              <strong>{r.tenantName}</strong>
              <div>
                {r.propertyName} · {r.leaseExpires} · {r.daysUntilExpiration}d
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.tableCard}>
        <h3 className={styles.chartTitle}>Rental applications</h3>
        <div className={styles.tableSearch}>
          <input
            type="search"
            placeholder="Search applicant, property…"
            value={appSearch}
            onChange={(e) => setAppSearch(e.target.value)}
            aria-label="Search applications"
          />
        </div>
        <div className={`${styles.tableWrap} ${styles.maintTableDesktop}`}>
          <table className={`${styles.table} ${styles.maintVendorTable}`}>
            <thead>
              <tr>
                <th onClick={() => toggleAppSort("applicants")}>Applicant(s)</th>
                <th onClick={() => toggleAppSort("propertyName")}>Property</th>
                <th>Unit</th>
                <th onClick={() => toggleAppSort("status")}>Status</th>
                <th onClick={() => toggleAppSort("received")}>Received</th>
                <th>Move-in</th>
                <th onClick={() => toggleAppSort("leadSource")}>Lead source</th>
                <th>Days to convert</th>
              </tr>
            </thead>
            <tbody>
              {filteredApps.map((r, i) => {
                const ab = appStatusBadge(r.status);
                return (
                  <tr key={`${r.propertyName}-${r.received}-${i}`}>
                    <td>{r.applicants || "—"}</td>
                    <td>{r.propertyName}</td>
                    <td>{r.unit || "—"}</td>
                    <td>
                      <span className={styles.statusBadge} style={{ background: ab.bg, color: ab.color }}>
                        {r.status}
                      </span>
                    </td>
                    <td>{r.received || "—"}</td>
                    <td>{r.moveInDate || "—"}</td>
                    <td>{r.leadSource || "—"}</td>
                    <td>{r.timeToConversion != null ? r.timeToConversion : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.maintCardOnly}>
          {filteredApps.map((r, i) => {
            const ab = appStatusBadge(r.status);
            return (
              <div key={`${r.propertyName}-${r.received}-${i}`} className={styles.maintMobileCard}>
                <strong>{r.applicants}</strong>
                <div>{r.propertyName}</div>
                <span className={styles.statusBadge} style={{ background: ab.bg, color: ab.color }}>
                  {r.status}
                </span>
                <div>
                  {r.received} · {r.leadSource}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
