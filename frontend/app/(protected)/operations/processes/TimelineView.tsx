"use client";

import { useMemo } from "react";
import styles from "../operations.module.css";
import type { ProcessRecord } from "../types";

type Props = {
  processes: ProcessRecord[];
  onOpenBar: (id: number) => void;
};

const WEEK_MS = 7 * 86400000;

export default function TimelineView({ processes, onOpenBar }: Props) {
  const { minDate, maxDate, weeks } = useMemo(() => {
    if (!processes.length) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return {
        minDate: today,
        maxDate: new Date(today.getTime() + 8 * WEEK_MS),
        weeks: 8,
      };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const p of processes) {
      const start = new Date(p.startedAt).getTime();
      const end = p.targetCompletion ? new Date(p.targetCompletion).getTime() : start + 14 * 86400000;
      if (start < min) min = start;
      if (end > max) max = end;
    }
    const minDate = new Date(min);
    minDate.setHours(0, 0, 0, 0);
    const maxDate = new Date(max);
    maxDate.setHours(0, 0, 0, 0);
    // Pad
    const padded = new Date(maxDate.getTime() + 2 * WEEK_MS);
    const totalMs = padded.getTime() - minDate.getTime();
    const weeks = Math.max(4, Math.ceil(totalMs / WEEK_MS));
    return { minDate, maxDate: padded, weeks };
  }, [processes]);

  const totalMs = maxDate.getTime() - minDate.getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!processes.length) {
    return (
      <div className={styles.emptyState}>
        <h3>No processes to show</h3>
      </div>
    );
  }

  const weekHeaders = Array.from({ length: weeks }).map((_, i) => {
    const d = new Date(minDate.getTime() + i * WEEK_MS);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  return (
    <div className={styles.timelineView}>
      <div className={styles.timelineHeader}>
        <div className={styles.timelineHeaderLabel}>Process</div>
        <div className={styles.timelineHeaderScale}>
          {weekHeaders.map((w, i) => (
            <div key={i} className={styles.timelineWeekCol}>
              {w}
            </div>
          ))}
        </div>
      </div>
      {processes.map((p) => {
        const start = new Date(p.startedAt).getTime();
        const end = p.targetCompletion ? new Date(p.targetCompletion).getTime() : start + 14 * 86400000;
        const leftPct = Math.max(0, ((start - minDate.getTime()) / totalMs) * 100);
        const widthPct = Math.max(2, ((end - start) / totalMs) * 100);
        const total = p.totalSteps ?? 0;
        const done = p.completedSteps ?? 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const overdue = p.targetCompletion && new Date(p.targetCompletion) < today && p.status === "active";
        return (
          <div key={p.id} className={styles.timelineRow}>
            <div
              className={styles.timelineRowLabel}
              onClick={() => onOpenBar(p.id)}
              title={p.name}
            >
              {p.templateIcon ? `${p.templateIcon} ` : ""}
              {p.name}
            </div>
            <div className={styles.timelineBarTrack}>
              <div
                className={`${styles.timelineBar} ${overdue ? styles.timelineBarOverdue : ""}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  background: p.templateColor || "#0098D0",
                }}
                onClick={() => onOpenBar(p.id)}
              >
                <div className={styles.timelineProgress} style={{ width: `${pct}%` }} />
                <span style={{ position: "relative", zIndex: 1 }}>
                  {p.propertyName || p.name} · {pct}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
