"use client";

// Phase 4 — Rules screen at /inbox/rules.
//
// Design source: design/.../screens.jsx RulesView (lines 348–406).
// The static design has only a switch + When/Then lines + run count.
// The Phase 4 brief extends each card with:
//   - mode segmented (Shadow / Suggested / Auto)
//   - confidence threshold slider
//   - last-7d firing stats + acted-on %
//   - link into shadow review
// The "Shadow review" tab lives alongside the Rules tab — it pulls
// matched-shadow log rows and lets operators grade them good/wrong so
// per-rule accuracy populates.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import { parseApiError } from "../../../lib/apiResult";
import useAutomationRules, {
  type AutomationRule,
  type RuleMode,
  type RuleStats,
  type RuleAccuracy,
} from "../../../hooks/inbox/useAutomationRules";
import styles from "./rules.module.css";

type Tab = "rules" | "shadow";

const MODE_OPTIONS: { key: RuleMode; label: string }[] = [
  { key: "shadow", label: "Shadow" },
  { key: "suggested", label: "Suggested" },
  { key: "auto", label: "Auto" },
];

export default function RulesClient() {
  const [tab, setTab] = useState<Tab>("rules");
  return (
    <div className={styles.page}>
      <header className={styles.pageHd}>
        <div>
          <div className={styles.pageEyebrow}>Automation</div>
          <h1 className={styles.pageTitle}>Rules</h1>
          <div className={styles.pageSub}>
            Run actions automatically when conversations match a condition. Keep new rules in{" "}
            <em>shadow</em> for at least two weeks before flipping them to <em>auto</em>.
          </div>
        </div>
        <div className={styles.pageHdActions}>
          <button type="button" className={styles.pageBtn} disabled title="Coming soon">
            Templates
          </button>
          <button type="button" className={`${styles.pageBtn} ${styles.pageBtnPrimary}`} disabled title="New-rule builder ships in Phase 4.1">
            + New rule
          </button>
        </div>
      </header>

      <div className={styles.tabBar} role="tablist" aria-label="Section">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "rules"}
          data-active={tab === "rules" ? "true" : "false"}
          className={styles.tabBtn}
          onClick={() => setTab("rules")}
        >
          Rules
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "shadow"}
          data-active={tab === "shadow" ? "true" : "false"}
          className={styles.tabBtn}
          onClick={() => setTab("shadow")}
        >
          Shadow review
        </button>
      </div>

      <div className={styles.pageBody}>
        {tab === "rules" ? <RulesTab /> : <ShadowReviewTab />}
      </div>
    </div>
  );
}

/* ────────────────────────── Rules tab ────────────────────────── */

function RulesTab() {
  const { rules, stats, accuracy, loading, error, patchRule, refetch } = useAutomationRules();

  if (loading && rules.length === 0) {
    return <div className={styles.empty}>Loading rules…</div>;
  }
  if (error && rules.length === 0) {
    return (
      <div className={styles.empty}>
        Couldn&rsquo;t load rules — {error}.{" "}
        <button type="button" className={styles.pageBtn} onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    );
  }
  if (rules.length === 0) {
    return <div className={styles.empty}>No automation rules yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rules.map((r) => (
        <RuleCard
          key={r.id}
          rule={r}
          stats={stats.get(r.id)}
          accuracy={accuracy.get(r.id)}
          patchRule={patchRule}
        />
      ))}
    </div>
  );
}

