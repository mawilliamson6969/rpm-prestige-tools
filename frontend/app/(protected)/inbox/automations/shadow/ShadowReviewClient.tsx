"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import { apiUrl } from "../../../../../lib/api";
import { networkErrorMessage, parseApiError } from "../../../../../lib/apiResult";

type LogEntry = {
  id: number;
  rule_id: number | null;
  rule_name: string | null;
  rule_mode: string | null;
  thread_id: string | null;
  thread_subject: string | null;
  trigger: string;
  matched: boolean;
  proposed_action: Record<string, unknown> | null;
  confidence: number | null;
  mode: string;
  executed: boolean;
  skipped_reason: string | null;
  feedback: "good" | "wrong" | null;
  created_at: string;
};

type AccuracyRow = {
  rule_id: number;
  name: string;
  mode: string;
  total_firings: number;
  reviewed_count: number;
  good_count: number;
  wrong_count: number;
  accuracy: number | null;
};

const PAGE: React.CSSProperties = {
  background: "#f5f5f5",
  minHeight: "100dvh",
  padding: "1.25rem",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#1b2856",
};

const TABLE_ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "minmax(160px, 1.4fr) minmax(180px, 1.6fr) 90px 90px 90px 110px minmax(180px, auto)",
  gap: "0.5rem",
  alignItems: "start",
  padding: "0.55rem 0.85rem",
  borderBottom: "1px solid #eef0f4",
  fontSize: "0.85rem",
};

const HEADER_ROW: React.CSSProperties = {
  ...TABLE_ROW,
  fontWeight: 700,
  textTransform: "uppercase",
  fontSize: "0.7rem",
  letterSpacing: "0.05em",
  color: "#6a737b",
  background: "#f9fafc",
};

const FB_BTN: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #cfd4dc",
  borderRadius: 6,
  padding: "0.2rem 0.55rem",
  fontSize: "0.78rem",
  cursor: "pointer",
};

function summarizeAction(p: Record<string, unknown> | null): string {
  if (!p) return "—";
  const action = String(p.action ?? "");
  const bits: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (k === "action") continue;
    if (v === null || v === undefined) continue;
    bits.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  return bits.length ? `${action} (${bits.join(", ")})` : action;
}

