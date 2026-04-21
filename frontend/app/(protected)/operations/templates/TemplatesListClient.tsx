"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../operations.module.css";
import OperationsTopBar from "../OperationsTopBar";
import { apiUrl } from "../../../../lib/api";
import { useAuth, RequireAdmin } from "../../../../context/AuthContext";
import type { Template } from "../types";

const CATEGORY_CHOICES = [
  "Owner Relations",
  "Leasing",
  "Maintenance",
  "Operations",
  "Admin",
  "Marketing",
  "Finance",
  "Other",
];

export default function TemplatesListClient() {
  return (
    <RequireAdmin>
      <TemplatesListInner />
    </RequireAdmin>
  );
}

function TemplatesListInner() {
  const { authHeaders, token } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "Operations",
    icon: "📋",
    color: "#0098D0",
    estimatedDays: 14,
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/processes/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setTemplates(body.templates || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load templates.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  const createTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl("/processes/templates"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          category: form.category,
          icon: form.icon,
          color: form.color,
          estimatedDays: form.estimatedDays,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Create failed.");
      setCreateOpen(false);
      router.push(`/operations/templates/${body.template.id}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not create template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <OperationsTopBar
        actions={
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setCreateOpen(true)}
          >
            + Create Template
          </button>
        }
      />
      <div className={styles.main}>
        {err ? <div className={styles.errorBanner}>{err}</div> : null}
        {loading ? (
          <div className={styles.loading}>Loading templates…</div>
        ) : templates.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No templates yet</h3>
            <p>Create your first template to launch processes from.</p>
          </div>
        ) : (
          <div className={styles.templateGrid}>
            {templates.map((t) => (
              <Link
                key={t.id}
                href={`/operations/templates/${t.id}`}
                className={styles.templateCard}
                style={{ borderLeftColor: t.color }}
              >
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span className={styles.templateIcon}>{t.icon}</span>
                  <h3 className={styles.templateName}>{t.name}</h3>
                </div>
                {t.description ? <p className={styles.templateDesc}>{t.description}</p> : null}
                <div className={styles.templateFoot}>
                  <span>{t.category ?? "—"}</span>
                  <span>
                    {t.stepCount ?? 0} steps · {t.estimatedDays}d
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {createOpen ? (
        <div className={styles.overlay} onClick={() => setCreateOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>New Template</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setCreateOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className={styles.form} onSubmit={createTemplate}>
              <div className={styles.field}>
                <label>Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div className={styles.field}>
                <label>Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label>Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    {CATEGORY_CHOICES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Estimated days</label>
                  <input
                    type="number"
                    min={1}
                    value={form.estimatedDays}
                    onChange={(e) =>
                      setForm({ ...form, estimatedDays: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label>Icon (emoji)</label>
                  <input
                    value={form.icon}
                    maxLength={4}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Color</label>
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={saving}
                >
                  {saving ? "Creating…" : "Create & Edit Steps"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
