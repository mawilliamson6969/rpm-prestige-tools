"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import {
  agentHubFetch,
  relativeTime,
  TIER_META,
  type AutomationRun,
  type HubPermissions,
  type Tier,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Avatar, Toast } from "../components";
import styles from "../agentHub.module.css";

function ApprovalQueueInner({ perms: _perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const body = await agentHubFetch<{ runs: AutomationRun[] }>("/agent-hub/approval-queue", { authHeaders: authHeaders() });
      setRuns(body.runs);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function approve(id: number) {
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/automation-runs/${id}/approve`, { method: "POST", authHeaders: authHeaders() });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Approve failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: number) {
    const reason = prompt("Cancel reason?");
    if (reason === null) return;
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/automation-runs/${id}/cancel`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ reason: reason || "manual_cancel" }),
      });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Cancel failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function bulkApprove() {
    if (!selected.size) return;
    if (!confirm(`Approve ${selected.size} run(s)?`)) return;
    setBusy(true);
    try {
      const body = await agentHubFetch<{ approved: number }>("/agent-hub/approval-queue/bulk-approve", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ run_ids: Array.from(selected) }),
      });
      setToast({ msg: `Approved ${body.approved}.`, variant: "ok" });
      setSelected(new Set());
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Bulk failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function bulkCancel() {
    if (!selected.size) return;
    const reason = prompt(`Cancel ${selected.size} run(s)? Reason:`);
    if (!reason) return;
    setBusy(true);
    try {
      const body = await agentHubFetch<{ cancelled: number }>("/agent-hub/approval-queue/bulk-cancel", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ run_ids: Array.from(selected), reason }),
      });
      setToast({ msg: `Cancelled ${body.cancelled}.`, variant: "ok" });
      setSelected(new Set());
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Bulk failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  function deadline(iso: string | null): { label: string; color: string } {
    if (!iso) return { label: "—", color: "#6a737b" };
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return { label: "Expired", color: "#b91c1c" };
    const hours = Math.floor(ms / 3600000);
    if (hours < 4) return { label: `${hours}h ${Math.floor((ms % 3600000) / 60000)}m`, color: "#b91c1c" };
    if (hours < 12) return { label: `${hours}h`, color: "#ea580c" };
    if (hours < 24) return { label: `${hours}h`, color: "#ca8a04" };
    return { label: `${Math.floor(hours / 24)}d ${hours % 24}h`, color: "#16a34a" };
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Approval Queue</h1>
          <p className={styles.pageSubtitle}>{runs.length} pending · sorted by deadline</p>
        </div>
        <div className={styles.row}>
          {selected.size > 0 ? (
            <>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={bulkApprove} disabled={busy}>
                Approve {selected.size}
              </button>
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={bulkCancel} disabled={busy}>
                Cancel {selected.size}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}
      {loading ? <div className={styles.muted}>Loading…</div> : null}
      {runs.length === 0 && !loading ? <div className={styles.empty}>Nothing pending. Nice.</div> : null}

      {runs.map((r) => {
        const dl = deadline(r.approval_required_until);
        const isExpanded = expanded.has(r.id);
        return (
          <div key={r.id} className={styles.card} style={{ marginBottom: "0.5rem", padding: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={(e) => {
                  setSelected((prev) => {
                    const n = new Set(prev);
                    if (e.target.checked) n.add(r.id);
                    else n.delete(r.id);
                    return n;
                  });
                }}
              />
              <Avatar agent={{ full_name: r.agent_name || "?", photo_url: r.agent_photo_url ?? null }} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>
                  <Link href={`/agent-hub/agents/${r.agent_id}`} className={styles.linkCell}>
                    {r.agent_name}
                  </Link>
                  {r.agent_tier ? (
                    <span style={{ marginLeft: "0.4rem", padding: "0.05rem 0.35rem", borderRadius: 9999, background: TIER_META[r.agent_tier as Tier].bg, color: TIER_META[r.agent_tier as Tier].fg, fontSize: "0.65rem", fontWeight: 600 }}>
                      {TIER_META[r.agent_tier as Tier].label}
                    </span>
                  ) : null}
                </div>
                <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                  {r.automation_name} · triggered {relativeTime(r.triggered_at)}
                </div>
              </div>
              <div style={{ color: dl.color, fontSize: "0.85rem", fontWeight: 600 }}>{dl.label}</div>
              <button className={styles.btn} onClick={() => setExpanded((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                {isExpanded ? "Hide" : "View"}
              </button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => approve(r.id)} disabled={busy}>
                Approve
              </button>
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => cancel(r.id)} disabled={busy}>
                Cancel
              </button>
            </div>
            {isExpanded ? (
              <div style={{ marginTop: "0.6rem", padding: "0.5rem", background: "#f9fafb", borderRadius: 8, fontSize: "0.85rem" }}>
                <div style={{ fontWeight: 500, marginBottom: "0.3rem" }}>Actions:</div>
                {r.action_preview?.map((a) => (
                  <div key={a.sequence_index} style={{ padding: "0.3rem 0", borderBottom: "1px solid #f3f4f6" }}>
                    <strong>{a.sequence_index + 1}.</strong> {a.action_type}
                    {a.action_config && Object.keys(a.action_config).length ? (
                      <span className={styles.muted}> · {JSON.stringify(a.action_config)}</span>
                    ) : null}
                  </div>
                ))}
                <div className={styles.muted} style={{ marginTop: "0.4rem", fontSize: "0.78rem" }}>
                  Showing first 3 of {r.actions_total} actions. <Link href={`/agent-hub/automation-runs/${r.id}`} className={styles.linkCell}>Full run →</Link>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function ApprovalQueuePage() {
  return <AgentHubGate>{(perms) => <ApprovalQueueInner perms={perms} />}</AgentHubGate>;
}
