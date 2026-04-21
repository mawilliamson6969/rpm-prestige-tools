"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type {
  CustomFieldConfig,
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldType,
} from "./types";
import { FIELD_TYPE_META, FIELD_TYPE_ORDER } from "./types";

type Props = {
  entityType: CustomFieldEntityType;
  entityId: number;
  allowFillAtLaunch?: boolean;
};

type FieldForm = {
  id?: number;
  fieldLabel: string;
  fieldName: string;
  fieldType: CustomFieldType;
  fieldConfig: CustomFieldConfig;
  isRequired: boolean;
  sectionName: string;
  placeholder: string;
  helpText: string;
};

function slug(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function emptyForm(): FieldForm {
  return {
    fieldLabel: "",
    fieldName: "",
    fieldType: "text",
    fieldConfig: {},
    isRequired: false,
    sectionName: "Details",
    placeholder: "",
    helpText: "",
  };
}

export default function CustomFieldManager({ entityType, entityId, allowFillAtLaunch }: Props) {
  const { authHeaders, token } = useAuth();
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<FieldForm>(emptyForm());
  const [labelTouched, setLabelTouched] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/custom-fields/definitions?entityType=${entityType}&entityId=${entityId}`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setFields(body.definitions || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load fields.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setForm(emptyForm());
    setLabelTouched(false);
    setEditorOpen(true);
  };

  const openEdit = (field: CustomFieldDefinition) => {
    setForm({
      id: field.id,
      fieldLabel: field.fieldLabel,
      fieldName: field.fieldName,
      fieldType: field.fieldType,
      fieldConfig: field.fieldConfig || {},
      isRequired: field.isRequired,
      sectionName: field.sectionName || "Details",
      placeholder: field.placeholder || "",
      helpText: field.helpText || "",
    });
    setLabelTouched(true);
    setEditorOpen(true);
  };

  const save = async () => {
    if (!form.fieldLabel.trim()) {
      setErr("Field label is required.");
      return;
    }
    const payload = {
      entityType,
      entityId,
      fieldLabel: form.fieldLabel.trim(),
      fieldName: form.fieldName.trim() || slug(form.fieldLabel),
      fieldType: form.fieldType,
      fieldConfig: form.fieldConfig,
      isRequired: form.isRequired,
      sectionName: form.sectionName || "Details",
      placeholder: form.placeholder || null,
      helpText: form.helpText || null,
    };
    try {
      if (form.id) {
        const res = await fetch(apiUrl(`/custom-fields/definitions/${form.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Save failed.");
      } else {
        const res = await fetch(apiUrl("/custom-fields/definitions"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Save failed.");
      }
      setEditorOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const deleteField = async (id: number) => {
    if (
      !confirm(
        "This will remove this field and all its data from all instances using this template. Continue?"
      )
    )
      return;
    try {
      await fetch(apiUrl(`/custom-fields/definitions/${id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  const reorder = async (ids: number[]) => {
    try {
      await fetch(apiUrl(`/custom-fields/definitions/reorder`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ fieldIds: ids }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reorder failed.");
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CustomFieldDefinition[]>();
    for (const f of fields) {
      const s = f.sectionName || "Details";
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(f);
    }
    return Array.from(map.entries());
  }, [fields]);

  if (loading) return <div className={styles.loading}>Loading fields…</div>;

  return (
    <div>
      {err ? <div className={styles.errorBanner}>{err}</div> : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <span className={styles.projectStatHint}>
          {fields.length} field{fields.length === 1 ? "" : "s"} defined
        </span>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openNew}>
          + Add Field
        </button>
      </div>

      {fields.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No custom fields yet</h3>
          <p>Add fields to collect structured data beyond the defaults.</p>
        </div>
      ) : (
        grouped.map(([section, groupFields]) => (
          <div key={section} className={styles.cfSectionGroup}>
            <div className={styles.cfSectionGroupHeader}>{section}</div>
            <div className={styles.cfManagerList}>
              {groupFields.map((f, idx) => {
                const globalIdx = fields.indexOf(f);
                const meta = FIELD_TYPE_META[f.fieldType];
                return (
                  <div
                    key={f.id}
                    className={styles.cfManagerRow}
                    draggable
                    onDragStart={() => setDragIdx(globalIdx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx === null || dragIdx === globalIdx) return;
                      const reordered = [...fields];
                      const [moved] = reordered.splice(dragIdx, 1);
                      reordered.splice(globalIdx, 0, moved);
                      reorder(reordered.map((x) => x.id));
                      setDragIdx(null);
                    }}
                  >
                    <span className={styles.dragHandle}>⋮⋮</span>
                    <span className={styles.cfManagerRowIcon}>{meta.icon}</span>
                    <span className={styles.cfManagerRowLabel}>
                      {f.fieldLabel}
                      {f.isRequired ? <span className={styles.cfRequired}> *</span> : null}
                    </span>
                    <span className={styles.cfManagerRowBadge}>{meta.label}</span>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => openEdit(f)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                      onClick={() => deleteField(f.id)}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {editorOpen ? (
        <FieldEditorModal
          form={form}
          labelTouched={labelTouched}
          setForm={setForm}
          setLabelTouched={setLabelTouched}
          onClose={() => setEditorOpen(false)}
          onSave={save}
          allowFillAtLaunch={allowFillAtLaunch}
        />
      ) : null}
    </div>
  );
}

function FieldEditorModal({
  form,
  labelTouched,
  setForm,
  setLabelTouched,
  onClose,
  onSave,
  allowFillAtLaunch,
}: {
  form: FieldForm;
  labelTouched: boolean;
  setForm: (f: FieldForm) => void;
  setLabelTouched: (v: boolean) => void;
  onClose: () => void;
  onSave: () => void;
  allowFillAtLaunch?: boolean;
}) {
  const meta = FIELD_TYPE_META[form.fieldType];
  const updateConfig = (patch: CustomFieldConfig) =>
    setForm({ ...form, fieldConfig: { ...form.fieldConfig, ...patch } });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{form.id ? "Edit Field" : "New Field"}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Field label</label>
              <input
                value={form.fieldLabel}
                autoFocus
                required
                onChange={(e) => {
                  const label = e.target.value;
                  setForm({
                    ...form,
                    fieldLabel: label,
                    fieldName: labelTouched ? form.fieldName : slug(label),
                  });
                }}
              />
            </div>
            <div className={styles.field}>
              <label>Internal name</label>
              <input
                value={form.fieldName}
                onChange={(e) => {
                  setLabelTouched(true);
                  setForm({ ...form, fieldName: slug(e.target.value) });
                }}
                placeholder="auto-generated"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label>Field type — {meta.label}</label>
            <div className={styles.cfTypeGrid}>
              {FIELD_TYPE_ORDER.map((t) => {
                const m = FIELD_TYPE_META[t];
                return (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.cfTypeTile} ${form.fieldType === t ? styles.cfTypeTileActive : ""}`}
                    onClick={() => setForm({ ...form, fieldType: t, fieldConfig: {} })}
                    title={m.description}
                  >
                    <div className={styles.cfTypeIcon}>{m.icon}</div>
                    <div className={styles.cfTypeLabel}>{m.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <TypeConfigFields type={form.fieldType} config={form.fieldConfig} update={updateConfig} />

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Section</label>
              <input
                value={form.sectionName}
                onChange={(e) => setForm({ ...form, sectionName: e.target.value })}
                placeholder="Details"
              />
            </div>
            <div className={styles.field}>
              <label>Placeholder</label>
              <input
                value={form.placeholder}
                onChange={(e) => setForm({ ...form, placeholder: e.target.value })}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label>Help text</label>
            <input
              value={form.helpText}
              onChange={(e) => setForm({ ...form, helpText: e.target.value })}
              placeholder="Small hint shown below the field"
            />
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.9rem",
                color: "#1b2856",
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={form.isRequired}
                onChange={(e) => setForm({ ...form, isRequired: e.target.checked })}
              />
              Required
            </label>
            {allowFillAtLaunch ? (
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.9rem",
                  color: "#1b2856",
                  fontWeight: 600,
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(form.fieldConfig.fillAtLaunch)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      fieldConfig: { ...form.fieldConfig, fillAtLaunch: e.target.checked },
                    })
                  }
                />
                Ask at launch
              </label>
            ) : null}
          </div>

          <div className={styles.formActions}>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
              {form.id ? "Save changes" : "Create field"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TypeConfigFields({
  type,
  config,
  update,
}: {
  type: CustomFieldType;
  config: CustomFieldConfig;
  update: (p: CustomFieldConfig) => void;
}) {
  if (type === "select" || type === "multiselect") {
    const options = config.options ?? [];
    return (
      <div className={styles.field}>
        <label>Options</label>
        <div>
          {options.map((o, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: "0.4rem", marginBottom: "0.3rem", alignItems: "center" }}
            >
              <input
                className={styles.cfInput}
                value={o}
                onChange={(e) => {
                  const next = [...options];
                  next[i] = e.target.value;
                  update({ options: next });
                }}
              />
              <button
                type="button"
                className={styles.pinBtn}
                onClick={() => update({ options: options.filter((_, idx) => idx !== i) })}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => update({ options: [...options, "Option " + (options.length + 1)] })}
          >
            + Add option
          </button>
        </div>
      </div>
    );
  }
  if (type === "number" || type === "currency" || type === "percentage") {
    return (
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label>Min</label>
          <input
            type="number"
            value={config.min ?? ""}
            onChange={(e) => update({ min: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>Max</label>
          <input
            type="number"
            value={config.max ?? ""}
            onChange={(e) => update({ max: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label>Step</label>
          <input
            type="number"
            value={config.step ?? ""}
            onChange={(e) => update({ step: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        {type === "number" ? (
          <>
            <div className={styles.field}>
              <label>Prefix</label>
              <input
                value={config.prefix ?? ""}
                onChange={(e) => update({ prefix: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label>Suffix</label>
              <input
                value={config.suffix ?? ""}
                onChange={(e) => update({ suffix: e.target.value })}
              />
            </div>
          </>
        ) : null}
      </div>
    );
  }
  if (type === "rating") {
    return (
      <div className={styles.field}>
        <label>Max stars</label>
        <input
          type="number"
          min={1}
          max={10}
          value={config.max ?? 5}
          onChange={(e) => update({ max: Number(e.target.value) || 5 })}
        />
      </div>
    );
  }
  if (type === "file") {
    return (
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label>Max files</label>
          <input
            type="number"
            min={1}
            value={config.maxFiles ?? 5}
            onChange={(e) => update({ maxFiles: Number(e.target.value) || 5 })}
          />
        </div>
        <div className={styles.field}>
          <label>Accepted types</label>
          <input
            value={config.acceptTypes ?? ""}
            onChange={(e) => update({ acceptTypes: e.target.value })}
            placeholder=".pdf,.jpg,.png"
          />
        </div>
      </div>
    );
  }
  if (type === "boolean") {
    return (
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label>&ldquo;Yes&rdquo; label</label>
          <input
            value={config.trueLabel ?? ""}
            onChange={(e) => update({ trueLabel: e.target.value })}
            placeholder="Yes"
          />
        </div>
        <div className={styles.field}>
          <label>&ldquo;No&rdquo; label</label>
          <input
            value={config.falseLabel ?? ""}
            onChange={(e) => update({ falseLabel: e.target.value })}
            placeholder="No"
          />
        </div>
      </div>
    );
  }
  if (type === "text") {
    return (
      <div className={styles.field}>
        <label>Max length</label>
        <input
          type="number"
          value={config.maxLength ?? ""}
          onChange={(e) =>
            update({ maxLength: e.target.value === "" ? undefined : Number(e.target.value) })
          }
        />
      </div>
    );
  }
  if (type === "textarea") {
    return (
      <div className={styles.field}>
        <label>Rows</label>
        <input
          type="number"
          min={2}
          max={20}
          value={config.rows ?? 4}
          onChange={(e) => update({ rows: Number(e.target.value) || 4 })}
        />
      </div>
    );
  }
  if (type === "checklist") {
    const items = config.items ?? [];
    return (
      <div className={styles.field}>
        <label>Default items</label>
        <div>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: "0.4rem", marginBottom: "0.3rem" }}>
              <input
                className={styles.cfInput}
                value={item}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  update({ items: next });
                }}
              />
              <button
                type="button"
                className={styles.pinBtn}
                onClick={() => update({ items: items.filter((_, idx) => idx !== i) })}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => update({ items: [...items, "Item " + (items.length + 1)] })}
          >
            + Add item
          </button>
        </div>
      </div>
    );
  }
  return null;
}
