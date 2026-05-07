"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import {
  agentHubFetch,
  relativeTime,
  type Automation,
  type AutomationRun,
  type HubPermissions,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { Toast } from "../../components";
import styles from "../../agentHub.module.css";

type Payload = { automation: Automation; recent_runs: AutomationRun[] };

function AutomationDetailInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const params = useParams();
  const id = Number(params?.id);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ eligible_count: number; skipped_count: number; eligible_agents: number[]; skipped_sample: { agent_id: number; reason: string }[] } | null>(null);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const body = await agentHubFetch<Payload>(`/agent-hub/automations/${id}`, { authHeaders: authHeaders() });
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token && id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  async function simulate() {
    setSimulating(true);
    try {
      const body = await agentHubFetch<typeof simResult>(`/agent-hub/automations/${id}/simulate`, {
        method: "POST",
        authHeaders: authHeaders(),
      });
      setSimResult(body);
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Simulation failed.", variant: "error" });
    } finally {
      setSimulating(false);
    }
  }

  async function toggleEnabled() {
    if (!data) return;
    try {
      await agentHubFetch(`/agent-hub/automations/${id}`, {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify({ enabled: !data.automation.enabled }),
      });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Toggle failed.", variant: "error" });
    }
  }

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (err) return <div className={styles.shell}><div className={styles.error}>{err}</div></div>;
  if (!data) return null;
  const a = data.automation;
  const isManager = perms.role === "owner" || perms.role === "manager";

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/automations" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Automations
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{a.name}</h1>
          <p className={styles.pageSubtitle}>
            {a.is_system ? "System automation · " : ""}
            {a.trigger_type} · cooldown {a.cooldown_period_days ?? "—"}d · {a.requires_approval ? "approval required" : "auto-send"}
          </p>
        </div>
        <div className={styles.row}>
          <button className={styles.btn} onClick={simulate} disabled={simulating}>
            {simulating ? "Simulating…" : "🧪 Simulate"}
          </button>
          {isManager ? (
            <button className={`${styles.btn} ${a.enabled ? styles.btnDanger : styles.btnPrimary}`} onClick={toggleEnabled}>
              {a.enabled ? "Disable" : "Enable"}
            </button>
          ) : null}
        </div>
      </div>

      {a.is_system ? (
        <div className={styles.placeholderBox} style={{ marginBottom: "1rem", textAlign: "left" }}>
          This is a system automation. Name / slug / trigger type are locked.
          You can edit conditions, actions, cooldown, and the approval flag.
        </div>
      ) : null}

      <div className={styles.gridTwo}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Configuration</div>
          <div className={styles.flexCol} style={{ gap: "0.4rem", fontSize: "0.85rem" }}>
            <Row label="Slug" value={<code>{a.slug}</code>} />
            <Row label="Description" value={a.description} />
            <Row label="Trigger" value={<><strong>{a.trigger_type}</strong> · <code>{JSON.stringify(a.trigger_config)}</code></>} />
            <Row label="Cooldown" value={a.cooldown_period_days != null ? `${a.cooldown_period_days} days` : "—"} />
            <Row label="Max runs / agent" value={a.max_runs_per_agent ?? "—"} />
            <Row label="Approval window" value={`${a.approval_window_hours}h`} />
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Conditions ({a.conditions.length})</div>
          {a.conditions.length === 0 ? (
            <div className={styles.muted}>No conditions — all agents matching the trigger fire.</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.85rem" }}>
              {a.conditions.map((c, i) => (
                <li key={i} style={{ padding: "0.25rem 0", borderBottom: "1px solid #f3f4f6" }}>
                  <code>{c.field}</code> {c.op} <code>{JSON.stringify(c.value)}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: "1rem" }}>
        <div className={styles.cardTitle}>Actions ({a.actions.length})</div>
        <ol style={{ paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
          {a.actions.map((act, i) => (
            <li key={i} style={{ padding: "0.3rem 0" }}>
              <strong>{act.type}</strong>
              {act.config && Object.keys(act.config).length ? (
                <div className={styles.muted}><code>{JSON.stringify(act.config)}</code></div>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {simResult ? (
        <div className={styles.card} style={{ marginTop: "1rem", background: "#f0f9ff", borderColor: "#bae6fd" }}>
          <div className={styles.cardTitle}>Simulation result</div>
          <p style={{ fontSize: "0.9rem" }}>
            <strong>{simResult.eligible_count}</strong> agent(s) would fire ·{" "}
            <strong>{simResult.skipped_count}</strong> skipped (sample below).
          </p>
          {simResult.eligible_agents.length ? (
            <details>
              <summary style={{ cursor: "pointer" }}>Eligible agents ({simResult.eligible_agents.length})</summary>
              <div style={{ fontSize: "0.85rem", marginTop: "0.4rem" }}>
                {simResult.eligible_agents.map((aid) => (
                  <Link key={aid} href={`/agent-hub/agents/${aid}`} className={styles.linkCell} style={{ marginRight: "0.5rem" }}>
                    #{aid}
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
          {simResult.skipped_sample.length ? (
            <details>
              <summary style={{ cursor: "pointer" }}>Skipped sample</summary>
              <ul style={{ fontSize: "0.85rem" }}>
                {simResult.skipped_sample.map((s, i) => (
                  <li key={i}>#{s.agent_id} — {s.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className={styles.card} style={{ marginTop: "1rem" }}>
        <div className={styles.cardTitle}>Recent runs ({data.recent_runs.length})</div>
        {data.recent_runs.length === 0 ? (
          <div className={styles.muted}>None yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Agent</th><th>Triggered</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {data.recent_runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/agent-hub/agents/${r.agent_id}`} className={styles.linkCell}>
                      {r.agent_name}
                    </Link>
                  </td>
                  <td>{relativeTime(r.triggered_at)}</td>
                  <td>{r.status}</td>
                  <td>{r.actions_completed}/{r.actions_total} done · {r.actions_failed} failed</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <span style={{ minWidth: 120, color: "#6a737b", fontSize: "0.78rem", textTransform: "uppercase" }}>{label}</span>
      <span style={{ flex: 1 }}>{value || <span style={{ color: "#9ca3af" }}>—</span>}</span>
    </div>
  );
}

export default function AutomationDetailPage() {
  return <AgentHubGate>{(perms) => <AutomationDetailInner perms={perms} />}</AgentHubGate>;
}
