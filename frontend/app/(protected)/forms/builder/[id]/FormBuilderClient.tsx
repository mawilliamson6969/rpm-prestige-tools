"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../forms.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import {
  CATEGORIES, CONDITION_OPERATORS, FIELD_TYPES,
  type FieldTypeDef, type FieldWidth, type FormAutomation,
  type FormField, type FormPage, type FormSummary,
} from "../../types";
import AutomationsTab from "./AutomationsTab";
import AnalyticsTab from "./AnalyticsTab";

type PanelTab = "properties" | "validation" | "logic" | "prefill";
type TopTab = "build" | "share" | "settings" | "automations" | "analytics";

export default function FormBuilderClient({ formId }: { formId: string }) {
  const { authHeaders, token } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState<FormSummary | null>(null);
  const [pages, setPages] = useState<FormPage[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [automations, setAutomations] = useState<FormAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("properties");
  const [topTab, setTopTab] = useState<TopTab>("build");
  const [libSearch, setLibSearch] = useState("");
  const [dragOverFieldId, setDragOverFieldId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/forms/${formId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setForm(body.form);
      setPages(body.pages || []);
      setFields(body.fields || []);
      setAutomations(body.automations || []);
      if (body.pages?.length && activePageId === null) setActivePageId(body.pages[0].id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load form.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, formId, activePageId]);

  useEffect(() => { load(); }, [load]);

  const selectedField = useMemo(
    () => fields.find((f) => f.id === selectedFieldId) ?? null,
    [fields, selectedFieldId]
  );

  const pageFields = useMemo(
    () => fields.filter((f) => f.pageId === activePageId || (activePageId === null && f.pageId === null))
               .sort((a, b) => a.sortOrder - b.sortOrder),
    [fields, activePageId]
  );

  const saveForm = async (patch: Partial<FormSummary>) => {
    if (!form) return;
    setForm({ ...form, ...patch });
    try {
      await fetch(apiUrl(`/forms/${form.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
    } catch {/* ignore */}
  };

  const addField = async (typeDef: FieldTypeDef, position?: number) => {
    if (!form) return;
    try {
      const res = await fetch(apiUrl(`/forms/${form.id}/fields`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          fieldType: typeDef.type,
          label: typeDef.isLayout ? typeDef.label : typeDef.label,
          pageId: activePageId,
          fieldConfig: typeDef.defaultConfig,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Add failed.");
      const newField = body.field as FormField;
      let newFields = [...fields, newField];
      if (position !== undefined) {
        // reorder: move to position
        const onPage = newFields.filter((f) => f.pageId === activePageId);
        const others = newFields.filter((f) => f.pageId !== activePageId);
        const reordered = onPage.filter((f) => f.id !== newField.id);
        reordered.splice(position, 0, newField);
        const ids = reordered.map((f) => f.id);
        newFields = [...others, ...reordered];
        setFields(newFields);
        await fetch(apiUrl(`/forms/${form.id}/fields/reorder`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ fieldIds: [...newFields.filter((f) => f.pageId !== activePageId).map((f) => f.id), ...ids] }),
        }).catch(() => {});
      } else {
        setFields(newFields);
      }
      setSelectedFieldId(newField.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Add field failed.");
    }
  };

  const updateField = async (fieldId: number, patch: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)));
    try {
      await fetch(apiUrl(`/forms/fields/${fieldId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
    } catch {/* ignore */}
  };

  const deleteField = async (fieldId: number) => {
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
    try {
      await fetch(apiUrl(`/forms/fields/${fieldId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
    } catch {/* ignore */}
  };

  const reorderFields = async (newOrder: FormField[]) => {
    const ids = newOrder.map((f) => f.id);
    setFields((prev) => {
      const others = prev.filter((f) => f.pageId !== activePageId);
      const map = new Map(newOrder.map((f, i) => [f.id, i]));
      const onPage = newOrder.map((f, i) => ({ ...f, sortOrder: others.length + i }));
      return [...others, ...onPage].sort((a, b) => a.sortOrder - b.sortOrder);
    });
    if (!form) return;
    try {
      const allIds = [...fields.filter((f) => f.pageId !== activePageId).map((f) => f.id), ...ids];
      await fetch(apiUrl(`/forms/${form.id}/fields/reorder`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ fieldIds: allIds }),
      });
    } catch {/* ignore */}
  };

  const addPage = async () => {
    if (!form) return;
    try {
      const res = await fetch(apiUrl(`/forms/${form.id}/pages`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title: `Page ${pages.length + 1}` }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Add page failed.");
      setPages([...pages, body.page]);
      setActivePageId(body.page.id);
      if (pages.length >= 1) await saveForm({ isMultiStep: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Add page failed.");
    }
  };

  const updatePage = async (pageId: number, patch: Partial<FormPage>) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, ...patch } : p)));
    try {
      await fetch(apiUrl(`/forms/pages/${pageId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
    } catch {/* ignore */}
  };

  const deletePage = async (pageId: number) => {
    if (pages.length <= 1) {
      alert("Cannot delete the only page.");
      return;
    }
    if (!confirm("Delete this page? Fields on it will move to the previous page.")) return;
    try {
      await fetch(apiUrl(`/forms/pages/${pageId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await load();
      const remaining = pages.filter((p) => p.id !== pageId);
      setActivePageId(remaining[0]?.id ?? null);
    } catch {/* ignore */}
  };

  const publish = async () => {
    if (!form) return;
    if (fields.filter((f) => !["heading", "paragraph", "divider", "spacer"].includes(f.fieldType)).length === 0) {
      if (!confirm("Form has no input fields. Publish anyway?")) return;
    }
    try {
      const res = await fetch(apiUrl(`/forms/${form.id}/publish`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Publish failed.");
      setForm(body.form);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Publish failed.");
    }
  };

  const unpublish = async () => {
    if (!form) return;
    try {
      const res = await fetch(apiUrl(`/forms/${form.id}/unpublish`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setForm(body.form);
    } catch {/* ignore */}
  };

  if (loading || !form) {
    return <div className={styles.loading}>Loading form…</div>;
  }

  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin}/forms/${form.slug}${form.accessType === "private" && form.accessToken ? `?token=${form.accessToken}` : ""}`
    : "";

  return (
    <div className={styles.page} style={{ background: "#f5f5f5" }}>
      <div className={styles.builderTop}>
        <div className={styles.builderTopLeft}>
          <button type="button" className={styles.builderBack} onClick={() => router.push("/forms")}>
            ← Forms
          </button>
          <input
            type="text"
            className={styles.builderNameInput}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={() => saveForm({ name: form.name })}
          />
          <span className={`${styles.statusBadge} ${form.status === "published" ? styles.statusPublished : styles.statusDraft}`}>
            {form.status}
          </span>
        </div>
        <div className={styles.builderTopRight}>
          <button type="button" className={styles.builderTopBtn} onClick={() => setTopTab("build")} disabled={topTab === "build"}>
            Build
          </button>
          <button type="button" className={styles.builderTopBtn} onClick={() => setTopTab("automations")} disabled={topTab === "automations"}>
            Automations
          </button>
          <button type="button" className={styles.builderTopBtn} onClick={() => setTopTab("analytics")} disabled={topTab === "analytics"}>
            Analytics
          </button>
          <button type="button" className={styles.builderTopBtn} onClick={() => setTopTab("share")} disabled={topTab === "share"}>
            Share
          </button>
          <button type="button" className={styles.builderTopBtn} onClick={() => setTopTab("settings")} disabled={topTab === "settings"}>
            Settings
          </button>
          {form.slug ? (
            <a
              href={`/forms/${form.slug}?preview=1`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.builderTopBtn}
            >
              Preview
            </a>
          ) : null}
          {form.status === "published" ? (
            <button type="button" className={styles.builderTopBtn} onClick={unpublish}>
              Unpublish
            </button>
          ) : (
            <button type="button" className={`${styles.builderTopBtn} ${styles.builderTopBtnPrimary}`} onClick={publish}>
              Publish
            </button>
          )}
        </div>
      </div>

      {err ? <div className={styles.errorBanner} style={{ margin: "0.5rem 1rem" }}>{err}</div> : null}

      {topTab === "build" ? (
        <div className={styles.builderShell}>
          <FieldLibrary onAdd={addField} search={libSearch} setSearch={setLibSearch} />
          <CanvasPanel
            form={form}
            pages={pages}
            activePageId={activePageId}
            setActivePageId={setActivePageId}
            addPage={addPage}
            updatePage={updatePage}
            deletePage={deletePage}
            pageFields={pageFields}
            selectedFieldId={selectedFieldId}
            setSelectedFieldId={setSelectedFieldId}
            updateField={updateField}
            deleteField={deleteField}
            reorderFields={reorderFields}
            dragOverFieldId={dragOverFieldId}
            setDragOverFieldId={setDragOverFieldId}
            addFieldAt={addField}
          />
          <PropertiesPanel
            field={selectedField}
            allFields={fields}
            panelTab={panelTab}
            setPanelTab={setPanelTab}
            updateField={updateField}
          />
        </div>
      ) : topTab === "automations" ? (
        <AutomationsTab
          formId={form.id}
          fields={fields}
          automations={automations}
          reload={load}
        />
      ) : topTab === "analytics" ? (
        <AnalyticsTab formId={form.id} />
      ) : topTab === "share" ? (
        <ShareTab form={form} publicUrl={publicUrl} />
      ) : (
        <SettingsTab form={form} saveForm={saveForm} />
      )}
    </div>
  );
}

/** Field Library (left panel) */
function FieldLibrary({
  onAdd,
  search,
  setSearch,
}: {
  onAdd: (t: FieldTypeDef) => void;
  search: string;
  setSearch: (s: string) => void;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return FIELD_TYPES;
    const q = search.trim().toLowerCase();
    return FIELD_TYPES.filter((t) => t.label.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  }, [search]);

  const byCategory = useMemo(() => {
    const groups: Array<{ category: string; items: FieldTypeDef[] }> = [];
    const lookup = new Map<string, FieldTypeDef[]>();
    for (const t of filtered) {
      let arr = lookup.get(t.category);
      if (!arr) {
        arr = [];
        lookup.set(t.category, arr);
        groups.push({ category: t.category, items: arr });
      }
      arr.push(t);
    }
    return groups;
  }, [filtered]);

  return (
    <div className={styles.builderLeft}>
      <input
        type="search"
        className={styles.libSearch}
        placeholder="Search fields…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {byCategory.map(({ category, items }) => (
        <div key={category}>
          <div className={styles.libCategory}>{category}</div>
          <div className={styles.libList}>
            {items.map((t: FieldTypeDef) => (
              <div
                key={t.type}
                className={styles.libItem}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-new-field", t.type);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(t)}
                title={`Click or drag to add ${t.label}`}
              >
                <span className={styles.libIcon}>{t.icon}</span>
                <span>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Canvas (center panel) */
function CanvasPanel({
  form, pages, activePageId, setActivePageId, addPage, updatePage, deletePage,
  pageFields, selectedFieldId, setSelectedFieldId, updateField, deleteField,
  reorderFields, dragOverFieldId, setDragOverFieldId, addFieldAt,
}: {
  form: FormSummary;
  pages: FormPage[];
  activePageId: number | null;
  setActivePageId: (id: number | null) => void;
  addPage: () => void;
  updatePage: (id: number, patch: Partial<FormPage>) => void;
  deletePage: (id: number) => void;
  pageFields: FormField[];
  selectedFieldId: number | null;
  setSelectedFieldId: (id: number | null) => void;
  updateField: (id: number, patch: Partial<FormField>) => void;
  deleteField: (id: number) => void;
  reorderFields: (order: FormField[]) => void;
  dragOverFieldId: number | null;
  setDragOverFieldId: (id: number | null) => void;
  addFieldAt: (t: FieldTypeDef, position?: number) => void;
}) {
  const activePage = pages.find((p) => p.id === activePageId) ?? null;

  const onDropAt = (e: React.DragEvent, position: number) => {
    e.preventDefault();
    setDragOverFieldId(null);
    const newType = e.dataTransfer.getData("application/x-new-field");
    if (newType) {
      const typeDef = FIELD_TYPES.find((t) => t.type === newType);
      if (typeDef) addFieldAt(typeDef, position);
      return;
    }
    const existingId = e.dataTransfer.getData("application/x-field-id");
    if (existingId) {
      const fid = Number(existingId);
      const current = [...pageFields];
      const srcIdx = current.findIndex((f) => f.id === fid);
      if (srcIdx < 0) return;
      const [moved] = current.splice(srcIdx, 1);
      const insertAt = position > srcIdx ? position - 1 : position;
      current.splice(insertAt, 0, moved);
      reorderFields(current);
    }
  };

  return (
    <div className={styles.builderCenter}>
      <div className={styles.builderCanvas}>
        {pages.length > 0 ? (
          <div className={styles.pageTabs}>
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${styles.pageTab} ${activePageId === p.id ? styles.pageTabActive : ""}`}
                onClick={() => setActivePageId(p.id)}
              >
                {p.title || `Page ${p.pageOrder + 1}`}
                {pages.length > 1 ? (
                  <span
                    onClick={(e) => { e.stopPropagation(); deletePage(p.id); }}
                    style={{ marginLeft: "0.35rem", opacity: 0.6, cursor: "pointer" }}
                    title="Delete page"
                  >×</span>
                ) : null}
              </button>
            ))}
            <button type="button" className={styles.addPageBtn} onClick={addPage}>
              + Add Page
            </button>
          </div>
        ) : null}

        {activePage ? (
          <>
            <input
              type="text"
              className={styles.pageTitleInput}
              value={activePage.title || ""}
              placeholder="Page title"
              onChange={(e) => updatePage(activePage.id, { title: e.target.value })}
            />
            <input
              type="text"
              className={styles.pageDescInput}
              value={activePage.description || ""}
              placeholder="Page description (optional)"
              onChange={(e) => updatePage(activePage.id, { description: e.target.value })}
            />
          </>
        ) : null}

        <div className={styles.fieldList}>
          <DropZone
            active={dragOverFieldId === -1}
            onDragOver={(e) => { e.preventDefault(); setDragOverFieldId(-1); }}
            onDragLeave={() => setDragOverFieldId(null)}
            onDrop={(e) => onDropAt(e, 0)}
          />
          {pageFields.map((f, idx) => (
            <div key={f.id}>
              <FieldCard
                field={f}
                selected={selectedFieldId === f.id}
                onSelect={() => setSelectedFieldId(f.id)}
                onDelete={() => deleteField(f.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-field-id", String(f.id));
                  e.dataTransfer.effectAllowed = "move";
                }}
              />
              <DropZone
                active={dragOverFieldId === f.id}
                onDragOver={(e) => { e.preventDefault(); setDragOverFieldId(f.id); }}
                onDragLeave={() => setDragOverFieldId(null)}
                onDrop={(e) => onDropAt(e, idx + 1)}
              />
            </div>
          ))}
          {pageFields.length === 0 ? (
            <div
              className={styles.emptyState}
              onDragOver={(e) => { e.preventDefault(); setDragOverFieldId(-1); }}
              onDrop={(e) => onDropAt(e, 0)}
            >
              <h3>No fields yet</h3>
              <p>Drag a field from the left panel or click one to add it.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DropZone({
  active, onDragOver, onDragLeave, onDrop,
}: {
  active: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`${styles.dropZone} ${active ? styles.dropZoneActive : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    />
  );
}

function FieldCard({
  field, selected, onSelect, onDelete, onDragStart,
}: {
  field: FormField;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const widthStyle: React.CSSProperties = {
    width: field.layout?.width === "half" ? "50%" : field.layout?.width === "third" ? "33.33%" : "100%",
    display: "inline-block",
    verticalAlign: "top",
    boxSizing: "border-box",
    padding: "0 0.25rem",
  };
  return (
    <div style={widthStyle}>
      <div
        className={`${styles.fieldCard} ${selected ? styles.fieldCardSelected : ""}`}
        onClick={onSelect}
        draggable
        onDragStart={onDragStart}
      >
        <div className={styles.fieldCardHeader}>
          <span className={styles.dragHandle} title="Drag to reorder">⋮⋮</span>
          <span className={styles.fieldCardLabel}>
            {field.label}
            {field.isRequired ? <span className={styles.fieldCardRequired}> *</span> : null}
          </span>
          <button
            type="button"
            className={styles.fieldCardDelete}
            onClick={(e) => { e.stopPropagation(); if (confirm("Delete this field?")) onDelete(); }}
            title="Delete"
          >×</button>
        </div>
        <FieldPreview field={field} />
      </div>
    </div>
  );
}

function FieldPreview({ field }: { field: FormField }) {
  const cfg = (field.fieldConfig || {}) as Record<string, unknown>;
  switch (field.fieldType) {
    case "text":
    case "email":
    case "phone":
      return <div className={styles.fieldCardPreview}><input type="text" placeholder={field.placeholder || ""} readOnly /></div>;
    case "textarea":
      return <div className={styles.fieldCardPreview}><textarea placeholder={field.placeholder || ""} readOnly /></div>;
    case "number":
    case "currency":
      return <div className={styles.fieldCardPreview}><input type="text" placeholder={field.fieldType === "currency" ? "$0.00" : "0"} readOnly /></div>;
    case "dropdown":
      return (
        <div className={styles.fieldCardPreview}>
          <select disabled>
            <option>Choose…</option>
            {(cfg.options as string[] || []).map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      );
    case "multiselect":
    case "checkbox":
      return (
        <div className={styles.fieldCardPreview} style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.85rem", color: "#1b2856" }}>
          {((cfg.options as string[]) || ["Option 1"]).slice(0, 3).map((o) => (
            <label key={o} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input type="checkbox" disabled /> {o}
            </label>
          ))}
        </div>
      );
    case "radio":
      return (
        <div className={styles.fieldCardPreview} style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.85rem", color: "#1b2856" }}>
          {((cfg.options as string[]) || ["Option 1"]).slice(0, 3).map((o) => (
            <label key={o} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input type="radio" disabled /> {o}
            </label>
          ))}
        </div>
      );
    case "yesno":
      return <div className={styles.fieldCardPreview} style={{ fontSize: "0.85rem", color: "#6a737b" }}>○ {(cfg.trueLabel as string) || "Yes"} &nbsp;&nbsp; ○ {(cfg.falseLabel as string) || "No"}</div>;
    case "date":
      return <div className={styles.fieldCardPreview}><input type="date" disabled /></div>;
    case "time":
      return <div className={styles.fieldCardPreview}><input type="time" disabled /></div>;
    case "datetime":
      return <div className={styles.fieldCardPreview}><input type="datetime-local" disabled /></div>;
    case "file":
    case "image":
      return <div className={styles.fieldCardPreview} style={{ padding: "1rem", border: "1px dashed #c9d0d7", borderRadius: 6, textAlign: "center", fontSize: "0.8rem", color: "#6a737b" }}>📎 File upload</div>;
    case "signature":
      return <div className={styles.fieldCardPreview} style={{ padding: "0.75rem", border: "1px dashed #c9d0d7", borderRadius: 6, textAlign: "center", fontSize: "0.8rem", color: "#6a737b", height: 60 }}>✍️ Signature pad</div>;
    case "rating":
      return <div className={styles.fieldCardPreview} style={{ fontSize: "1.2rem", color: "#d1d5db" }}>{"★".repeat((cfg.max as number) || 5)}</div>;
    case "scale":
      return <div className={styles.fieldCardPreview} style={{ fontSize: "0.85rem", color: "#6a737b" }}>{(cfg.minLabel as string) || "Low"} ─────── {(cfg.maxLabel as string) || "High"}</div>;
    case "address":
      return <div className={styles.fieldCardPreview}><input type="text" placeholder="Street, city, state, ZIP" readOnly /></div>;
    case "fullname":
      return <div className={styles.fieldCardPreview}><input type="text" placeholder="First Last" readOnly /></div>;
    case "heading":
      return <h2 style={{ margin: "0.5rem 0", color: "#1b2856", fontSize: (cfg.level === "h1") ? "1.5rem" : (cfg.level === "h3") ? "1.1rem" : "1.25rem" }}>{field.label}</h2>;
    case "paragraph":
      return <p style={{ margin: "0.5rem 0", color: "#1b2856", fontSize: "0.9rem", lineHeight: 1.5 }}>{(cfg.content as string) || field.label}</p>;
    case "divider":
      return <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "0.5rem 0" }} />;
    case "spacer":
      return <div style={{ height: (cfg.height as number) || 24 }} />;
    case "hidden":
      return <div className={styles.fieldCardPreview} style={{ fontSize: "0.8rem", color: "#6a737b", fontStyle: "italic" }}>Hidden field: value = {String(cfg.value || field.defaultValue || "")}</div>;
    default:
      return <div className={styles.fieldCardPreview}><input type="text" readOnly placeholder={field.fieldType} /></div>;
  }
}

/** Right panel: properties/validation/logic/prefill */
function PropertiesPanel({
  field, allFields, panelTab, setPanelTab, updateField,
}: {
  field: FormField | null;
  allFields: FormField[];
  panelTab: PanelTab;
  setPanelTab: (t: PanelTab) => void;
  updateField: (id: number, patch: Partial<FormField>) => void;
}) {
  if (!field) {
    return (
      <div className={styles.builderRight}>
        <p style={{ fontSize: "0.85rem", color: "#6a737b", padding: "1rem 0", textAlign: "center" }}>
          Select a field to edit its properties.
        </p>
      </div>
    );
  }

  const cfg = (field.fieldConfig || {}) as Record<string, unknown>;
  const updateCfg = (patch: Record<string, unknown>) =>
    updateField(field.id, { fieldConfig: { ...cfg, ...patch } });
  const validation = (field.validation || {}) as Record<string, unknown>;
  const updateValidation = (patch: Record<string, unknown>) =>
    updateField(field.id, { validation: { ...validation, ...patch } });

  return (
    <div className={styles.builderRight}>
      <div className={styles.panelTabs}>
        {(["properties", "validation", "logic", "prefill"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.panelTab} ${panelTab === t ? styles.panelTabActive : ""}`}
            onClick={() => setPanelTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {panelTab === "properties" ? (
        <PropertiesTab field={field} updateField={updateField} updateCfg={updateCfg} />
      ) : panelTab === "validation" ? (
        <ValidationTab field={field} updateField={updateField} updateValidation={updateValidation} />
      ) : panelTab === "logic" ? (
        <LogicTab field={field} allFields={allFields} updateField={updateField} />
      ) : (
        <PreFillTab field={field} updateField={updateField} />
      )}
    </div>
  );
}

function PropertiesTab({
  field, updateField, updateCfg,
}: {
  field: FormField;
  updateField: (id: number, patch: Partial<FormField>) => void;
  updateCfg: (patch: Record<string, unknown>) => void;
}) {
  const cfg = (field.fieldConfig || {}) as Record<string, unknown>;
  const isLayout = ["heading", "paragraph", "divider", "spacer", "hidden"].includes(field.fieldType);
  const width = field.layout?.width || "full";

  return (
    <div>
      <div className={styles.panelField}>
        <label>Label</label>
        <input
          type="text"
          value={field.label}
          onChange={(e) => updateField(field.id, { label: e.target.value })}
        />
      </div>
      {!isLayout ? (
        <>
          <div className={styles.panelField}>
            <label>Description</label>
            <textarea
              value={field.description || ""}
              onChange={(e) => updateField(field.id, { description: e.target.value })}
            />
          </div>
          <div className={styles.panelField}>
            <label>Placeholder</label>
            <input
              type="text"
              value={field.placeholder || ""}
              onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
            />
          </div>
          <div className={styles.panelField}>
            <label>Help Text</label>
            <input
              type="text"
              value={field.helpText || ""}
              onChange={(e) => updateField(field.id, { helpText: e.target.value })}
            />
          </div>
          <div className={styles.toggleRow}>
            <input
              type="checkbox"
              id={`req-${field.id}`}
              checked={field.isRequired}
              onChange={(e) => updateField(field.id, { isRequired: e.target.checked })}
            />
            <label htmlFor={`req-${field.id}`}>Required</label>
          </div>
          <div className={styles.toggleRow}>
            <input
              type="checkbox"
              id={`hide-${field.id}`}
              checked={field.isHidden}
              onChange={(e) => updateField(field.id, { isHidden: e.target.checked })}
            />
            <label htmlFor={`hide-${field.id}`}>Hidden (auto-populated only)</label>
          </div>
          <div className={styles.panelField}>
            <label>Width</label>
            <div className={styles.widthGroup}>
              {(["full", "half", "third"] as FieldWidth[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  className={`${styles.widthBtn} ${width === w ? styles.widthBtnActive : ""}`}
                  onClick={() => updateField(field.id, { layout: { width: w } })}
                >
                  {w === "full" ? "Full" : w === "half" ? "Half" : "Third"}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {["dropdown", "radio", "checkbox", "multiselect"].includes(field.fieldType) ? (
        <OptionsEditor cfg={cfg} updateCfg={updateCfg} />
      ) : null}

      {field.fieldType === "number" || field.fieldType === "currency" ? (
        <>
          <div className={styles.panelField}>
            <label>Min</label>
            <input type="number" value={String(cfg.min ?? "")} onChange={(e) => updateCfg({ min: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div className={styles.panelField}>
            <label>Max</label>
            <input type="number" value={String(cfg.max ?? "")} onChange={(e) => updateCfg({ max: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
        </>
      ) : null}

      {field.fieldType === "heading" ? (
        <div className={styles.panelField}>
          <label>Heading Level</label>
          <select value={(cfg.level as string) || "h2"} onChange={(e) => updateCfg({ level: e.target.value })}>
            <option value="h1">H1</option><option value="h2">H2</option>
            <option value="h3">H3</option><option value="h4">H4</option>
          </select>
        </div>
      ) : null}

      {field.fieldType === "paragraph" ? (
        <div className={styles.panelField}>
          <label>Content</label>
          <textarea
            value={(cfg.content as string) || ""}
            onChange={(e) => updateCfg({ content: e.target.value })}
          />
        </div>
      ) : null}

      {field.fieldType === "spacer" ? (
        <div className={styles.panelField}>
          <label>Height (px)</label>
          <input type="number" value={String(cfg.height ?? 24)} onChange={(e) => updateCfg({ height: Number(e.target.value) })} />
        </div>
      ) : null}

      {field.fieldType === "scale" ? (
        <>
          <div className={styles.panelField}>
            <label>Min Label</label>
            <input type="text" value={(cfg.minLabel as string) || ""} onChange={(e) => updateCfg({ minLabel: e.target.value })} />
          </div>
          <div className={styles.panelField}>
            <label>Max Label</label>
            <input type="text" value={(cfg.maxLabel as string) || ""} onChange={(e) => updateCfg({ maxLabel: e.target.value })} />
          </div>
        </>
      ) : null}

      {field.fieldType === "hidden" ? (
        <div className={styles.panelField}>
          <label>Default Value</label>
          <input type="text" value={field.defaultValue || ""} onChange={(e) => updateField(field.id, { defaultValue: e.target.value })} />
        </div>
      ) : null}

      <div className={styles.panelField}>
        <label>Field Key (readonly)</label>
        <input type="text" value={field.fieldKey} readOnly style={{ background: "#f5f5f5", color: "#6a737b" }} />
      </div>
    </div>
  );
}

function OptionsEditor({
  cfg, updateCfg,
}: {
  cfg: Record<string, unknown>;
  updateCfg: (patch: Record<string, unknown>) => void;
}) {
  const options = (cfg.options as string[]) || [];
  const update = (opts: string[]) => updateCfg({ options: opts });
  return (
    <div className={styles.panelField}>
      <label>Options</label>
      {options.map((o, i) => (
        <div key={i} className={styles.optionRow}>
          <input
            type="text"
            value={o}
            onChange={(e) => {
              const next = [...options];
              next[i] = e.target.value;
              update(next);
            }}
          />
          <button type="button" className={styles.smallBtn} onClick={() => update(options.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className={styles.smallBtn} onClick={() => update([...options, `Option ${options.length + 1}`])}>
        + Add Option
      </button>
    </div>
  );
}

function ValidationTab({
  field, updateField, updateValidation,
}: {
  field: FormField;
  updateField: (id: number, patch: Partial<FormField>) => void;
  updateValidation: (patch: Record<string, unknown>) => void;
}) {
  const v = (field.validation || {}) as Record<string, unknown>;
  return (
    <div>
      <div className={styles.toggleRow}>
        <input
          type="checkbox"
          id={`req2-${field.id}`}
          checked={field.isRequired}
          onChange={(e) => updateField(field.id, { isRequired: e.target.checked })}
        />
        <label htmlFor={`req2-${field.id}`}>Required</label>
      </div>
      {["text", "textarea"].includes(field.fieldType) ? (
        <>
          <div className={styles.panelField}>
            <label>Min length</label>
            <input type="number" value={String(v.minLength ?? "")} onChange={(e) => updateValidation({ minLength: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div className={styles.panelField}>
            <label>Max length</label>
            <input type="number" value={String(v.maxLength ?? "")} onChange={(e) => updateValidation({ maxLength: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
        </>
      ) : null}
      {["number", "currency"].includes(field.fieldType) ? (
        <>
          <div className={styles.panelField}>
            <label>Min value</label>
            <input type="number" value={String(v.min ?? "")} onChange={(e) => updateValidation({ min: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div className={styles.panelField}>
            <label>Max value</label>
            <input type="number" value={String(v.max ?? "")} onChange={(e) => updateValidation({ max: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
        </>
      ) : null}
      <div className={styles.panelField}>
        <label>Custom error message</label>
        <input type="text" value={(v.errorMessage as string) || ""} onChange={(e) => updateValidation({ errorMessage: e.target.value })} />
      </div>
    </div>
  );
}

function LogicTab({
  field, allFields, updateField,
}: {
  field: FormField;
  allFields: FormField[];
  updateField: (id: number, patch: Partial<FormField>) => void;
}) {
  const logic = field.conditionalLogic || { enabled: false, action: "show", logic: "all", conditions: [] };
  const update = (patch: Partial<typeof logic>) =>
    updateField(field.id, { conditionalLogic: { ...logic, ...patch } });

  const availableFields = allFields.filter(
    (f) => f.id !== field.id && !["heading", "paragraph", "divider", "spacer"].includes(f.fieldType)
  );

  return (
    <div>
      <div className={styles.toggleRow}>
        <input
          type="checkbox"
          id={`logic-${field.id}`}
          checked={logic.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        <label htmlFor={`logic-${field.id}`}>Enable conditional logic</label>
      </div>

      {logic.enabled ? (
        <>
          <div className={styles.panelField}>
            <label>Action</label>
            <select value={logic.action} onChange={(e) => update({ action: e.target.value as typeof logic.action })}>
              <option value="show">Show this field</option>
              <option value="hide">Hide this field</option>
              <option value="require">Make required</option>
              <option value="unrequire">Make optional</option>
            </select>
          </div>
          <div className={styles.panelField}>
            <label>Match</label>
            <select value={logic.logic} onChange={(e) => update({ logic: e.target.value as "all" | "any" })}>
              <option value="all">All conditions (AND)</option>
              <option value="any">Any condition (OR)</option>
            </select>
          </div>
          {logic.conditions.map((c, i) => (
            <div key={i} className={styles.conditionCard}>
              <div className={styles.conditionRow}>
                <select
                  value={c.fieldKey}
                  onChange={(e) => {
                    const next = [...logic.conditions];
                    next[i] = { ...c, fieldKey: e.target.value };
                    update({ conditions: next });
                  }}
                >
                  <option value="">Field…</option>
                  {availableFields.map((f) => (
                    <option key={f.id} value={f.fieldKey}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div className={styles.conditionRow}>
                <select
                  value={c.operator}
                  onChange={(e) => {
                    const next = [...logic.conditions];
                    next[i] = { ...c, operator: e.target.value };
                    update({ conditions: next });
                  }}
                >
                  {CONDITION_OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
              </div>
              {!["is_empty", "is_not_empty"].includes(c.operator) ? (
                <div className={styles.conditionRow}>
                  <input
                    type="text"
                    placeholder="Value"
                    value={c.value}
                    onChange={(e) => {
                      const next = [...logic.conditions];
                      next[i] = { ...c, value: e.target.value };
                      update({ conditions: next });
                    }}
                  />
                </div>
              ) : null}
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => update({ conditions: logic.conditions.filter((_, j) => j !== i) })}
              >Remove</button>
            </div>
          ))}
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => update({ conditions: [...logic.conditions, { fieldKey: "", operator: "equals", value: "" }] })}
          >+ Add Condition</button>
        </>
      ) : null}
    </div>
  );
}

function PreFillTab({
  field, updateField,
}: {
  field: FormField;
  updateField: (id: number, patch: Partial<FormField>) => void;
}) {
  const pf = field.preFillConfig || { source: "url_param" as const, config: {} };
  const enabled = !!field.preFillConfig;

  const update = (patch: Partial<typeof pf>) =>
    updateField(field.id, { preFillConfig: { ...pf, ...patch } });

  return (
    <div>
      <div className={styles.toggleRow}>
        <input
          type="checkbox"
          id={`pf-${field.id}`}
          checked={enabled}
          onChange={(e) => updateField(field.id, { preFillConfig: e.target.checked ? { source: "url_param", config: {} } : null })}
        />
        <label htmlFor={`pf-${field.id}`}>Enable pre-fill</label>
      </div>

      {enabled ? (
        <>
          <div className={styles.panelField}>
            <label>Source</label>
            <select value={pf.source} onChange={(e) => update({ source: e.target.value as typeof pf.source, config: {} })}>
              <option value="url_param">URL Parameter</option>
              <option value="appfolio_property">AppFolio Property</option>
              <option value="appfolio_owner">AppFolio Owner</option>
              <option value="static">Static Value</option>
              <option value="user">Current User</option>
            </select>
          </div>
          {pf.source === "url_param" ? (
            <div className={styles.panelField}>
              <label>Param Name</label>
              <input
                type="text"
                placeholder="e.g., property, pid"
                value={(pf.config?.paramName as string) || ""}
                onChange={(e) => update({ config: { ...pf.config, paramName: e.target.value } })}
              />
            </div>
          ) : null}
          {pf.source === "static" ? (
            <div className={styles.panelField}>
              <label>Value</label>
              <input
                type="text"
                value={(pf.config?.value as string) || ""}
                onChange={(e) => update({ config: { ...pf.config, value: e.target.value } })}
              />
            </div>
          ) : null}
          {pf.source === "appfolio_property" ? (
            <div className={styles.panelField}>
              <label>Property Field</label>
              <select
                value={(pf.config?.field as string) || ""}
                onChange={(e) => update({ config: { ...pf.config, field: e.target.value, propertyIdParam: "pid" } })}
              >
                <option value="">Select…</option>
                <option value="property_name">Property Name</option>
                <option value="property_address">Property Address</option>
                <option value="property_type">Property Type</option>
              </select>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ShareTab({ form, publicUrl }: { form: FormSummary; publicUrl: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (s: string) => {
    navigator.clipboard?.writeText(s).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(publicUrl)}`;
  const embedCode = `<iframe src="${publicUrl}${publicUrl.includes("?") ? "&" : "?"}embed=true" width="100%" height="800" frameborder="0"></iframe>`;

  return (
    <div className={styles.main}>
      {form.status !== "published" ? (
        <div className={styles.errorBanner}>
          Publish the form to make it shareable.
        </div>
      ) : null}
      <div className={styles.shareSection}>
        <h4>Direct Link</h4>
        <div className={styles.shareLink}>
          <input type="text" readOnly value={publicUrl} />
          <button type="button" className={styles.smallBtn} onClick={() => copy(publicUrl)}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <div className={styles.shareSection}>
        <h4>QR Code</h4>
        <div className={styles.qrWrap}>
          <img src={qrUrl} alt="QR code" />
          <a href={qrUrl} download="form-qr.png" className={styles.smallBtn} style={{ marginTop: "0.5rem", display: "inline-block" }}>
            Download PNG
          </a>
        </div>
      </div>
      <div className={styles.shareSection}>
        <h4>Embed Code</h4>
        <div className={styles.shareLink}>
          <input type="text" readOnly value={embedCode} />
          <button type="button" className={styles.smallBtn} onClick={() => copy(embedCode)}>Copy</button>
        </div>
      </div>
      {form.accessType === "private" ? (
        <div className={styles.shareSection}>
          <h4>Private Access Token</h4>
          <div className={styles.shareLink}>
            <input type="text" readOnly value={form.accessToken || ""} />
            <button type="button" className={styles.smallBtn} onClick={() => copy(form.accessToken || "")}>Copy</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsTab({
  form, saveForm,
}: {
  form: FormSummary;
  saveForm: (patch: Partial<FormSummary>) => void;
}) {
  const [local, setLocal] = useState(form);
  useEffect(() => { setLocal(form); }, [form]);

  return (
    <div className={styles.main}>
      <div style={{ background: "white", borderRadius: 10, padding: "1.25rem", border: "1px solid rgba(27,40,86,0.08)", maxWidth: 640 }}>
        <div className={styles.field}>
          <label>Form Name</label>
          <input type="text" value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} onBlur={() => saveForm({ name: local.name })} />
        </div>
        <div className={styles.field}>
          <label>Description</label>
          <textarea value={local.description || ""} onChange={(e) => setLocal({ ...local, description: e.target.value })} onBlur={() => saveForm({ description: local.description || "" })} />
        </div>
        <div className={styles.field}>
          <label>Category</label>
          <select value={local.category || ""} onChange={(e) => { setLocal({ ...local, category: e.target.value }); saveForm({ category: e.target.value }); }}>
            <option value="">—</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Slug</label>
          <input type="text" value={local.slug || ""} onChange={(e) => setLocal({ ...local, slug: e.target.value })} onBlur={() => saveForm({ slug: local.slug || "" })} />
        </div>
        <div className={styles.field}>
          <label>Access Type</label>
          <select value={local.accessType} onChange={(e) => { setLocal({ ...local, accessType: e.target.value as FormSummary["accessType"] }); saveForm({ accessType: e.target.value as FormSummary["accessType"] }); }}>
            <option value="public">Public (anyone with link)</option>
            <option value="private">Private (token required)</option>
            <option value="internal">Internal (logged-in only)</option>
          </select>
        </div>
        <div className={styles.field}>
          <label>Submit Button Text</label>
          <input type="text" value={local.submitButtonText} onChange={(e) => setLocal({ ...local, submitButtonText: e.target.value })} onBlur={() => saveForm({ submitButtonText: local.submitButtonText })} />
        </div>
        <div className={styles.field}>
          <label>Success Message</label>
          <textarea value={local.successMessage} onChange={(e) => setLocal({ ...local, successMessage: e.target.value })} onBlur={() => saveForm({ successMessage: local.successMessage })} />
        </div>
        <div className={styles.field}>
          <label>Success Redirect URL (optional)</label>
          <input type="url" value={local.successRedirectUrl || ""} onChange={(e) => setLocal({ ...local, successRedirectUrl: e.target.value })} onBlur={() => saveForm({ successRedirectUrl: local.successRedirectUrl || "" })} />
        </div>
      </div>
    </div>
  );
}
