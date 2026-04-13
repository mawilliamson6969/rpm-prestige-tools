"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentsTopBar from "../../../../components/AgentsTopBar";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import styles from "../agents.module.css";

type QueueItem = {
  id: number;
  agentId: number;
  agentName: string;
  agentSlug: string;
  agentIcon: string;
  actionType: string;
  actionData: unknown;
  context: unknown;
  aiDraft: string | null;
  confidenceScore: number | null;
  createdAt: string;
};

export default function AgentsQueueClient() {
  const { authHeaders, isAdmin, token } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openAgents, setOpenAgents] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/agents/queue/all"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not load queue.");
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const m = new Map<string, QueueItem[]>();
    for (const it of items) {
      const k = it.agentSlug;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return Array.from(m.entries()).sort((a, b) => {
      const ta = a[1][0]?.createdAt ?? "";
      const tb = b[1][0]?.createdAt ?? "";
      return ta.localeCompare(tb);
    });
  }, [items]);

  const approve = async (id: number) => {
    setBusy(id);
    try {
      const res = await fetch(apiUrl(`/agents/queue/${id}/approve`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Failed.");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (rejectId == null) return;
    setBusy(rejectId);
    try {
      const res = await fetch(apiUrl(`/agents/queue/${rejectId}/reject`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ notes: rejectNotes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Failed.");
      setRejectId(null);
      setRejectNotes("");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async () => {
    if (editId == null) return;
    setBusy(editId);
    try {
      const res = await fetch(apiUrl(`/agents/queue/${editId}/edit`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ editedDraft: editText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Failed.");
      setEditId(null);
      setEditText("");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`${styles.page} ${styles.pageSans}`}>
      <AgentsTopBar title="Agent review queue" subtitle="Pending actions across all agents" />

      <main className={styles.main}>
        {error ? <div className={styles.errorBanner}>{error}</div> : null}
        {loading ? <p>Loading…</p> : null}
        {!loading && items.length === 0 ? (
          <p style={{ color: "var(--navy)", fontWeight: 600 }}>No items in the review queue.</p>
        ) : null}

        {grouped.map(([slug, list]) => {
          const first = list[0];
          const open = openAgents[slug] !== false;
          return (
            <section key={slug} className={styles.panel} style={{ marginBottom: "1rem" }}>
              <button
                type="button"
                onClick={() => setOpenAgents((o) => ({ ...o, [slug]: !open }))}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>{first.agentIcon}</span>
                  {first.agentName}
                  <span style={{ fontSize: "0.8rem", color: "#666" }}>({list.length})</span>
                  <span style={{ marginLeft: "auto", fontSize: "0.85rem" }}>{open ? "▼" : "▶"}</span>
                </h3>
              </button>
              {open
                ? list.map((it) => (
                    <div key={it.id} className={styles.queueCard}>
                      <div style={{ fontSize: "0.78rem", color: "#555" }}>
                        #{it.id} · {it.actionType} ·{" "}
                        {it.confidenceScore != null ? `Confidence ${it.confidenceScore}` : "No score"} ·{" "}
                        {new Date(it.createdAt).toLocaleString()}
                      </div>
                      {it.aiDraft ? <pre className={styles.queueDraft}>{it.aiDraft}</pre> : null}
                      {isAdmin ? (
                        <div className={styles.actionsRow}>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                            disabled={busy === it.id}
                            onClick={() => void approve(it.id)}
                          >
                            Approve &amp; Send
                          </button>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                            disabled={busy === it.id}
                            onClick={() => {
                              setEditId(it.id);
                              setEditText(it.aiDraft || "");
                            }}
                          >
                            Edit &amp; Send
                          </button>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                            disabled={busy === it.id}
                            onClick={() => setRejectId(it.id)}
                          >
                            Reject
                          </button>
                          <Link href={`/agents/${it.agentSlug}?tab=queue`} className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}>
                            Open agent
                          </Link>
                        </div>
                      ) : (
                        <p style={{ fontSize: "0.82rem", margin: "0.5rem 0 0" }}>Admin approval required.</p>
                      )}
                    </div>
                  ))
                : null}
            </section>
          );
        })}
      </main>

      {editId != null ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Edit draft</h2>
            <textarea className={styles.promptArea} value={editText} onChange={(e) => setEditText(e.target.value)} />
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setEditId(null)}>
                Cancel
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void saveEdit()}>
                Save &amp; approve
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejectId != null ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
          <div className={styles.modal}>
            <h2>Reject action</h2>
            <div className={styles.field}>
              <label htmlFor="rjnotes">Notes</label>
              <textarea id="rjnotes" value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} />
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setRejectId(null)}>
                Cancel
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => void reject()}>
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
