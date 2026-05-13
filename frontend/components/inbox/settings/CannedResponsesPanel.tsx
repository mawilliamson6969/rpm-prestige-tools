"use client";

import { useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import useCannedResponses, {
  type CannedResponse,
} from "../../../hooks/inbox/useCannedResponses";
import styles from "./settings.module.css";

export default function CannedResponsesPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const { canned, loading, error, create, update, remove } = useCannedResponses();

  const [editingId, setEditingId] = useState<number | "new" | null>(null);

  return (
    <>
      <header className={styles.hd}>
        <div>
          <h1 className={styles.title}>Canned responses</h1>
          <p className={styles.sub}>
            Pre-written replies usable from the composer. Shared responses
            are visible to the whole team; personal ones are yours alone.
            Shortcuts like <code>/ack-maint</code> let you insert by typing
            the trigger in the reply body (composer auto-expand wires up in
            a follow-up).
          </p>
        </div>
        <div className={styles.hdActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setEditingId(editingId === "new" ? null : "new")}
          >
            {editingId === "new" ? "Cancel" : "+ New response"}
          </button>
        </div>
      </header>

      {editingId === "new" ? (
        <CannedEditor
          isAdmin={isAdmin}
          initial={null}
          onCancel={() => setEditingId(null)}
          onSave={async (payload) => {
            const r = await create(payload);
            if (r.ok) setEditingId(null);
            return r;
          }}
        />
      ) : null}

      {error ? (
        <div className={styles.empty}>Couldn&rsquo;t load canned responses — {error}.</div>
      ) : loading && canned.length === 0 ? (
        <div className={styles.empty}>Loading canned responses…</div>
      ) : canned.length === 0 ? (
        <div className={styles.empty}>No canned responses yet.</div>
      ) : (
        <div className={styles.card}>
          {canned.map((c) =>
            editingId === c.id ? (
              <div key={c.id} style={{ padding: 14 }}>
                <CannedEditor
                  isAdmin={isAdmin}
                  initial={c}
                  onCancel={() => setEditingId(null)}
                  onSave={async (payload) => {
                    const r = await update(c.id, payload);
                    if (r.ok) setEditingId(null);
                    return r;
                  }}
                />
              </div>
            ) : (
              <CannedRow
                key={c.id}
                canned={c}
                isAdmin={isAdmin}
                onEdit={() => setEditingId(c.id)}
                onDelete={async () => {
                  if (!window.confirm(`Delete canned response "${c.name}"?`)) return;
                  await remove(c.id);
                }}
              />
            )
          )}
        </div>
      )}
    </>
  );
}

function CannedRow({
  canned,
  isAdmin,
  onEdit,
  onDelete,
}: {
  canned: CannedResponse;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const canMutate = isAdmin || canned.owner_id != null; // own + admin
  return (
    <div className={styles.cannedRow}>
      <div className={styles.cannedMain}>
        <div className={styles.cannedName}>
          {canned.name}
          {canned.shortcut ? (
            <span className={styles.cannedShortcut}>{canned.shortcut}</span>
          ) : null}
          <span
            className={`${styles.badge} ${canned.is_shared ? styles.badgeShared : ""}`}
          >
            {canned.is_shared ? "Shared" : "Personal"}
          </span>
        </div>
        <div className={styles.cannedBody}>{canned.body}</div>
        <div className={styles.cannedMeta}>
          Used {canned.use_count} {canned.use_count === 1 ? "time" : "times"}
        </div>
      </div>
      {canMutate ? (
        <div className={styles.tableRowAction}>
          <button type="button" className={styles.btn} onClick={onEdit}>
            Edit
          </button>
          <button type="button" className={styles.btn} onClick={onDelete}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CannedEditor({
  initial,
  isAdmin,
  onCancel,
  onSave,
}: {
  initial: CannedResponse | null;
  isAdmin: boolean;
  onCancel: () => void;
  onSave: (payload: {
    name: string;
    body: string;
    shortcut?: string | null;
    is_shared?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [shortcut, setShortcut] = useState(initial?.shortcut ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [isShared, setIsShared] = useState(initial?.is_shared ?? false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className={styles.card} style={{ marginBottom: 16, padding: 14 }}>
      <div className={styles.formRow} style={{ marginBottom: 8 }}>
        <input
          className={styles.input}
          placeholder="Name (shown in the picker)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <input
          className={styles.input}
          placeholder="Shortcut (optional, e.g. /ack)"
          value={shortcut}
          onChange={(e) => setShortcut(e.target.value)}
          style={{ width: 200 }}
        />
        <label
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-2)" }}
          title={isAdmin ? "Visible to the whole team" : "Only admins can promote to shared"}
        >
          <input
            type="checkbox"
            checked={isShared}
            disabled={!isAdmin}
            onChange={(e) => setIsShared(e.target.checked)}
          />
          Shared
        </label>
      </div>
      <textarea
        className={styles.textarea}
        placeholder="Response body — supports plain-text + simple line breaks. {placeholders} aren't auto-replaced yet."
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {err ? <div style={{ marginTop: 8, color: "#B32317", fontSize: 12 }}>{err}</div> : null}
      <div className={styles.formRow} style={{ marginTop: 10, justifyContent: "flex-end" }}>
        <button type="button" className={styles.btn} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={saving || !name.trim() || !body.trim()}
          onClick={async () => {
            setSaving(true);
            setErr(null);
            const r = await onSave({
              name: name.trim(),
              body: body.trim(),
              shortcut: shortcut.trim() || null,
              is_shared: isShared,
            });
            setSaving(false);
            if (!r.ok) setErr(r.error ?? "Save failed.");
          }}
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Create"}
        </button>
      </div>
    </div>
  );
}
