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
const GOLD = "#c5960c";
const ORANGE = "#d97706";
const RED_MED = "#e11d48";
const RED_DARK = "#7f1d1d";
const GREEN = "#2d8b4e";

const BREAKDOWN_COLORS = [NAVY, BLUE, GOLD];

type CompanyRev = {
  ytd: number;
  mtd: number;
  lastYearYtd: number;
  yoyChange: number;
  goalAnnual: number;
  goalProgress: number;
  revenuePerDoor: number;
  revenuePerDoorMonthlyAvg: number;
  revenuePerDoorGoal: number;
};

type BreakdownRow = { category: string; ytd: number; mtd: number; percent?: number };
type OwnerBreakdownRow = { category: string; ytd: number; mtd: number };

type DelTenant = {
  name: string;
  amount: number;
  property: string;
  unit: string;
  lastPayment: string;
  daysDelinquent: number;
  aging: {
    current: number;
    days30to60: number;
    days60to90: number;
    days90plus: number;
  };
  inCollections: string;
};

type FinancePayload = {
  companyRevenue?: CompanyRev;
  companyRevenueBreakdown?: BreakdownRow[];
  ownerRevenue?: { ytd: number; mtd: number };
  ownerRevenueBreakdown?: OwnerBreakdownRow[];
  profitMargin?: { current: number; goal: number };
  delinquency?: {
    totalAmount: number;
    accountCount: number;
    avgPerAccount?: number;
    aging: {
      current: number;
      days30to60: number;
      days60to90: number;
      days90plus: number;
    };
    tenants: DelTenant[];
  };
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    n
  );
}

function fmtMoneyDec(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    n
  );
}

function marginColor(p: number) {
  if (p >= 20) return GREEN;
  if (p >= 15) return GOLD;
  return RED;
}

type SortKey =
  | "amount"
  | "name"
  | "property"
  | "unit"
  | "lastPayment"
  | "inCollections"
  | "a0"
  | "a30"
  | "a60"
  | "a90";

