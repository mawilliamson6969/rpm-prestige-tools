"use client";

import Link from "next/link";
import styles from "../../app/(protected)/inbox/inbox.module.css";
import type { UseStats } from "../../hooks/inbox/useStats";
import NotificationCenter from "./NotificationCenter";

type Props = {
  stats: UseStats;
  isAdmin: boolean;
  syncBusy: boolean;
  onSync: () => void;
  batchBusy: boolean;
  batchProgress: string | null;
  batchSummary: string | null;
  batchEligibleCount: number;
  onDraftAllUnread: () => void;
};

export default function InboxTopBar({
  stats,
  isAdmin,
  syncBusy,
  onSync,
  batchBusy,
  batchProgress,
  batchSummary,
  batchEligibleCount,
  onDraftAllUnread,
}: Props) {
  const s = stats.stats;
  return (
    <header className={styles.topBar}>
      <div>
        <h1>Shared Inbox</h1>
        <div className={styles.topStats}>
          {s ? (
            <>
              <span>
                <strong>{s.totalOpen}</strong> open
              </span>
              <span>
                <strong>{s.unread}</strong> unread
              </span>
              <span>
                <strong>{s.assignedToMe}</strong> assigned to you
              </span>
            </>
          ) : (
            <span>Loading stats…</span>
          )}
          {batchProgress || batchSummary ? (
            <span className={styles.batchStatus}>{batchProgress || batchSummary}</span>
          ) : null}
        </div>
      </div>
      <div className={styles.topActions}>
        <NotificationCenter />
        {isAdmin ? (
          <button
            type="button"
            className={styles.iconBtn}
            title="Sync now"
            onClick={onSync}
            disabled={syncBusy}
          >
            ⟳
          </button>
        ) : null}
        {isAdmin ? (
          <button
            type="button"
            className={styles.batchDraftBtn}
            onClick={onDraftAllUnread}
            disabled={batchBusy || batchEligibleCount === 0}
          >
            ✨ Draft All Unread ({batchEligibleCount})
          </button>
        ) : null}
        <Link href="/inbox/settings" className={styles.mutedLink}>
          Settings
        </Link>
      </div>
    </header>
  );
}
