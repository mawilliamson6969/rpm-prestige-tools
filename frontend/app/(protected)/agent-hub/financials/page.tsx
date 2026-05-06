"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import {
  agentHubFetch,
  formatMoney,
  STAGE_LABELS,
  type FinancialsSummary,
  type HubPermissions,
  type PipelineStats,
  type Stage,
  STAGE_META,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { StatCard, Toast } from "../components";
import styles from "../agentHub.module.css";

type LeaderboardRow = {
  agent_id: number;
  full_name: string;
  brokerage_name: string | null;
  tier: string;
  total_referrals_received: number;
  total_referrals_converted: number;
  conversion_rate_pct: number;
  total_referral_fees_paid: number;
  total_revenue_generated: number;
  lifetime_relationship_value: number;
};

type MonthlyPoint = { month: string; fees: number; revenue: number; net_margin: number };

function FinancialsInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [summary, setSummary] = useState<FinancialsSummary | null>(null);
  const [pipeline, setPipeline] = useState<PipelineStats | null>(null);
  const [byMonth, setByMonth] = useState<MonthlyPoint[]>([]);
  const [leaderboardFees, setLeaderboardFees] = useState<LeaderboardRow[]>([]);
  const [leaderboardRevenue, setLeaderboardRevenue] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    (async () => {
      try {
        const headers = authHeaders();
        const [s, ps, m, lf, lr] = await Promise.all([
          agentHubFetch<FinancialsSummary>("/agent-hub/financials/summary", { authHeaders: headers }),
          agentHubFetch<PipelineStats>("/agent-hub/pipeline/stats", { authHeaders: headers }),
          agentHubFetch<{ months: number; series: MonthlyPoint[] }>("/agent-hub/financials/by-month?months=24", { authHeaders: headers }),
          agentHubFetch<{ leaderboard: LeaderboardRow[] }>("/agent-hub/financials/leaderboard?sort_by=fees&limit=20", { authHeaders: headers }),
          agentHubFetch<{ leaderboard: LeaderboardRow[] }>("/agent-hub/financials/leaderboard?sort_by=revenue&limit=20", { authHeaders: headers }),
        ]);
        if (cancel) return;
        setSummary(s);
        setPipeline(ps);
        setByMonth(m.series);
        setLeaderboardFees(lf.leaderboard);
        setLeaderboardRevenue(lr.leaderboard);
      } catch (e) {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : "Could not load financials.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, authHeaders]);

  function exportCsv() {
    if (!perms.can_export) {
      setToast({ msg: "No export permission.", variant: "error" });
      return;
    }
    fetch(apiUrl("/agent-hub/financials/export.csv"), { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `agent-hub-financials-${Date.now()}.csv`;
        a.click();
      })
      .catch((e) => setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" }));
  }

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (err) return <div className={styles.shell}><div className={styles.error}>{err}</div></div>;

  // Find chart bounds for simple SVG
  const maxVal = Math.max(
    1,
    ...byMonth.map((p) => Math.max(p.fees, p.revenue))
  );
  const chartW = 720;
  const chartH = 200;
  const xStep = byMonth.length > 1 ? chartW / (byMonth.length - 1) : 0;
  const y = (v: number) => chartH - (v / maxVal) * chartH;

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Financials</h1>
          <p className={styles.pageSubtitle}>Lifetime referral fees, revenue, and net margin</p>
        </div>
        {perms.can_export ? (
          <button className={styles.btn} onClick={exportCsv}>⬇ Export</button>
        ) : null}
      </div>

      {summary ? (
        <div className={styles.statGrid}>
          <StatCard label="Lifetime fees paid" value={formatMoney(summary.lifetime_fees_paid)} />
          <StatCard label="YTD fees" value={formatMoney(summary.ytd_fees_paid)} />
          <StatCard label="MTD fees" value={formatMoney(summary.mtd_fees_paid)} />
          <StatCard label="Lifetime revenue" value={formatMoney(summary.lifetime_revenue_generated)} />
          <StatCard label="Net margin" value={formatMoney(summary.net_margin)} highlight={summary.net_margin < 0} />
          <StatCard label="ROI" value={summary.roi_ratio != null ? `${summary.roi_ratio}×` : "—"} />
        </div>
      ) : null}

      <div className={styles.card} style={{ marginBottom: "1rem" }}>
        <div className={styles.cardTitle}>Monthly fees + revenue (last 24 months)</div>
        {byMonth.length === 0 ? (
          <div className={styles.muted}>No financial activity yet.</div>
        ) : (
          <svg viewBox={`0 0 ${chartW + 40} ${chartH + 40}`} style={{ width: "100%", height: "auto" }}>
            <g transform="translate(20, 20)">
              {/* Fees line */}
              <polyline
                fill="none"
                stroke="#b91c1c"
                strokeWidth={2}
                points={byMonth.map((p, i) => `${i * xStep},${y(p.fees)}`).join(" ")}
              />
              {/* Revenue line */}
              <polyline
                fill="none"
                stroke="#16a34a"
                strokeWidth={2}
                points={byMonth.map((p, i) => `${i * xStep},${y(p.revenue)}`).join(" ")}
              />
              {byMonth.map((p, i) => (
                <g key={p.month}>
                  <circle cx={i * xStep} cy={y(p.fees)} r={3} fill="#b91c1c" />
                  <circle cx={i * xStep} cy={y(p.revenue)} r={3} fill="#16a34a" />
                </g>
              ))}
            </g>
          </svg>
        )}
        <div className={styles.row} style={{ gap: "1rem", fontSize: "0.85rem", marginTop: "0.5rem" }}>
          <span><span style={{ color: "#b91c1c", fontWeight: 700 }}>━</span> Fees paid</span>
          <span><span style={{ color: "#16a34a", fontWeight: 700 }}>━</span> Revenue generated</span>
        </div>
      </div>

      <div className={styles.card} style={{ marginBottom: "1rem" }}>
        <div className={styles.cardTitle}>Pipeline value by stage</div>
        {pipeline?.by_stage.length ? (
          <table className={styles.table}>
            <thead>
              <tr><th>Stage</th><th>Count</th><th>Expected first-month fees</th><th>Expected MRR</th><th>Avg days</th></tr>
            </thead>
            <tbody>
              {pipeline.by_stage.map((s) => (
                <tr key={s.stage}>
                  <td>
                    <span style={{ padding: "0.1rem 0.4rem", borderRadius: 9999, background: STAGE_META[s.stage as Stage].bg, color: STAGE_META[s.stage as Stage].fg, fontSize: "0.72rem", fontWeight: 600 }}>
                      {STAGE_LABELS[s.stage as Stage]}
                    </span>
                  </td>
                  <td>{s.count}</td>
                  <td>{formatMoney(s.expected_fees)}</td>
                  <td>{formatMoney(s.expected_mrr)}</td>
                  <td>{s.avg_days_in_stage != null ? `${s.avg_days_in_stage}d` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className={styles.muted}>No active referrals.</div>}
      </div>

      <div className={styles.gridTwo}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Top by fees paid</div>
          <Leaderboard rows={leaderboardFees} sortKey="total_referral_fees_paid" />
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Top by revenue generated</div>
          <Leaderboard rows={leaderboardRevenue} sortKey="total_revenue_generated" />
        </div>
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Leaderboard({ rows, sortKey }: { rows: LeaderboardRow[]; sortKey: keyof LeaderboardRow }) {
  if (rows.length === 0) {
    return <div className={styles.muted}>No data.</div>;
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr><th>Agent</th><th>Refs</th><th>Conv %</th><th>{sortKey === "total_referral_fees_paid" ? "Fees" : "Revenue"}</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.agent_id}>
            <td>
              <Link href={`/agent-hub/agents/${r.agent_id}`} className={styles.linkCell}>
                {r.full_name}
              </Link>
              <div className={styles.muted} style={{ fontSize: "0.75rem" }}>{r.brokerage_name || "—"}</div>
            </td>
            <td>{r.total_referrals_received}</td>
            <td>{Number(r.conversion_rate_pct || 0)}%</td>
            <td>{formatMoney(Number(r[sortKey] || 0))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FinancialsPage() {
  return <AgentHubGate>{(perms) => <FinancialsInner perms={perms} />}</AgentHubGate>;
}
