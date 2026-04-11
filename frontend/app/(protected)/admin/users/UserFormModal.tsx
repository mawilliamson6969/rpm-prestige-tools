"use client";

import { type FormEvent, useEffect, useState } from "react";
import styles from "./users-admin.module.css";

export type ManagedUser = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "viewer";
  email: string | null;
  created_at: string;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial: ManagedUser | null;
  currentUserId: number;
  onClose: () => void;
  onSubmitCreate: (data: {
    username: string;
    password: string;
    displayName: string;
    email: string;
    role: "admin" | "viewer";
  }) => Promise<void>;
  onSubmitEdit: (data: {
    displayName: string;
    email: string;
    role: "admin" | "viewer";
    password?: string;
  }) => Promise<void>;
  /** Shown as toast alongside inline form error (optional). */
  onApiError?: (message: string) => void;
};

export default function UserFormModal({
  open,
  mode,
  initial,
  currentUserId,
  onClose,
  onSubmitCreate,
  onSubmitEdit,
  onApiError,
}: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "create") {
      setUsername("");
      setPassword("");
      setDisplayName("");
      setEmail("");
      setRole("viewer");
      return;
    }
    if (initial) {
      setUsername(initial.username);
      setPassword("");
      setDisplayName(initial.displayName);
      setEmail(initial.email ?? "");
      setRole(initial.role);
    }
  }, [open, mode, initial]);

  if (!open) return null;

  const isSelf = mode === "edit" && initial?.id === currentUserId;
  const roleDisabled = isSelf;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const d = displayName.trim();
    if (!d) {
      setError("Display name is required.");
      return;
    }
    if (mode === "create") {
      const u = username.trim().toLowerCase();
      if (!u) {
        setError("Username is required.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      setSubmitting(true);
      try {
        await onSubmitCreate({
          username: u,
          password,
          displayName: d,
          email: email.trim(),
          role,
        });
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not save.";
        setError(msg);
        onApiError?.(msg);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (password.length > 0 && password.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: {
        displayName: string;
        email: string;
        role: "admin" | "viewer";
        password?: string;
      } = {
        displayName: d,
        email: email.trim(),
        role,
      };
      if (password.trim()) {
        payload.password = password;
      }
      await onSubmitEdit(payload);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save.";
      setError(msg);
      onApiError?.(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === "create" ? "Add user" : "Edit user";

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="user-form-title" onClick={onClose}>
      <div className={styles.modal} onClick={(ev) => ev.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 id="user-form-title">{title}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={mode === "edit"}
              autoComplete="off"
              required={mode === "create"}
            />
          </label>
          <label className={styles.field}>
            <span>Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="optional"
            />
          </label>
          <label className={styles.field}>
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "viewer")} disabled={roleDisabled}>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {roleDisabled ? (
            <p className={styles.hint}>You cannot change your own role here.</p>
          ) : null}
          <label className={styles.field}>
            <span>{mode === "create" ? "Password" : "New password (optional)"}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "create" ? "new-password" : "new-password"}
              minLength={mode === "create" ? 8 : undefined}
              required={mode === "create"}
            />
          </label>
          {mode === "edit" ? <p className={styles.hint}>Leave password blank to keep the current password.</p> : null}
          {error ? (
            <div className={styles.formError} role="alert">
              {error}
            </div>
          ) : null}
          <div className={styles.formActions}>
            <button type="button" className={styles.btnCancel} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className={styles.btnSubmit} disabled={submitting}>
              {submitting ? "Saving…" : mode === "create" ? "Create user" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
