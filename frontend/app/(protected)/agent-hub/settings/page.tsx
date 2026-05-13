"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import {
  agentHubFetch,
  type HubPermissions,
  type HubRole,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Toast } from "../components";
import styles from "../agentHub.module.css";

type UserWithoutAccess = { id: number; username: string; display_name: string; role: string };
type Payload = {
  permissions: HubPermissions[];
  users_without_access: UserWithoutAccess[];
};

const FLAGS: Array<{ key: keyof HubPermissions; label: string }> = [
  { key: "can_view_personal_details", label: "Personal" },
  { key: "can_change_tier", label: "Tier" },
  { key: "can_mark_dnc", label: "DNC" },
  { key: "can_export", label: "Export" },
  { key: "can_merge", label: "Merge" },
];

function SettingsInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const [p, t] = await Promise.all([
        agentHubFetch<Payload>("/agent-hub/permissions", { authHeaders: authHeaders() }),
        agentHubFetch<{ tags: { tag: string; count: number }[] }>("/agent-hub/tags", { authHeaders: authHeaders() }),
      ]);
      setData(p);
      setTags(t.tags);
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

  if (perms.role !== "owner" && perms.role !== "manager") {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <h1 className={styles.pageTitle}>Settings</h1>
          <div className={styles.muted}>Owner or manager role required.</div>
        </div>
      </div>
    );
  }

  async function updateUser(userId: number, patch: Partial<HubPermissions>) {
    try {
      await agentHubFetch(`/agent-hub/permissions/${userId}`, {
        method: "PUT",
        authHeaders: authHeaders(),
        body: JSON.stringify(patch),
      });
      setToast({ msg: "Saved.", variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Save failed.", variant: "error" });
    }
  }

  async function revoke(userId: number) {
    if (!confirm("Revoke Hub access for this user?")) return;
    try {
      await agentHubFetch(`/agent-hub/permissions/${userId}`, {
        method: "DELETE",
        authHeaders: authHeaders(),
      });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Revoke failed.", variant: "error" });
    }
  }

  async function renameTag() {
    if (!renaming || !renaming.to.trim()) return;
    try {
      const body = await agentHubFetch<{ renamed: number }>(`/agent-hub/tags/rename`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ old_tag: renaming.from, new_tag: renaming.to.trim() }),
      });
      setToast({ msg: `Renamed ${body.renamed} occurrence(s).`, variant: "ok" });
      setRenaming(null);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Rename failed.", variant: "error" });
    }
  }

  async function deleteTag(tag: string) {
    if (!confirm(`Delete tag "${tag}" from every agent?`)) return;
    try {
      const body = await agentHubFetch<{ deleted: number }>(`/agent-hub/tags/${encodeURIComponent(tag)}`, {
        method: "DELETE",
        authHeaders: authHeaders(),
      });
      setToast({ msg: `Removed tag from ${body.deleted} agent(s).`, variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Delete failed.", variant: "error" });
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Settings</h1>
          <p className={styles.pageSubtitle}>
            <Link href="/agent-hub" className={styles.muted}>← Back to Hub</Link>
          </p>
        </div>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}
      {loading ? <div className={styles.muted}>Loading…</div> : null}

      {data ? (
        <>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Permissions</div>
            <div className={styles.permsRow + " " + styles.permsHeader}>
              <span>User</span>
              <span>Role</span>
              {FLAGS.map((f) => <span key={f.key}>{f.label}</span>)}
              <span></span>
            </div>
            {data.permissions.map((p) => (
              <div key={p.user_id} className={styles.permsRow}>
                <span>
                  <strong>{p.display_name || p.username}</strong>{" "}
                  <span className={styles.muted}>@{p.username}</span>
                </span>
                <select
                  className={styles.select}
                  value={p.role}
                  onChange={(e) => updateUser(p.user_id, { role: e.target.value as HubRole })}
                >
                  <option value="owner">Owner</option>
                  <option value="manager">Manager</option>
                  <option value="team">Team</option>
                  <option value="outreach">Outreach</option>
                  <option value="read_only">Read-only</option>
                </select>
                {FLAGS.map((f) => (
                  <input
                    key={f.key}
                    type="checkbox"
                    checked={p[f.key] === true}
                    onChange={(e) => updateUser(p.user_id, { [f.key]: e.target.checked } as Partial<HubPermissions>)}
                    style={{ justifySelf: "center" }}
                  />
                ))}
                <button className={styles.btnDanger + " " + styles.btn} onClick={() => revoke(p.user_id)}>
                  Revoke
                </button>
              </div>
            ))}
            {data.users_without_access.length > 0 ? (
              <div style={{ marginTop: "1rem" }}>
                <div className={styles.permsHeader}>Grant access to:</div>
                {data.users_without_access.map((u) => (
                  <div key={u.id} className={styles.row} style={{ padding: "0.4rem 0", borderBottom: "1px solid #f3f4f6" }}>
                    <span style={{ flex: 1 }}>
                      <strong>{u.display_name}</strong> <span className={styles.muted}>@{u.username} · {u.role}</span>
                    </span>
                    <button className={styles.btn} onClick={() => updateUser(u.id, { role: "team" })}>
                      Grant team access
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className={styles.card} style={{ marginTop: "1rem" }}>
            <div className={styles.cardTitle}>Tag management</div>
            {tags.length === 0 ? (
              <div className={styles.muted}>No tags in use.</div>
            ) : (
              tags.map((t) => (
                <div key={t.tag} className={styles.row} style={{ padding: "0.3rem 0", borderBottom: "1px solid #f3f4f6" }}>
                  <span className={styles.tagChip}>{t.tag}</span>
                  <span className={styles.muted} style={{ flex: 1 }}>{t.count} agent{t.count === 1 ? "" : "s"}</span>
                  <button className={styles.btnGhost + " " + styles.btn} onClick={() => setRenaming({ from: t.tag, to: t.tag })}>Rename</button>
                  <button className={styles.btnDanger + " " + styles.btn} onClick={() => deleteTag(t.tag)}>Delete</button>
                </div>
              ))
            )}
            {renaming ? (
              <div className={styles.row} style={{ marginTop: "0.5rem" }}>
                <span className={styles.muted}>Rename "{renaming.from}" to:</span>
                <input
                  className={styles.input}
                  value={renaming.to}
                  onChange={(e) => setRenaming({ ...renaming, to: e.target.value })}
                  autoFocus
                />
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={renameTag}>Rename</button>
                <button className={styles.btn} onClick={() => setRenaming(null)}>Cancel</button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function SettingsPage() {
  return <AgentHubGate>{(perms) => <SettingsInner perms={perms} />}</AgentHubGate>;
}
