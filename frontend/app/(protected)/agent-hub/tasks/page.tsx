"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import {
  agentHubFetch,
  type HubPermissions,
  type Task,
  type TaskStatus,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { FieldGroup, Toast } from "../components";
import styles from "../agentHub.module.css";

const PRIORITY_BG: Record<string, { bg: string; fg: string }> = {
  urgent: { bg: "#fee2e2", fg: "#991b1b" },
  high: { bg: "#fef3c7", fg: "#854d0e" },
  medium: { bg: "#e5e7eb", fg: "#374151" },
  low: { bg: "#dbeafe", fg: "#1e3a8a" },
};

function TasksInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token, user } = useAuth();
  const [list, setList] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ assigned_to: "me" as string, status: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", description: "", due_date: "", priority: "medium" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const sp = new URLSearchParams();
      sp.set("assigned_to", filter.assigned_to);
      if (filter.status) sp.set("status", filter.status);
      const body = await agentHubFetch<{ tasks: Task[] }>(`/agent-hub/tasks?${sp}`, { authHeaders: authHeaders() });
      setList(body.tasks);
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
  }, [token, filter]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.title.trim()) return;
    setBusy(true);
    try {
      await agentHubFetch("/agent-hub/tasks", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({
          title: createForm.title,
          description: createForm.description || undefined,
          due_date: createForm.due_date || undefined,
          priority: createForm.priority,
        }),
      });
      setCreateForm({ title: "", description: "", due_date: "", priority: "medium" });
      setShowCreate(false);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(t: Task, status: TaskStatus) {
    try {
      await agentHubFetch(`/agent-hub/tasks/${t.id}`, {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify({ status }),
      });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Tasks</h1>
          <p className={styles.pageSubtitle}>{list.length} task{list.length === 1 ? "" : "s"}</p>
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "+ New Task"}
        </button>
      </div>

      {showCreate ? (
        <form className={styles.card} onSubmit={createTask} style={{ marginBottom: "1rem" }}>
          <FieldGroup label="Title *">
            <input className={styles.input} value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} required autoFocus />
          </FieldGroup>
          <FieldGroup label="Description">
            <textarea className={styles.textarea} value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
          </FieldGroup>
          <div className={styles.gridTwo}>
            <FieldGroup label="Due date">
              <input className={styles.input} type="date" value={createForm.due_date} onChange={(e) => setCreateForm({ ...createForm, due_date: e.target.value })} />
            </FieldGroup>
            <FieldGroup label="Priority">
              <select className={styles.select} value={createForm.priority} onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </FieldGroup>
          </div>
          <div style={{ marginTop: "0.6rem", display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>
              {busy ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      ) : null}

      <div className={styles.filterBar}>
        <select
          className={styles.select}
          value={filter.assigned_to}
          onChange={(e) => setFilter({ ...filter, assigned_to: e.target.value })}
        >
          <option value="me">My tasks</option>
          <option value="any">All tasks</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select
          className={styles.select}
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}

      {loading ? (
        <div className={styles.muted}>Loading…</div>
      ) : list.length === 0 ? (
        <div className={styles.empty}>No tasks match.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Task</th>
                <th>Priority</th>
                <th>Due</th>
                <th>Assigned</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} style={t.status === "completed" ? { opacity: 0.5 } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.status === "completed"}
                      onChange={(e) => setStatus(t, e.target.checked ? "completed" : "pending")}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{t.title}</div>
                    {t.related_referral_id ? (
                      <Link href={`/agent-hub/pipeline/${t.related_referral_id}`} className={styles.muted} style={{ fontSize: "0.78rem" }}>
                        → Referral #{t.related_referral_id}
                      </Link>
                    ) : t.related_agent_id ? (
                      <Link href={`/agent-hub/agents/${t.related_agent_id}`} className={styles.muted} style={{ fontSize: "0.78rem" }}>
                        → {t.related_agent_name}
                      </Link>
                    ) : null}
                  </td>
                  <td>
                    <span style={{ padding: "0.1rem 0.4rem", borderRadius: 4, background: PRIORITY_BG[t.priority]?.bg, color: PRIORITY_BG[t.priority]?.fg, fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase" }}>
                      {t.priority}
                    </span>
                  </td>
                  <td>{t.due_date || <span className={styles.muted}>—</span>}</td>
                  <td>{t.assigned_to_name || <span className={styles.muted}>—</span>}</td>
                  <td>
                    {t.source === "system_referral_thank_you" ? (
                      <span className={styles.muted} style={{ fontSize: "0.78rem" }}>system: thank-you</span>
                    ) : t.source === "manual" ? (
                      <span className={styles.muted} style={{ fontSize: "0.78rem" }}>manual</span>
                    ) : t.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function TasksPage() {
  return <AgentHubGate>{(perms) => <TasksInner perms={perms} />}</AgentHubGate>;
}
