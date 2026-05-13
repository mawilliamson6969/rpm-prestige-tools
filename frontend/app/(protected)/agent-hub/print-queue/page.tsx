"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import { agentHubFetch, type HubPermissions, type Postcard } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Toast } from "../components";
import styles from "../agentHub.module.css";

function PrintQueueInner({ perms: _perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [list, setList] = useState<Postcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: "pending" });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const sp = new URLSearchParams();
      sp.set("status", filter.status);
      const body = await agentHubFetch<{ postcards: Postcard[] }>(`/agent-hub/postcard-queue?${sp}`, { authHeaders: authHeaders() });
      setList(body.postcards);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filter]);

  async function markMailed(id: number) {
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/postcard-queue/${id}/mark-mailed`, { method: "POST", authHeaders: authHeaders() });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: number) {
    const reason = prompt("Cancel reason?");
    if (reason === null) return;
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/postcard-queue/${id}/cancel`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ reason: reason || "manual_cancel" }),
      });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  function exportCsv() {
    fetch(apiUrl("/agent-hub/postcard-queue/export.csv"), { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(`(${res.status})`);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `postcards-${Date.now()}.csv`;
        a.click();
      })
      .catch((e) => setToast({ msg: e.message || "Export failed.", variant: "error" }));
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Print Queue</h1>
          <p className={styles.pageSubtitle}>{list.length} postcard{list.length === 1 ? "" : "s"}</p>
        </div>
        <div className={styles.row}>
          <button className={styles.btn} onClick={exportCsv}>⬇ Export CSV</button>
        </div>
      </div>

      <div className={styles.filterBar}>
        <select className={styles.select} value={filter.status} onChange={(e) => setFilter({ status: e.target.value })}>
          <option value="pending">Pending</option>
          <option value="mailed">Mailed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading ? <div className={styles.muted}>Loading…</div> : null}
      {list.length === 0 && !loading ? <div className={styles.empty}>Nothing here.</div> : null}

      {list.map((p) => {
        const isExpanded = expanded.has(p.id);
        return (
          <div key={p.id} className={styles.card} style={{ marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div style={{ flex: 1 }}>
                <Link href={`/agent-hub/agents/${p.agent_id}`} className={styles.linkCell}>
                  {p.agent_name}
                </Link>
                <span className={styles.muted}> · {p.template_name || "—"}</span>
                <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                  {(p.mailing_address?.address_1 || "")}, {p.mailing_address?.city || ""} {p.mailing_address?.state || ""} {p.mailing_address?.zip || ""}
                </div>
              </div>
              <button className={styles.btn} onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>
                {isExpanded ? "Hide" : "Preview"}
              </button>
              {filter.status === "pending" ? (
                <>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => markMailed(p.id)} disabled={busy}>
                    Mark mailed
                  </button>
                  <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => cancel(p.id)} disabled={busy}>
                    Cancel
                  </button>
                </>
              ) : null}
            </div>
            {isExpanded ? (
              <div style={{ marginTop: "0.5rem", padding: "0.6rem", background: "#fff7ed", borderRadius: 8, border: "1px dashed #fdba74" }}>
                {p.rendered_subject ? <div style={{ fontWeight: 600 }}>{p.rendered_subject}</div> : null}
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", margin: 0 }}>{p.rendered_body}</pre>
              </div>
            ) : null}
          </div>
        );
      })}

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function PrintQueuePage() {
  return <AgentHubGate>{(perms) => <PrintQueueInner perms={perms} />}</AgentHubGate>;
}
