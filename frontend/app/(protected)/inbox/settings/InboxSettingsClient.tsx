"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SignatureManager from "../../../../components/signature/SignatureManager";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import styles from "../inbox.module.css";

type Conn = {
  id: number;
  user_id: number;
  email_address: string | null;
  mailbox_type: string | null;
  mailbox_email: string | null;
  display_name: string | null;
  is_active: boolean;
  connected_at: string | null;
  last_sync_at: string | null;
  sync_status?: string | null;
  sync_last_at?: string | null;
  messages_synced?: number | null;
  error_log?: string | null;
  my_permission?: string | null;
};

type TeamUser = { id: number; username: string; displayName: string; email?: string | null };

type PermRow = {
  user_id: number;
  permission: string;
  username: string;
  display_name: string;
  email: string | null;
};

const MAILBOX_COLORS = ["#1565c0", "#2e7d32", "#6a1b9a", "#e65100", "#00897b"];

function mailboxColor(id: number) {
  return MAILBOX_COLORS[Math.abs(id) % MAILBOX_COLORS.length];
}

function connLabel(c: Conn) {
  return (c.display_name || c.mailbox_email || c.email_address || "Mailbox").trim();
}

export default function InboxSettingsClient() {
  const { authHeaders } = useAuth();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [nameEdits, setNameEdits] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const [sharedModalOpen, setSharedModalOpen] = useState(false);
  const [sharedEmail, setSharedEmail] = useState("");
  const [sharedDisplayName, setSharedDisplayName] = useState("");

  const [permModalConn, setPermModalConn] = useState<Conn | null>(null);
  const [permRows, setPermRows] = useState<PermRow[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [permDraft, setPermDraft] = useState<Record<number, string>>({});
  const [permLoading, setPermLoading] = useState(false);
  const [permSavingUser, setPermSavingUser] = useState<number | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cRes = await fetch(apiUrl("/inbox/connections"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const cBody = await cRes.json().catch(() => ({}));
      if (cRes.ok && Array.isArray(cBody.connections)) {
        const rows = cBody.connections as Conn[];
        setConnections(rows);
        const next: Record<number, string> = {};
        for (const c of rows) {
          next[c.id] = c.display_name ?? c.mailbox_email ?? c.email_address ?? "";
        }
        setNameEdits(next);
      }
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      setMsg("Microsoft account connected successfully.");
    }
    const err = searchParams.get("error");
    if (err) {
      setMsg(`Connection issue: ${decodeURIComponent(err)}`);
    }
  }, [searchParams]);

  const startOAuth = async (body: Record<string, unknown>) => {
    const res = await fetch(apiUrl("/inbox/microsoft/authorize-url"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resBody = await res.json().catch(() => ({}));
    if (res.ok && resBody.authorizeUrl) {
      window.location.href = resBody.authorizeUrl as string;
      return;
    }
    setMsg(typeof resBody.error === "string" ? resBody.error : "Could not start Microsoft sign-in.");
  };

  const connectPersonal = () => void startOAuth({ flow: "personal" });

  const openSharedModal = () => {
    setSharedEmail("");
    setSharedDisplayName("");
    setSharedModalOpen(true);
  };

  const connectShared = () => {
    const mailbox = sharedEmail.trim();
    if (!mailbox.includes("@")) {
      setMsg("Enter a valid shared mailbox email.");
      return;
    }
    void startOAuth({
      flow: "shared",
      mailbox,
      displayName: sharedDisplayName.trim() || undefined,
    });
  };

  const disconnect = async (id: number) => {
    if (!confirm("Disconnect this mailbox from the shared inbox?")) return;
    const res = await fetch(apiUrl(`/inbox/connections/${id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (res.ok) load();
    else setMsg("Could not disconnect.");
  };

  const saveDisplayName = async (c: Conn) => {
    const v = (nameEdits[c.id] ?? "").trim();
    if (!v) {
      setMsg("Display name cannot be empty.");
      return;
    }
    setSavingId(c.id);
    try {
      const res = await fetch(apiUrl(`/inbox/connections/${c.id}`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: v }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof body.error === "string" ? body.error : "Could not save name.");
        return;
      }
      await load();
      setMsg("Display name updated.");
    } finally {
      setSavingId(null);
    }
  };

  const isConnAdmin = (c: Conn) => c.my_permission === "admin";

  const openPermissions = async (c: Conn) => {
    if (!isConnAdmin(c)) return;
    setPermModalConn(c);
    setPermLoading(true);
    try {
      const [pRes, tRes] = await Promise.all([
        fetch(apiUrl(`/inbox/connections/${c.id}/permissions`), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } }),
      ]);
      const pBody = await pRes.json().catch(() => ({}));
      const tBody = await tRes.json().catch(() => ({}));
      const want = new Set(["mike", "lori", "leslie", "amanda", "amelia"]);
      const team = (Array.isArray(tBody.users) ? tBody.users : []).filter((u: TeamUser) =>
        want.has(u.username.toLowerCase())
      ) as TeamUser[];
      setTeamUsers(team);
      const existing = (Array.isArray(pBody.permissions) ? pBody.permissions : []) as Array<{
        user_id: number;
        permission: string;
        username: string;
        display_name: string;
        email: string | null;
      }>;
      const merged: PermRow[] = team.map((u) => {
        const hit = existing.find((e) => e.user_id === u.id);
        return {
          user_id: u.id,
          permission: hit?.permission ?? "none",
          username: u.username,
          display_name: u.displayName,
          email: hit?.email ?? u.email ?? null,
        };
      });
      for (const e of existing) {
        if (!merged.some((m) => m.user_id === e.user_id)) {
          merged.push({
            user_id: e.user_id,
            permission: e.permission,
            username: e.username,
            display_name: e.display_name,
            email: e.email,
          });
        }
      }
      merged.sort((a, b) => a.display_name.localeCompare(b.display_name));
      setPermRows(merged);
      const draft: Record<number, string> = {};
      for (const r of merged) draft[r.user_id] = r.permission;
      setPermDraft(draft);
    } finally {
      setPermLoading(false);
    }
  };

  const savePermissionRow = async (userId: number) => {
    if (!permModalConn) return;
    const level = permDraft[userId] ?? "none";
    setPermSavingUser(userId);
    try {
      if (level === "none") {
        const res = await fetch(
          apiUrl(`/inbox/connections/${permModalConn.id}/permissions/${userId}`),
          { method: "DELETE", headers: { ...authHeaders() } }
        );
        if (!res.ok) setMsg("Could not remove access.");
      } else {
        const res = await fetch(
          apiUrl(`/inbox/connections/${permModalConn.id}/permissions/${userId}`),
          {
            method: "PUT",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ permission: level }),
          }
        );
        if (res.status === 404) {
          const ins = await fetch(apiUrl(`/inbox/connections/${permModalConn.id}/permissions`), {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ userId, permission: level }),
          });
          if (!ins.ok) setMsg("Could not save permission.");
        } else if (!res.ok) {
          setMsg("Could not save permission.");
        }
      }
      await openPermissions(permModalConn);
    } finally {
      setPermSavingUser(null);
    }
  };

  const grantTeamAll = async () => {
    if (!permModalConn) return;
    setGrantBusy(true);
    try {
      const res = await fetch(
        apiUrl(`/inbox/connections/${permModalConn.id}/permissions/grant-team`),
        {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ permission: "read" }),
        }
      );
      if (!res.ok) setMsg("Could not grant team access.");
      await openPermissions(permModalConn);
    } finally {
      setGrantBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div>
          <h1>Inbox settings</h1>
          <p className={styles.settingsMuted} style={{ margin: "0.35rem 0 0" }}>
            Connect Outlook mailboxes and manage who can view or reply.
          </p>
        </div>
        <Link href="/inbox" className={styles.mutedLink}>
          ← Back to inbox
        </Link>
      </header>

      <div style={{ padding: "1.25rem", maxWidth: 880 }}>
        {msg ? (
          <p
            style={{
              padding: "0.75rem 1rem",
              background: "#e8f7fc",
              border: "1px solid #b8e6f5",
              borderRadius: 8,
              marginBottom: "1rem",
            }}
          >
            {msg}
          </p>
        ) : null}

        <section className={styles.settingsSection}>
          <h2 className={styles.settingsCardTitle}>Connect mailbox</h2>
          <p className={styles.settingsMuted}>
            Personal: sync your own Microsoft mailbox. Shared: sync a delegated shared mailbox (same sign-in).
          </p>
          <div className={styles.settingsRow}>
            <button type="button" className={styles.sendBtn} onClick={connectPersonal}>
              Connect my email
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={openSharedModal}>
              Connect shared mailbox
            </button>
          </div>
        </section>

        <section className={styles.settingsSection}>
          <h2 className={styles.settingsCardTitle}>Connected mailboxes</h2>
          {loading ? <p className={styles.settingsMuted}>Loading…</p> : null}
          {!loading && connections.length === 0 ? (
            <p className={styles.settingsMuted}>No mailboxes connected yet.</p>
          ) : null}
          {!loading &&
            connections.map((c) => {
              const type = (c.mailbox_type || "personal").toLowerCase();
              return (
                <div key={c.id} className={styles.settingsCard}>
                  <div className={styles.settingsRow} style={{ alignItems: "flex-start" }}>
                    <span className={styles.mailboxDot} style={{ background: mailboxColor(c.id) }} aria-hidden />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 0.6rem", alignItems: "center" }}>
                        <span className={styles.settingsCardTitle} style={{ margin: 0 }}>
                          {connLabel(c)}
                        </span>
                        <span className={type === "shared" ? styles.badgeShared : styles.badgePersonal}>
                          {type === "shared" ? "Shared" : "Personal"}
                        </span>
                        <span className={styles.settingsMuted} style={{ margin: 0 }}>
                          {c.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className={styles.settingsMuted} style={{ margin: "0.35rem 0 0" }}>
                        Mailbox: {c.mailbox_email || c.email_address || "—"}
                        {type === "personal" ? null : (
                          <> · Authenticating account: {c.email_address || "—"}</>
                        )}
                      </p>
                      <p className={styles.settingsMuted} style={{ margin: "0.25rem 0 0" }}>
                        Last sync: {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : "—"}
                        {c.sync_status ? <> · Job: {c.sync_status}</> : null}
                        {c.messages_synced != null ? <> · Last run new msgs: {c.messages_synced}</> : null}
                      </p>
                      {c.error_log ? (
                        <p style={{ color: "var(--red)", margin: "0.35rem 0 0", fontSize: "0.85rem" }}>{c.error_log}</p>
                      ) : null}
                    </div>
                  </div>

                  {isConnAdmin(c) ? (
                    <div className={styles.settingsRow} style={{ marginTop: "0.75rem" }}>
                      <input
                        className={styles.inlineInput}
                        aria-label="Display name"
                        value={nameEdits[c.id] ?? ""}
                        onChange={(e) => setNameEdits((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={savingId === c.id}
                        onClick={() => void saveDisplayName(c)}
                      >
                        {savingId === c.id ? "Saving…" : "Save name"}
                      </button>
                    </div>
                  ) : null}

                  <div className={styles.settingsRow} style={{ marginTop: "0.65rem" }}>
                    {isConnAdmin(c) && type === "shared" ? (
                      <button type="button" className={styles.secondaryBtn} onClick={() => void openPermissions(c)}>
                        Manage permissions
                      </button>
                    ) : null}
                    {c.is_active ? (
                      <button type="button" className={styles.dangerBtn} onClick={() => void disconnect(c.id)}>
                        Disconnect
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
        </section>

        <SignatureManager authHeaders={authHeaders} variant="inbox" />
      </div>

      {sharedModalOpen ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSharedModalOpen(false);
          }}
        >
          <div className={styles.modalPanel}>
            <div className={styles.modalHead}>
              <h2>Connect shared mailbox</h2>
              <button type="button" className={styles.modalClose} aria-label="Close" onClick={() => setSharedModalOpen(false)}>
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.settingsMuted}>
                You must have delegate access to this shared mailbox in Microsoft 365. You will sign in with your own
                work account.
              </p>
              <label className={styles.settingsMuted} style={{ display: "block", marginTop: "0.75rem" }}>
                Shared mailbox email
                <input
                  className={styles.inlineInput}
                  style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
                  placeholder="office@prestigerpm.com"
                  value={sharedEmail}
                  onChange={(e) => setSharedEmail(e.target.value)}
                />
              </label>
              <label className={styles.settingsMuted} style={{ display: "block", marginTop: "0.65rem" }}>
                Friendly name (optional)
                <input
                  className={styles.inlineInput}
                  style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
                  placeholder="Office Inbox"
                  value={sharedDisplayName}
                  onChange={(e) => setSharedDisplayName(e.target.value)}
                />
              </label>
            </div>
            <div className={styles.modalFoot}>
              <button type="button" className={styles.secondaryBtn} onClick={() => setSharedModalOpen(false)}>
                Cancel
              </button>
              <button type="button" className={styles.sendBtn} onClick={connectShared}>
                Connect
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {permModalConn ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPermModalConn(null);
          }}
        >
          <div className={styles.modalPanel} style={{ maxWidth: 640 }}>
            <div className={styles.modalHead}>
              <h2>Permissions — {connLabel(permModalConn)}</h2>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                onClick={() => setPermModalConn(null)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {(permModalConn.mailbox_type || "").toLowerCase() === "shared" ? (
                <div style={{ marginBottom: "0.75rem" }}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={grantBusy}
                    onClick={() => void grantTeamAll()}
                  >
                    {grantBusy ? "Granting…" : "Grant access to all team members (read)"}
                  </button>
                </div>
              ) : null}
              {permLoading ? (
                <p className={styles.settingsMuted}>Loading…</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className={styles.permTable}>
                    <thead>
                      <tr>
                        <th>Team member</th>
                        <th>Access</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {permRows.map((r) => (
                        <tr key={r.user_id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{r.display_name}</div>
                            <div className={styles.settingsMuted} style={{ fontSize: "0.8rem" }}>
                              {r.email || r.username}
                            </div>
                          </td>
                          <td>
                            <select
                              className={styles.permSelect}
                              value={permDraft[r.user_id] ?? "none"}
                              onChange={(e) =>
                                setPermDraft((prev) => ({ ...prev, [r.user_id]: e.target.value }))
                              }
                            >
                              <option value="none">No access</option>
                              <option value="read">Read only</option>
                              <option value="reply">Can reply</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.sendBtn}
                              style={{ padding: "0.3rem 0.65rem", fontSize: "0.82rem" }}
                              disabled={permSavingUser === r.user_id}
                              onClick={() => void savePermissionRow(r.user_id)}
                            >
                              {permSavingUser === r.user_id ? "…" : "Save"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className={styles.modalFoot}>
              <button type="button" className={styles.secondaryBtn} onClick={() => setPermModalConn(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
