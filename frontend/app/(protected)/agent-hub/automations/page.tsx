"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, type Automation, type HubPermissions, type SystemConfig } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Toast } from "../components";
import styles from "../agentHub.module.css";

const TRIGGER_ICONS: Record<string, string> = {
  time_based: "⏰",
  event_based: "⚡",
  manual: "👆",
};

function AutomationsInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [list, setList] = useState<Automation[]>([]);
  const [config, setConfig] = useState<SystemConfig | null>(null);
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
      const [a, c] = await Promise.all([
        agentHubFetch<{ automations: Automation[] }>("/agent-hub/automations", { authHeaders: authHeaders() }),
        agentHubFetch<{ config: SystemConfig }>("/agent-hub/system-config", { authHeaders: authHeaders() }),
      ]);
      setList(a.automations);
      setConfig(c.config);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggleEnabled(a: Automation) {
    setBusy(a.id);
    try {
      await agentHubFetch(`/agent-hub/automations/${a.id}`, {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify({ enabled: !a.enabled }),
      });
      setToast({ msg: `${a.name} ${!a.enabled ? "enabled" : "disabled"}.`, variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Toggle failed.", variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const isManager = perms.role === "owner" || perms.role === "manager";

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Automations</h1>
          <p className={styles.pageSubtitle}>{list.length} automation{list.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      {config && !config.launch_checklist_complete ? (
        <div className={styles.error} style={{ marginBottom: "1rem" }}>
          ⚠️ Launch checklist not complete. Automations cannot be enabled until the
          owner clicks "Complete checklist" on the{" "}
          <Link href="/agent-hub/system-config" className={styles.linkCell}>System Config</Link> page.
        </div>
      ) : null}

      {config?.kill_switch_enabled ? (
        <div className={styles.error} style={{ marginBottom: "1rem", background: "#fee2e2", borderColor: "#fca5a5" }}>
          🔴 Kill switch is engaged. All sends are paused. Reason: {config.kill_switch_reason || "(not specified)"}
        </div>
      ) : null}

      {loading ? <div className={styles.muted}>Loading…</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "0.75rem" }}>
        {list.map((a) => (
          <div key={a.id} className={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "1.1rem" }}>{TRIGGER_ICONS[a.trigger_type]}</span>
                  <Link href={`/agent-hub/automations/${a.id}`} className={styles.linkCell} style={{ fontWeight: 600 }}>
                    {a.name}
                  </Link>
                  {a.is_system ? (
                    <span style={{ padding: "0.05rem 0.35rem", borderRadius: 4, background: "#eef2f7", color: "#1b2856", fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase" }}>
                      System
                    </span>
                  ) : null}
                </div>
                <div className={styles.muted} style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>{a.description}</div>
              </div>
              {isManager ? (
                <label className={styles.checkboxLabel} style={{ marginLeft: "0.4rem" }}>
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    onChange={() => toggleEnabled(a)}
                    disabled={busy === a.id}
                  />
                  {a.enabled ? "On" : "Off"}
                </label>
              ) : (
                <span className={styles.muted}>{a.enabled ? "On" : "Off"}</span>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.4rem", marginTop: "0.75rem", fontSize: "0.78rem", textAlign: "center" }}>
              <Stat label="30d runs" value={a.runs_30d ?? 0} />
              <Stat label="Done" value={a.completed_30d ?? 0} />
              <Stat label="Skipped" value={a.skipped_30d ?? 0} />
              <Stat label="Failed" value={a.failed_30d ?? 0} highlight={(a.failed_30d ?? 0) > 0} />
            </div>
          </div>
        ))}
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: "1rem", color: highlight ? "#b91c1c" : "#1b2856" }}>{value}</div>
      <div className={styles.muted} style={{ fontSize: "0.7rem" }}>{label}</div>
    </div>
  );
}

export default function AutomationsPage() {
  return <AgentHubGate>{(perms) => <AutomationsInner perms={perms} />}</AgentHubGate>;
}
