"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./forms.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import { CATEGORIES, type FormStatus, type FormSummary } from "./types";

export default function FormsListClient() {
  const { authHeaders, token } = useAuth();
  const router = useRouter();
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | FormStatus>("all");
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", category: "Operations" });
  const [saving, setSaving] = useState(false);
  const [createStep, setCreateStep] = useState<"choose" | "blank" | "templates">("choose");
  const [templates, setTemplates] = useState<Array<{
    id: number; name: string; description: string | null;
    category: string | null; icon: string; fieldCount: number; pageCount: number;
  }>>([]);
  const [tmplCategory, setTmplCategory] = useState<string>("");

  const openCreate = () => {
    setCreateStep("choose");
    setForm({ name: "", description: "", category: "Operations" });
    setCreateOpen(true);
  };

  const loadTemplates = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/forms/templates"), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        setTemplates(body.templates || []);
      }
    } catch {/* ignore */}
  }, [authHeaders, token]);

  const pickTemplate = async (templateId: number) => {
    try {
      const res = await fetch(apiUrl("/forms/from-template"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ templateId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Create from template failed.");
      setCreateOpen(false);
      router.push(`/forms/builder/${body.formId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create from template failed.");
    }
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (category) params.set("category", category);
      if (search) params.set("search", search);
      const res = await fetch(apiUrl(`/forms?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setForms(body.forms || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load forms.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, status, category, search]);

  useEffect(() => { load(); }, [load]);

  const createForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl("/forms"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          category: form.category,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Create failed.");
      setCreateOpen(false);
      router.push(`/forms/builder/${body.form.id}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not create form.");
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(apiUrl(`/forms/${id}/duplicate`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Duplicate failed.");
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not duplicate.");
    }
  };

  const archive = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Archive this form?")) return;
    try {
      await fetch(apiUrl(`/forms/${id}`), { method: "DELETE", headers: { ...authHeaders() } });
      await load();
    } catch {/* ignore */}
  };

  const statusClass = (s: FormStatus) =>
    s === "published" ? styles.statusPublished : s === "archived" ? styles.statusArchived : styles.statusDraft;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.titleBlock}>
          <h1>Forms</h1>
          <p>Create, share, and manage custom forms</p>
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={openCreate}
        >
          + Create Form
        </button>
      </div>
      <div className={styles.main}>
        {err ? <div className={styles.errorBanner}>{err}</div> : null}
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search forms…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as "all" | FormStatus)}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <select className={styles.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading forms…</div>
        ) : forms.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No forms yet</h3>
            <p>Create your first form to get started.</p>
          </div>
        ) : (
          <div className={styles.formGrid}>
            {forms.map((f) => {
              const conversion = f.viewsCount > 0 ? Math.round((f.submissionsCount / f.viewsCount) * 1000) / 10 : 0;
              return (
                <Link key={f.id} href={`/forms/builder/${f.id}`} className={styles.formCard}>
                  <div className={styles.formCardHead}>
                    <h3 className={styles.formName}>{f.name}</h3>
                    <span className={`${styles.statusBadge} ${statusClass(f.status)}`}>{f.status}</span>
                  </div>
                  {f.description ? <p className={styles.formDesc}>{f.description}</p> : null}
                  {f.category ? <span className={styles.categoryTag}>{f.category}</span> : null}
                  <div className={styles.formMeta}>
                    <span>{f.submissionsCount} submissions</span>
                    <span>{f.viewsCount} views</span>
                    {f.viewsCount > 0 ? <span>{conversion}% conversion</span> : null}
                  </div>
                  <div className={styles.formFoot}>
                    <span>{new Date(f.updatedAt).toLocaleDateString()}</span>
                    <div className={styles.formActions}>
                      <Link
                        href={`/forms/${f.id}/submissions`}
                        className={styles.smallBtn}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Submissions
                      </Link>
                      <button type="button" className={styles.smallBtn} onClick={(e) => duplicate(f.id, e)}>
                        Duplicate
                      </button>
                      <button type="button" className={styles.smallBtn} onClick={(e) => archive(f.id, e)}>
                        Archive
                      </button>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {createOpen ? (
        <div className={styles.overlay} onClick={() => setCreateOpen(false)}>
          <div className={styles.modal} style={{ maxWidth: createStep === "templates" ? 720 : 540 }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>
                {createStep === "choose"
                  ? "Create Form"
                  : createStep === "blank"
                  ? "New Blank Form"
                  : "Choose a Template"}
              </h2>
              <button type="button" className={styles.closeBtn} onClick={() => setCreateOpen(false)}>×</button>
            </div>

            {createStep === "choose" ? (
              <div className={styles.form}>
                <div className={styles.tmplChoice}>
                  <button
                    type="button"
                    className={styles.tmplChoiceBtn}
                    onClick={() => setCreateStep("blank")}
                  >
                    <h3 className={styles.tmplChoiceTitle}>📄 Start from Blank</h3>
                    <p className={styles.tmplChoiceDesc}>Build a form from scratch.</p>
                  </button>
                  <button
                    type="button"
                    className={styles.tmplChoiceBtn}
                    onClick={() => { setCreateStep("templates"); loadTemplates(); }}
                  >
                    <h3 className={styles.tmplChoiceTitle}>📋 Use a Template</h3>
                    <p className={styles.tmplChoiceDesc}>Pick from pre-built templates.</p>
                  </button>
                </div>
              </div>
            ) : null}

            {createStep === "blank" ? (
              <form className={styles.form} onSubmit={createForm}>
                <div className={styles.field}>
                  <label>Form Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                <div className={styles.field}>
                  <label>Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className={styles.formActionsRow}>
                  <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setCreateStep("choose")}>
                    ← Back
                  </button>
                  <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
                    {saving ? "Creating…" : "Create"}
                  </button>
                </div>
              </form>
            ) : null}

            {createStep === "templates" ? (
              <div className={styles.form}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                  <select
                    className={styles.select}
                    value={tmplCategory}
                    onChange={(e) => setTmplCategory(e.target.value)}
                  >
                    <option value="">All categories</option>
                    {Array.from(new Set(templates.map((t) => t.category).filter(Boolean))).map((c) => (
                      <option key={c!} value={c!}>{c}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={() => setCreateStep("choose")}
                    style={{ marginLeft: "auto" }}
                  >
                    ← Back
                  </button>
                </div>
                <div className={styles.tmplGrid}>
                  {templates
                    .filter((t) => !tmplCategory || t.category === tmplCategory)
                    .map((t) => (
                      <div key={t.id} className={styles.tmplCard} onClick={() => pickTemplate(t.id)}>
                        <div className={styles.tmplCardHead}>
                          <span className={styles.tmplIcon}>{t.icon}</span>
                          <h3 className={styles.tmplName}>{t.name}</h3>
                        </div>
                        {t.description ? <p className={styles.tmplDesc}>{t.description}</p> : null}
                        <div className={styles.tmplFoot}>
                          <span>{t.category || "—"}</span>
                          <span>{t.fieldCount} fields · {t.pageCount} page{t.pageCount === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                    ))}
                </div>
                {templates.length === 0 ? (
                  <p style={{ color: "#6a737b", textAlign: "center", padding: "1rem" }}>Loading templates…</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
