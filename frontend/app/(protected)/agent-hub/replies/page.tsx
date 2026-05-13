"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, relativeTime, type HubPermissions } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Toast } from "../components";
import styles from "../agentHub.module.css";

type Reply = {
  id: number;
  agent_id: number;
  agent_name: string;
  agent_tier: string;
  still_flagged: boolean;
  channel: string;
  subject: string | null;
  body: string | null;
  sent_at: string;
  replied_at: string;
};

function RepliesInner({ perms: _perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [list, setList] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const body = await agentHubFetch<{ replies: Reply[] }>("/agent-hub/replies", { authHeaders: authHeaders() });
      setList(body.replies);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handle(id: number) {
    setBusy(id);
    try {
      await agentHubFetch(`/agent-hub/replies/${id}/handled`, { method: "POST", authHeaders: authHeaders() });
      setToast({ msg: "Marked handled — automations can resume.", variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Replies</h1>
          <p className={styles.pageSubtitle}>Agent replies that paused automations. Handle daily.</p>
        </div>
      </div>

      {loading ? <div className={styles.muted}>Loading…</div> : null}
      {list.length === 0 && !loading ? <div className={styles.empty}>No replies pending.</div> : null}

      {list.map((r) => (
        <div key={r.id} className={styles.card} style={{ marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
            <div style={{ flex: 1 }}>
              <Link href={`/agent-hub/agents/${r.agent_id}`} className={styles.linkCell} style={{ fontWeight: 600 }}>
                {r.agent_name}
              </Link>
              {r.still_flagged ? (
                <span style={{ marginLeft: "0.4rem", padding: "0.05rem 0.35rem", borderRadius: 4, background: "#fef3c7", color: "#854d0e", fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase" }}>
                  Outreach Paused
                </span>
              ) : null}
              <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                Replied {relativeTime(r.replied_at)} to "{r.subject || "(no subject)"}"
              </div>
              <div style={{ marginTop: "0.4rem", padding: "0.5rem", background: "#f9fafb", borderRadius: 8, fontSize: "0.85rem" }}>
                Original: <span className={styles.muted}>{(r.body || "").slice(0, 240)}{(r.body || "").length > 240 ? "…" : ""}</span>
              </div>
            </div>
            {r.still_flagged ? (
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => handle(r.id)} disabled={busy === r.id}>
                Mark handled
              </button>
            ) : (
              <span className={styles.muted}>Handled</span>
            )}
          </div>
        </div>
      ))}

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function RepliesPage() {
  return <AgentHubGate>{(perms) => <RepliesInner perms={perms} />}</AgentHubGate>;
}
