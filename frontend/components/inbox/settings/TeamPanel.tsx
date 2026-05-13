"use client";

// Phase 8 — Team settings panel. Wires to the existing /users endpoints
// (F2). Read-only for non-admins; admins can change role + active flag.
// Adding new users + password reset stays in the existing /admin/users
// page; we link out there to avoid duplicating that flow.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import { parseApiError } from "../../../lib/apiResult";
import styles from "./settings.module.css";

type TeamUser = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  active?: boolean;
};

const ROLES = ["owner", "admin", "csm", "maintenance", "operations", "staff"];

export default function TeamPanel() {
  const { user, authHeaders, token } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/users"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      const list = Array.isArray(body) ? body : Array.isArray(body.users) ? body.users : [];
      setUsers(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const updateUser = useCallback(
    async (id: number, patch: { role?: string; active?: boolean }) => {
      setSavingId(id);
      try {
        const res = await fetch(apiUrl(`/users/${id}`), {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          await refetch();
          return;
        }
        // Optimistic refresh; server may massage the row.
        setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
      } finally {
        setSavingId(null);
      }
    },
    [authHeaders, refetch]
  );

  return (
    <>
      <header className={styles.hd}>
        <div>
          <h1 className={styles.title}>Team</h1>
          <p className={styles.sub}>
            Roles drive permissions across the workspace. To add a new
            user, set a password, or deactivate an account, use the{" "}
            <Link href="/admin/users" style={{ color: "var(--accent)", textDecoration: "underline" }}>
              User Management
            </Link>{" "}
            page.
          </p>
        </div>
      </header>

      {error ? (
        <div className={styles.empty}>Couldn&rsquo;t load users — {error}.</div>
      ) : loading && users.length === 0 ? (
        <div className={styles.empty}>Loading users…</div>
      ) : users.length === 0 ? (
        <div className={styles.empty}>No team members yet.</div>
      ) : (
        <div className={styles.card}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th className={styles.right}>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === user?.id;
                const isInactive = u.active === false;
                return (
                  <tr key={u.id} style={{ opacity: isInactive ? 0.6 : 1 }}>
                    <td>{u.displayName || "—"}</td>
                    <td style={{ color: "var(--text-3)" }}>{u.username}</td>
                    <td style={{ color: "var(--text-3)" }}>{u.email || "—"}</td>
                    <td>
                      {isAdmin && !isSelf ? (
                        <select
                          value={u.role}
                          disabled={savingId === u.id}
                          onChange={(e) => void updateUser(u.id, { role: e.target.value })}
                          className={styles.input}
                          style={{ width: 140 }}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-2)" }}>{u.role}</span>
                      )}
                    </td>
                    <td className={styles.right}>
                      {isInactive ? (
                        <span className={styles.badge}>Inactive</span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeShared}`}>Active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