function RuleCard({
  rule,
  stats,
  accuracy,
  patchRule,
}: {
  rule: AutomationRule;
  stats: RuleStats | undefined;
  accuracy: RuleAccuracy | undefined;
  patchRule: ReturnType<typeof useAutomationRules>["patchRule"];
}) {
  // Local mirror of the slider value so dragging stays smooth without
  // round-tripping every tick. We patch on `change` (mouse up / blur).
  const [confLocal, setConfLocal] = useState<number>(rule.confidence_min);
  useEffect(() => setConfLocal(rule.confidence_min), [rule.confidence_min]);

  const onToggleActive = useCallback(() => {
    void patchRule(rule.id, { active: !rule.active });
  }, [patchRule, rule.id, rule.active]);

  const onModeChange = useCallback(
    (next: RuleMode) => {
      if (next === rule.mode) return;
      void patchRule(rule.id, { mode: next });
    },
    [patchRule, rule.id, rule.mode]
  );

  const onConfCommit = useCallback(() => {
    if (Math.abs(confLocal - rule.confidence_min) < 0.005) return;
    void patchRule(rule.id, { confidence_min: confLocal });
  }, [confLocal, patchRule, rule.confidence_min, rule.id]);

  const whenText = describeConditions(rule.trigger, rule.conditions);
  const thenText = describeAction(rule.action, rule.action_params);

  const firings = stats?.last7d_firings ?? 0;
  const actedPct = stats?.last7d_acted_pct;
  const accVal = accuracy?.accuracy;

  return (
    <div className={styles.ruleCard} data-enabled={rule.active ? "true" : "false"}>
      <div className={styles.ruleCardL}>
        <button
          type="button"
          className={styles.ruleSwitch}
          data-on={rule.active ? "true" : "false"}
          onClick={onToggleActive}
          aria-label={rule.active ? "Turn rule off" : "Turn rule on"}
          aria-pressed={rule.active}
        >
          <span className={styles.ruleSwitchKnob} />
        </button>
      </div>
      <div className={styles.ruleCardBody}>
        <div className={styles.ruleCardTop}>
          <h3 className={styles.ruleCardName}>{rule.name}</h3>
          <span className={styles.ruleStats}>
            <span className={styles.ruleStatsActed}>{firings}</span>{" "}
            firings in last 7 days
            {actedPct != null ? (
              <>
                {" · "}
                <span className={styles.ruleStatsActed}>{actedPct}%</span> acted on
              </>
            ) : null}
          </span>
        </div>
        {rule.description ? <p className={styles.ruleDesc}>{rule.description}</p> : null}
        <div className={styles.ruleFlow}>
          <div className={styles.ruleFlowStep}>
            <span className={styles.ruleFlowLbl}>When</span>
            <span className={styles.ruleFlowText}>{whenText}</span>
          </div>
          <div className={styles.ruleFlowStep}>
            <span className={`${styles.ruleFlowLbl} ${styles.ruleFlowThen}`}>Then</span>
            <span className={styles.ruleFlowText}>{thenText}</span>
          </div>
        </div>
        <div className={styles.ruleControls}>
          <span className={styles.ruleControlLabel}>Mode</span>
          <div className={styles.modeSeg} role="tablist" aria-label="Rule mode">
            {MODE_OPTIONS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={rule.mode === m.key}
                data-active={rule.mode === m.key ? "true" : "false"}
                data-mode={m.key}
                className={styles.modeSegBtn}
                onClick={() => onModeChange(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className={styles.ruleControlLabel}>Confidence ≥</span>
          <div className={styles.confidenceWrap}>
            <input
              type="range"
              className={styles.confidenceSlider}
              min={0}
              max={1}
              step={0.05}
              value={confLocal}
              onChange={(e) => setConfLocal(Number(e.target.value))}
              onPointerUp={onConfCommit}
              onBlur={onConfCommit}
              aria-label={`Confidence threshold for ${rule.name}`}
            />
            <span className={styles.confidenceValue}>{Math.round(confLocal * 100)}%</span>
          </div>
          {accVal != null ? (
            <span
              className={`${styles.accuracyChip} ${
                accVal >= 90
                  ? styles.accuracyChipGood
                  : accVal >= 70
                    ? ""
                    : styles.accuracyChipBad
              }`}
              title={`${accuracy?.reviewed_count ?? 0} reviewed · ${accuracy?.good_count ?? 0} good / ${accuracy?.wrong_count ?? 0} wrong`}
            >
              Accuracy {accVal}%
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function describeConditions(trigger: string, c: Record<string, unknown>): React.ReactNode {
  const parts: React.ReactNode[] = [];
  parts.push(triggerLabel(trigger));
  if (c.category) parts.push(<>category is <code>{String(c.category)}</code></>);
  if (Array.isArray(c.priority_in) && c.priority_in.length) {
    parts.push(<>priority in <code>{(c.priority_in as string[]).join(", ")}</code></>);
  }
  if (c.priority) parts.push(<>priority is <code>{String(c.priority)}</code></>);
  if (c.status) parts.push(<>status is <code>{String(c.status)}</code></>);
  if (c.has_unread) parts.push(<>has unread messages</>);
  return joinNodes(parts, " · ");
}

function describeAction(action: string, p: Record<string, unknown>): React.ReactNode {
  switch (action) {
    case "assign":
      return (
        <>Assign to <code>{String(p.assignee_username || "—")}</code></>
      );
    case "set_status":
      return <>Set status to <code>{String(p.status || "—")}</code></>;
    case "set_priority":
      return <>Set priority to <code>{String(p.priority || "—")}</code></>;
    case "close":
      return <>Close the conversation</>;
    case "star":
      return <>Star the conversation</>;
    case "escalate":
      return (
        <>
          Escalate to <code>{String(p.assignee_username || "—")}</code>
          {p.priority ? (
            <>
              {" "}at priority <code>{String(p.priority)}</code>
            </>
          ) : null}
          {p.star ? <> and star</> : null}
        </>
      );
    case "create_task":
      return <>Create a task</>;
    case "create_work_order":
      return <>Create a work order</>;
    case "apply_label":
      return <>Apply label <code>{String(p.label || "—")}</code></>;
    default:
      return <code>{action}</code>;
  }
}

function triggerLabel(t: string): React.ReactNode {
  switch (t) {
    case "new_thread":
      return <>a new conversation arrives and</>;
    case "message_received":
      return <>a new inbound message arrives and</>;
    case "classification_changed":
      return <>the classifier reclassifies a thread and</>;
    case "sla_warning":
      return <>SLA is about to breach and</>;
    case "sla_breached":
      return <>SLA breaches and</>;
    default:
      return <>{t} and</>;
  }
}

function joinNodes(nodes: React.ReactNode[], sep: string): React.ReactNode {
  return nodes.map((n, i) => (
    <span key={i}>
      {i > 0 ? sep : null}
      {n}
    </span>
  ));
}

/* ────────────────────────── Shadow review tab ────────────────────────── */

type ShadowEntry = {
  id: number;
  rule_id: number;
  rule_name: string | null;
  thread_id: string;
  thread_subject: string | null;
  proposed_action: Record<string, unknown> | null;
  confidence: number | null;
  mode: string;
  matched: boolean;
  feedback: "good" | "wrong" | null;
  created_at: string;
};

function ShadowReviewTab() {
  const { authHeaders, token } = useAuth();
  const [entries, setEntries] = useState<ShadowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/inbox/automation-log?mode=shadow&matched_only=true&limit=100`),
        { cache: "no-store", headers: { ...authHeaders() } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      setEntries(Array.isArray(body.entries) ? body.entries : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shadow log.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const grade = useCallback(
    async (id: number, feedback: "good" | "wrong") => {
      const prev = entries;
      setEntries((es) => es.map((e) => (e.id === id ? { ...e, feedback } : e)));
      try {
        const res = await fetch(apiUrl(`/inbox/automation-log/${id}/feedback`), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ feedback }),
        });
        if (!res.ok) {
          setEntries(prev);
        }
      } catch {
        setEntries(prev);
      }
    },
    [entries, authHeaders]
  );

  const pending = useMemo(() => entries.filter((e) => e.feedback == null), [entries]);
  const graded = useMemo(() => entries.filter((e) => e.feedback != null), [entries]);

  if (loading) return <div className={styles.empty}>Loading shadow log…</div>;
  if (error) return <div className={styles.empty}>Couldn&rsquo;t load shadow log — {error}.</div>;
  if (entries.length === 0) {
    return <div className={styles.empty}>No shadow firings yet — leave rules in shadow mode for a couple weeks to gather data.</div>;
  }

  return (
    <section className={styles.shadowSection}>
      <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 10 }}>
        Grade each match — does the proposed action look right? Two weeks of mostly{" "}
        <b style={{ color: "var(--text)" }}>good</b> grades is the bar to flip to <em>suggested</em> or <em>auto</em>.
      </div>
      <div className={styles.shadowList}>
        {pending.map((e) => (
          <ShadowRow key={e.id} entry={e} grade={grade} />
        ))}
        {graded.length > 0 ? (
          <>
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "var(--text-4)",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Already graded
            </div>
            {graded.map((e) => (
              <ShadowRow key={e.id} entry={e} grade={grade} />
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

function ShadowRow({
  entry,
  grade,
}: {
  entry: ShadowEntry;
  grade: (id: number, feedback: "good" | "wrong") => Promise<void>;
}) {
  const action =
    entry.proposed_action && typeof entry.proposed_action === "object"
      ? describeProposedAction(entry.proposed_action as Record<string, unknown>)
      : "—";
  return (
    <div className={styles.shadowRow}>
      <div className={styles.shadowRowMain}>
        <span className={styles.shadowRowRule}>
          {entry.rule_name || "Rule"} → {action}
        </span>
        <span className={styles.shadowRowSubject}>
          {entry.thread_subject || entry.thread_id}
        </span>
        <span className={styles.shadowRowMeta}>
          {new Date(entry.created_at).toLocaleString()}
          {entry.confidence != null ? ` · conf ${Math.round(entry.confidence * 100)}%` : null}
        </span>
      </div>
      <div className={styles.shadowFeedback}>
        <button
          type="button"
          className={styles.shadowFeedbackBtn}
          data-on={entry.feedback === "good" ? "good" : undefined}
          onClick={() => void grade(entry.id, "good")}
          aria-pressed={entry.feedback === "good"}
        >
          ✓ Looks good
        </button>
        <button
          type="button"
          className={styles.shadowFeedbackBtn}
          data-on={entry.feedback === "wrong" ? "wrong" : undefined}
          onClick={() => void grade(entry.id, "wrong")}
          aria-pressed={entry.feedback === "wrong"}
        >
          ✕ Wrong
        </button>
      </div>
    </div>
  );
}

function describeProposedAction(p: Record<string, unknown>): string {
  if (p.assignee_username) return `assign to ${p.assignee_username}`;
  if (p.status) return `set status to ${p.status}`;
  if (p.priority) return `set priority to ${p.priority}`;
  if (p.star === true) return "star";
  return "act";
}
