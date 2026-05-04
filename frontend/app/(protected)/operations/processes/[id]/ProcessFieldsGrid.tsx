"use client";

import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";

type FieldRow = {
  fieldDefinitionId: number;
  label: string;
  fieldType: string;
  value: unknown;
  scope: "process" | "process_step";
  stepId: number | null;
  stepName: string | null;
  stepNumber: number | null;
  stepStatus: string | null;
  updatedAt: string;
};

function tone(value: unknown): { bg: string; fg: string; border: string } {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (value === true || s === "yes" || s === "true" || s === "y" || s === "complete") {
    return { bg: "#E8F5E9", fg: "#1B8A4E", border: "rgba(27, 138, 78, 0.25)" };
  }
  if (value === false || s === "no" || s === "false" || s === "n" || s === "missing") {
    return { bg: "#FFF3E0", fg: "#E5890A", border: "rgba(229, 137, 10, 0.25)" };
  }
  if (value === null || value === undefined || value === "") {
    return { bg: "rgba(27, 40, 86, 0.03)", fg: "#9ca3af", border: "rgba(27, 40, 86, 0.08)" };
  }
  return { bg: "rgba(27, 40, 86, 0.04)", fg: "#1B2856", border: "rgba(27, 40, 86, 0.1)" };
}

function format(value: unknown, fieldType: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (fieldType === "date" && typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }
  if (fieldType === "datetime" && typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toLocaleString();
  }
  if (fieldType === "currency" && typeof value === "number") {
    return `$${value.toLocaleString()}`;
  }
  if (fieldType === "percentage" && typeof value === "number") {
    return `${value}%`;
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return String(value);
}

/**
 * Quick-reference grid of every custom field value on this process — covers
 * both process-level fields and per-step fields. Shown above the steps timeline.
 */
export default function ProcessFieldsGrid({ processId }: { processId: number }) {
  const { authHeaders, token } = useAuth();
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/custom-field-summary`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.fields)) setFields(body.fields);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, processId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || fields.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "0.5rem",
        marginBottom: "1.25rem",
      }}
    >
      {fields.map((f, i) => {
        const t = tone(f.value);
        return (
          <div
            key={`${f.fieldDefinitionId}-${f.scope}-${f.stepId ?? "p"}-${i}`}
            style={{
              padding: "0.55rem 0.75rem",
              borderRadius: 8,
              background: t.bg,
              border: `1px solid ${t.border}`,
              display: "flex",
              flexDirection: "column",
              gap: "0.15rem",
            }}
            title={f.stepName ? `On step: ${f.stepName}` : "Process field"}
          >
            <div
              style={{
                fontSize: "0.65rem",
                color: "#6a737b",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {f.label}
            </div>
            <div style={{ fontSize: "0.92rem", fontWeight: 700, color: t.fg }}>
              {format(f.value, f.fieldType)}
            </div>
            {f.stepName ? (
              <div
                style={{
                  fontSize: "0.66rem",
                  color: "#6a737b",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {f.stepNumber != null ? `Step ${f.stepNumber}: ` : ""}
                {f.stepName}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
