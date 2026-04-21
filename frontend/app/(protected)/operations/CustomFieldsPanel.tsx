"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./operations.module.css";
import CustomFieldEditor from "./CustomFieldEditor";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldValue,
  TeamUser,
} from "./types";

type Props = {
  entityType: CustomFieldEntityType;
  entityId: number;
  readOnly?: boolean;
  users?: TeamUser[];
  title?: string;
  hideCompletionBar?: boolean;
};

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    return Object.values(v as Record<string, unknown>).every(
      (x) => x === null || x === undefined || x === ""
    );
  }
  return false;
}

export default function CustomFieldsPanel({
  entityType,
  entityId,
  readOnly,
  users,
  title,
  hideCompletionBar,
}: Props) {
  const { authHeaders, token } = useAuth();
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [valuesByDef, setValuesByDef] = useState<Record<number, unknown>>({});
  const [savedFlash, setSavedFlash] = useState<Record<number, boolean>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/custom-fields/values?entityType=${entityType}&entityId=${entityId}`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setDefinitions(body.definitions || []);
      const map: Record<number, unknown> = {};
      for (const v of body.values as CustomFieldValue[]) {
        map[v.fieldDefinitionId] = v.value;
      }
      setValuesByDef(map);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load fields.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const saveValue = useCallback(
    async (defId: number, newValue: unknown) => {
      try {
        const res = await fetch(apiUrl("/custom-fields/values"), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            fieldDefinitionId: defId,
            entityType,
            entityId,
            value: newValue,
          }),
        });
        if (!res.ok) throw new Error("Save failed.");
        setSavedFlash((prev) => ({ ...prev, [defId]: true }));
        setTimeout(
          () => setSavedFlash((prev) => ({ ...prev, [defId]: false })),
          1200
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Save failed.");
      }
    },
    [authHeaders, entityType, entityId]
  );

  const onValueChange = (defId: number, newValue: unknown) => {
    setValuesByDef((prev) => ({ ...prev, [defId]: newValue }));
    if (saveTimers.current[defId]) clearTimeout(saveTimers.current[defId]);
    saveTimers.current[defId] = setTimeout(() => {
      saveValue(defId, newValue);
    }, 500);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CustomFieldDefinition[]>();
    for (const d of definitions) {
      const s = d.sectionName || "Details";
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(d);
    }
    return Array.from(map.entries());
  }, [definitions]);

  const completion = useMemo(() => {
    const total = definitions.length;
    if (total === 0) return { total: 0, filled: 0, requiredMissing: 0 };
    let filled = 0;
    let requiredMissing = 0;
    for (const d of definitions) {
      const v = valuesByDef[d.id];
      const empty = isEmpty(v);
      if (!empty) filled++;
      if (d.isRequired && empty) requiredMissing++;
    }
    return { total, filled, requiredMissing };
  }, [definitions, valuesByDef]);

  if (loading) return <div className={styles.loading}>Loading…</div>;

  if (definitions.length === 0) {
    return (
      <div className={styles.emptyState}>
        <h3>{title || "No custom fields yet"}</h3>
        <p>
          {readOnly
            ? "No custom fields have been defined."
            : "Define fields in the template to collect structured data."}
        </p>
      </div>
    );
  }

  return (
    <div>
      {title ? (
        <h3 style={{ color: "#1b2856", margin: "0 0 0.75rem", fontSize: "0.95rem" }}>{title}</h3>
      ) : null}
      {err ? <div className={styles.errorBanner}>{err}</div> : null}
      {!hideCompletionBar ? (
        <div className={styles.cfCompletionRow}>
          <span>
            {completion.filled} of {completion.total} fields completed
            {completion.requiredMissing > 0
              ? ` · ${completion.requiredMissing} required missing`
              : ""}
          </span>
          <div className={styles.progressBar} style={{ width: 140 }}>
            <div
              className={styles.progressFill}
              style={{
                width: `${completion.total > 0 ? Math.round((completion.filled / completion.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      {grouped.map(([section, fields]) => {
        const isCollapsed = collapsed.has(section);
        return (
          <div key={section} className={styles.cfSection}>
            <div
              className={styles.cfSectionHeader}
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(section)) next.delete(section);
                  else next.add(section);
                  return next;
                })
              }
            >
              <h4>{section}</h4>
              <span>{isCollapsed ? "▸" : "▾"}</span>
            </div>
            {!isCollapsed ? (
              <div className={styles.cfSectionBody}>
                {fields.map((d) => (
                  <div
                    key={d.id}
                    className={`${styles.cfField} ${savedFlash[d.id] ? styles.cfSavedFlash : ""}`}
                  >
                    <label className={styles.cfLabel}>
                      {d.fieldLabel}
                      {d.isRequired ? <span className={styles.cfRequired}>*</span> : null}
                    </label>
                    <CustomFieldEditor
                      definition={d}
                      value={valuesByDef[d.id] ?? null}
                      onChange={(v) => !readOnly && onValueChange(d.id, v)}
                      disabled={readOnly}
                      users={users}
                      entityType={entityType}
                      entityId={entityId}
                    />
                    {d.helpText ? <div className={styles.cfHelp}>{d.helpText}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
