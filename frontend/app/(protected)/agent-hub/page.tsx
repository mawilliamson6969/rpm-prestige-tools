"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import {
  agentHubFetch,
  ACTIVITY_ICONS,
  ACTIVITY_TYPE_LABELS,
  relativeTime,
  type DashboardSummary,
  type HubPermissions,
  type NeedsAttentionAgent,
  type RecentActivity,
  type UpcomingTouchpoint,
} from "../../../lib/agentHub";
import AgentHubGate from "./AgentHubGate";
import { StatCard, TierBadge } from "./components";
import styles from "./agentHub.module.css";

function DashboardInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recent, setRecent] = useState<RecentActivity[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingTouchpoint[] | null>(null);
  const [upcomingCount, setUpcomingCount] = useState<number | null>(null);
  const [needs, setNeeds] = useState<NeedsAttentionAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    (async () => {
      try {
        const headers = authHeaders();
        const [s, r, u, n] = await Promise.all([
          agentHubFetch<DashboardSummary>("/agent-hub/dashboard", { authHeaders: headers }),
          agentHubFetch<{ activities: RecentActivity[] }>("/agent-hub/dashboard/recent-activity", { authHeaders: headers }),
          agentHubFetch<{ upcoming: UpcomingTouchpoint[] | null; counts?: { total: number } }>(
            "/agent-hub/dashboard/upcoming-touchpoints",
            { authHeaders: headers }
          ),
          agentHubFetch<{ agents: NeedsAttentionAgent[] }>("/agent-hub/dashboard/needs-attention", { authHeaders: headers }),
        ]);
        if (cancel) return;
        setSummary(s);
        setRecent(r.activities);
        if (u.upcoming) {
          setUpcoming(u.upcoming);
        } else {
          setUpcoming(null);
          setUpcomingCount(u.counts?.total ?? 0);
        }
        setNeeds(n.agents);
      } catch (e) {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : "Failed to load dashboard.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, authHeaders]);

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (err) return <div className={styles.shell}><div className={styles.error}>{err}</div></div>;

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Agent Hub</h1>
          <p className={styles.pageSubtitle}>
            Real estate agent referral CRM · {summary?.total ?? 0} agents
            {perms.role !== "team" ? ` · ${perms.role}` : ""}
          </p>
        </div>
        <div className={styles.row}>
          <Link href="/agent-hub/search" className={styles.btn}>🔍 Search</Link>
          <Link href="/agent-hub/agents/new" className={`${styles.btn} ${styles.btnPrimary}`}>+ Add Agent</Link>
        </div>
      </div>

      {summary ? (
        <div className={styles.statGrid}>
          <StatCard label="Total" value={summary.total} href="/agent-hub/agents" />
          <StatCard label="VIP + Partner" value={summary.vip + summary.partner} href="/agent-hub/agents?tier=partner" />
          <StatCard label="Warm" value={summary.warm} href="/agent-hub/agents?tier=warm" />
          <StatCard label="Prospect" value={summary.prospect} href="/agent-hub/agents?tier=prospect" />
          <StatCard label="Cold" value={summary.cold} href="/agent-hub/agents?tier=cold" />
          <StatCard label="Dormant" value={summary.dormant} href="/agent-hub/agents?tier=dormant" />
          <StatCard label="DNC" value={summary.dnc} />
          <StatCard label="Interactions (7d)" value={summary.interactions_7d} />
          <StatCard label="Needs Attention" value={summary.needs_attention} highlight={summary.needs_attention > 0} />
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Upcoming Touchpoints (30 days)</div>
          {upcoming === null ? (
            <div className={styles.placeholderBox}>
              {upcomingCount != null && upcomingCount > 0
                ? `${upcomingCount} dates this month — visible to users with personal-details access.`
                : "No upcoming touchpoints. (Personal-details access not granted.)"}
            </div>
          ) : upcoming.length === 0 ? (
            <div className={styles.empty}>Nothing in the next 30 days.</div>
          ) : (
            <div>
              {upcoming.map((u, i) => (
                <Link
                  key={`${u.id}-${u.kind}-${i}`}
                  href={`/agent-hub/agents/${u.id}`}
                  className={styles.row}
                  style={{ padding: "0.4rem 0", textDecoration: "none", color: "inherit", borderBottom: "1px solid #f3f4f6" }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, color: "#1b2856" }}>
                      {u.kind === "spouse_birthday" ? `${u.related_name || "Spouse"} (${u.full_name})` : u.full_name}
                    </div>
                    <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                      {u.kind.replace("_", " ")} · in {u.days_until} day{u.days_until === 1 ? "" : "s"}
                    </div>
                  </div>
                  <TierBadge tier={u.tier} />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Needs Attention</div>
          {needs.length === 0 ? (
            <div className={styles.empty}>Nothing waiting. Nice work.</div>
          ) : (
            <div>
              {needs.slice(0, 10).map((a) => (
                <Link
                  key={a.id}
                  href={`/agent-hub/agents/${a.id}`}
                  className={styles.row}
                  style={{ padding: "0.4rem 0", textDecoration: "none", color: "inherit", borderBottom: "1px solid #f3f4f6" }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, color: "#1b2856" }}>{a.full_name}</div>
                    <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                      {a.brokerage_name || "—"} · {a.last_interaction_date ? `${a.days_since}d since contact` : "Never contacted"}
                    </div>
                  </div>
                  <TierBadge tier={a.tier} />
                </Link>
              ))}
              {needs.length > 10 ? (
                <Link href="/agent-hub/agents?tier=warm" className={styles.muted} style={{ display: "block", marginTop: "0.5rem", fontSize: "0.85rem" }}>
                  See all {needs.length} →
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Recent Activity (7 days)</div>
        {recent.length === 0 ? (
          <div className={styles.empty}>No activity yet. Log an interaction on any agent.</div>
        ) : (
          <div>
            {recent.map((a) => (
              <Link
                key={a.id}
                href={`/agent-hub/agents/${a.agent_id}`}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0", borderBottom: "1px solid #f3f4f6", textDecoration: "none", color: "inherit" }}
              >
                <span style={{ fontSize: "1.2rem" }} aria-hidden>{ACTIVITY_ICONS[a.type]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.9rem", color: "#1f2937" }}>
                    <strong>{a.agent_name}</strong> · {ACTIVITY_TYPE_LABELS[a.type]}
                    {a.subject ? ` — ${a.subject}` : a.summary ? ` — ${a.summary.slice(0, 100)}` : ""}
                  </div>
                  <div className={styles.muted} style={{ fontSize: "0.75rem" }}>
                    {relativeTime(a.occurred_at)}{a.logged_by_name ? ` by ${a.logged_by_name}` : ""}
                  </div>
                </div>
                <TierBadge tier={a.agent_tier} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentHubDashboardPage() {
  return <AgentHubGate>{(perms) => <DashboardInner perms={perms} />}</AgentHubGate>;
}
