"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError } from "../../lib/apiResult";

type Mode = "shadow" | "suggested" | "auto";

type Rule = {
  id: number;
  name: string;
  description: string | null;
  trigger: string;
  conditions: Record<string, unknown>;
  action: string;
  action_params: Record<string, unknown>;
  confidence_min: number;
  mode: Mode;
  active: boolean;
  priority_rank: number;
};

type AccuracyRow = {
  rule_id: number;
  total_firings: number;
  reviewed_count: number;
  good_count: number;
  wrong_count: number;
  accuracy: number | null;
};

const MODE_BADGE: Record<Mode, { bg: string; color: string; label: string }> = {
  shadow: { bg: "#eceff1", color: "#546e7a", label: "Shadow" },
  suggested: { bg: "#fff3e0", color: "#e65100", label: "Suggested" },
  auto: { bg: "#e8f5e9", color: "#2e7d32", label: "Auto" },
};

const ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(180px, 1.6fr) repeat(4, minmax(70px, 1fr)) auto",
  gap: "0.5rem",
  alignItems: "center",
  padding: "0.6rem 0.85rem",
  borderBottom: "1px solid #eef0f4",
  fontSize: "0.88rem",
  color: "#1b2856",
};
const HEADER_ROW: React.CSSProperties = {
  ...ROW,
  fontWeight: 700,
  textTransform: "uppercase",
  fontSize: "0.7rem",
  letterSpacing: "0.05em",
  color: "#6a737b",
  background: "#f9fafc",
};
const PILL: React.CSSProperties = {
  display: "inline-block",
  fontSize: "0.7rem",
  padding: "0.1rem 0.45rem",
  borderRadius: 999,
  fontWeight: 600,
};
const ACTION_BTN: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #cfd4dc",
  borderRadius: 6,
  padding: "0.25rem 0.55rem",
  fontSize: "0.78rem",
  cursor: "pointer",
};

function describeConditions(c: Record<string, unknown>): string {
  if (!c || Object.keys(c).length === 0) return "always";
  const bits: string[] = [];
  for (const [k, v] of Object.entries(c)) {
    if (Array.isArray(v)) bits.push(`${k}∈[${v.join(",")}]`);
    else if (typeof v === "object") bits.push(`${k}=${JSON.stringify(v)}`);
    else bits.push(`${k}=${v}`);
  }
  return bits.join(" · ");
}

function describeAction(action: string, params: Record<string, unknown>): string {
  const bits = Object.entries(params).map(([k, v]) => `${k}=${v}`);
  return bits.length ? `${action} (${bits.join(", ")})` : action;
}

