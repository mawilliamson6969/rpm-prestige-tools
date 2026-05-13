"use client";

import styles from "../../app/(protected)/inbox/inbox.module.css";
import type { ThreadRow } from "../../hooks/inbox/types";
import useSLA from "../../hooks/inbox/useSLA";
import type { UseThreadList } from "../../hooks/inbox/useThreadList";
import {
  CAT_STYLE,
  initials,
  mailboxColor,
  relativeTime,
} from "./inboxConstants";
import RetryState from "./RetryState";

// Phase 3 SLA dot tiers. The map covers every variant useSLA emits.
const SLA_DOT_COLOR: Record<string, string> = {
  ok: "#1a7f4c",       // green: ≥2h remaining or responded on time
  open: "#1a7f4c",
  late: "#c5960c",     // yellow: <2h remaining
  overdue: "#b32317",  // red: past sla_due_at
  paused: "#9e9e9e",   // gray: paused on a waiting status
};

function SlaDot({ thread }: { thread: ThreadRow }) {
  const view = useSLA(thread);
  if (!view) return null;
  return (
    <span
      title={`${view.label} — ${view.tooltip}`}
      aria-label={view.label}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 999,
        background: SLA_DOT_COLOR[view.variant] ?? "#9e9e9e",
        marginRight: "0.35rem",
        flexShrink: 0,
      }}
    />
  );
}

const PRIORITY_BAR: Record<string, string> = {
  emergency: "#b32317",
  high: "#e65100",
  normal: "#9e9e9e",
  low: "#cfd4dc",
};

function priorityBarColor(priority: string) {
  return PRIORITY_BAR[priority] ?? "#9e9e9e";
}

function senderLabelOf(t: ThreadRow): string {
  const m = t.latest_message;
  return (m?.sender_name?.trim() || m?.sender_email?.trim() || t.subject || "(no sender)").slice(0, 80);
}

type Props = {
  list: UseThreadList;
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onToggleStar: (e: React.MouseEvent, thread: ThreadRow) => void;
};

export default function InboxList({ list, selectedThreadId, onSelect, onToggleStar }: Props) {
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

      {threads.map((t) => {
        const unread = t.unread_count > 0;
        const senderLabel = senderLabelOf(t);
        return (
          <button
            key={t.thread_id}
            type="button"
            className={`${styles.ticketRow} ${selectedThreadId === t.thread_id ? styles.active : ""}`}
            onClick={() => onSelect(t.thread_id)}
          >
            <span className={styles.priBar} style={{ background: priorityBarColor(t.priority) }} />
            {unread ? <span className={styles.unreadDot} aria-hidden /> : <span style={{ width: 8 }} />}
            <div className={styles.ticketMain}>
              <div className={styles.ticketTop}>
                <p className={`${styles.sender} ${unread ? styles.unread : ""}`}>{senderLabel}</p>
                <span className={styles.ticketTopRight}>
                  <SlaDot thread={t} />
                  {t.has_ai_draft_ready ? (
                    <span className={styles.draftReadyMark} title="Draft ready">
                      ✨
                    </span>
                  ) : null}
                  {t.has_attachments ? (
                    <span title="Has attachments" aria-label="Has attachments">📎</span>
                  ) : null}
                  <span className={styles.time}>{relativeTime(t.last_message_at)}</span>
                </span>
              </div>
              <p className={styles.subject}>
                {t.subject || "(No subject)"}
                {t.message_count > 1 ? (
                  <span
                    aria-label={`${t.message_count} messages`}
                    style={{
                      marginLeft: "0.4rem",
                      color: "#6a737b",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                    }}
                  >
                    · {t.message_count}
                  </span>
                ) : null}
              </p>
              <p className={styles.preview}>{t.latest_message?.body_preview || ""}</p>
              {t.connection_id != null && (t.mailbox_display_name || t.mailbox_email) ? (
                <div className={styles.ticketMailboxTag}>
                  <span className={styles.mailboxDot} style={{ background: mailboxColor(t.connection_id) }} />
                  <span>📧 {(t.mailbox_display_name || t.mailbox_email || "").slice(0, 18)}</span>
                </div>
              ) : null}
              <div className={styles.ticketMeta}>
                {t.category ? (
                  <span
                    className={styles.catBadge}
                    style={{
                      background: (CAT_STYLE[t.category] || CAT_STYLE.other).bg,
                      color: (CAT_STYLE[t.category] || CAT_STYLE.other).color,
                    }}
                  >
                    {t.category}
                  </span>
                ) : null}
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
                  aria-label={t.starred ? "Unstar" : "Star"}
                  onClick={(e) => onToggleStar(e, t)}
                >
                  {t.starred ? "★" : "☆"}
                </button>
              </div>
            </div>
          </button>
        );
      })}

      {!loading && empty && !error ? (
        <div className={styles.emptyDetail}>No threads match.</div>
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
