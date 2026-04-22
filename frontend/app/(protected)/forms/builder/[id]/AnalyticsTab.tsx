"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import styles from "../../forms.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";

type Summary = {
  totalViews: number;
  totalStarts: number;
  totalSubmissions: number;
  totalAbandons: number;
  conversionRate: number;
  startToSubmitRate: number;
  abandonRate: number;
  avgCompletionTimeSeconds: number;
};
type OverTime = { date: string; views: number; starts: number; submissions: number };
type ByPage = { page: number; pageId: number; pageTitle: string; views: number; completions: number; dropRate: number };
type ByField = { fieldKey: string; label: string; errorCount: number };
type TopReferrer = { referrer: string; count: number };

type AnalyticsResponse = {
  summary: Summary;
  overTime: OverTime[];
  byPage: ByPage[];
  byField: ByField[];
  topReferrers: TopReferrer[];
};

type DateRange = "7d" | "30d" | "90d" | "ytd" | "all" | "custom";

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function AnalyticsTab({ formId }: { formId: number }) {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { from, to } = useMemo(() => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (range === "custom") return { from: customFrom || null, to: customTo || null };
    if (range === "all") return { from: null, to: null };
    let days = 30;
    if (range === "7d") days = 7;
    else if (range === "90d") days = 90;
    else if (range === "ytd") {
      return { from: `${today.getFullYear()}-01-01`, to: fmt(today) };
    }
    const f = new Date(today);
    f.setDate(f.getDate() - days);
    return { from: fmt(f), to: fmt(today) };
  }, [range, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(apiUrl(`/forms/${formId}/analytics?${params.toString()}`), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed.");
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [formId, from, to, authHeaders, token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={styles.main}><div className={styles.loading}>Loading analytics…</div></div>;
  if (err) return <div className={styles.main}><div className={styles.errorBanner}>{err}</div></div>;
  if (!data) return null;

  const maxFunnel = Math.max(
    data.byPage[0]?.views || 0,
    data.summary.totalSubmissions,
    1
  );

  return (
    <div className={styles.main}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem", alignItems: "center" }}>
        <h2 style={{ margin: 0, color: "#1b2856", fontSize: "1.15rem", fontWeight: 700, flex: 1 }}>Analytics</h2>
        <select className={styles.select} value={range} onChange={(e) => setRange(e.target.value as DateRange)}>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="ytd">Year to date</option>
          <option value="all">All time</option>
          <option value="custom">Custom range</option>
        </select>
        {range === "custom" ? (
          <>
            <input type="date" className={styles.input} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" className={styles.input} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        ) : null}
      </div>

      <div className={styles.kpiRow}>
        <KpiCard label="Total Views" value={data.summary.totalViews} />
        <KpiCard label="Total Starts" value={data.summary.totalStarts} />
        <KpiCard label="Total Submissions" value={data.summary.totalSubmissions} />
        <KpiCard label="Conversion Rate" value={`${data.summary.conversionRate}%`} hint="views → submissions" />
        <KpiCard label="Start → Submit" value={`${data.summary.startToSubmitRate}%`} />
        <KpiCard label="Avg. Completion" value={formatDuration(data.summary.avgCompletionTimeSeconds)} />
        <KpiCard label="Abandons" value={data.summary.totalAbandons} hint={`${data.summary.abandonRate}%`} />
      </div>

      <div className={styles.chartCard}>
        <h3 className={styles.chartTitle}>Activity over time</h3>
        {data.overTime.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.overTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6a737b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#6a737b" }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="views" stroke="#0098D0" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="starts" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="submissions" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: "#6a737b", fontSize: "0.85rem" }}>No activity yet in this period.</p>
        )}
      </div>

      {data.byPage.length > 1 ? (
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Funnel by page</h3>
          {data.byPage.map((p) => {
            const pct = maxFunnel > 0 ? (p.completions / maxFunnel) * 100 : 0;
            return (
              <div key={p.pageId} className={styles.funnelRow}>
                <div className={styles.funnelLabel}>{p.pageTitle}</div>
                <div className={styles.funnelBar} style={{ width: `${Math.max(15, pct)}%` }}>
                  {p.completions}
                </div>
                <div className={styles.funnelStat}>
                  {p.views} views • {p.dropRate}% drop
                </div>
              </div>
            );
          })}
          <div className={styles.funnelRow}>
            <div className={styles.funnelLabel} style={{ fontWeight: 700 }}>Submitted</div>
            <div
              className={styles.funnelBar}
              style={{
                width: `${maxFunnel > 0 ? Math.max(15, (data.summary.totalSubmissions / maxFunnel) * 100) : 0}%`,
                background: "linear-gradient(90deg, #10b981, #34d399)",
              }}
            >
              {data.summary.totalSubmissions}
            </div>
            <div className={styles.funnelStat}>{data.summary.conversionRate}% of views</div>
          </div>
        </div>
      ) : null}

      {data.byField.length ? (
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Top field errors</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.byField} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#6a737b" }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#6a737b" }} width={150} />
              <Tooltip />
              <Bar dataKey="errorCount" fill="#B32317" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {data.byPage.length ? (
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Page performance</h3>
          <table className={styles.subTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>Page</th>
                <th>Views</th>
                <th>Completions</th>
                <th>Drop Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.byPage.map((p) => (
                <tr key={p.pageId}>
                  <td>{p.page + 1}</td>
                  <td>{p.pageTitle}</td>
                  <td>{p.views}</td>
                  <td>{p.completions}</td>
                  <td>{p.dropRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data.topReferrers.length ? (
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Top referrers</h3>
          <table className={styles.subTable}>
            <thead>
              <tr>
                <th>Source</th>
                <th>Views</th>
              </tr>
            </thead>
            <tbody>
              {data.topReferrers.map((r) => (
                <tr key={r.referrer}>
                  <td>{r.referrer}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      {hint ? <div className={styles.kpiHint}>{hint}</div> : null}
    </div>
  );
}
