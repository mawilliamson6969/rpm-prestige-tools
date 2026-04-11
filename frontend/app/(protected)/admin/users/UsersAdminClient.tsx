"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import UserMenu from "../../../../components/UserMenu";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import UserFormModal, { type ManagedUser } from "./UserFormModal";
import styles from "./users-admin.module.css";

type Toast = { id: string; type: "success" | "error"; message: string };

function formatCreated(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function UsersAdminClient() {
  const { authHeaders, user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
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
      const res = await fetch(apiUrl("/users"), {
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
  }, [authHeaders]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async (data: {
    username: string;
    password: string;
    displayName: string;
    email: string;
    role: "admin" | "viewer";
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
    data: { displayName: string; email: string; role: "admin" | "viewer"; password?: string }
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
      method: "PUT",
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

  const confirmDelete = (u: ManagedUser) => {
    const name = u.displayName?.trim() || u.username;
    const ok = window.confirm(
      `Are you sure you want to remove ${name}? This cannot be undone.`
    );
    if (!ok) return;
    void (async () => {
      try {
        const res = await fetch(apiUrl(`/users/${u.id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          pushToast("error", typeof body.error === "string" ? body.error : "Delete failed.");
          return;
        }
        pushToast("success", `Removed ${name}.`);
        await loadUsers();
      } catch {
        pushToast("error", "Delete failed.");
      }
    })();
  };

  const currentId = currentUser?.id ?? -1;

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.titleBlock}>
          <Link href="/" className={styles.backLink}>
            ← Team Hub
          </Link>
          <h1>User Management</h1>
          <p className={styles.sub}>Real Property Management Prestige — team accounts</p>
        </div>
        <div className={styles.topBarRight}>
          <UserMenu />
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.toolbar}>
          <p style={{ margin: 0, color: "var(--grey)", fontSize: "0.95rem" }}>
            Manage login accounts and roles for the intranet.
          </p>
          <button type="button" className={styles.addBtn} onClick={() => setModal({ mode: "create" })}>
            Add user
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
                    <th>Created</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.displayName}</td>
                      <td>
                        <span
                          className={`${styles.rolePill} ${u.role === "admin" ? styles.roleAdmin : styles.roleViewer}`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td>{u.email ?? "—"}</td>
                      <td>{formatCreated(u.created_at)}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => setModal({ mode: "edit", user: u })}
                          >
                            Edit
                          </button>
                          {u.id !== currentId ? (
                            <button
                              type="button"
                              className={`${styles.actionBtn} ${styles.actionDanger}`}
                              onClick={() => confirmDelete(u)}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
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
