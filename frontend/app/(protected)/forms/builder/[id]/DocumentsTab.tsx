"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../../forms.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type { FormField } from "../../types";

type DocTemplate = {
  id: number;
  formId: number;
  name: string;
  description: string | null;
  templateType: string;
  templateContent: string;
  isActive: boolean;
};

export default function DocumentsTab({ formId, fields }: { formId: number; fields: FormField[] }) {
  const { authHeaders, token } = useAuth();
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DocTemplate | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/forms/${formId}/document-templates`), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed.");
      setTemplates(body.templates || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load templates.");
    } finally {
      setLoading(false);
    }
  }, [formId, authHeaders, token]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    if (!confirm("Delete this document template?")) return;
    await fetch(apiUrl(`/forms/document-templates/${id}`), {
      method: "DELETE", headers: { ...authHeaders() },
    });
    await load();
  };

  const startNew = () => {
    setEditing({
      id: 0, formId,
      name: "",
      description: "",
      templateType: "pdf",
      templateContent: "# Document Title\n\nHello {{field:first_name}},\n\n{{form_name}} was submitted on {{submission_date}}.\n\n---\n\n## Details\n\nProperty: {{property_name}}\nEmail: {{field:email}}",
      isActive: true,
    });
  };

  return (
    <div className={styles.main}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, color: "#1b2856", fontSize: "1.15rem", fontWeight: 700 }}>Document Templates</h2>
          <p style={{ margin: "0.25rem 0 0", color: "#6a737b", fontSize: "0.85rem" }}>
            Generate PDFs from submission data using variable placeholders.
          </p>
        </div>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={startNew}>
          + New Template
        </button>
      </div>
      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : templates.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No document templates yet</h3>
          <p>Create a template to generate branded PDFs from submissions.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 860 }}>
          {templates.map((t) => (
            <div key={t.id} className={styles.autoCard}>
              <div className={styles.autoCardTop}>
                <div>
                  <div className={styles.autoName}>{t.name}</div>
                  {t.description ? (
                    <div style={{ fontSize: "0.82rem", color: "#6a737b" }}>{t.description}</div>
                  ) : null}
                </div>
                <div className={styles.autoActions}>
                  <button type="button" className={styles.smallBtn} onClick={() => setEditing(t)}>Edit</button>
                  <button type="button" className={styles.smallBtn} onClick={() => remove(t.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <DocEditor
          template={editing}
          fields={fields}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      ) : null}
    </div>
  );
}

function DocEditor({
  template, fields, onClose, onSaved,
}: {
  template: DocTemplate;
  fields: FormField[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { authHeaders } = useAuth();
  const [draft, setDraft] = useState(template);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [varOpen, setVarOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVar = (token: string) => {
    const el = textareaRef.current;
    const content = draft.templateContent;
    if (!el) {
      setDraft({ ...draft, templateContent: content + token });
      setVarOpen(false);
      return;
    }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const next = content.slice(0, start) + token + content.slice(end);
    setDraft({ ...draft, templateContent: next });
    setVarOpen(false);
    setTimeout(() => {
      el.focus();
      const pos = start + token.length;
      try { el.setSelectionRange(pos, pos); } catch {/* ignore */}
    }, 0);
  };

  const inputFields = fields.filter(
    (f) => !["heading", "paragraph", "divider", "spacer"].includes(f.fieldType)
  );
  const vars = [
    { token: "{{form_name}}", label: "Form name" },
    { token: "{{submission_id}}", label: "Submission ID" },
    { token: "{{submission_date}}", label: "Submission date" },
    { token: "{{date}}", label: "Today's date" },
    { token: "{{property_name}}", label: "Property name" },
    { token: "{{contact_name}}", label: "Contact name" },
    { token: "{{contact_email}}", label: "Contact email" },
    ...inputFields.map((f) => ({ token: `{{field:${f.fieldKey}}}`, label: `Field: ${f.label}` })),
    { token: "[sig:signature]", label: "Signature image (replace 'signature' with field key)" },
  ];

  const preview = useMemo(() => {
    const sampleData: Record<string, string> = {};
    for (const f of inputFields) {
      sampleData[f.fieldKey] = f.fieldType === "email" ? "jane@example.com"
        : f.fieldType === "phone" ? "(555) 555-5555"
        : `[${f.label}]`;
    }
    return draft.templateContent
      .replace(/\{\{form_name\}\}/g, "[Form Name]")
      .replace(/\{\{submission_id\}\}/g, "1234")
      .replace(/\{\{submission_date\}\}/g, new Date().toLocaleString())
      .replace(/\{\{date\}\}/g, new Date().toLocaleDateString())
      .replace(/\{\{property_name\}\}/g, "[Property Name]")
      .replace(/\{\{contact_name\}\}/g, "Jane Doe")
      .replace(/\{\{contact_email\}\}/g, "jane@example.com")
      .replace(/\{\{field:([a-z0-9_]+)\}\}/gi, (_m, k) => sampleData[k] ?? `[${k}]`)
      .replace(/\[sig:[^\]]+\]/g, "— signature —");
  }, [draft.templateContent, inputFields]);

  const save = async () => {
    if (!draft.name.trim()) { setErr("Name is required."); return; }
    setSaving(true);
    setErr(null);
    try {
      if (draft.id === 0) {
        const res = await fetch(apiUrl(`/forms/${draft.formId}/document-templates`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            name: draft.name, description: draft.description,
            templateType: draft.templateType, templateContent: draft.templateContent,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Save failed.");
        }
      } else {
        await fetch(apiUrl(`/forms/document-templates/${draft.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            name: draft.name, description: draft.description,
            templateContent: draft.templateContent,
          }),
        });
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{draft.id === 0 ? "New Document Template" : "Edit Document Template"}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Name *</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label>Description</label>
            <input
              type="text"
              value={draft.description || ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <strong style={{ color: "#1b2856", fontSize: "0.85rem" }}>Template (Markdown-lite)</strong>
              <div className={styles.varBtnWrap}>
                <button type="button" className={styles.varBtn} onClick={() => setVarOpen((o) => !o)}>
                  Insert ▾
                </button>
                {varOpen ? (
                  <div className={styles.varDropdown}>
                    {vars.map((v) => (
                      <button key={v.token} type="button" className={styles.varItem} onClick={() => insertVar(v.token)}>
                        {v.label}
                        <div className={styles.varItemCode}>{v.token}</div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className={styles.docSplit}>
              <div className={styles.docEditor}>
                <textarea
                  ref={textareaRef}
                  value={draft.templateContent}
                  onChange={(e) => setDraft({ ...draft, templateContent: e.target.value })}
                />
                <p className={styles.hint || ""} style={{ fontSize: "0.78rem", color: "#6a737b", margin: 0 }}>
                  Use <code># Heading</code>, <code>## Sub-heading</code>, <code>---</code> for a divider, <code>{"{{field:key}}"}</code> for submission values.
                </p>
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "#6a737b", marginBottom: "0.35rem", fontWeight: 700, textTransform: "uppercase" }}>Preview</div>
                <div className={styles.docPreview}>{preview}</div>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.formActionsRow} style={{ padding: "0 1.25rem 1rem" }}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
