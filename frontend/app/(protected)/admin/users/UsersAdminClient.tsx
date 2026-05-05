"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import UserFormModal, { type EditableRole, type ManagedUser } from "./UserFormModal";
import styles from "./users-admin.module.css";

type Toast = { id: string; type: "success" | "error"; message: string };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  csm: "Client Success",
  maintenance: "Maintenance",
  operations: "Operations",
  staff: "Staff",
  viewer: "Staff", // legacy
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

export default function UsersAdminClient() {
  const { authHeaders, user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showInactive, setShowInactive] = useState(true);
  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; user: ManagedUser }
    | null
  >(null);

  const pushToast = useCallback((type: Toast["type"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const url = showInactive ? "/users?include=inactive" : "/users";
      const res = await fetch(apiUrl(url), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status}).`);
      }
      const list = body.users;
      if (!Array.isArray(list)) {
        throw new Error("Invalid response.");
      }
      setUsers(list as ManagedUser[]);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, showInactive]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async (data: {
    username: string;
    password: string;
    displayName: string;
    email: string;
    role: EditableRole;
  }) => {
    const res = await fetch(apiUrl("/users"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        username: data.username,
        password: data.password,
        displayName: data.displayName,
        email: data.email || null,
        role: data.role,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body.error === "string" ? body.error : `Create failed (${res.status}).`);
    }
    pushToast("success", `User ${data.username} was created.`);
    await loadUsers();
  };

  const handleEdit = async (
    id: number,
    data: { displayName: string; email: string; role: EditableRole; password?: string }
  ) => {
    const payload: Record<string, unknown> = {
      displayName: data.displayName,
      email: data.email || null,
      role: data.role,
    };
    if (data.password) {
      payload.password = data.password;
    }
    const res = await fetch(apiUrl(`/users/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body.error === "string" ? body.error : `Update failed (${res.status}).`);
    }
    pushToast("success", "User updated.");
    await loadUsers();
  };

  const setActive = async (u: ManagedUser, active: boolean) => {
    try {
      const res = await fetch(apiUrl(`/users/${u.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast("error", typeof body.error === "string" ? body.error : "Update failed.");
        return;
      }
      pushToast(
        "success",
        active
          ? `Reactivated ${u.displayName?.trim() || u.username}.`
          : `Deactivated ${u.displayName?.trim() || u.username}.`
      );
      await loadUsers();
    } catch {
      pushToast("error", active ? "Reactivation failed." : "Deactivation failed.");
    }
  };

  const confirmDeactivate = (u: ManagedUser) => {
    const name = u.displayName?.trim() || u.username;
    const ok = window.confirm(
      `Deactivate ${name}? Their login is disabled immediately, and they're removed from assignee pickers, but their history stays for audit.`
    );
    if (ok) void setActive(u, false);
  };

  const currentId = currentUser?.id ?? -1;

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.titleBlock}>
          <h1>User Management</h1>
          <p className={styles.sub}>Real Property Management Prestige — team accounts</p>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.toolbar}>
          <p style={{ margin: 0, color: "var(--grey)", fontSize: "0.95rem" }}>
            Manage login accounts, roles, and access.{" "}
            <Link href="/admin/signatures" style={{ color: "var(--blue)", fontWeight: 600 }}>
              Email signatures
            </Link>
          </p>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show deactivated
          </label>
          <button type="button" className={styles.addBtn} onClick={() => setModal({ mode: "create" })}>
            Add team member
          </button>
        </div>

        {listError ? <div className={styles.errorBanner}>{listError}</div> : null}

        <div className={styles.card}>
          {loading ? (
            <div className={styles.empty}>Loading users…</div>
          ) : users.length === 0 && !listError ? (
            <div className={styles.empty}>No users found.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Display name</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const inactive = u.active === false;
                    return (
                      <tr key={u.id} style={inactive ? { opacity: 0.6 } : undefined}>
                        <td>{u.username}</td>
                        <td>{u.displayName}</td>
                        <td>
                          <span
                            className={`${styles.rolePill} ${
                              u.role === "admin" || u.role === "owner"
                                ? styles.roleAdmin
                                : styles.roleViewer
                            }`}
                          >
                            {ROLE_LABEL[u.role] ?? u.role}
                          </span>
                        </td>
                        <td>{u.email ?? "—"}</td>
                        <td>{inactive ? "Deactivated" : "Active"}</td>
                        <td>{formatDate(u.lastLoginAt ?? null)}</td>
                        <td>
                          <div className={styles.rowActions}>
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() => setModal({ mode: "edit", user: u })}
                            >
                              Edit
                            </button>
                            {u.id !== currentId && !inactive ? (
                              <button
                                type="button"
                                className={`${styles.actionBtn} ${styles.actionDanger}`}
                                onClick={() => confirmDeactivate(u)}
                              >
                                Deactivate
                              </button>
                            ) : null}
                            {u.id !== currentId && inactive ? (
                              <button
                                type="button"
                                className={styles.actionBtn}
                                onClick={() => void setActive(u, true)}
                              >
                                Reactivate
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <div className={styles.toastHost} aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${styles.toast} ${t.type === "success" ? styles.toastSuccess : styles.toastError}`}
          >
            {t.message}
          </div>
        ))}
      </div>

      <UserFormModal
        open={modal !== null}
        mode={modal?.mode ?? "create"}
        initial={modal?.mode === "edit" ? modal.user : null}
        currentUserId={currentId}
        onClose={() => setModal(null)}
        onSubmitCreate={async (data) => {
          await handleCreate(data);
        }}
        onSubmitEdit={async (data) => {
          if (modal?.mode !== "edit") return;
          await handleEdit(modal.user.id, data);
        }}
        onApiError={(message) => pushToast("error", message)}
      />
    </div>
  );
}
