"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import {
  agentHubFetch,
  FLAG_ICONS,
  FLAG_LABELS,
  relativeTime,
  scoreColor,
  SEVERITY_META,
  TIER_META,
  type HubPermissions,
  type PredictiveFlag,
  type Tier,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Avatar, Toast } from "../components";
import styles from "../agentHub.module.css";

type Health = { tiers: Array<{ tier: string; agents: number; avg_score: number; declining_count: number }> };
type Histogram = { histogram: Array<{ bucket: number; bucket_min: number; bucket_max: number; count: number; avg_score: number; tiers: string[] }> };
type CalcLogRow = { id: number; calculation_type: string; started_at: string; completed_at: string | null; agents_processed: number | null; flags_added: number | null; flags_resolved: number | null; errors_count: number; duration_ms: number | null; triggered_by_name: string | null };

function InsightsInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [predictions, setPredictions] = useState<PredictiveFlag[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [hist, setHist] = useState<Histogram | null>(null);
  const [calcLog, setCalcLog] = useState<CalcLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const [p, h, d, c] = await Promise.all([
        agentHubFetch<{ predictions: PredictiveFlag[] }>("/agent-hub/intelligence/predictions?limit=25", { authHeaders: authHeaders() }),
        agentHubFetch<Health>("/agent-hub/intelligence/health", { authHeaders: authHeaders() }),
        agentHubFetch<Histogram>("/agent-hub/intelligence/trends/score-distribution", { authHeaders: authHeaders() }),
        agentHubFetch<{ runs: CalcLogRow[] }>("/agent-hub/intelligence/scores/calculation-log", { authHeaders: authHeaders() }),
      ]);
      setPredictions(p.predictions);
      setHealth(h);
      setHist(d);
      setCalcLog(c.runs.slice(0, 10));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function dismissFlag(flag: PredictiveFlag) {
    const reason = prompt("Why dismiss? (logged + 90-day snooze)");
    if (!reason) return;
    setBusy(flag.id);
    try {
      await agentHubFetch(`/agent-hub/intelligence/flags/${flag.id}/dismiss`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ reason }),
      });
      setToast({ msg: "Dismissed.", variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Dismiss failed.", variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function recalcAll() {
    if (!confirm("Recalculate all engagement scores + flags now? Takes ~1-5 min for 10K agents.")) return;
    setBusy(-1);
    try {
      await agentHubFetch("/agent-hub/intelligence/scores/recalculate", { method: "POST", authHeaders: authHeaders(), body: JSON.stringify({ all: true }) });
      await agentHubFetch("/agent-hub/intelligence/flags/recalculate", { method: "POST", authHeaders: authHeaders() });
      setToast({ msg: "Recalc kicked off.", variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Recalc failed.", variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const isManager = perms.role === "owner" || perms.role === "manager";
  const actionFlags = predictions.filter((f) => f.severity === "action");
  const watchFlags = predictions.filter((f) => f.severity === "watch");
  const infoFlags = predictions.filter((f) => f.severity === "info");

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Insights</h1>
          <p className={styles.pageSubtitle}>
            Today's attention queue · {actionFlags.length} action · {watchFlags.length} watch · {infoFlags.length} info
          </p>
        </div>
        <div className={styles.row}>
          {isManager ? (
            <button className={styles.btn} onClick={recalcAll} disabled={busy === -1}>
              {busy === -1 ? "Running…" : "🔄 Recalculate now"}
            </button>
          ) : null}
        </div>
      </div>

      {/* TODAY'S ATTENTION QUEUE */}
      <div className={styles.card} style={{ marginBottom: "1rem" }}>
        <div className={styles.cardTitle}>
          Today's attention queue
          <Link href="/agent-hub/insights?view=all" className={styles.btnGhost} style={{ fontSize: "0.78rem" }}>
            View all →
          </Link>
        </div>
        {loading ? (
          <div className={styles.muted}>Loading…</div>
        ) : predictions.length === 0 ? (
          <div className={styles.empty}>No flags — system has nothing to surface.</div>
        ) : (
          predictions.slice(0, 10).map((f) => {
            const sev = SEVERITY_META[f.severity];
            return (
              <div key={f.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.6rem 0", borderBottom: "1px solid #f3f4f6" }}>
                <Avatar agent={{ full_name: f.agent_name || "?", photo_url: f.agent_photo_url ?? null }} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "1.1rem" }}>{FLAG_ICONS[f.flag_type]}</span>
                    <Link href={`/agent-hub/agents/${f.agent_id}`} className={styles.linkCell} style={{ fontWeight: 500 }}>
                      {f.agent_name}
                    </Link>
                    {f.agent_tier ? (
                      <span style={{ padding: "0.05rem 0.35rem", borderRadius: 9999, background: TIER_META[f.agent_tier as Tier].bg, color: TIER_META[f.agent_tier as Tier].fg, fontSize: "0.65rem", fontWeight: 600 }}>
                        {TIER_META[f.agent_tier as Tier].label}
                      </span>
                    ) : null}
                    <span style={{ padding: "0.05rem 0.35rem", borderRadius: 4, background: sev.bg, color: sev.fg, fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase" }}>
                      {FLAG_LABELS[f.flag_type]} · {sev.label}
                    </span>
                    <span className={styles.muted} style={{ fontSize: "0.72rem" }}>{f.confidence}</span>
                  </div>
                  <div style={{ marginTop: "0.25rem", fontSize: "0.85rem" }}>{f.reasoning}</div>
                </div>
                <div className={styles.row}>
                  <Link href={`/agent-hub/agents/${f.agent_id}`} className={styles.btn}>View</Link>
                  <button className={styles.btnDanger + " " + styles.btn} onClick={() => dismissFlag(f)} disabled={busy === f.id}>
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* HEALTH BY TIER */}
      <div className={styles.card} style={{ marginBottom: "1rem" }}>
        <div className={styles.cardTitle}>Health by tier</div>
        {health ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.5rem" }}>
            {health.tiers.map((t) => (
              <Link
                key={t.tier}
                href={`/agent-hub/agents?tier=${t.tier}`}
                style={{ display: "block", padding: "0.6rem", background: "#f9fafb", borderRadius: 8, textDecoration: "none", color: "inherit", border: "1px solid rgba(27,40,86,0.08)" }}
              >
                <div style={{ fontSize: "0.78rem", color: "#6a737b", textTransform: "uppercase", fontWeight: 600 }}>{t.tier}</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{t.agents}</div>
                <div style={{ fontSize: "0.78rem", color: scoreColor(Number(t.avg_score) || 0) }}>
                  avg {t.avg_score != null ? Number(t.avg_score).toFixed(0) : "—"} score
                </div>
                {t.declining_count > 0 ? (
                  <div className={styles.muted} style={{ fontSize: "0.72rem" }}>
                    {t.declining_count} declining
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        ) : (
          <div className={styles.muted}>Loading…</div>
        )}
      </div>

      {/* SCORE DISTRIBUTION */}
      <div className={styles.card} style={{ marginBottom: "1rem" }}>
        <div className={styles.cardTitle}>Score distribution</div>
        {hist ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: "0.3rem", height: 120 }}>
            {hist.histogram.map((b) => {
              const max = Math.max(1, ...hist.histogram.map((x) => x.count));
              const pct = (b.count / max) * 100;
              return (
                <div
                  key={b.bucket}
                  title={`${b.bucket_min}-${b.bucket_max}: ${b.count} agents`}
                  style={{
                    flex: 1,
                    background: scoreColor((b.bucket_min + b.bucket_max) / 2),
                    height: `${pct}%`,
                    minHeight: 3,
                    borderRadius: 3,
                    position: "relative",
                  }}
                >
                  <div style={{ position: "absolute", top: -16, width: "100%", textAlign: "center", fontSize: "0.7rem", color: "#6a737b" }}>
                    {b.count}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className={styles.muted} style={{ fontSize: "0.72rem", textAlign: "center", marginTop: "0.4rem" }}>
          0 — 10 — 20 — 30 — 40 — 50 — 60 — 70 — 80 — 90 — 100
        </div>
      </div>

      {/* SYSTEM HEALTH */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Calculation log</div>
        <table className={styles.table}>
          <thead>
            <tr><th>Type</th><th>Started</th><th>Duration</th><th>Processed</th><th>Errors</th></tr>
          </thead>
          <tbody>
            {calcLog.map((r) => (
              <tr key={r.id}>
                <td>{r.calculation_type}</td>
                <td>{relativeTime(r.started_at)}</td>
                <td>{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                <td>{r.agents_processed ?? "—"}</td>
                <td style={{ color: r.errors_count > 0 ? "#b91c1c" : undefined }}>{r.errors_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function InsightsPage() {
  return <AgentHubGate>{(perms) => <InsightsInner perms={perms} />}</AgentHubGate>;
}
