"use client";

import styles from "../../app/(protected)/inbox/inbox.module.css";
import type { TicketRow } from "../../hooks/inbox/types";
import type { UseThreadList } from "../../hooks/inbox/useThreadList";
import {
  CAT_STYLE,
  initials,
  mailboxColor,
  mailboxShortLabel,
  priorityBarColor,
  relativeTime,
} from "./inboxConstants";
import RetryState from "./RetryState";

type Props = {
  list: UseThreadList;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onToggleStar: (e: React.MouseEvent, ticket: TicketRow) => void;
};

export default function InboxList({ list, selectedId, onSelect, onToggleStar }: Props) {
  const { threads, total, offset, loading, error, loadMore, refetch } = list;
  const empty = threads.length === 0;

  return (
    <div className={styles.ticketList}>
      {loading && empty ? <div className={styles.emptyDetail}>Loading…</div> : null}

      {!loading && empty && error ? (
        <RetryState
          message={`Couldn't load threads. ${error}`}
          onRetry={() => void refetch()}
          retrying={loading}
        />
      ) : null}

      {threads.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`${styles.ticketRow} ${selectedId === t.id ? styles.active : ""}`}
          onClick={() => onSelect(t.id)}
        >
          <span className={styles.priBar} style={{ background: priorityBarColor(t.priority) }} />
          {!t.is_read ? <span className={styles.unreadDot} aria-hidden /> : <span style={{ width: 8 }} />}
          <div className={styles.ticketMain}>
            <div className={styles.ticketTop}>
              <p className={`${styles.sender} ${!t.is_read ? styles.unread : ""}`}>
                {t.sender_name || t.sender_email}
              </p>
              <span className={styles.ticketTopRight}>
                {t.has_ai_draft_ready ? (
                  <span className={styles.draftReadyMark} title="Draft ready">
                    ✨
                  </span>
                ) : null}
                <span className={styles.time}>{relativeTime(t.received_at)}</span>
              </span>
            </div>
            <p className={styles.subject}>{t.subject || "(No subject)"}</p>
            <p className={styles.preview}>{t.body_preview || ""}</p>
            {t.connection_id != null && mailboxShortLabel(t) ? (
              <div className={styles.ticketMailboxTag}>
                <span className={styles.mailboxDot} style={{ background: mailboxColor(t.connection_id) }} />
                <span>📧 {mailboxShortLabel(t)}</span>
              </div>
            ) : null}
            <div className={styles.ticketMeta}>
              <span
                className={styles.catBadge}
                style={{
                  background: (CAT_STYLE[t.category] || CAT_STYLE.other).bg,
                  color: (CAT_STYLE[t.category] || CAT_STYLE.other).color,
                }}
              >
                {t.category}
              </span>
              <span
                className={styles.assignAv}
                style={{ background: t.assignee_name ? "#1b2856" : "#9e9e9e" }}
                title={t.assignee_name || "Unassigned"}
              >
                {t.assignee_name ? initials(t.assignee_name, null) : "?"}
              </span>
              <button
                type="button"
                className={styles.starBtn}
                aria-label={t.is_starred ? "Unstar" : "Star"}
                onClick={(e) => onToggleStar(e, t)}
              >
                {t.is_starred ? "★" : "☆"}
              </button>
            </div>
          </div>
        </button>
      ))}

      {!loading && empty && !error ? (
        <div className={styles.emptyDetail}>No tickets match.</div>
      ) : null}

      {offset < total ? (
        <div className={styles.loadMore}>
          <button type="button" onClick={() => void loadMore()} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