export default function AutomationsPanel() {
  const { authHeaders, isAdmin } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [accuracy, setAccuracy] = useState<Record<number, AccuracyRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, aRes] = await Promise.all([
        fetch(apiUrl("/inbox/automation-rules"), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/inbox/automation-accuracy"), { headers: { ...authHeaders() } }),
      ]);
      const rBody = await rRes.json().catch(() => ({}));
      const aBody = await aRes.json().catch(() => ({}));
      if (!rRes.ok) {
        setError(parseApiError(rBody, rRes.status));
        return;
      }
      setRules(Array.isArray(rBody.rules) ? (rBody.rules as Rule[]) : []);
      const map: Record<number, AccuracyRow> = {};
      for (const a of aBody.rules ?? []) map[a.rule_id] = a;
      setAccuracy(map);
      setError(null);
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...rules].sort((a, b) => a.priority_rank - b.priority_rank || a.id - b.id),
    [rules]
  );

  const setMode = async (rule: Rule, mode: Mode) => {
    if (!isAdmin) return;
    setSavingId(rule.id);
    try {
      const res = await fetch(apiUrl(`/inbox/automation-rules/${rule.id}`), {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(parseApiError(body, res.status));
        return;
      }
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const setActive = async (rule: Rule, active: boolean) => {
    if (!isAdmin) return;
    setSavingId(rule.id);
    try {
      const res = await fetch(apiUrl(`/inbox/automation-rules/${rule.id}`), {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) return;
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const setConfidence = async (rule: Rule, value: number) => {
    if (!isAdmin) return;
    setSavingId(rule.id);
    try {
      const res = await fetch(apiUrl(`/inbox/automation-rules/${rule.id}`), {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ confidence_min: value }),
      });
      if (!res.ok) return;
      await load();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "0.6rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1b2856" }}>Workflow automations</h2>
          <p style={{ margin: "0.2rem 0 0", color: "#6a737b", fontSize: "0.85rem" }}>
            Every rule starts in <strong>shadow</strong> — runs hypothetically and logs what it would
            have done. Flip to <strong>suggested</strong> for one-click actions on the thread, or{" "}
            <strong>auto</strong> after at least 2 weeks / 50 firings of clean shadow data.{" "}
            <Link href="/inbox/automations/shadow" style={{ color: "var(--blue, #0098D0)" }}>
              Review shadow firings →
            </Link>
          </p>
        </div>
      </div>

      {error ? <div style={{ color: "#b32317", fontSize: "0.85rem", marginBottom: "0.5rem" }}>{error}</div> : null}

      <div style={{ background: "#fff", border: "1px solid #e2e4e8", borderRadius: 8, overflow: "hidden" }}>
        <div style={HEADER_ROW}>
          <span>Name / match</span>
          <span>Action</span>
          <span>Confidence</span>
          <span>Mode</span>
          <span>Accuracy</span>
          <span aria-label="Active toggle" />
        </div>
        {loading && rules.length === 0 ? (
          <div style={{ padding: "1rem", color: "#6a737b" }}>Loading…</div>
        ) : !loading && rules.length === 0 ? (
          <div style={{ padding: "1rem", color: "#6a737b" }}>No rules yet.</div>
        ) : (
          sorted.map((r) => {
            const acc = accuracy[r.id];
            const badge = MODE_BADGE[r.mode];
            return (
              <div key={r.id} style={{ ...ROW, opacity: r.active ? 1 : 0.55 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: "0.78rem", color: "#6a737b", marginTop: "0.15rem" }}>
                    on <code>{r.trigger}</code> · {describeConditions(r.conditions)}
                  </div>
                </div>
                <div style={{ fontSize: "0.82rem" }}>{describeAction(r.action, r.action_params)}</div>
                <div>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={r.confidence_min}
                    disabled={!isAdmin || savingId === r.id}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 0 && v <= 1) {
                        void setConfidence(r, v);
                      }
                    }}
                    style={{
                      width: "4.5rem",
                      padding: "0.25rem",
                      border: "1px solid #cfd4dc",
                      borderRadius: 6,
                      fontSize: "0.85rem",
                    }}
                  />
                </div>
                <div>
                  <select
                    value={r.mode}
                    disabled={!isAdmin || savingId === r.id}
                    onChange={(e) => void setMode(r, e.target.value as Mode)}
                    style={{
                      ...PILL,
                      background: badge.bg,
                      color: badge.color,
                      border: "none",
                      padding: "0.2rem 0.45rem",
                      cursor: isAdmin ? "pointer" : "default",
                    }}
                  >
                    <option value="shadow">Shadow</option>
                    <option value="suggested">Suggested</option>
                    <option value="auto">Auto</option>
                  </select>
                </div>
                <div style={{ fontSize: "0.82rem" }}>
                  {acc && acc.reviewed_count > 0 ? (
                    <>
                      <strong>{acc.accuracy}%</strong>
                      <span style={{ color: "#6a737b", marginLeft: "0.3rem" }}>
                        ({acc.good_count}/{acc.reviewed_count})
                      </span>
                    </>
                  ) : acc && acc.total_firings > 0 ? (
                    <span style={{ color: "#6a737b" }}>{acc.total_firings} firings, none reviewed</span>
                  ) : (
                    <span style={{ color: "#6a737b" }}>—</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                  {isAdmin ? (
                    <button
                      type="button"
                      style={ACTION_BTN}
                      disabled={savingId === r.id}
                      onClick={() => void setActive(r, !r.active)}
                    >
                      {r.active ? "Disable" : "Enable"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
