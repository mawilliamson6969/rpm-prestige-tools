"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import {
  agentHubFetch,
  relativeTime,
  type Brokerage,
  type HubPermissions,
  type Tier,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { TierBadge } from "../../components";
import styles from "../../agentHub.module.css";

type Payload = {
  brokerage: Brokerage;
  agents: { id: number; full_name: string; tier: Tier; status: string; last_interaction_date: string | null }[];
};

function BrokerageDetailInner({ perms }: { perms: HubPermissions }) {
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
        const body = await agentHubFetch<Payload>(`/agent-hub/brokerages/${id}`, { authHeaders: authHeaders() });
        setData(body);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, id, authHeaders]);

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (err) return <div className={styles.shell}><div className={styles.error}>{err}</div></div>;
  if (!data) return null;

  const { brokerage: b, agents } = data;
  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/brokerages" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Brokerages
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{b.name}</h1>
          <p className={styles.pageSubtitle}>
            {[b.city, b.state, b.zip].filter(Boolean).join(", ") || "—"} · {agents.length} agent{agents.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className={styles.gridTwo}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Brokerage info</div>
          <div className={styles.flexCol} style={{ gap: "0.4rem", fontSize: "0.85rem" }}>
            <Row label="Address" value={[b.address_1, b.address_2, b.city, b.state, b.zip].filter(Boolean).join(", ")} />
            <Row label="Phone" value={b.phone} />
            <Row label="Website" value={b.website ? <a href={b.website} target="_blank" rel="noreferrer">{b.website}</a> : null} />
            <Row label="MLS office id" value={b.mls_office_id} />
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Notes</div>
          <div className={styles.muted} style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{b.notes || "—"}</div>
        </div>
      </div>

      <div className={styles.tableWrap} style={{ marginTop: "1rem" }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Last interaction</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr><td colSpan={4} className={styles.empty}>No agents at this brokerage.</td></tr>
            ) : (
              agents.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/agent-hub/agents/${a.id}`} className={styles.linkCell}>{a.full_name}</Link></td>
                  <td><TierBadge tier={a.tier} /></td>
                  <td>{a.status}</td>
                  <td>{relativeTime(a.last_interaction_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <span style={{ minWidth: 100, color: "#6a737b", fontSize: "0.78rem", textTransform: "uppercase" }}>{label}</span>
      <span style={{ flex: 1 }}>{value || <span style={{ color: "#9ca3af" }}>—</span>}</span>
    </div>
  );
}

export default function BrokerageDetailPage() {
  return <AgentHubGate>{(perms) => <BrokerageDetailInner perms={perms} />}</AgentHubGate>;
}
