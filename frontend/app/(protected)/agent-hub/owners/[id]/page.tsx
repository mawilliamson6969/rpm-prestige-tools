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
  type Owner,
  type Property,
  type Referral,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import styles from "../../agentHub.module.css";

type Payload = { owner: Owner; properties: Property[]; referrals: Referral[] };

function OwnerDetailInner({ perms }: { perms: HubPermissions }) {
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
        const body = await agentHubFetch<Payload>(`/agent-hub/owners/${id}`, { authHeaders: authHeaders() });
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
  const o = data.owner;

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/owners" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Owners
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            {o.full_name}
            {o.is_company ? <span className={styles.muted} style={{ fontSize: "1rem", marginLeft: "0.5rem" }}>({o.company_name})</span> : null}
          </h1>
          <p className={styles.pageSubtitle}>
            Status: {o.status}{o.source_agent_id ? ` · Sourced by ` : ""}
            {o.source_agent_id ? (
              <Link href={`/agent-hub/agents/${o.source_agent_id}`} className={styles.linkCell}>
                {o.source_agent_name || "Agent"}
              </Link>
            ) : null}
          </p>
        </div>
      </div>

      <div className={styles.gridTwo}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Contact</div>
          <div className={styles.flexCol} style={{ gap: "0.4rem", fontSize: "0.85rem" }}>
            <Row label="Email" value={o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : null} />
            <Row label="Mobile" value={o.phone_mobile} />
            <Row label="Office" value={o.phone_office} />
            <Row label="Address" value={[o.mailing_address_1, o.city, o.state, o.zip].filter(Boolean).join(", ")} />
            <Row label="First referral" value={o.first_referral_date} />
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Notes</div>
          <div className={styles.muted} style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{o.notes || "—"}</div>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: "1rem" }}>
        <div className={styles.cardTitle}>
          Properties ({data.properties.length})
        </div>
        {data.properties.length === 0 ? (
          <div className={styles.muted}>No properties for this owner yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Address</th><th>Type</th><th>Beds/Baths</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.properties.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/agent-hub/properties/${p.id}`} className={styles.linkCell}>
                      {p.address_1}, {p.city}
                    </Link>
                  </td>
                  <td>{p.property_type || <span className={styles.muted}>—</span>}</td>
                  <td>{p.bedrooms ?? "—"} / {p.bathrooms ?? "—"}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.card} style={{ marginTop: "1rem" }}>
        <div className={styles.cardTitle}>Referrals ({data.referrals.length})</div>
        {data.referrals.length === 0 ? (
          <div className={styles.muted}>No referrals yet.</div>
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
                  {r.property_address ? <span className={styles.muted}> · {r.property_address}</span> : null}
                </div>
                <span
                  style={{
                    padding: "0.1rem 0.4rem",
                    borderRadius: 9999,
                    background: STAGE_META[r.stage].bg,
                    color: STAGE_META[r.stage].fg,
                    fontSize: "0.7rem",
                    fontWeight: 600,
                  }}
                >
                  {STAGE_LABELS[r.stage]}
                </span>
              </div>
              <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                {formatMoney(r.expected_monthly_rent)} expected
              </div>
            </Link>
          ))
        )}
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

export default function OwnerDetailPage() {
  return <AgentHubGate>{(perms) => <OwnerDetailInner perms={perms} />}</AgentHubGate>;
}
