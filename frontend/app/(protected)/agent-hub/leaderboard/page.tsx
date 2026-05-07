"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import {
  agentHubFetch,
  formatMoney,
  TIER_META,
  type HubPermissions,
  type Tier,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Avatar } from "../components";
import styles from "../agentHub.module.css";

type Row = {
  rank: number;
  agent_id: number;
  full_name: string;
  brokerage_name: string | null;
  tier: Tier;
  photo_url: string | null;
  metric_value: number;
};

const TABS: Array<{ key: string; label: string }> = [
  { key: "score", label: "Top Engagement Scores" },
  { key: "engagement_growth", label: "Biggest Score Improvers" },
  { key: "referrals", label: "Most Referrals" },
  { key: "fees_paid", label: "Highest Fees Paid" },
  { key: "revenue", label: "Highest Revenue Generated" },
];

function LeaderboardInner({ perms: _perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [metric, setMetric] = useState("score");
  const [range, setRange] = useState("all_time");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const sp = new URLSearchParams();
        sp.set("metric", metric);
        sp.set("range", range);
        sp.set("limit", "20");
        const body = await agentHubFetch<{ leaderboard: Row[] }>(`/agent-hub/intelligence/leaderboard?${sp}`, {
          authHeaders: authHeaders(),
        });
        if (cancel) return;
        setRows(body.leaderboard);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, authHeaders, metric, range]);

  function formatMetric(v: number): string {
    if (metric === "score" || metric === "engagement_growth" || metric === "referrals") {
      return metric === "engagement_growth" && v > 0 ? `+${v}` : String(v);
    }
    return formatMoney(v);
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Leaderboard</h1>
          <p className={styles.pageSubtitle}>Top performers by metric and time range.</p>
        </div>
      </div>

      <div className={styles.row} style={{ flexWrap: "wrap", gap: "0.3rem", marginBottom: "1rem" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`${styles.btn} ${metric === t.key ? styles.btnPrimary : ""}`}
            onClick={() => setMetric(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!["score", "engagement_growth"].includes(metric) ? (
        <div className={styles.filterBar}>
          <select className={styles.select} value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="all_time">All time</option>
            <option value="ytd">Year to date</option>
            <option value="mtd">Month to date</option>
            <option value="last_30">Last 30 days</option>
            <option value="last_90">Last 90 days</option>
          </select>
        </div>
      ) : null}

      {loading ? <div className={styles.muted}>Loading…</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Agent</th>
              <th>Brokerage</th>
              <th>Tier</th>
              <th style={{ textAlign: "right" }}>{TABS.find((t) => t.key === metric)?.label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr><td colSpan={5} className={styles.empty}>No data.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.agent_id}>
                  <td>{r.rank}</td>
                  <td>
                    <Link href={`/agent-hub/agents/${r.agent_id}`} className={styles.row} style={{ textDecoration: "none", color: "inherit" }}>
                      <Avatar agent={{ full_name: r.full_name, photo_url: r.photo_url }} size={32} />
                      <span className={styles.linkCell} style={{ marginLeft: "0.4rem" }}>{r.full_name}</span>
                    </Link>
                  </td>
                  <td>{r.brokerage_name || "—"}</td>
                  <td>
                    <span style={{ padding: "0.05rem 0.35rem", borderRadius: 9999, background: TIER_META[r.tier].bg, color: TIER_META[r.tier].fg, fontSize: "0.65rem", fontWeight: 600 }}>
                      {TIER_META[r.tier].label}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{formatMetric(r.metric_value)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  return <AgentHubGate>{(perms) => <LeaderboardInner perms={perms} />}</AgentHubGate>;
}
