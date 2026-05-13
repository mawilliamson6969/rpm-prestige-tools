"use client";

import styles from "../renewals.module.css";
import type { CountdownBucket } from "./types";

export default function GroupHeader({
  bucket,
  count,
  collapsed,
  onToggle,
}: {
  bucket: CountdownBucket;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={styles.groupHeader}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className={`${styles.groupCaret} ${!collapsed ? styles.groupCaretOpen : ""}`} />
      <span className={styles.groupColorDot} style={{ background: bucket.color }} />
      <span className={styles.groupLabel}>{bucket.label}</span>
      <span className={styles.groupDescription}>· {bucket.description}</span>
      <span className={styles.groupCount}>{count}</span>
    </div>
  );
}
