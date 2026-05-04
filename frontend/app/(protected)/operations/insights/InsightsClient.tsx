"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../operations.module.css";
import OperationsTopBar from "../OperationsTopBar";
import { apiUrl } from "../../../../lib/api";
import { useAuth, RequireAdmin } from "../../../../context/AuthContext";
import type {
  AiSuggestion,
  AiSuggestionStats,
  AiSuggestionType,
} from "../types";

const TYPE_LABELS: Record<AiSuggestionType | "all", string> = {
  all: "All",
  follow_up: "Follow-ups",
  escalate: "Escalations",
  reassign: "Reassignments",
  auto_create: "Auto-create",
  reminder: "Reminders",
  insight: "Insights",
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "confidence", label: "Highest confidence" },
  { value: "overdue", label: "Most overdue" },
] as const;

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function InsightsClient() {
  const { authHeaders, token, isAdmin } = useAuth();
  const [stats, setStats] = useState<AiSuggestionStats | null>(null);
  const [items, setItems] = useState<AiSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<AiSuggestionType | "all">("all");
  const [sort, setSort] = useState<"newest" | "confidence" | "overdue">("newest");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastAnalyze, setLastAnalyze] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/process-suggestions/stats`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (res.ok) setStats(await res.json());
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  const loadFeed = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("type", filter);
      params.set("sort", sort);
      params.set("limit", "50");
      const res = await fetch(
        apiUrl(`/process-suggestions/pending?${params.toString()}`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!res.ok) return;
      const body = await res.json();
      setItems(body.suggestions || []);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, filter, sort]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);
  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const apply = async (s: AiSuggestion) => {
    setBusyId(s.id);
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/processes/process-suggestions/${s.id}/accept`),
        { method: "PUT", headers: { ...authHeaders() } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Apply failed");
      await Promise.all([loadFeed(), loadStats()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (s: AiSuggestion) => {
    setBusyId(s.id);
    try {
      await fetch(apiUrl(`/processes/process-suggestions/${s.id}/dismiss`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      await Promise.all([loadFeed(), loadStats()]);
    } finally {
      setBusyId(null);
    }
  };

  const analyzeNow = async () => {
    setAnalyzing(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/process-suggestions/analyze-now`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Analysis failed");
      setLastAnalyze(
        body.skipped
          ? `Skipped: ${body.skipped}`
          : `Generated ${body.generated ?? 0}, stored ${body.stored ?? 0}`
      );
      await Promise.all([loadFeed(), loadStats()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className={styles.page}>
      <OperationsTopBar
        actions={
          isAdmin ? (
            <RequireAdmin>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={analyzeNow}
                disabled={analyzing}
              >
                {analyzing ? "Analyzing…" : "✨ Analyze now"}
              </button>
            </RequireAdmin>
          ) : null
        }
      />
      <div className={styles.main}>
        <h2 style={{ color: "#1B2856", margin: "0 0 0.4rem" }}>AI Insights</h2>
        {stats ? (
          <div style={{ color: "#6a737b", fontSize: "0.88rem", marginBottom: "1rem" }}>
            <strong style={{ color: "#1B2856" }}>{stats.pendingCount}</strong> pending ·{" "}
            <strong style={{ color: "#10b981" }}>{stats.acceptedToday}</strong> accepted today ·{" "}
            <strong style={{ color: "#6a737b" }}>{stats.dismissedToday}</strong> dismissed today
            {stats.acceptRate != null
              ? ` · ${stats.acceptRate}% accept rate`
              : null}
          </div>
        ) : null}
        {lastAnalyze ? (
          <div
            style={{
              fontSize: "0.78rem",
              color: "#6C5CE7",
              marginBottom: "0.5rem",
            }}
          >
            {lastAnalyze}
          </div>
        ) : null}
        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <div className={styles.viewToggle}>
            {(Object.keys(TYPE_LABELS) as Array<AiSuggestionType | "all">).map((k) => (
              <button
                key={k}
                type="button"
                className={`${styles.viewToggleBtn} ${filter === k ? styles.viewToggleActive : ""}`}
                onClick={() => setFilter(k)}
              >
                {TYPE_LABELS[k]}
              </button>
            ))}
          </div>
          <select
            className={styles.select}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label}
              </option>
            ))}
          </select>
        </div>

        {loading && items.length === 0 ? (
          <div className={styles.loading}>Loading suggestions…</div>
        ) : items.length === 0 ? (
          <div
            style={{
              padding: "1rem",
              border: "1px dashed rgba(27, 40, 86, 0.15)",
              borderRadius: 8,
              color: "#6a737b",
              fontSize: "0.88rem",
            }}
          >
            No pending suggestions. The AI will keep watching every 15 minutes.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {items.map((s) => {
              const conf = s.confidence != null ? Math.round(s.confidence * 100) : null;
              return (
                <div
                  key={s.id}
                  style={{
                    background:
                      "linear-gradient(135deg, #F3E8FF 0%, #E8F4FD 50%, #F0FFF4 100%)",
                    border: "1px solid rgba(108, 92, 246, 0.2)",
                    borderRadius: 10,
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.7rem",
                      color: "#6C5CE7",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: "0.3rem",
                    }}
                  >
                    <span aria-hidden>✨</span>
                    {TYPE_LABELS[s.suggestionType] ?? s.suggestionType}
                    {conf != null ? (
                      <span
                        style={{
                          marginLeft: "auto",
                          background: "rgba(108, 92, 246, 0.15)",
                          padding: "0.1rem 0.45rem",
                          borderRadius: 999,
                          fontSize: "0.66rem",
                        }}
                      >
                        {conf}%
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontWeight: 700, color: "#1B2856", fontSize: "0.95rem" }}>
                    {s.title}
                  </div>
                  <div style={{ color: "#1B2856", fontSize: "0.85rem", marginTop: "0.2rem" }}>
                    {s.description}
                  </div>
                  <div
                    style={{
                      marginTop: "0.4rem",
                      fontSize: "0.75rem",
                      color: "#6a737b",
                    }}
                  >
                    {s.templateIcon ? `${s.templateIcon} ` : ""}
                    {s.templateName ? `${s.templateName} · ` : ""}
                    {s.propertyName || s.processName || ""}
                    {s.stageName ? ` · ${s.stageName}` : ""}
                    {" · "}
                    Suggested {relTime(s.createdAt)}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.55rem" }}>
                    <button
                      type="button"
                      onClick={() => apply(s)}
                      disabled={busyId === s.id}
                      style={{
                        background: "#6C5CE7",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "0.4rem 0.9rem",
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        cursor: busyId === s.id ? "wait" : "pointer",
                      }}
                    >
                      {busyId === s.id ? "Working…" : "Apply"}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(s)}
                      disabled={busyId === s.id}
                      style={{
                        background: "transparent",
                        color: "#6C5CE7",
                        border: "1px solid rgba(108, 92, 246, 0.4)",
                        borderRadius: 6,
                        padding: "0.4rem 0.9rem",
                        fontSize: "0.82rem",
                        fontWeight: 600,
                        cursor: busyId === s.id ? "wait" : "pointer",
                      }}
                    >
                      Dismiss
                    </button>
                    <Link
                      href={`/operations/processes/${s.processId}`}
                      style={{
                        marginLeft: "auto",
                        alignSelf: "center",
                        color: "#0098D0",
                        fontSize: "0.78rem",
                        textDecoration: "none",
                        fontWeight: 600,
                      }}
                    >
                      Open process →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
