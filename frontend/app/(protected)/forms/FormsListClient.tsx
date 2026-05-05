"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./forms.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import { CATEGORIES, type FormStatus, type FormSummary } from "./types";
import FormSidebar, { type SidebarNav } from "./FormSidebar";
import FormListRow from "./FormListRow";
import FormGridCard from "./FormGridCard";
import { categoryTone } from "./categoryTone";

function categoryStorageKey(cat: string | null | undefined) {
  const t = typeof cat === "string" ? cat.trim() : "";
  return t.length ? t : "__none__";
}

function categoryDisplayLabel(storageKey: string) {
  return storageKey === "__none__" ? "(No category)" : storageKey;
}

type Toast = { variant: "ok" | "err"; message: string };

const TONE_CLASSES: Record<
  ReturnType<typeof categoryTone>,
  typeof styles.catChipNavy
> = {
  navy: styles.catChipNavy,
  red: styles.catChipRed,
  teal: styles.catChipTeal,
  blue: styles.catChipBlue,
  neutral: styles.catChipNeutral,
};

export default function FormsListClient() {
  const { authHeaders, token, user } = useAuth();
  const router = useRouter();
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [status, setStatus] = useState<"all" | FormStatus>("all");
  const [search, setSearch] = useState("");
  const [sidebarNav, setSidebarNav] = useState<SidebarNav>({ kind: "all" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", category: "Operations" });
  const [saving, setSaving] = useState(false);
  const [createStep, setCreateStep] = useState<"choose" | "blank" | "templates">("choose");
  const [templates, setTemplates] = useState<
    Array<{
      id: number;
      name: string;
      description: string | null;
      category: string | null;
      icon: string;
      fieldCount: number;
      pageCount: number;
    }>
  >([]);
  const [tmplCategory, setTmplCategory] = useState<string>("");
  const [archiveTarget, setArchiveTarget] = useState<FormSummary | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!user?.id || typeof window === "undefined") return;
    try {
      const cKey = `rpm_forms_sidebar_collapsed:${user.id}`;
      const vKey = `rpm_forms_view_mode:${user.id}`;
      setSidebarCollapsed(localStorage.getItem(cKey) === "1");
      setViewMode(localStorage.getItem(vKey) === "grid" ? "grid" : "list");
    } catch {
      /* ignore */
    }
    setPrefsHydrated(true);
  }, [user?.id]);

  useEffect(() => {
    if (!prefsHydrated || !user?.id || typeof window === "undefined") return;
    try {
      localStorage.setItem(`rpm_forms_sidebar_collapsed:${user.id}`, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [prefsHydrated, user?.id, sidebarCollapsed]);

  useEffect(() => {
    if (!prefsHydrated || !user?.id || typeof window === "undefined") return;
    try {
      localStorage.setItem(`rpm_forms_view_mode:${user.id}`, viewMode);
    } catch {
      /* ignore */
    }
  }, [prefsHydrated, user?.id, viewMode]);

  const openCreate = () => {
    setCreateStep("choose");
    setForm({ name: "", description: "", category: "Operations" });
    setCreateOpen(true);
  };

  const loadTemplates = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/forms/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        setTemplates(body.templates || []);
      }
    } catch {
      /* ignore */
    }
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
  }, [authHeaders, token, status, search]);

  useEffect(() => {
    load();
  }, [load]);

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

  const duplicateOne = async (id: number) => {
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

  const exportOne = async (f: FormSummary) => {
    try {
      const res = await fetch(apiUrl(`/forms/${f.id}/export`), {
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Export failed.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${f.name.replace(/[^\w]+/g, "_")}_export.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Export failed.");
    }
  };

  const shareOne = async (f: FormSummary) => {
    if (!f.slug) {
      setToast({ variant: "err", message: "This form needs a slug (save in builder) before you can share." });
      return;
    }
    const base = `${window.location.origin}/forms/${encodeURIComponent(f.slug)}`;
    const href =
      f.accessType === "private" && f.accessToken
        ? `${base}?token=${encodeURIComponent(f.accessToken)}`
        : base;
    try {
      await navigator.clipboard.writeText(href);
      setToast({ variant: "ok", message: "Link copied to clipboard." });
    } catch {
      setToast({ variant: "err", message: "Could not copy link." });
    }
  };

  const archiveOne = async (id: number) => {
    try {
      await fetch(apiUrl(`/forms/${id}`), { method: "DELETE", headers: { ...authHeaders() } });
      setArchiveTarget(null);
      await load();
    } catch {
      setToast({ variant: "err", message: "Could not archive." });
    }
  };

  const toggleFavorite = async (f: FormSummary) => {
    const prev = Boolean(f.favorited);
    const next = !prev;
    setForms((curr) =>
      curr.map((x) => (x.id === f.id ? { ...x, favorited: next } : x)),
    );
    try {
      const res = await fetch(apiUrl(`/forms/${f.id}/favorite`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Favorite failed.");
      const fv = Boolean(body.favorited);
      setForms((curr) =>
        curr.map((x) => (x.id === f.id ? { ...x, favorited: fv } : x)),
      );
    } catch {
      setForms((curr) =>
        curr.map((x) => (x.id === f.id ? { ...x, favorited: prev } : x)),
      );
      setToast({ variant: "err", message: "Could not update favorites. Try again." });
    }
  };

  const categoryRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of forms) {
      const k = categoryStorageKey(f.category);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: categoryDisplayLabel(value),
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [forms]);

  const favoritesSidebar = useMemo(() => {
    return [...forms]
      .filter((f) => f.favorited)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [forms]);

  const filteredForms = useMemo(() => {
    if (sidebarNav.kind === "all") return forms;
    const cat = sidebarNav.value;
    return forms.filter((f) => categoryStorageKey(f.category) === cat);
  }, [forms, sidebarNav]);

  const favoritesMain = useMemo(() => {
    return filteredForms
      .filter((f) => f.favorited)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [filteredForms]);

  const restMain = useMemo(() => {
    const ids = new Set(favoritesMain.map((f) => f.id));
    return filteredForms.filter((f) => !ids.has(f.id));
  }, [filteredForms, favoritesMain]);

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.titleBlock}>
          <h1>Forms</h1>
          <p>Create, share, and manage custom forms</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link href="/forms/approvals" className={`${styles.btn} ${styles.btnGhost}`}>
            My Approvals
          </Link>
          <label
            className={`${styles.btn} ${styles.btnGhost}`}
            style={{ cursor: "pointer", display: "inline-flex", alignItems: "center" }}
          >
            Import
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async () => {
                  try {
                    const parsed = JSON.parse(reader.result as string);
                    const res = await fetch(apiUrl("/forms/import"), {
                      method: "POST",
                      headers: { "Content-Type": "application/json", ...authHeaders() },
                      body: JSON.stringify(parsed),
                    });
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(body.error || "Import failed.");
                    router.push(`/forms/builder/${body.formId}`);
                  } catch (ex) {
                    setErr(ex instanceof Error ? ex.message : "Import failed.");
                  }
                };
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
          </label>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openCreate}>
            + Create Form
          </button>
        </div>
      </div>

      <div className={styles.mainShell}>
        {toast ? (
          <div
            className={`${styles.toastFloater} ${toast.variant === "ok" ? styles.toastFloaterOk : styles.toastFloaterErr}`}
            role="alert"
          >
            {toast.message}
          </div>
        ) : null}
        <div className={styles.formsLayout}>
          {!compact ? (
            <FormSidebar
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
              nav={sidebarNav}
              onNav={(n) => {
                setSidebarNav(n);
                closeDrawer();
              }}
              totalForms={forms.length}
              categories={categoryRows}
              favorites={favoritesSidebar}
              drawerOpen={drawerOpen}
              onCloseDrawer={closeDrawer}
              isCompact={false}
            />
          ) : null}
          <div className={styles.formsMainColumn}>
            {compact ? (
              <FormSidebar
                collapsed={false}
                onToggleCollapse={() => {}}
                nav={sidebarNav}
                onNav={(n) => {
                  setSidebarNav(n);
                  closeDrawer();
                }}
                totalForms={forms.length}
                categories={categoryRows}
                favorites={favoritesSidebar}
                drawerOpen={drawerOpen}
                onCloseDrawer={closeDrawer}
                isCompact={true}
              />
            ) : null}
            {err ? <div className={styles.errorBanner}>{err}</div> : null}
            <div className={styles.formsToolbarRow}>
              {compact ? (
                <button
                  type="button"
                  className={styles.hamburgerBtn}
                  aria-label="Open forms menu"
                  onClick={() => setDrawerOpen((o) => !o)}
                >
                  ☰
                </button>
              ) : null}
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Search forms…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className={styles.toolbarControls}>
                <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as "all" | FormStatus)}>
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <div className={styles.viewToggle} role="group" aria-label="View mode">
                  <button
                    type="button"
                    className={`${styles.viewToggleBtn} ${viewMode === "list" ? styles.viewToggleBtnActive : ""}`}
                    onClick={() => setViewMode("list")}
                  >
                    ☰ List
                  </button>
                  <button
                    type="button"
                    className={`${styles.viewToggleBtn} ${viewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
                    onClick={() => setViewMode("grid")}
                  >
                    ▦ Grid
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className={styles.loading}>Loading forms…</div>
            ) : forms.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No forms yet</h3>
                <p>Create your first form to get started.</p>
              </div>
            ) : filteredForms.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No forms match</h3>
                <p>Try another category, status, or search.</p>
              </div>
            ) : viewMode === "grid" ? (
              <div className={styles.formGridModern}>
                {filteredForms.map((f) => (
                  <FormGridCard
                    key={f.id}
                    form={f}
                    toneClass={TONE_CLASSES}
                    toggleFavorite={toggleFavorite}
                    onOpenSubmissions={() => router.push(`/forms/${f.id}/submissions`)}
                    onDuplicate={() => void duplicateOne(f.id)}
                    onExport={() => void exportOne(f)}
                    onArchive={() => setArchiveTarget(f)}
                    onShare={() => void shareOne(f)}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.listStack}>
                {favoritesMain.length > 0 ? (
                  <>
                    <div className={`${styles.formsSectionHdr} ${styles.formsSectionHdrFirst}`}>Favorites</div>
                    {favoritesMain.map((f) => (
                      <FormListRow
                        key={f.id}
                        form={f}
                        toneClass={TONE_CLASSES}
                        toggleFavorite={toggleFavorite}
                        onOpenSubmissions={() => router.push(`/forms/${f.id}/submissions`)}
                        onDuplicate={() => void duplicateOne(f.id)}
                        onExport={() => void exportOne(f)}
                        onArchive={() => setArchiveTarget(f)}
                        onShare={() => void shareOne(f)}
                      />
                    ))}
                  </>
                ) : null}
                {restMain.length > 0 ? (
                  <>
                    <div
                      className={
                        favoritesMain.length === 0
                          ? `${styles.formsSectionHdr} ${styles.formsSectionHdrFirst}`
                          : styles.formsSectionHdr
                      }
                    >
                      All forms
                    </div>
                    {restMain.map((f) => (
                      <FormListRow
                        key={f.id}
                        form={f}
                        toneClass={TONE_CLASSES}
                        toggleFavorite={toggleFavorite}
                        onOpenSubmissions={() => router.push(`/forms/${f.id}/submissions`)}
                        onDuplicate={() => void duplicateOne(f.id)}
                        onExport={() => void exportOne(f)}
                        onArchive={() => setArchiveTarget(f)}
                        onShare={() => void shareOne(f)}
                      />
                    ))}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {archiveTarget ? (
        <div
          className={styles.miniModalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="archiveHdr"
          onClick={() => setArchiveTarget(null)}
        >
          <div className={styles.miniModal} onClick={(e) => e.stopPropagation()}>
            <h3 id="archiveHdr" style={{ margin: "0 0 0.5rem", fontSize: "1.05rem", color: "var(--navy)", fontWeight: 700 }}>
              Archive this form?
            </h3>
            <p style={{ margin: 0, color: "var(--grey)", fontSize: "0.9rem" }}>
              Archived forms can be recovered from archived status filters. Submission history is kept.
            </p>
            <div className={styles.miniModalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setArchiveTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => void archiveOne(archiveTarget.id)}
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className={styles.overlay} onClick={() => setCreateOpen(false)}>
          <div
            className={styles.modal}
            style={{ maxWidth: createStep === "templates" ? 720 : 540 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2>
                {createStep === "choose"
                  ? "Create Form"
                  : createStep === "blank"
                    ? "New Blank Form"
                    : "Choose a Template"}
              </h2>
              <button type="button" className={styles.closeBtn} onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </div>

            {createStep === "choose" ? (
              <div className={styles.form}>
                <div className={styles.tmplChoice}>
                  <button type="button" className={styles.tmplChoiceBtn} onClick={() => setCreateStep("blank")}>
                    <h3 className={styles.tmplChoiceTitle}>📄 Start from Blank</h3>
                    <p className={styles.tmplChoiceDesc}>Build a form from scratch.</p>
                  </button>
                  <button
                    type="button"
                    className={styles.tmplChoiceBtn}
                    onClick={() => {
                      setCreateStep("templates");
                      loadTemplates();
                    }}
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
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
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
                      <option key={c!} value={c!}>
                        {c}
                      </option>
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
                          <span>
                            {t.fieldCount} fields · {t.pageCount} page{t.pageCount === 1 ? "" : "s"}
                          </span>
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
