"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../operations.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type {
  ProcessEmailTemplate,
  ProcessTextTemplate,
  ProcessTypeRole,
  TeamUser,
} from "../../types";

const MERGE_FIELDS = [
  "{{tenant.first_name}}",
  "{{tenant.last_name}}",
  "{{tenant.email}}",
  "{{property.address}}",
  "{{property.city}}",
  "{{owner.first_name}}",
  "{{owner.last_name}}",
  "{{process.name}}",
  "{{process.start_date}}",
];

function MergeFieldPicker({ onPick }: { onPick: (field: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
      {MERGE_FIELDS.map((f) => (
        <button
          key={f}
          type="button"
          className={styles.cfChip}
          onClick={() => onPick(f)}
          title="Click to insert"
        >
          {f}
        </button>
      ))}
    </div>
  );
}

/* ---------- Roles tab ---------- */

export function RolesPanel({ templateId, users }: { templateId: number; users: TeamUser[] }) {
  const { authHeaders, token } = useAuth();
  const [roles, setRoles] = useState<ProcessTypeRole[]>([]);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${templateId}/roles`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.roles)) setRoles(body.roles);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, templateId]);

  useEffect(() => {
    load();
  }, [load]);

  const addRole = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${templateId}/roles`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ roleName: name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Add failed");
      setNewName("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add role.");
    }
  };

  const updateRole = async (role: ProcessTypeRole, patch: Partial<ProcessTypeRole>) => {
    setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, ...patch } : r)));
    try {
      await fetch(apiUrl(`/processes/process-type-roles/${role.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
    } catch {
      /* ignore */
    }
  };

  const deleteRole = async (role: ProcessTypeRole) => {
    if (!confirm(`Delete role "${role.roleName}"?`)) return;
    try {
      await fetch(apiUrl(`/processes/process-type-roles/${role.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await load();
    } catch {
      /* ignore */
    }
  };

  // Avoid the "users prop unused in dev" warning while keeping the prop for future
  // assignee preview.
  void users;

  return (
    <div>
      <div className={styles.cfSection}>
        <div className={styles.cfSectionHeader}>
          <h4>Role slots</h4>
        </div>
        <div className={styles.cfSectionBody}>
          <p style={{ fontSize: "0.85rem", color: "#6a737b", margin: "0 0 0.75rem" }}>
            Define the role slots that show up on every process from this template — Process
            Owner, CSM, Maintenance Coordinator, etc. Assign actual people to these slots
            from each running process.
          </p>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <input
              className={styles.cfInput}
              placeholder="New role name (e.g. Process Owner)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addRole();
              }}
              style={{ flex: 1 }}
            />
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={addRole}>
              + Add
            </button>
          </div>

          {roles.length === 0 ? (
            <div
              style={{
                fontSize: "0.85rem",
                color: "#6a737b",
                padding: "0.75rem 1rem",
                border: "1px dashed rgba(27, 40, 86, 0.15)",
                borderRadius: 8,
              }}
            >
              No roles yet. Add a role above to create slots for assignees.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {roles.map((role) => (
                <div
                  key={role.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 0.75rem",
                    background: "rgba(27, 40, 86, 0.03)",
                    border: "1px solid rgba(27, 40, 86, 0.08)",
                    borderRadius: 8,
                  }}
                >
                  <input
                    value={role.roleName}
                    onChange={(e) =>
                      setRoles((prev) =>
                        prev.map((r) =>
                          r.id === role.id ? { ...r, roleName: e.target.value } : r
                        )
                      )
                    }
                    onBlur={(e) => updateRole(role, { roleName: e.target.value.trim() })}
                    className={styles.cfInput}
                    style={{ flex: 1, fontWeight: 600 }}
                  />
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      fontSize: "0.82rem",
                      color: "#1b2856",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={role.isRequired}
                      onChange={(e) => updateRole(role, { isRequired: e.target.checked })}
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                    onClick={() => deleteRole(role)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Email Templates tab ---------- */

export function EmailTemplatesPanel({ templateId }: { templateId: number }) {
  const { authHeaders, token } = useAuth();
  const [items, setItems] = useState<ProcessEmailTemplate[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    subject: string;
    bodyHtml: string;
  }>({ name: "", subject: "", bodyHtml: "" });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${templateId}/email-templates`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.templates)) setItems(body.templates);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, templateId]);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setDraft({ name: "", subject: "", bodyHtml: "" });
    setEditing("new");
  };

  const startEdit = (t: ProcessEmailTemplate) => {
    setDraft({ name: t.name, subject: t.subject, bodyHtml: t.bodyHtml });
    setEditing(t.id);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      setErr("Name is required.");
      return;
    }
    setErr(null);
    try {
      if (editing === "new") {
        const res = await fetch(apiUrl(`/processes/templates/${templateId}/email-templates`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error("Save failed");
      } else if (typeof editing === "number") {
        const res = await fetch(apiUrl(`/processes/email-templates/${editing}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error("Save failed");
      }
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this email template?")) return;
    try {
      await fetch(apiUrl(`/processes/email-templates/${id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await load();
    } catch {
      /* ignore */
    }
  };

  const insertMerge = (field: string) => {
    setDraft((prev) => ({ ...prev, bodyHtml: `${prev.bodyHtml}${field}` }));
  };

  return (
    <div className={styles.cfSection}>
      <div className={styles.cfSectionHeader}>
        <h4>Email templates ({items.length})</h4>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={startNew}>
          + New email template
        </button>
      </div>
      <div className={styles.cfSectionBody}>
        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {editing != null ? (
          <div
            style={{
              padding: "0.75rem",
              border: "1px solid rgba(0, 152, 208, 0.3)",
              borderRadius: 8,
              background: "rgba(0, 152, 208, 0.04)",
              marginBottom: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
            }}
          >
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Template name</span>
              <input
                className={styles.cfInput}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="(Tenant) Schedule Inspection"
              />
            </label>
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Subject</span>
              <input
                className={styles.cfInput}
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                placeholder="Schedule your inspection — {{property.address}}"
              />
            </label>
            <div className={styles.cfField}>
              <span className={styles.cfLabel}>Body</span>
              <textarea
                className={styles.cfInput}
                rows={10}
                value={draft.bodyHtml}
                onChange={(e) => setDraft({ ...draft, bodyHtml: e.target.value })}
                placeholder="Hi {{tenant.first_name}},&#10;&#10;We need to schedule the inspection for {{property.address}}…"
                style={{ fontFamily: "Menlo, monospace", fontSize: "0.85rem", resize: "vertical" }}
              />
            </div>
            <div>
              <div className={styles.cfLabel} style={{ marginBottom: "0.3rem" }}>
                Merge fields (click to insert)
              </div>
              <MergeFieldPicker onPick={insertMerge} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={save}>
                Save
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {items.length === 0 && editing == null ? (
          <div
            style={{
              fontSize: "0.85rem",
              color: "#6a737b",
              padding: "0.75rem 1rem",
              border: "1px dashed rgba(27, 40, 86, 0.15)",
              borderRadius: 8,
            }}
          >
            No email templates yet. Click "+ New email template" to add one.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {items.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.3rem",
                  padding: "0.75rem",
                  background: "rgba(27, 40, 86, 0.03)",
                  border: "1px solid rgba(27, 40, 86, 0.08)",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#1b2856" }}>{t.name}</div>
                    <div style={{ fontSize: "0.82rem", color: "#6a737b" }}>{t.subject || "—"}</div>
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "#6a737b",
                      whiteSpace: "nowrap",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                    }}
                  >
                    <span>📤 {t.totalSends} sent</span>
                    <span>👁 {t.totalOpens} opens · 🖱 {t.totalClicks} clicks</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.3rem" }}>
                  <button type="button" className={styles.smallBtn} onClick={() => startEdit(t)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                    onClick={() => remove(t.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Text Templates tab ---------- */

export function TextTemplatesPanel({ templateId }: { templateId: number }) {
  const { authHeaders, token } = useAuth();
  const [items, setItems] = useState<ProcessTextTemplate[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<{ name: string; body: string }>({ name: "", body: "" });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${templateId}/text-templates`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.templates)) setItems(body.templates);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, templateId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft.name.trim()) {
      setErr("Name is required.");
      return;
    }
    setErr(null);
    try {
      if (editing === "new") {
        const res = await fetch(apiUrl(`/processes/templates/${templateId}/text-templates`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error("Save failed");
      } else if (typeof editing === "number") {
        const res = await fetch(apiUrl(`/processes/text-templates/${editing}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error("Save failed");
      }
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this text template?")) return;
    try {
      await fetch(apiUrl(`/processes/text-templates/${id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await load();
    } catch {
      /* ignore */
    }
  };

  const insertMerge = (field: string) => {
    setDraft((prev) => ({ ...prev, body: `${prev.body}${field}` }));
  };

  return (
    <div className={styles.cfSection}>
      <div className={styles.cfSectionHeader}>
        <h4>Text message templates ({items.length})</h4>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => {
            setDraft({ name: "", body: "" });
            setEditing("new");
          }}
        >
          + New text template
        </button>
      </div>
      <div className={styles.cfSectionBody}>
        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {editing != null ? (
          <div
            style={{
              padding: "0.75rem",
              border: "1px solid rgba(0, 152, 208, 0.3)",
              borderRadius: 8,
              background: "rgba(0, 152, 208, 0.04)",
              marginBottom: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
            }}
          >
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Template name</span>
              <input
                className={styles.cfInput}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>
                Body ({draft.body.length} / 320 chars)
              </span>
              <textarea
                className={styles.cfInput}
                rows={5}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                style={{ resize: "vertical" }}
              />
            </label>
            <div>
              <div className={styles.cfLabel} style={{ marginBottom: "0.3rem" }}>
                Merge fields
              </div>
              <MergeFieldPicker onPick={insertMerge} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={save}>
                Save
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {items.length === 0 && editing == null ? (
          <div
            style={{
              fontSize: "0.85rem",
              color: "#6a737b",
              padding: "0.75rem 1rem",
              border: "1px dashed rgba(27, 40, 86, 0.15)",
              borderRadius: 8,
            }}
          >
            No text templates yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {items.map((t) => (
              <div
                key={t.id}
                style={{
                  padding: "0.75rem",
                  background: "rgba(27, 40, 86, 0.03)",
                  border: "1px solid rgba(27, 40, 86, 0.08)",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#1b2856" }}>{t.name}</div>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "#6a737b",
                        whiteSpace: "pre-wrap",
                        marginTop: "0.2rem",
                      }}
                    >
                      {t.body.length > 160 ? `${t.body.slice(0, 160)}…` : t.body}
                    </div>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#6a737b", whiteSpace: "nowrap" }}>
                    📤 {t.totalSends}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={() => {
                      setDraft({ name: t.name, body: t.body });
                      setEditing(t.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                    onClick={() => remove(t.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