export default function ShadowReviewClient() {
  const { authHeaders, user } = useAuth();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [accuracy, setAccuracy] = useState<AccuracyRow[]>([]);
  const [ruleFilter, setRuleFilter] = useState<number | "all">("all");
  const [matchedOnly, setMatchedOnly] = useState(true);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("mode", "shadow");
      params.set("limit", "300");
      if (matchedOnly) params.set("matched_only", "true");
      if (ruleFilter !== "all") params.set("rule_id", String(ruleFilter));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      params.set("since", since);
      const [logRes, accRes] = await Promise.all([
        fetch(apiUrl(`/inbox/automation-log?${params.toString()}`), {
          headers: { ...authHeaders() },
        }),
        fetch(apiUrl("/inbox/automation-accuracy"), { headers: { ...authHeaders() } }),
      ]);
      const logBody = await logRes.json().catch(() => ({}));
      const accBody = await accRes.json().catch(() => ({}));
      if (!logRes.ok) {
        setError(parseApiError(logBody, logRes.status));
        return;
      }
      setEntries(Array.isArray(logBody.entries) ? (logBody.entries as LogEntry[]) : []);
      setAccuracy(Array.isArray(accBody.rules) ? (accBody.rules as AccuracyRow[]) : []);
      setError(null);
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [authHeaders, days, matchedOnly, ruleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitFeedback = async (entry: LogEntry, verdict: "good" | "wrong" | "clear") => {
    setSavingId(entry.id);
    try {
      const res = await fetch(apiUrl(`/inbox/automation-log/${entry.id}/feedback`), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: verdict }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(parseApiError(body, res.status));
        return;
      }
      // Patch the entry locally so the UI updates without a full reload.
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id
            ? { ...e, feedback: verdict === "clear" ? null : verdict }
            : e
        )
      );
    } finally {
      setSavingId(null);
    }
  };

  const ruleOptions = useMemo(
    () => [...accuracy].sort((a, b) => a.name.localeCompare(b.name)),
    [accuracy]
  );

  return (
    <div style={PAGE}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: "1rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Shadow review</h1>
          <p style={{ margin: "0.2rem 0 0", color: "#6a737b", fontSize: "0.9rem" }}>
            Hypothetical actions that automation rules would have taken. Mark each row{" "}
            <strong>looks good</strong> or <strong>wrong</strong> to drive per-rule accuracy.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link
            href="/inbox/settings"
            style={{
              padding: "0.4rem 0.9rem",
              border: "1px solid #cfd4dc",
              borderRadius: 6,
              background: "#fff",
              color: "#1b2856",
              textDecoration: "none",
              fontSize: "0.88rem",
            }}
          >
            ← Inbox settings
          </Link>
        </div>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          background: "#fff",
          padding: "0.75rem",
          border: "1px solid #e2e4e8",
          borderRadius: 8,
          marginBottom: "1rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.78rem", color: "#6a737b" }}>
          Rule
          <select
            value={ruleFilter}
            onChange={(e) =>
              setRuleFilter(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            style={{ padding: "0.35rem", border: "1px solid #cfd4dc", borderRadius: 6, fontSize: "0.85rem" }}
          >
            <option value="all">All rules</option>
            {ruleOptions.map((r) => (
              <option key={r.rule_id} value={r.rule_id}>
                {r.name} ({r.mode})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.78rem", color: "#6a737b" }}>
          Window
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ padding: "0.35rem", border: "1px solid #cfd4dc", borderRadius: 6, fontSize: "0.85rem" }}
          >
            <option value={1}>last 24h</option>
            <option value={7}>last 7 days</option>
            <option value={14}>last 14 days</option>
            <option value={30}>last 30 days</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.6rem" }}>
          <input
            type="checkbox"
            checked={matchedOnly}
            onChange={(e) => setMatchedOnly(e.target.checked)}
          />
          <span style={{ fontSize: "0.85rem" }}>Matched only</span>
        </label>
      </div>

      {error ? <div style={{ color: "#b32317", marginBottom: "0.5rem" }}>{error}</div> : null}

      {accuracy.length ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e4e8",
            borderRadius: 8,
            padding: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Per-rule accuracy</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.5rem" }}>
            {accuracy.map((r) => (
              <div
                key={r.rule_id}
                style={{
                  border: "1px solid #eef0f4",
                  borderRadius: 6,
                  padding: "0.55rem",
                  fontSize: "0.85rem",
                }}
              >
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ color: "#6a737b", fontSize: "0.78rem", margin: "0.15rem 0" }}>
                  {r.total_firings} firings · {r.reviewed_count} reviewed · mode: {r.mode}
                </div>
                <div style={{ fontWeight: 600 }}>
                  {r.accuracy != null ? `${r.accuracy}% accurate` : "no feedback yet"}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ background: "#fff", border: "1px solid #e2e4e8", borderRadius: 8, overflow: "hidden" }}>
        <div style={HEADER_ROW}>
          <span>Rule</span>
          <span>Thread / proposed action</span>
          <span>Confidence</span>
          <span>When</span>
          <span>Matched</span>
          <span>Feedback</span>
          <span aria-label="Actions" />
        </div>
        {loading && entries.length === 0 ? (
          <div style={{ padding: "1rem", color: "#6a737b" }}>Loading…</div>
        ) : !loading && entries.length === 0 ? (
          <div style={{ padding: "1rem", color: "#6a737b" }}>No shadow firings in the selected window.</div>
        ) : (
          entries.map((e) => {
            const subj = e.thread_subject || e.thread_id || "(unknown thread)";
            return (
              <div key={e.id} style={TABLE_ROW}>
                <div>
                  <div style={{ fontWeight: 600 }}>{e.rule_name ?? `Rule #${e.rule_id ?? "?"}`}</div>
                  <div style={{ color: "#6a737b", fontSize: "0.78rem", marginTop: "0.15rem" }}>
                    on <code>{e.trigger}</code>
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.thread_id ? (
                      <Link
                        href={`/inbox?thread=${encodeURIComponent(e.thread_id)}`}
                        style={{ color: "#1b2856", fontWeight: 500 }}
                      >
                        {subj}
                      </Link>
                    ) : (
                      subj
                    )}
                  </div>
                  <div style={{ color: "#6a737b", fontSize: "0.78rem", marginTop: "0.15rem" }}>
                    {summarizeAction(e.proposed_action)}
                  </div>
                  {e.skipped_reason ? (
                    <div style={{ color: "#6a737b", fontSize: "0.75rem", marginTop: "0.15rem", fontStyle: "italic" }}>
                      {e.skipped_reason}
                    </div>
                  ) : null}
                </div>
                <div>{e.confidence != null ? e.confidence.toFixed(2) : "—"}</div>
                <div style={{ color: "#6a737b", fontSize: "0.78rem" }}>
                  {new Date(e.created_at).toLocaleString()}
                </div>
                <div>{e.matched ? "Yes" : "No"}</div>
                <div>
                  {e.feedback === "good" ? (
                    <span style={{ color: "#2e7d32", fontWeight: 600 }}>Looks good</span>
                  ) : e.feedback === "wrong" ? (
                    <span style={{ color: "#b32317", fontWeight: 600 }}>Wrong</span>
                  ) : (
                    <span style={{ color: "#6a737b" }}>—</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={{
                      ...FB_BTN,
                      background: e.feedback === "good" ? "#e8f5e9" : "transparent",
                      borderColor: e.feedback === "good" ? "#2e7d32" : "#cfd4dc",
                    }}
                    disabled={savingId === e.id || !user}
                    onClick={() => void submitFeedback(e, "good")}
                  >
                    Looks good
                  </button>
                  <button
                    type="button"
                    style={{
                      ...FB_BTN,
                      background: e.feedback === "wrong" ? "#ffebee" : "transparent",
                      borderColor: e.feedback === "wrong" ? "#b32317" : "#cfd4dc",
                      color: e.feedback === "wrong" ? "#b32317" : "#1b2856",
                    }}
                    disabled={savingId === e.id || !user}
                    onClick={() => void submitFeedback(e, "wrong")}
                  >
                    Wrong
                  </button>
                  {e.feedback ? (
                    <button
                      type="button"
                      style={FB_BTN}
                      disabled={savingId === e.id}
                      onClick={() => void submitFeedback(e, "clear")}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
