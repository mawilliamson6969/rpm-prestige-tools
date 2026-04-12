"use client";

import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../../lib/api";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import SignatureRichEditor from "./SignatureRichEditor";
import styles from "./signature-manager.module.css";

export type EmailSignatureRow = {
  id: number;
  userId?: number;
  name: string;
  signatureHtml: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type AuthHeaders = () => Record<string, string>;

type Props = {
  authHeaders: AuthHeaders;
  variant: "inbox" | "admin";
  /** Required when variant is admin */
  targetUserId?: number | null;
};

export default function SignatureManager({ authHeaders, variant, targetUserId }: Props) {
  const [rows, setRows] = useState<EmailSignatureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; sig: EmailSignatureRow }
    | null
  >(null);

  const listUrl = useCallback(() => {
    if (variant === "admin") {
      if (targetUserId == null) return null;
      return apiUrl(`/admin/signatures?userId=${targetUserId}`);
    }
    return apiUrl("/inbox/signatures");
  }, [variant, targetUserId]);

  const load = useCallback(async () => {
    const url = listUrl();
    if (!url) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { cache: "no-store", headers: { ...authHeaders() } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status}).`);
      }
      const list = body.signatures;
      if (!Array.isArray(list)) throw new Error("Invalid response.");
      setRows(list as EmailSignatureRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load signatures.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, listUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const postUrl = variant === "admin" ? apiUrl("/admin/signatures") : apiUrl("/inbox/signatures");
  const itemBase = variant === "admin" ? "/admin/signatures" : "/inbox/signatures";

  const remove = async (id: number) => {
    if (!confirm("Delete this signature?")) return;
    const res = await fetch(apiUrl(`${itemBase}/${id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (res.ok) load();
    else {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Could not delete.");
    }
  };

  const setDefault = async (id: number) => {
    const res = await fetch(apiUrl(`${itemBase}/${id}/default`), {
      method: "PUT",
      headers: { ...authHeaders() },
    });
    if (res.ok) load();
    else {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Could not set default.");
    }
  };

  if (variant === "admin" && (targetUserId == null || targetUserId < 1)) {
    return <p className={styles.hint}>Select a team member to manage signatures.</p>;
  }

  return (
    <section className={styles.section} aria-labelledby="signatures-heading">
      <h2 id="signatures-heading" className={styles.heading}>
        Signatures
      </h2>
      <p className={styles.hint}>
        Create multiple signatures and choose one when you reply. The default is selected automatically for new replies.
      </p>
      {error ? (
        <p style={{ color: "#b32317", fontSize: "0.9rem", marginBottom: "0.75rem" }} role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.loading}>Loading signatures…</p>
      ) : rows.length === 0 ? (
        <p className={styles.hint}>No signatures yet. Add one to get started.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((s) => (
            <li key={s.id} className={styles.card}>
              <div>
                <p className={styles.cardTitle}>
                  {s.name}
                  {s.isDefault ? (
                    <span className={styles.badge} title="Default for replies">
                      Default
                    </span>
                  ) : null}
                </p>
                <div
                  className={styles.preview}
                  dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(s.signatureHtml || "<p>(empty)</p>") }}
                />
              </div>
              <div className={styles.actions}>
                {!s.isDefault ? (
                  <button type="button" className={styles.btn} onClick={() => setDefault(s.id)}>
                    Set default
                  </button>
                ) : null}
                <button type="button" className={styles.btn} onClick={() => setModal({ mode: "edit", sig: s })}>
                  Edit
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => remove(s.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.addBtn} onClick={() => setModal({ mode: "create" })}>
        Add signature
      </button>

      {modal ? (
        <SignatureEditModal
          key={modal.mode === "edit" ? `e-${modal.sig.id}` : "new"}
          variant={variant}
          targetUserId={targetUserId ?? undefined}
          mode={modal.mode}
          initial={modal.mode === "edit" ? modal.sig : null}
          postUrl={postUrl}
          itemBase={itemBase}
          authHeaders={authHeaders}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      ) : null}
    </section>
  );
}

function SignatureEditModal({
  variant,
  targetUserId,
  mode,
  initial,
  postUrl,
  itemBase,
  authHeaders,
  onClose,
  onSaved,
}: {
  variant: "inbox" | "admin";
  targetUserId?: number;
  mode: "create" | "edit";
  initial: EmailSignatureRow | null;
  postUrl: string;
  itemBase: string;
  authHeaders: AuthHeaders;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [html, setHtml] = useState(initial?.signatureHtml ?? "<p><br></p>");
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    setName(initial?.name ?? "");
    setHtml(initial?.signatureHtml ?? "<p><br></p>");
    setIsDefault(initial?.isDefault ?? false);
    setResetKey((k) => k + 1);
  }, [initial]);

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        signatureHtml: html,
        isDefault,
      };
      if (variant === "admin" && targetUserId != null) payload.userId = targetUserId;

      const url = mode === "edit" && initial ? apiUrl(`${itemBase}/${initial.id}`) : postUrl;
      const method = mode === "edit" ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(typeof body.error === "string" ? body.error : "Could not save.");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sig-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 id="sig-modal-title">{mode === "create" ? "New signature" : "Edit signature"}</h3>
        <div className={styles.field}>
          <label htmlFor="sig-name">Signature name</label>
          <input
            id="sig-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Standard, Formal, Short"
            maxLength={100}
            autoComplete="off"
          />
        </div>
        <div className={styles.field}>
          <span className={styles.previewTitle} style={{ marginBottom: "0.35rem", display: "block" }}>
            Signature
          </span>
          <SignatureRichEditor resetKey={resetKey} initialHtml={html} onChange={setHtml} />
        </div>
        <p className={styles.previewTitle}>Live preview (as in email)</p>
        <div
          className={styles.previewBox}
          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(html || "<p>(empty)</p>") }}
        />
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Set as default signature
        </label>
        <div className={styles.modalActions}>
          <button type="button" className={styles.saveBtn} disabled={saving || !name.trim()} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
