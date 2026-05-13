"use client";

// Analytics view — Phase A.
//
// Source: design/shared-inbox-ux-and-ui/project/screens.jsx lines 189–346
// (AnalyticsView). Renders inside the InboxShell main pane. Permission-
// gated server-side (reports.view) — the hook surfaces a `forbidden`
// flag when any endpoint returns 403, and we render a friendly notice
// in place of the data.

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import useAnalytics, { type AnalyticsWindow } from "../../../hooks/inbox/useAnalytics";
import { avatarColor, avatarInitials } from "../conversation/chips";
import VolumeChart from "./VolumeChart";
import ChannelDonut from "./ChannelDonut";
import Sparkline from "./Sparkline";
import styles from "./analytics.module.css";

const WINDOWS: { key: AnalyticsWindow; label: string }[] = [
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "ytd", label: "YTD" },
];

const MAILBOX_COLORS = ["#1565c0", "#2e7d32", "#6a1b9a", "#e65100", "#00897b"];

function mailboxDotColor(id: number): string {
  return MAILBOX_COLORS[Math.abs(id) % MAILBOX_COLORS.length];
}

function formatDurationFromSeconds(s: number | null): string {
  if (s == null) return "—";
  const m = Math.max(0, Math.round(s / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function formatDeltaSeconds(now: number | null, prior: number | null): {
  text: string;
  dir: "pos" | "neg" | "neutral";
} {
  if (now == null || prior == null) return { text: "—", dir: "neutral" };
  const diff = now - prior;
  const abs = Math.abs(diff);
  const formatted = formatDurationFromSeconds(abs);
  if (abs < 60) return { text: "no change", dir: "neutral" };
  // Faster reply = positive ("pos"). Faster resolution = positive too.
  return { text: formatted, dir: diff < 0 ? "pos" : "neg" };
}

function formatDeltaCount(now: number | null, prior: number | null): {
  text: string;
  dir: "pos" | "neg" | "neutral";
} {
  if (now == null || prior == null) return { text: "—", dir: "neutral" };
  const diff = now - prior;
  if (diff === 0) return { text: "0", dir: "neutral" };
  return {
    text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`,
    dir: diff > 0 ? "pos" : "neg",
  };
}

function formatDeltaPct(now: number | null, prior: number | null): {
  text: string;
  dir: "pos" | "neg" | "neutral";
} {
  if (now == null || prior == null) return { text: "—", dir: "neutral" };
  const diff = now - prior;
  if (diff === 0) return { text: "0pp", dir: "neutral" };
  return {
    text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)}pp`,
    dir: diff > 0 ? "pos" : "neg",
  };
}

export default function AnalyticsClient() {
  const { user } = useAuth();
  const [window, setWindowState] = useState<AnalyticsWindow>("14d");
  const data = useAnalytics(window);

  // Client-side gate. The same check is enforced server-side; this just
  // avoids firing five 403s on every render for staff users.
  const hasReportsView = useMemo(() => {
    const perms = user?.permissions ?? [];
    return perms.includes("all") || perms.includes("reports.view");
  }, [user]);

  const onExport = useCallback(() => {
    const rows: string[] = [];
    rows.push(`# Inbox analytics export — window=${window}`);
    rows.push("");
    if (data.kpis) {
      rows.push("KPI,value,prior");
      rows.push(`Open conversations,${data.kpis.openConversations.value ?? ""},${data.kpis.openConversations.prior ?? ""}`);
      rows.push(`Median first reply (sec),${data.kpis.medianFirstReplySeconds.value ?? ""},${data.kpis.medianFirstReplySeconds.prior ?? ""}`);
      rows.push(`Median resolution (sec),${data.kpis.medianResolutionSeconds.value ?? ""},${data.kpis.medianResolutionSeconds.prior ?? ""}`);
      rows.push(`SLA hit %,${data.kpis.slaHitPct.value ?? ""},${data.kpis.slaHitPct.prior ?? ""}`);
      rows.push(`Conversations / day,${data.kpis.conversationsPerDay.value ?? ""},${data.kpis.conversationsPerDay.prior ?? ""}`);
      rows.push(`CSAT,${data.kpis.csat.value ?? "not configured"},${data.kpis.csat.prior ?? ""}`);
      rows.push("");
    }
    rows.push("Volume");
    rows.push("date,received,resolved");
    for (const p of data.volume) rows.push(`${p.date},${p.received},${p.resolved}`);
    rows.push("");
    rows.push("Channel mix");
    rows.push("channel,count,pct");
    for (const c of data.channels.channels) rows.push(`${c.channel},${c.count},${c.pct}`);
    rows.push("");
    rows.push("Team load");
    rows.push("user,open,resolved_7d");
    for (const t of data.teamLoad) {
      rows.push(`${t.displayName.replace(/,/g, " ")},${t.openCount},${t.resolvedCount}`);
    }
    rows.push("");
    rows.push("Inbox health");
    rows.push("mailbox,open,sla_hit_pct,median_first_reply_sec");
    for (const m of data.inboxHealth) {
      rows.push(
        `${(m.name || "").replace(/,/g, " ")},${m.openCount},${m.slaHitPct ?? ""},${m.medianFirstReplySeconds ?? ""}`
      );
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inbox-analytics-${window}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data, window]);

  if (!hasReportsView) {
    return (
      <div className={styles.page}>
        <div className={styles.pageHd}>
          <div>
            <div className={styles.pageEyebrow}>Workspace · all inboxes</div>
            <h1 className={styles.pageTitle}>Analytics</h1>
          </div>
        </div>
        <div className={styles.empty}>
          <div className={styles.emptyInner}>
            <h2 className={styles.emptyTitle}>You don't have access to analytics</h2>
            <p className={styles.emptySub}>
              Inbox analytics requires the <code>reports.view</code> permission. Ask an admin
              to update your role if you should see this view.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHd}>
        <div>
          <div className={styles.pageEyebrow}>Workspace · all inboxes</div>
          <h1 className={styles.pageTitle}>Analytics</h1>
          <div className={styles.pageSub}>
            Volume, response time, SLA hit rate, and team load across every mailbox you have access to.
          </div>
        </div>
        <div className={styles.pageHdActions}>
          <div className={styles.pageSegWrap} role="tablist" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                className={styles.pageSegBtn}
                data-active={window === w.key ? "true" : "false"}
                onClick={() => setWindowState(w.key)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={onExport}
            disabled={data.loading || !!data.error || data.forbidden}
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {data.forbidden ? (
        <div className={styles.empty}>
          <div className={styles.emptyInner}>
            <h2 className={styles.emptyTitle}>You don't have access to analytics</h2>
            <p className={styles.emptySub}>
              The server rejected the analytics requests with 403. Ask an admin to grant the
              <code> reports.view</code> permission to your role.
            </p>
          </div>
        </div>
      ) : data.error ? (
        <div className={styles.empty}>
          <div className={styles.emptyInner}>
            <h2 className={styles.emptyTitle}>Couldn't load analytics</h2>
            <p className={styles.emptySub}>{data.error}</p>
            <button
              type="button"
              className={styles.pageBtn}
              onClick={() => void data.refetch()}
              style={{ marginTop: 12 }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.pageBody}>
          <KpiStrip data={data} />
          <div className={styles.chartGrid}>
            <div className={styles.card}>
              <div className={styles.cardHd}>
                <div>
                  <div className={styles.cardTitle}>Conversation volume</div>
                  <div className={styles.cardSub}>Received vs. resolved · {windowLabel(window)}</div>
                </div>
                <div className={styles.legend}>
                  <span>
                    <span
                      className={styles.legendSwatch}
                      style={{ background: "var(--accent)" }}
                    />
                    Received
                  </span>
                  <span>
                    <span className={styles.legendSwatch} style={{ background: "#1F8A5B" }} />
                    Resolved
                  </span>
                </div>
              </div>
              <VolumeChart data={data.volume} />
            </div>
            <div className={styles.card}>
              <div className={styles.cardHd}>
                <div>
                  <div className={styles.cardTitle}>Channel mix</div>
                  <div className={styles.cardSub}>Share of inbound traffic</div>
                </div>
              </div>
              <ChannelDonut total={data.channels.total} channels={data.channels.channels} />
            </div>
          </div>

          <div className={styles.chartGrid}>
            <div className={styles.card}>
              <div className={styles.cardHd}>
                <div>
                  <div className={styles.cardTitle}>Team load</div>
                  <div className={styles.cardSub}>Open vs. resolved (last 7 days)</div>
                </div>
              </div>
              <TeamLoadTable rows={data.teamLoad} />
            </div>
            <div className={styles.card}>
              <div className={styles.cardHd}>
                <div>
                  <div className={styles.cardTitle}>Inbox health</div>
                  <div className={styles.cardSub}>SLA performance by mailbox</div>
                </div>
              </div>
              <InboxHealthTable rows={data.inboxHealth} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function windowLabel(w: AnalyticsWindow): string {
  switch (w) {
    case "14d":
      return "last 14 days";
    case "30d":
      return "last 30 days";
    case "90d":
      return "last 90 days";
    case "ytd":
      return "year to date";
  }
}

function KpiStrip({ data }: { data: ReturnType<typeof useAnalytics> }) {
  const k = data.kpis;
  // Empty/placeholder shape while loading.
  const empty = !k;

  const reply = k?.medianFirstReplySeconds;
  const replyDelta = reply
    ? formatDeltaSeconds(reply.value, reply.prior)
    : { text: "—", dir: "neutral" as const };

  const res = k?.medianResolutionSeconds;
  const resDelta = res
    ? formatDeltaSeconds(res.value, res.prior)
    : { text: "—", dir: "neutral" as const };

  const sla = k?.slaHitPct;
  const slaDelta = sla
    ? formatDeltaPct(sla.value, sla.prior)
    : { text: "—", dir: "neutral" as const };

  const open = k?.openConversations;
  const openDelta = open
    ? formatDeltaCount(open.value, open.prior)
    : { text: "—", dir: "neutral" as const };

  const perDay = k?.conversationsPerDay;
  const perDayDelta = perDay
    ? formatDeltaCount(perDay.value, perDay.prior)
    : { text: "—", dir: "neutral" as const };

  const tiles: {
    label: string;
    value: string;
    delta: { text: string; dir: "pos" | "neg" | "neutral" };
    spark: number[] | null | undefined;
    title?: string;
  }[] = [
    {
      label: "Open conversations",
      value: open?.value != null ? String(open.value) : "—",
      delta: openDelta,
      spark: open?.spark,
    },
    {
      label: "Median first reply",
      value: formatDurationFromSeconds(reply?.value ?? null),
      delta: replyDelta,
      spark: reply?.spark,
    },
    {
      label: "Median resolution",
      value: formatDurationFromSeconds(res?.value ?? null),
      delta: resDelta,
      spark: res?.spark,
    },
    {
      label: "SLA hit rate",
      value: sla?.value != null ? `${sla.value}%` : "—",
      delta: slaDelta,
      spark: sla?.spark,
    },
    {
      label: "Conversations / day",
      value: perDay?.value != null ? String(perDay.value) : "—",
      delta: perDayDelta,
      spark: perDay?.spark,
    },
    {
      label: "CSAT",
      value: "—",
      delta: { text: "not configured", dir: "neutral" },
      spark: null,
      title:
        "CSAT scoring isn't wired up yet. When customer feedback collection lands, this tile starts populating.",
    },
  ];

  return (
    <div className={styles.kpiGrid}>
      {tiles.map((t) => (
        <div key={t.label} className={styles.kpi} title={t.title}>
          <div className={styles.kpiLabel}>{t.label}</div>
          <div className={styles.kpiRow}>
            <span className={styles.kpiValue}>{empty ? "…" : t.value}</span>
            <span
              className={`${styles.kpiDelta} ${
                t.delta.dir === "pos"
                  ? styles.kpiDeltaPos
                  : t.delta.dir === "neg"
                    ? styles.kpiDeltaNeg
                    : styles.kpiDeltaNeutral
              }`}
            >
              {t.delta.dir === "pos" ? "▲" : t.delta.dir === "neg" ? "▼" : ""} {t.delta.text}
            </span>
          </div>
          <div className={styles.kpiSpark}>
            <Sparkline data={t.spark} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamLoadTable({ rows }: { rows: ReturnType<typeof useAnalytics>["teamLoad"] }) {
  if (rows.length === 0) {
    return (
      <div style={{ color: "var(--text-3)", fontSize: 12, padding: "20px 0" }}>
        No team activity yet.
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.openCount + r.resolvedCount), 1);

  return (
    <div className={styles.teamTable}>
      {rows.map((r) => {
        const total = r.openCount + r.resolvedCount;
        const w = (total / max) * 100;
        const openW = total > 0 ? (r.openCount / total) * w : 0;
        const resW = total > 0 ? (r.resolvedCount / total) * w : 0;
        return (
          <div key={r.userId} className={styles.teamRow}>
            <div className={styles.teamRowL}>
              <span
                className={styles.teamAvatar}
                style={{ background: avatarColor(r.username) }}
                aria-hidden
              >
                {avatarInitials(r.displayName)}
              </span>
              <span className={styles.teamName}>{r.displayName.split(/\s+\(/)[0]}</span>
            </div>
            <div className={styles.teamBarWrap}>
              <span className={styles.teamBar} style={{ width: `${openW}%`, background: "var(--accent)" }} />
              <span className={styles.teamBar} style={{ width: `${resW}%`, background: "#1F8A5B", opacity: 0.55 }} />
            </div>
            <div className={styles.teamCounts}>
              <span className={styles.teamCountsOpen}>{r.openCount}</span>
              <span className={styles.teamCountsResolved}>· {r.resolvedCount}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InboxHealthTable({ rows }: { rows: ReturnType<typeof useAnalytics>["inboxHealth"] }) {
  if (rows.length === 0) {
    return (
      <div style={{ color: "var(--text-3)", fontSize: 12, padding: "20px 0" }}>
        No mailboxes available.
      </div>
    );
  }
  return (
    <table className={styles.inboxTable}>
      <thead>
        <tr>
          <th>Inbox</th>
          <th className={styles.right}>Open</th>
          <th className={styles.right}>SLA hit</th>
          <th className={styles.right}>1st reply</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const slaColor =
            r.slaHitPct == null
              ? "var(--text-3)"
              : r.slaHitPct >= 95
                ? "#1F8A5B"
                : r.slaHitPct >= 90
                  ? "#B45309"
                  : "#B32317";
          return (
            <tr key={r.mailboxId}>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center" }}>
                  <span
                    className={styles.inboxMailboxDot}
                    style={{ background: mailboxDotColor(r.mailboxId) }}
                  />
                  {r.name}
                </span>
              </td>
              <td className={styles.right}>{r.openCount}</td>
              <td className={styles.right}>
                <span style={{ color: slaColor, fontWeight: 500 }}>
                  {r.slaHitPct == null ? "—" : `${r.slaHitPct}%`}
                </span>
              </td>
              <td className={`${styles.right}`} style={{ color: "var(--text-3)" }}>
                {formatDurationFromSeconds(r.medianFirstReplySeconds)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
