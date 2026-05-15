"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Hash, Info } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import styles from "./custom-fields.module.css";

/**
 * Phase 7.3 — Custom Fields tab.
 *
 * Pixel-target: process-management-system/project/screens.jsx
 * (CustomFields). The design shows three scopes — Processes /
 * Properties / Contacts. Only the **Processes** scope is backed by the
 * current schema (custom_field_definitions on entity_type
 * 'process_template'); Properties / Contacts need property & contact
 * record modeling that doesn't exist yet, so those sections render
 * informational/disabled (see PHASE7_3_DEFERRED note in the commit).
 */

interface ResolvedTemplate {
  id: number;
  name: string;
}

interface FieldDef {
  id: number;
  fieldLabel: string;
  fieldName: string;
  fieldType: string;
  isRequired: boolean;
  sectionName: string | null;
  helpText: string | null;
}

const FIELD_TYPES: Array<{ value: string; label: string }> = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "percentage", label: "Percentage" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date / Time" },
  { value: "boolean", label: "Yes / No" },
  { value: "select", label: "Single choice" },
  { value: "multiselect", label: "Multiple choice" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  FIELD_TYPES.map((t) => [t.value, t.label])
);

export default function CustomFieldsClient({ slug }: { slug: string }) {
  const { authHeaders, token, isAdmin } = useAuth();
  const [tpl, setTpl] = useState<ResolvedTemplate | null>(null);
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState("text");
  const [newRequired, setNewRequired] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const tRes = await fetch(apiUrl("/processes/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!tRes.ok) throw new Error("Could not load templates.");
      const tBody = await tRes.json();
      const match = (tBody.templates || []).find(
        (t: Record<string, unknown>) => t.slug === slug
      );
      if (!match) throw new Error(`No process template matches "${slug}".`);
      const resolved = { id: Number(match.id), name: String(match.name ?? "") };
      setTpl(resolved);

      const dRes = await fetch(
        apiUrl(
          `/custom-fields/definitions?entityType=process_template&entityId=${resolved.id}`
        ),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!dRes.ok) throw new Error("Could not load custom fields.");
      const dBody = await dRes.json();
      setDefs(
        (dBody.definitions || []).map((d: Record<string, unknown>) => ({
          id: Number(d.id),
          fieldLabel: String(d.fieldLabel ?? ""),
          fieldName: String(d.fieldName ?? ""),
          fieldType: String(d.fieldType ?? "text"),
          isRequired: Boolean(d.isRequired),
          sectionName: (d.sectionName as string | null) ?? null,
          helpText: (d.helpText as string | null) ?? null,
        }))
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load custom fields.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, slug, token]);

  useEffect(() => {
    load();
  }, [load]);

  const addField = useCallback(async () => {
    if (!tpl || busy || !newLabel.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/custom-fields/definitions"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          entityType: "process_template",
          entityId: tpl.id,
          fieldLabel: newLabel.trim(),
          fieldType: newType,
          isRequired: newRequired,
          sectionName: "Process Fields",
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not create field.");
      }
      setNewLabel("");
      setNewType("text");
      setNewRequired(false);
      setAdding(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create field.");
    } finally {
      setBusy(false);
    }
  }, [authHeaders, busy, load, newLabel, newRequired, newType, tpl]);

  const toggleRequired = useCallback(
    async (def: FieldDef) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(apiUrl(`/custom-fields/definitions/${def.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ isRequired: !def.isRequired }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || "Could not update field.");
        }
        setDefs((cur) =>
          cur.map((d) => (d.id === def.id ? { ...d, isRequired: !d.isRequired } : d))
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not update field.");
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, busy]
  );

  const deleteField = useCallback(
    async (id: number) => {
      if (busy || !window.confirm("Delete this custom field? Existing values are removed.")) {
        return;
      }
      setBusy(true);
      try {
        const res = await fetch(apiUrl(`/custom-fields/definitions/${id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || "Could not delete field.");
        }
        setDefs((cur) => cur.filter((d) => d.id !== id));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not delete field.");
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, busy]
  );

  const grouped = useMemo(() => {
    const m = new Map<string, FieldDef[]>();
    for (const d of defs) {
      const k = d.sectionName || "Process Fields";
      const arr = m.get(k) ?? [];
      arr.push(d);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [defs]);

  if (loading) {
    return <div data-pms className={styles.loading}>Loading custom fields…</div>;
  }

  return (
    <div data-pms className={styles.root}>
      <div className={styles.header}>
        <div>
          <div className={`${styles.eyebrow} pms-cond`}>{tpl?.name ?? slug}</div>
          <h1 className={`${styles.title} pms-cond`}>Custom Fields</h1>
          <p className={styles.sub}>
            Add custom data to this process. Field values are referenceable in email/text
            templates and conditional logic with{" "}
            <code className={`${styles.code} pms-mono`}>{"{{field_name}}"}</code> syntax.
          </p>
        </div>
        {isAdmin && !adding && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setAdding(true)}
          >
            <Plus size={14} /> Add Field
          </button>
        )}
      </div>

      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.infoBar}>
        <Info size={14} />
        <span>
          Custom fields can be referenced anywhere with{" "}
          <code className={`${styles.codeAmber} pms-mono`}>{"{{field_name}}"}</code> syntax.
        </span>
      </div>

      {/* Processes scope — the functional section */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={`${styles.sectionTitle} pms-cond`}>Processes</h3>
          <span className={styles.sectionHelp}>
            · Fields attached to this process (one set per running instance).
          </span>
        </div>

        {isAdmin && adding && (
          <div className={styles.addRow}>
            <input
              autoFocus
              className={styles.addInput}
              placeholder="Field label…"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addField();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <select
              className={styles.addSelect}
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <label className={styles.reqToggle}>
              <input
                type="checkbox"
                checked={newRequired}
                onChange={(e) => setNewRequired(e.target.checked)}
              />
              Required
            </label>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={addField}
              disabled={busy || !newLabel.trim()}
            >
              Add
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnLight}`}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        )}

        {defs.length === 0 ? (
          <div className={styles.emptyCard}>
            No custom fields on this process yet.
            {isAdmin ? " Use “Add Field” to create one." : ""}
          </div>
        ) : (
          grouped.map(([section, items]) => (
            <div key={section} className={styles.tableCard}>
              <div className={styles.tableCardHead}>{section}</div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Data Type</th>
                    <th>
                      Variable (<span className="pms-mono">{"{{…}}"}</span>)
                    </th>
                    <th className={styles.center}>Required</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className={styles.fieldLabelCell}>
                          <span className={styles.typeBadge}>
                            <Hash size={12} />
                          </span>
                          <span className={styles.fieldLabelText}>{d.fieldLabel}</span>
                        </div>
                        {d.helpText && (
                          <div className={styles.helpText}>{d.helpText}</div>
                        )}
                      </td>
                      <td>
                        <span className={styles.typeText}>
                          {TYPE_LABEL[d.fieldType] ?? d.fieldType}
                        </span>
                      </td>
                      <td>
                        <code className={`${styles.varCode} pms-mono`}>
                          {`{{${d.fieldName}}}`}
                        </code>
                      </td>
                      <td className={styles.center}>
                        {isAdmin ? (
                          <button
                            type="button"
                            className={`${styles.reqPill} ${d.isRequired ? styles.reqOn : styles.reqOff}`}
                            onClick={() => toggleRequired(d)}
                            disabled={busy}
                            title="Toggle required"
                          >
                            {d.isRequired ? "Required" : "Optional"}
                          </button>
                        ) : (
                          <span
                            className={`${styles.reqPill} ${d.isRequired ? styles.reqOn : styles.reqOff}`}
                          >
                            {d.isRequired ? "Required" : "Optional"}
                          </span>
                        )}
                      </td>
                      <td className={styles.actionsCell}>
                        {isAdmin && (
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => deleteField(d.id)}
                            disabled={busy}
                            title="Delete field"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>

      {/* Properties / Contacts — design scopes not yet backed by schema */}
      {(["Properties", "Contacts"] as const).map((scope) => (
        <section key={scope} className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={`${styles.sectionTitle} pms-cond ${styles.sectionDisabled}`}>
              {scope}
            </h3>
            <span className={styles.sectionHelp}>
              ·{" "}
              {scope === "Properties"
                ? "Fields stored on the property record itself."
                : "Fields stored on contacts (owners, tenants, vendors)."}
            </span>
          </div>
          <div className={styles.deferredCard}>
            <Info size={14} />
            <span>
              {scope}-scoped custom fields need {scope.toLowerCase()} records to be modeled
              first (properties/contacts are currently sourced externally). Deferred to a
              later phase.
            </span>
          </div>
        </section>
      ))}
    </div>
  );
}
