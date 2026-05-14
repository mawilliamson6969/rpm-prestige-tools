"use client";

import dashStyles from "../../../dashboards/components/dashboards.module.css";
import type { BoardColumn, StatusOption } from "@/types/mb";

/**
 * Read-only render for a status cell on an aggregated parent. Looks
 * the same as the editable status chip but shows an "Auto" pill next
 * to it and is not clickable. Tooltip explains the calculation.
 */
export default function AggregatedStatusBadge({
  column,
  value,
}: {
  column: BoardColumn;
  value: string | null;
}) {
  const cfg = column.config as { options?: StatusOption[] } | undefined;
  const options = Array.isArray(cfg?.options) ? cfg!.options! : [];
  const opt = value ? options.find((o) => o.value === value) : null;
  return (
    <div style={{ padding: "0.5rem 0.75rem", display: "flex", alignItems: "center" }}>
      {opt ? (
        <span
          style={{
            display: "inline-block",
            padding: "0.2rem 0.55rem",
            borderRadius: 999,
            color: "#fff",
            background: opt.color || "#6a737b",
            fontWeight: 700,
            fontSize: "0.75rem",
          }}
        >
          {opt.label}
        </span>
      ) : (
        <span style={{ color: "#6a737b", fontStyle: "italic" }}>—</span>
      )}
      <span
        className={dashStyles.autoBadge}
        title="This status is auto-computed from this item's subitems. To edit manually, turn off status aggregation in Board → Edit → Aggregation."
      >
        Auto
      </span>
    </div>
  );
}
