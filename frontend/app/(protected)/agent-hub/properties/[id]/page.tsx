"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import {
  agentHubFetch,
  formatMoney,
  STAGE_LABELS,
  STAGE_META,
  type HubPermissions,
  type Property,
  type Referral,
  type Revenue,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import styles from "../../agentHub.module.css";

type Payload = { property: Property; referrals: Referral[]; revenue: Revenue[] };

function PropertyDetailInner({ perms }: { perms: HubPermissions }) {
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
        const body = await agentHubFetch<Payload>(`/agent-hub/properties/${id}`, { authHeaders: authHeaders() });
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
  const p = data.property;

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/properties" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Properties
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{p.address_1}</h1>
          <p className={styles.pageSubtitle}>
            {[p.address_2, p.city, p.state, p.zip].filter(Boolean).join(", ")}
            {p.owner_id ? <> · Owner: <Link href={`/agent-hub/owners/${p.owner_id}`} className={styles.linkCell}>{p.owner_name}</Link></> : null}
          </p>
        </div>
      </div>

      <div className={styles.gridTwo}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Details</div>
          <div className={styles.flexCol} style={{ gap: "0.4rem", fontSize: "0.85rem" }}>
            <Row label="Type" value={p.property_type} />
            <Row label="Beds / Baths" value={`${p.bedrooms ?? "—"} / ${p.bathrooms ?? "—"}`} />
            <Row label="Square feet" value={p.square_feet} />
            <Row label="Year built" value={p.year_built} />
            <Row label="Status" value={p.status} />
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Notes</div>
          <div className={styles.muted} style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{p.notes || "—"}</div>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: "1rem" }}>
        <div className={styles.cardTitle}>Referral history ({data.referrals.length})</div>
        {data.referrals.length === 0 ? (
          <div className={styles.muted}>No referrals on this property yet.</div>
        ) : (
          data.referrals.map((r) => (
            <Link
              key={r.id}
              href={`/agent-hub/pipeline/${r.id}`}
              style={{ display: "block", padding: "0.5rem 0", borderBottom: "1px solid #f3f4f6", textDecoration: "none", color: "inherit" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <strong>{r.agent_name}</strong>
                  <span className={styles.muted}> · {new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <span style={{ padding: "0.1rem 0.4rem", borderRadius: 9999, background: STAGE_META[r.stage].bg, color: STAGE_META[r.stage].fg, fontSize: "0.7rem", fontWeight: 600 }}>
                  {STAGE_LABELS[r.stage]}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>

      <div className={styles.card} style={{ marginTop: "1rem" }}>
        <div className={styles.cardTitle}>Revenue (last 12 months)</div>
        {data.revenue.length === 0 ? (
          <div className={styles.muted}>No revenue logged.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Month</th><th>Rent collected</th><th>Mgmt fee</th></tr>
            </thead>
            <tbody>
              {data.revenue.map((rv) => (
                <tr key={rv.id}>
                  <td>{rv.month?.slice(0, 7)}</td>
                  <td>{formatMoney(rv.rent_collected)}</td>
                  <td>{formatMoney(rv.management_fee_earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <span style={{ minWidth: 110, color: "#6a737b", fontSize: "0.78rem", textTransform: "uppercase" }}>{label}</span>
      <span style={{ flex: 1 }}>{value || <span style={{ color: "#9ca3af" }}>—</span>}</span>
    </div>
  );
}

export default function PropertyDetailPage() {
  return <AgentHubGate>{(perms) => <PropertyDetailInner perms={perms} />}</AgentHubGate>;
}