export default function FinancePanel(props: {
  finance: FinancePayload | null;
  loading: boolean;
  error: string | null;
}) {
  const { finance, loading, error } = props;
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const cr = finance?.companyRevenue;
  const del = finance?.delinquency;

  const pieData = useMemo(() => {
    const rows = finance?.companyRevenueBreakdown ?? [];
    return rows
      .filter((r) => r.ytd > 0 || r.mtd > 0)
      .map((r) => ({ name: r.category, value: r.ytd }));
  }, [finance?.companyRevenueBreakdown]);

  const yoyBarData = useMemo(() => {
    if (!cr) return [];
    return [
      { name: "This year (company YTD)", value: cr.ytd, fill: BLUE },
      { name: "Prior year (same period)", value: cr.lastYearYtd, fill: GREY },
    ];
  }, [cr]);

  const agingStack = useMemo(() => {
    if (!del?.aging) return [];
    const a = del.aging;
    return [
      {
        label: "Aging",
        current: a.current,
        d30: a.days30to60,
        d60: a.days60to90,
        d90: a.days90plus,
      },
    ];
  }, [del?.aging]);

  const filteredTenants = useMemo(() => {
    const rows = [...(del?.tenants ?? [])];
    const q = search.trim().toLowerCase();
    let list = q
      ? rows.filter((t) => {
          const hay = `${t.name} ${t.property} ${t.unit}`.toLowerCase();
          return hay.includes(q);
        })
      : rows;

    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: DelTenant, b: DelTenant) => {
      switch (sortKey) {
        case "amount":
          return dir * (a.amount - b.amount);
        case "name":
          return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        case "property":
          return dir * a.property.localeCompare(b.property, undefined, { sensitivity: "base" });
        case "unit":
          return dir * a.unit.localeCompare(b.unit, undefined, { sensitivity: "base" });
        case "lastPayment":
          return dir * a.lastPayment.localeCompare(b.lastPayment, undefined, { sensitivity: "base" });
        case "inCollections":
          return dir * a.inCollections.localeCompare(b.inCollections, undefined, { sensitivity: "base" });
        case "a0":
          return dir * (a.aging.current - b.aging.current);
        case "a30":
          return dir * (a.aging.days30to60 - b.aging.days30to60);
        case "a60":
          return dir * (a.aging.days60to90 - b.aging.days60to90);
        case "a90":
          return dir * (a.aging.days90plus - b.aging.days90plus);
        default:
          return 0;
      }
    };
    list.sort(cmp);
    return list;
  }, [del?.tenants, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(
        key === "amount" || key === "a0" || key === "a30" || key === "a60" || key === "a90" ? "desc" : "asc"
      );
    }
  };

  if (loading && !finance) {
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
      </>
    );
  }

  if (error) {
    return (
      <div className={styles.alert} role="alert">
        <strong>Could not load finance data.</strong> {error}
      </div>
    );
  }

  if (!finance || !cr) {
    return (
      <p style={{ color: GREY }}>
        No finance data yet. Run a sync from Refresh Data after income statement and delinquency caches are populated.
      </p>
    );
  }

  const pm = finance.profitMargin?.current ?? 0;
  const goalBarWidth = Math.min(100, cr.goalProgress);

  return (
    <>
      <p style={{ fontSize: "0.85rem", color: GREY, marginTop: 0, marginBottom: "1rem" }}>
        <strong>Company revenue</strong> (accounts 0-5xxxx) is RPM Prestige management and fee income — this drives the
        annual goal and margin. <strong>Owner revenue</strong> (0-4xxxx) is pass-through rent and tenant charges to
        owners, shown separately below.
      </p>

      <div className={styles.grid4}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Company revenue YTD</div>
          <div className={styles.kpiValue} style={{ color: NAVY }}>
            {fmtMoney(cr.ytd)}
          </div>
          <div className={styles.kpiSub}>
            {cr.goalProgress.toFixed(1)}% of {fmtMoney(cr.goalAnnual)} annual goal
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${goalBarWidth}%`, background: BLUE }} />
          </div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Month-to-date (company)</div>
          <div className={styles.kpiValue} style={{ color: BLUE }}>
            {fmtMoney(cr.mtd)}
          </div>
          <div className={styles.kpiSub}>Current calendar month</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Profit margin (company)</div>
          <div className={styles.kpiValue} style={{ color: marginColor(pm) }}>
            {pm.toFixed(1)}%
          </div>
          <div className={styles.kpiSub}>Goal {finance.profitMargin?.goal ?? 20}% · company revenue minus 0-6 expenses</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Revenue per door</div>
          <div className={styles.kpiValue} style={{ color: NAVY }}>
            {fmtMoney(cr.revenuePerDoor)}
          </div>
          <div className={styles.kpiSub}>
            YTD cumulative per unit · Avg / month / door {fmtMoney(cr.revenuePerDoorMonthlyAvg)} (goal{" "}
            {fmtMoney(cr.revenuePerDoorGoal)})
          </div>
        </div>
      </div>

      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Company revenue breakdown (YTD)</h3>
          {pieData.length === 0 ? (
            <div className={styles.chartPlaceholder}>No company revenue rows in cache.</div>
          ) : (
            <div style={{ width: "100%", height: 280 }}>
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
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.82rem", color: GREY }}>
            {(finance.companyRevenueBreakdown ?? []).map((r) => (
              <li key={r.category}>
                <strong>{r.category}:</strong> {fmtMoney(r.ytd)} YTD · {fmtMoney(r.mtd)} MTD
                {typeof r.percent === "number" ? ` (${r.percent}%)` : ""}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>YTD vs prior year (company)</h3>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart
                layout="vertical"
                data={yoyBarData}
                margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke={GREY} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} stroke={GREY} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Amount">
                  {yoyBarData.map((e, i) => (
                    <Cell key={i} fill={e.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", color: GREY }}>
            YoY change: <strong>{cr.yoyChange >= 0 ? "+" : ""}
            {cr.yoyChange.toFixed(1)}%</strong> vs prior-year YTD (0-5 accounts).
          </p>
        </div>
      </div>

      <div className={styles.tableCard} style={{ marginBottom: "1.25rem" }}>
        <h3 className={styles.chartTitle}>Owner revenue (pass-through)</h3>
        <p style={{ fontSize: "0.82rem", color: GREY, marginTop: 0 }}>
          Rent and tenant charges that flow to property owners — not RPM company revenue.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "baseline" }}>
          <div>
            <div className={styles.kpiLabel}>YTD</div>
            <div className={styles.kpiValue} style={{ fontSize: "1.45rem", color: NAVY }}>
              {fmtMoney(finance.ownerRevenue?.ytd ?? 0)}
            </div>
          </div>
          <div>
            <div className={styles.kpiLabel}>MTD</div>
            <div className={styles.kpiValue} style={{ fontSize: "1.45rem", color: NAVY }}>
              {fmtMoney(finance.ownerRevenue?.mtd ?? 0)}
            </div>
          </div>
        </div>
        <ul style={{ margin: "0.75rem 0 0", paddingLeft: "1.1rem", fontSize: "0.88rem", color: GREY }}>
          {(finance.ownerRevenueBreakdown ?? []).map((r) => (
            <li key={r.category}>
              <strong>{r.category}:</strong> {fmtMoney(r.ytd)} YTD · {fmtMoney(r.mtd)} MTD
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Delinquency aging</h3>
          {agingStack.length === 0 ? (
            <div className={styles.chartPlaceholder}>No delinquency data.</div>
          ) : (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={agingStack} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="label" width={56} tick={{ fontSize: 11 }} stroke={GREY} />
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend />
                  <Bar dataKey="current" stackId="a" fill={GOLD} name="0–30 days" />
                  <Bar dataKey="d30" stackId="a" fill={ORANGE} name="30–60 days" />
                  <Bar dataKey="d60" stackId="a" fill={RED_MED} name="60–90 days" />
                  <Bar dataKey="d90" stackId="a" fill={RED_DARK} name="90+ days" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Delinquency summary</h3>
          <div style={{ display: "grid", gap: "1rem" }}>
            <div className={styles.kpiCard} style={{ boxShadow: "none", padding: "0.85rem" }}>
              <div className={styles.kpiLabel}>Total delinquent</div>
              <div className={styles.kpiValue} style={{ color: RED, fontSize: "1.5rem" }}>
                {fmtMoney(del?.totalAmount ?? 0)}
              </div>
            </div>
            <div className={styles.kpiCard} style={{ boxShadow: "none", padding: "0.85rem" }}>
              <div className={styles.kpiLabel}>Accounts</div>
              <div className={styles.kpiValue} style={{ fontSize: "1.5rem" }}>
                {del?.accountCount ?? 0}
              </div>
            </div>
            <div className={styles.kpiCard} style={{ boxShadow: "none", padding: "0.85rem" }}>
              <div className={styles.kpiLabel}>Average per account</div>
              <div className={styles.kpiValue} style={{ fontSize: "1.5rem" }}>
                {fmtMoney(del?.avgPerAccount ?? 0)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.tableCard}>
        <h3 className={styles.chartTitle} style={{ marginBottom: "0.65rem" }}>
          Delinquent tenants
        </h3>
        <div className={styles.tableSearch}>
          <input
            type="search"
            placeholder="Search tenant or property…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search delinquent tenants"
          />
        </div>
        <div className={`${styles.tableWrap} ${styles.maintTableDesktop}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort("name")}>Tenant</th>
                <th onClick={() => toggleSort("property")}>Property</th>
                <th onClick={() => toggleSort("unit")}>Unit</th>
                <th onClick={() => toggleSort("amount")}>Amount owed</th>
                <th onClick={() => toggleSort("a0")}>0–30</th>
                <th onClick={() => toggleSort("a30")}>30–60</th>
                <th onClick={() => toggleSort("a60")}>60–90</th>
                <th onClick={() => toggleSort("a90")}>90+</th>
                <th onClick={() => toggleSort("lastPayment")}>Last payment</th>
                <th onClick={() => toggleSort("inCollections")}>Collections</th>
              </tr>
            </thead>
            <tbody>
              {filteredTenants.map((t) => {
                const hi = t.aging.days90plus > 0;
                return (
                  <tr key={`${t.name}-${t.property}-${t.unit}`} className={hi ? styles.financeRowWarn : undefined}>
                    <td>{t.name}</td>
                    <td>{t.property}</td>
                    <td>{t.unit}</td>
                    <td>{fmtMoneyDec(t.amount)}</td>
                    <td>{fmtMoneyDec(t.aging.current)}</td>
                    <td>{fmtMoneyDec(t.aging.days30to60)}</td>
                    <td>{fmtMoneyDec(t.aging.days60to90)}</td>
                    <td>{fmtMoneyDec(t.aging.days90plus)}</td>
                    <td>{t.lastPayment}</td>
                    <td>{t.inCollections}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.maintCardOnly}>
          {filteredTenants.map((t) => {
            const hi = t.aging.days90plus > 0;
            return (
              <div
                key={`${t.name}-${t.property}-${t.unit}`}
                className={styles.maintMobileCard}
                style={hi ? { background: "rgba(179, 35, 23, 0.08)", borderColor: "rgba(179,35,23,0.2)" } : undefined}
              >
                <strong>{t.name}</strong>
                <div>
                  {t.property} · {t.unit}
                </div>
                <div>Owed {fmtMoneyDec(t.amount)}</div>
                <div style={{ fontSize: "0.8rem" }}>
                  0–30 {fmtMoneyDec(t.aging.current)} · 30–60 {fmtMoneyDec(t.aging.days30to60)} · 60–90{" "}
                  {fmtMoneyDec(t.aging.days60to90)} · 90+ {fmtMoneyDec(t.aging.days90plus)}
                </div>
                <div>Last payment {t.lastPayment}</div>
                <div>Collections: {t.inCollections}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
