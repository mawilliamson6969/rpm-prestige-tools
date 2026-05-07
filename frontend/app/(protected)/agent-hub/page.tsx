"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import {
  agentHubFetch,
  ACTIVITY_ICONS,
  ACTIVITY_TYPE_LABELS,
  formatMoney,
  relativeTime,
  type AutomationRun,
  type DashboardSummary,
  type FinancialsSummary,
  type HubPermissions,
  type NeedsAttentionAgent,
  type PipelineStats,
  type Postcard,
  type RecentActivity,
  type SystemConfig,
  type Task,
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
  const [pipeline, setPipeline] = useState<PipelineStats | null>(null);
  const [financials, setFinancials] = useState<FinancialsSummary | null>(null);
  const [tasksToday, setTasksToday] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<AutomationRun[]>([]);
  const [pendingPostcards, setPendingPostcards] = useState<Postcard[]>([]);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [repliesPending, setRepliesPending] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    (async () => {
      try {
        const headers = authHeaders();
        const [s, r, u, n, ps, fs, tasks, approval, postcards, cfg, replies] = await Promise.all([
          agentHubFetch<DashboardSummary>("/agent-hub/dashboard", { authHeaders: headers }),
          agentHubFetch<{ activities: RecentActivity[] }>("/agent-hub/dashboard/recent-activity", { authHeaders: headers }),
          agentHubFetch<{ upcoming: UpcomingTouchpoint[] | null; counts?: { total: number } }>(
            "/agent-hub/dashboard/upcoming-touchpoints",
            { authHeaders: headers }
          ),
          agentHubFetch<{ agents: NeedsAttentionAgent[] }>("/agent-hub/dashboard/needs-attention", { authHeaders: headers }),
          agentHubFetch<PipelineStats>("/agent-hub/pipeline/stats", { authHeaders: headers }).catch(() => null),
          agentHubFetch<FinancialsSummary>("/agent-hub/financials/summary", { authHeaders: headers }).catch(() => null),
          agentHubFetch<{ tasks: Task[] }>("/agent-hub/tasks?assigned_to=me&status=pending", { authHeaders: headers }).catch(() => ({ tasks: [] })),
          agentHubFetch<{ runs: AutomationRun[] }>("/agent-hub/approval-queue", { authHeaders: headers }).catch(() => ({ runs: [] })),
          agentHubFetch<{ postcards: Postcard[] }>("/agent-hub/postcard-queue?status=pending", { authHeaders: headers }).catch(() => ({ postcards: [] })),
          agentHubFetch<{ config: SystemConfig }>("/agent-hub/system-config", { authHeaders: headers }).catch(() => ({ config: null as SystemConfig | null })),
          agentHubFetch<{ replies: { still_flagged: boolean }[] }>("/agent-hub/replies", { authHeaders: headers }).catch(() => ({ replies: [] })),
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
        setPipeline(ps);
        setFinancials(fs);
        setTasksToday(tasks.tasks);
        setApprovals(approval.runs);
        setPendingPostcards(postcards.postcards);
        setSystemConfig(cfg.config);
        setRepliesPending(replies.replies.filter((r) => r.still_flagged).length);
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

      {systemConfig?.kill_switch_enabled ? (
        <div className={styles.error} style={{ marginBottom: "1rem", background: "#fee2e2" }}>
          🔴 Kill switch is ENGAGED. All automated sends are paused.{" "}
          <Link href="/agent-hub/system-config" className={styles.linkCell}>System Config →</Link>
        </div>
      ) : null}

      {summary ? (
        <div className={styles.statGrid}>
          <StatCard label="Total Agents" value={summary.total} href="/agent-hub/agents" />
          <StatCard label="Active Pipeline" value={pipeline?.total_in_pipeline ?? 0} href="/agent-hub/pipeline" />
          <StatCard label="Approval Queue" value={approvals.length} href="/agent-hub/approval-queue" highlight={approvals.length > 0} />
          <StatCard label="Replies pending" value={repliesPending} href="/agent-hub/replies" highlight={repliesPending > 0} />
          <StatCard label="Postcards queued" value={pendingPostcards.length} href="/agent-hub/print-queue" />
          <StatCard label="Tasks due" value={tasksToday.length} href="/agent-hub/tasks" highlight={tasksToday.some((t) => t.priority === "urgent")} />
          <StatCard label="MTD fees" value={formatMoney(financials?.mtd_fees_paid)} href="/agent-hub/financials" />
          <StatCard label="Interactions (7d)" value={summary.interactions_7d} />
          <StatCard label="Needs Attention" value={summary.needs_attention} highlight={summary.needs_attention > 0} />
        </div>
      ) : null}

      {tasksToday.length > 0 ? (
        <div className={styles.card} style={{ marginBottom: "1rem" }}>
          <div className={styles.cardTitle}>
            Tasks due
            <Link href="/agent-hub/tasks" className={styles.btnGhost} style={{ fontSize: "0.78rem" }}>
              View all →
            </Link>
          </div>
          {tasksToday.slice(0, 5).map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0", borderBottom: "1px solid #f3f4f6" }}>
              <span style={{ flex: 1, fontSize: "0.9rem" }}>{t.title}</span>
              <span className={styles.muted} style={{ fontSize: "0.78rem" }}>
                {t.due_date || "—"} · {t.priority}
              </span>
            </div>
          ))}
          {tasksToday.length > 5 ? (
            <div className={styles.muted} style={{ fontSize: "0.78rem", marginTop: "0.4rem" }}>
              +{tasksToday.length - 5} more
            </div>
          ) : null}
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
