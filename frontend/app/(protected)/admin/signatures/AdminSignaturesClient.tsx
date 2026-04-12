"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SignatureManager from "../../../../components/signature/SignatureManager";
import UserMenu from "../../../../components/UserMenu";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import type { ManagedUser } from "../users/UserFormModal";
import inboxStyles from "../../inbox/inbox.module.css";

export default function AdminSignaturesClient() {
  const { authHeaders } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState<number | null>(null);

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
      if (!Array.isArray(list)) throw new Error("Invalid response.");
      setUsers(list as ManagedUser[]);
      setTargetUserId((prev) => {
        if (prev != null && list.some((u: ManagedUser) => u.id === prev)) return prev;
        return list.length ? (list[0] as ManagedUser).id : null;
      });
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load users.");
      setUsers([]);
      setTargetUserId(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  return (
    <div className={inboxStyles.page}>
      <header className={inboxStyles.topBar}>
        <div>
          <h1>Email signatures (admin)</h1>
          <p style={{ margin: "0.35rem 0 0", color: "#6a737b", fontSize: "0.9rem" }}>
            Create and edit signature templates for any team member. Personal defaults still apply when they reply.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <Link href="/admin/users" className={inboxStyles.mutedLink}>
            User management
          </Link>
          <UserMenu variant="light" />
        </div>
      </header>

      <div style={{ padding: "1.25rem", maxWidth: 720 }}>
        {listError ? (
          <p style={{ color: "#b32317", marginBottom: "1rem" }} role="alert">
            {listError}
          </p>
        ) : null}

        <div style={{ marginBottom: "1.25rem" }}>
          <label htmlFor="admin-sig-user" style={{ display: "block", fontSize: "0.78rem", color: "#6a737b", marginBottom: "0.35rem" }}>
            Team member
          </label>
          <select
            id="admin-sig-user"
            value={targetUserId ?? ""}
            onChange={(e) => setTargetUserId(Number(e.target.value) || null)}
            disabled={loading || !users.length}
            style={{
              width: "100%",
              maxWidth: 400,
              padding: "0.5rem 0.65rem",
              borderRadius: 8,
              border: "1px solid #e2e4e8",
              fontSize: "0.95rem",
              color: "#1b2856",
            }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.username})
              </option>
            ))}
          </select>
        </div>

        {loading ? <p style={{ color: "#6a737b" }}>Loading…</p> : null}

        {!loading && targetUserId != null ? (
          <SignatureManager authHeaders={authHeaders} variant="admin" targetUserId={targetUserId} />
        ) : null}
      </div>
    </div>
  );
}
