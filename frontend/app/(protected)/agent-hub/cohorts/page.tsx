"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, formatMoney, type Cohort, type HubPermissions } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import styles from "../agentHub.module.css";

function CohortsInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [list, setList] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const body = await agentHubFetch<{ cohorts: Cohort[] }>("/agent-hub/intelligence/cohorts", { authHeaders: authHeaders() });
        setList(body.cohorts);
      } finally {
        setLoading(false);
      }
    })();
  }, [token, authHeaders]);

  const isManager = perms.role === "owner" || perms.role === "manager";

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Cohorts</h1>
          <p className={styles.pageSubtitle}>{list.length} cohort{list.length === 1 ? "" : "s"}</p>
        </div>
        {isManager ? (
          <Link href="/agent-hub/cohorts/new" className={`${styles.btn} ${styles.btnPrimary}`}>+ New Cohort</Link>
        ) : null}
      </div>

      {loading ? <div className={styles.muted}>Loading…</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "0.75rem" }}>
        {list.map((c) => (
          <Link key={c.id} href={`/agent-hub/cohorts/${c.id}`} className={styles.card} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              {c.is_system ? <span style={{ padding: "0.05rem 0.35rem", borderRadius: 4, background: "#eef2f7", color: "#1b2856", fontSize: "0.65rem", fontWeight: 600 }}>SYS</span> : null}
            </div>
            {c.description ? <div className={styles.muted} style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>{c.description}</div> : null}
            {c.metrics ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.4rem", marginTop: "0.6rem", fontSize: "0.78rem" }}>
                <Stat label="Agents" value={c.metrics.total_agents} />
                <Stat label="Conv rate" value={`${c.metrics.conversion_rate_pct}%`} />
                <Stat label="Avg revenue" value={formatMoney(Number(c.metrics.avg_revenue_per_agent))} />
                <Stat label="Retention" value={`${c.metrics.active_retention_pct}%`} />
              </div>
            ) : (
              <div className={styles.muted} style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>Metrics pending…</div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{value}</div>
      <div className={styles.muted} style={{ fontSize: "0.7rem", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

export default function CohortsPage() {
  return <AgentHubGate>{(perms) => <CohortsInner perms={perms} />}</AgentHubGate>;
}
