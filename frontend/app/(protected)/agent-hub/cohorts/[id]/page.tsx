"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import {
  agentHubFetch,
  formatMoney,
  relativeTime,
  TIER_META,
  type Cohort,
  type HubPermissions,
  type Tier,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import styles from "../../agentHub.module.css";

type Payload = {
  cohort: Cohort;
  agents: Array<{
    id: number;
    full_name: string;
    tier: Tier;
    status: string;
    brokerage_name: string | null;
    last_interaction_date: string | null;
    total_referrals_received: number | null;
    total_revenue_generated: number | null;
  }>;
};

function CohortDetailInner({ perms }: { perms: HubPermissions }) {
  const params = useParams();
  const id = Number(params?.id);
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    (async () => {
      try {
        const body = await agentHubFetch<Payload>(`/agent-hub/intelligence/cohorts/${id}`, { authHeaders: authHeaders() });
        setData(body);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, id, authHeaders]);

  async function deleteCohort() {
    if (!data || data.cohort.is_system) return;
    if (!confirm(`Delete cohort "${data.cohort.name}"?`)) return;
    try {
      await agentHubFetch(`/agent-hub/intelligence/cohorts/${id}`, { method: "DELETE", authHeaders: authHeaders() });
      window.location.href = "/agent-hub/cohorts";
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  const isManager = perms.role === "owner" || perms.role === "manager";

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (err) return <div className={styles.shell}><div className={styles.error}>{err}</div></div>;
  if (!data) return null;

  const c = data.cohort;
  const m = c.metrics;

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/cohorts" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Cohorts
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{c.name}</h1>
          <p className={styles.pageSubtitle}>
            {c.description}
            {m?.calculated_at ? ` · metrics ${relativeTime(m.calculated_at)}` : ""}
          </p>
        </div>
        <div className={styles.row}>
          {isManager && !c.is_system ? (
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={deleteCohort}>Delete</button>
          ) : null}
        </div>
      </div>

      <div className={styles.card} style={{ marginBottom: "1rem" }}>
        <div className={styles.cardTitle}>Definition</div>
        <pre style={{ background: "#f9fafb", padding: "0.6rem", borderRadius: 8, fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(c.definition, null, 2)}
        </pre>
      </div>

      {m ? (
        <>
          <div className={styles.statGrid}>
            <Stat label="Total agents" value={m.total_agents} />
            <Stat label="Conversion rate" value={`${m.conversion_rate_pct}%`} />
            <Stat label="Avg referrals/agent" value={Number(m.avg_referrals_per_agent).toFixed(1)} />
            <Stat label="Avg revenue/agent" value={formatMoney(Number(m.avg_revenue_per_agent))} />
            <Stat label="Avg fees/agent" value={formatMoney(Number(m.avg_fees_per_agent))} />
            <Stat label="Active retention" value={`${m.active_retention_pct}%`} />
            <Stat label="Median time to first referral" value={m.avg_days_to_first_referral != null ? `${m.avg_days_to_first_referral}d` : "—"} />
          </div>

          <div className={styles.card} style={{ marginBottom: "1rem" }}>
            <div className={styles.cardTitle}>Tier distribution</div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {Object.entries(m.tier_distribution).map(([tier, n]) => {
                const total = m.total_agents || 1;
                const pct = (Number(n) / total) * 100;
                return (
                  <div
                    key={tier}
                    title={`${tier}: ${n}`}
                    style={{
                      flex: pct,
                      background: TIER_META[tier as Tier]?.bg || "#e5e7eb",
                      color: TIER_META[tier as Tier]?.fg || "#374151",
                      padding: "0.5rem 0.4rem",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      textAlign: "center",
                      borderRadius: 6,
                    }}
                  >
                    {tier} ({n})
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className={styles.placeholderBox}>Metrics pending — run nightly to populate.</div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Agent</th><th>Tier</th><th>Status</th><th>Referrals</th><th>Revenue</th></tr>
          </thead>
          <tbody>
            {data.agents.length === 0 ? (
              <tr><td colSpan={5} className={styles.empty}>No agents in cohort.</td></tr>
            ) : (
              data.agents.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/agent-hub/agents/${a.id}`} className={styles.linkCell}>{a.full_name}</Link></td>
                  <td>{a.tier}</td>
                  <td>{a.status}</td>
                  <td>{a.total_referrals_received ?? 0}</td>
                  <td>{formatMoney(Number(a.total_revenue_generated || 0))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

export default function CohortDetailPage() {
  return <AgentHubGate>{(perms) => <CohortDetailInner perms={perms} />}</AgentHubGate>;
}
