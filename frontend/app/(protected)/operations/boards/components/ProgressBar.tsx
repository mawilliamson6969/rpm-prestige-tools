"use client";

import dashStyles from "../../../dashboards/components/dashboards.module.css";
import type { BoardProgressEntry } from "@/types/mb";

/**
 * Phase 6: per-parent progress bar. Items with zero subitems render
 * "—" rather than 0% so the user can tell "no work to do" from "no work
 * done."
 */
export default function ProgressBar({ entry }: { entry: BoardProgressEntry | undefined }) {
  if (!entry || entry.pct == null) {
    return (
      <div style={{ padding: "0.5rem 0.75rem" }}>
        <span className={dashStyles.progressDash}>—</span>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, entry.pct));
  return (
    <div
      style={{ padding: "0.5rem 0.75rem" }}
      title={`${entry.done} of ${entry.total} subitems complete`}
    >
      <div className={dashStyles.progressBar}>
        <div className={dashStyles.progressTrack}>
          <div
            className={dashStyles.progressFill}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={dashStyles.progressLabel}>{pct}%</span>
      </div>
    </div>
  );
}
