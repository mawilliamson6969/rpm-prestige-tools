"use client";

import { useMemo, useState } from "react";
import styles from "../operations.module.css";
import type { ProcessRecord } from "../types";

type Props = {
  processes: ProcessRecord[];
  onOpenRow: (id: number) => void;
};

type SortKey =
  | "name"
  | "propertyName"
  | "templateName"
  | "currentStageName"
  | "status"
  | "targetCompletion"
  | "progress"
  | "startedAt";

export default function TableView({ processes, onOpenRow }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("targetCompletion");
  const [sortDesc, setSortDesc] = useState(false);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDesc((d) => !d);
    else {
      setSortKey(k);
      setSortDesc(false);
    }
  };

  const sorted = useMemo(() => {
    const arr = [...processes];
    arr.sort((a, b) => {
      const dir = sortDesc ? -1 : 1;
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (sortKey === "progress") {
        const ap = a.totalSteps ? (a.completedSteps ?? 0) / a.totalSteps : 0;
        const bp = b.totalSteps ? (b.completedSteps ?? 0) / b.totalSteps : 0;
        return dir * (ap - bp);
      }
      if (sortKey === "targetCompletion" || sortKey === "startedAt") {
        const at = av ? new Date(av as string).getTime() : Infinity;
        const bt = bv ? new Date(bv as string).getTime() : Infinity;
        return dir * (at - bt);
      }
      const as = String(av ?? "").toLowerCase();
      const bs = String(bv ?? "").toLowerCase();
      return dir * as.localeCompare(bs);
    });
    return arr;
  }, [processes, sortKey, sortDesc]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <table className={styles.procTable}>
      <thead>
        <tr>
          <th onClick={() => toggleSort("name")}>Process</th>
          <th onClick={() => toggleSort("propertyName")}>Property</th>
          <th onClick={() => toggleSort("templateName")}>Template</th>
          <th onClick={() => toggleSort("currentStageName")}>Current stage</th>
          <th onClick={() => toggleSort("status")}>Status</th>
          <th onClick={() => toggleSort("targetCompletion")}>Target</th>
          <th onClick={() => toggleSort("progress")}>Progress</th>
          <th onClick={() => toggleSort("startedAt")}>Started</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const total = p.totalSteps ?? 0;
          const done = p.completedSteps ?? 0;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const overdue =
            p.targetCompletion && new Date(p.targetCompletion) < today && p.status === "active";
          return (
            <tr key={p.id} onClick={() => onOpenRow(p.id)}>
              <td>
                <strong style={{ color: "#1b2856" }}>
                  {p.templateIcon ? `${p.templateIcon} ` : ""}
                  {p.name}
                </strong>
              </td>
              <td>{p.propertyName ?? "—"}</td>
              <td>
                <span className={styles.categoryTag}>{p.templateName ?? "—"}</span>
              </td>
              <td>{p.currentStepName ?? "—"}</td>
              <td>
                <span
                  className={`${styles.statusBadge} ${
                    p.status === "active"
                      ? styles.statusActive
                      : p.status === "completed"
                      ? styles.statusCompleted
                      : p.status === "paused"
                      ? styles.statusPaused
                      : styles.statusCanceled
                  }`}
                >
                  {p.status}
                </span>
              </td>
              <td style={overdue ? { color: "#b32317", fontWeight: 700 } : undefined}>
                {p.targetCompletion ? new Date(p.targetCompletion).toLocaleDateString() : "—"}
              </td>
              <td style={{ minWidth: 120 }}>
                <div className={styles.progressBarSlim}>
                  <div
                    className={styles.progressBarSlimFill}
                    style={{
                      width: `${pct}%`,
                      background: pct < 50 ? "#0098D0" : pct < 80 ? "#f59e0b" : "#10b981",
                    }}
                  />
                </div>
                <div style={{ fontSize: "0.7rem", color: "#6a737b", marginTop: "0.15rem" }}>
                  {done}/{total} ({pct}%)
                </div>
              </td>
              <td>{new Date(p.startedAt).toLocaleDateString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
