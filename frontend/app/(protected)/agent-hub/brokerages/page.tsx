"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, type Brokerage, type HubPermissions } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { FieldGroup, Toast } from "../components";
import styles from "../agentHub.module.css";

function BrokeragesInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [list, setList] = useState<Brokerage[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", state: "TX", phone: "", website: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const body = await agentHubFetch<{ brokerages: Brokerage[] }>("/agent-hub/brokerages", { authHeaders: authHeaders() });
      setList(body.brokerages);
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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await agentHubFetch("/agent-hub/brokerages", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify(form),
      });
      setForm({ name: "", city: "", state: "TX", phone: "", website: "", notes: "" });
      setCreating(false);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Create failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const isManager = perms.role === "owner" || perms.role === "manager";

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Brokerages</h1>
          <p className={styles.pageSubtitle}>{loading ? "Loading…" : `${list.length} brokerage${list.length === 1 ? "" : "s"}`}</p>
        </div>
        {isManager ? (
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setCreating((v) => !v)}>
            {creating ? "Cancel" : "+ New brokerage"}
          </button>
        ) : null}
      </div>

      {creating ? (
        <form className={styles.card} onSubmit={create} style={{ marginBottom: "1rem" }}>
          <div className={styles.gridTwo}>
            <FieldGroup label="Name *">
              <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </FieldGroup>
            <FieldGroup label="City">
              <input className={styles.input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </FieldGroup>
            <FieldGroup label="State">
              <input className={styles.input} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} maxLength={2} />
            </FieldGroup>
            <FieldGroup label="Phone">
              <input className={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </FieldGroup>
            <FieldGroup label="Website">
              <input className={styles.input} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </FieldGroup>
          </div>
          <FieldGroup label="Notes">
            <textarea className={styles.textarea} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FieldGroup>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button type="button" className={styles.btn} onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      ) : null}

      {err ? <div className={styles.error}>{err}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>City</th>
              <th>Phone</th>
              <th>Agents</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={5} className={styles.empty}>No brokerages yet.</td></tr>
            ) : (
              list.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/agent-hub/brokerages/${b.id}`} className={styles.linkCell}>{b.name}</Link>
                  </td>
                  <td>{b.city || <span className={styles.muted}>—</span>}</td>
                  <td>{b.phone || <span className={styles.muted}>—</span>}</td>
                  <td>{b.agent_count ?? 0}</td>
                  <td>{b.active ? "Active" : "Archived"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function BrokeragesListPage() {
  return <AgentHubGate>{(perms) => <BrokeragesInner perms={perms} />}</AgentHubGate>;
}
