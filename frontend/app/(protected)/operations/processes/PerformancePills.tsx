"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../operations.module.css";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import type { AnalyticsKpis } from "../types";

/**
 * Compact analytics summary pinned above the kanban — mirrors the top of the
 * Analytics page so operators can spot trouble without leaving the board.
 */
export default function PerformancePills({
  templateId,
}: {
  templateId: number | null;
}) {
  const { authHeaders, token } = useAuth();
  const [kpis, setKpis] = useState<AnalyticsKpis | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (templateId) params.set("templateId", String(templateId));
      const res = await fetch(
        apiUrl(`/process-analytics/kpis${params.toString() ? `?${params}` : ""}`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!res.ok) return;
      const body = await res.json();
      setKpis(body);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, templateId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!kpis) return null;

  const pill = (label: string, value: string, tone?: string) => (
    <span
      style={{
        padding: "0.25rem 0.6rem",
        borderRadius: 999,
        background: tone || "rgba(27, 40, 86, 0.05)",
        color: tone ? "#fff" : "#1B2856",
        fontSize: "0.78rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label}: <strong style={{ marginLeft: "0.25rem" }}>{value}</strong>
    </span>
  );

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.4rem",
        alignItems: "center",
        padding: "0.5rem 0.65rem",
        marginBottom: "0.75rem",
        background: "rgba(0, 152, 208, 0.04)",
        border: "1px solid rgba(0, 152, 208, 0.2)",
        borderRadius: 8,
      }}
    >
      <span
        style={{
          fontSize: "0.66rem",
          color: "#6a737b",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginRight: "0.25rem",
        }}
      >
        Performance
      </span>
      {pill("Active", String(kpis.activeProcesses))}
      {kpis.overdueProcesses > 0
        ? pill("Overdue", String(kpis.overdueProcesses), "#B32317")
        : pill("Overdue", "0")}
      {pill("Completed (this mo.)", String(kpis.completedThisMonth))}
      {pill(
        "Avg",
        kpis.avgCompletionDays != null ? `${kpis.avgCompletionDays}d` : "—"
      )}
      {kpis.onTimeRate != null
        ? pill(
            "On time",
            `${kpis.onTimeRate}%`,
            kpis.onTimeRate >= 80
              ? "#10b981"
              : kpis.onTimeRate >= 60
              ? "#f59e0b"
              : "#B32317"
          )
        : null}
      <Link
        href="/operations/analytics"
        style={{
          marginLeft: "auto",
          fontSize: "0.78rem",
          color: "#0098D0",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Full analytics →
      </Link>
    </div>
  );
}
