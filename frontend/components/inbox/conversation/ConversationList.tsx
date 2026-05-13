"use client";

// Conversation list — D0-aligned design.
//
// Source: design/shared-inbox-ux-and-ui/project/inbox.jsx lines 166–340.
// Renders a 380px-wide list with a header (title + count + filter/sort/⋯),
// a segmented filter row (Open / Snoozed / Closed / All), an optional bulk
// bar, and the rows themselves with avatars + channel badges, sender,
// mention badge, subject, preview, and a tags row with SLA chip + tag pills
// + attachment indicator + assignee avatar.

import { useEffect, useMemo, useState } from "react";
import styles from "./conversation.module.css";
import type { ListSort, ThreadRow } from "../../../hooks/inbox/types";
import type { UseThreadList } from "../../../hooks/inbox/useThreadList";
import { mailboxColor } from "../inboxConstants";
import {
  ChannelBadge,
  MentionBadge,
  TagPill,
  avatarColor,
  avatarInitials,
  deriveSlaChip,
  extractSnoozeUntil,
  formatRelativeTime,
} from "./chips";
import RetryState from "../RetryState";

export type Density = "compact" | "cozy" | "comfortable";

const STATUS_TABS = [
  { key: "open", label: "Open" },
  { key: "snoozed", label: "Snoozed" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

type Props = {
  /** The mailbox name displayed in the header. Falls back to "Inbox". */
  title: string;
  list: UseThreadList;
  /** Currently active status tab. */
  status: "open" | "snoozed" | "closed" | "all";
  /** Update the status tab. The list-hook treats "all" as bucket=all. */
  onStatusChange: (next: "open" | "snoozed" | "closed" | "all") => void;
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onToggleStar: (e: React.MouseEvent, t: ThreadRow) => void;
  density: Density;
  onDensityChange: (next: Density) => void;
  /** Phase 7: bulk-action state + handlers. Optional so the list still
   *  renders when bulk mode isn't wired by the parent. */
  bulk?: import("../../../hooks/inbox/useBulkActions").UseBulkActions | null;
  /** Phase 7: parent renders the action popovers (Assign / Tag / Snooze
   *  / ...) outside the list. We just call back when a button is hit. */
  onBulkActionClick?: (action: BulkActionKey) => void;
};

export type BulkActionKey =
  | "assign"
  | "status"
  | "tag"
  | "snooze"
  | "close"
  | "reopen"
  | "mark_read"
  | "mark_unread"
  | "more";

const SORT_LABELS: Record<ListSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  priority: "Highest priority",
  updated: "Recently updated",
};

export default function ConversationList({
  title,
  list,
  status,
  onStatusChange,
  selectedThreadId,
  onSelect,
  onToggleStar,
  density,
  onDensityChange,
  bulk = null,
  onBulkActionClick,
}: Props) {
  const [searchOpen, setSearchOpen] = useState<boolean>(!!list.filters.search);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  // Close the sort menu on outside click.
  useEffect(() => {
    if (!sortMenuOpen) return;
    const onDocClick = () => setSortMenuOpen(false);
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [sortMenuOpen]);

  const densityClass = useMemo(() => {
    if (density === "compact") return styles.clDensityCompact;
    if (density === "comfortable") return styles.clDensityComfortable;
    return styles.clDensityCozy;
  }, [density]);

  const { threads, total, offset, loading, error, loadMore, refetch } = list;
  const empty = threads.length === 0;

  return (
    <section className={styles.convoList}>
      <header className={styles.clHeader}>
        <div className={styles.clTitleRow}>
          <h2 className={styles.clTitle}>
            {title}
            <span className={styles.clCount}>{Number.isFinite(total) ? total : threads.length}</span>
          </h2>
          <div className={styles.clActions}>
            <button
              type="button"
              className={styles.clIconBtn}
              title={searchOpen ? "Hide search" : "Search"}
              aria-label={searchOpen ? "Hide search" : "Search"}
              onClick={() => setSearchOpen((s) => !s)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className={styles.clIconBtn}
                title="Sort"
                aria-label="Sort"
                aria-expanded={sortMenuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setSortMenuOpen((s) => !s);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M6 7h12M8 12h8M10 17h4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              {sortMenuOpen ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: 32,
                    right: 0,
                    minWidth: 180,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                    padding: 4,
                    zIndex: 10,
                  }}
                >
                  {(Object.keys(SORT_LABELS) as ListSort[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        list.setSort(s);
                        setSortMenuOpen(false);
                      }}
                      style={{
                        display: "flex",
                        width: "100%",
                        padding: "6px 8px",
                        background: list.filters.sort === s ? "var(--selected)" : "transparent",
                        color: list.filters.sort === s ? "var(--accent)" : "var(--text-2)",
                        border: "none",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {SORT_LABELS[s]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={styles.clIconBtn}
              title="Density"
              aria-label="Density"
              onClick={() => {
                const order: Density[] = ["compact", "cozy", "comfortable"];
                const idx = order.indexOf(density);
                onDensityChange(order[(idx + 1) % order.length]);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className={styles.clFilterRow}>
          <div className={styles.clSeg} role="tablist" aria-label="Status filter">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={status === tab.key}
                data-active={status === tab.key ? "true" : "false"}
                className={styles.clSegBtn}
                onClick={() => onStatusChange(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {bulk ? (
            <button
              type="button"
              className={styles.clLink}
              onClick={() => bulk.setBulkMode(!bulk.bulkMode)}
              title={bulk.bulkMode ? "Exit selection mode" : "Enter selection mode"}
              aria-pressed={bulk.bulkMode}
            >
              {bulk.bulkMode ? "✕ Cancel" : "✓ Select"}
            </button>
          ) : null}
        </div>
        {searchOpen ? (
          <div className={styles.clSearchRow}>
            <input
              type="search"
              className={styles.clSearch}
              placeholder="Search this list…"
              value={list.filters.search}
              onChange={(e) => list.setSearch(e.target.value)}
              aria-label="Search conversations"
            />
          </div>
        ) : null}
      </header>

      {bulk && bulk.bulkMode && bulk.selectedCount > 0 ? (
        <div className={styles.clBulkbar}>
          <span>{bulk.selectedCount} selected</span>
          <BulkActionButton label="Assign" onClick={() => onBulkActionClick?.("assign")} disabled={bulk.busy} />
          <BulkActionButton label="Status" onClick={() => onBulkActionClick?.("status")} disabled={bulk.busy} />
          <BulkActionButton label="Tag" onClick={() => onBulkActionClick?.("tag")} disabled={bulk.busy} />
          <BulkActionButton label="Snooze" onClick={() => onBulkActionClick?.("snooze")} disabled={bulk.busy} />
          <BulkActionButton label="Close" onClick={() => onBulkActionClick?.("close")} disabled={bulk.busy} />
          <BulkActionButton
            label="⋯"
            onClick={() => onBulkActionClick?.("more")}
            disabled={bulk.busy}
            title="More actions"
          />
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className={styles.clLink}
            onClick={() => bulk.clear()}
            disabled={bulk.busy}
            title="Clear selection"
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className={`${styles.clScroll} ${densityClass}`}>
        {loading && empty ? (
          <div className={styles.clEmpty}>
            <div className={styles.clEmptySub}>Loading…</div>
          </div>
        ) : null}

        {!loading && empty && error ? (
          <RetryState
            message={`Couldn't load threads. ${error}`}
            onRetry={() => void refetch()}
            retrying={loading}
          />
        ) : null}

        {!loading && empty && !error ? (
          <div className={styles.clEmpty}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="m6 12 4 4 8-8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className={styles.clEmptyTitle}>All caught up</div>
            <div className={styles.clEmptySub}>
              No {status === "all" ? "" : `${status} `}conversations in this view.
            </div>
          </div>
        ) : null}

        {threads.map((t) => (
          <ThreadRowCard
            key={t.thread_id}
            thread={t}
            selected={t.thread_id === selectedThreadId}
            onSelect={() => {
              if (bulk?.bulkMode) {
                bulk.toggleSelected(t.thread_id);
                return;
              }
              onSelect(t.thread_id);
            }}
            onToggleStar={(e) => onToggleStar(e, t)}
            density={density}
            bulkMode={!!bulk?.bulkMode}
            bulkChecked={bulk?.isSelected(t.thread_id) ?? false}
          />
        ))}

        {offset < total && threads.length ? (
          <div className={styles.clLoadMore}>
            <button type="button" onClick={() => void loadMore()} disabled={loading}>
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ThreadRowCard({
  thread: t,
  selected,
  onSelect,
  onToggleStar,
  density,
  bulkMode,
  bulkChecked,
}: {
  thread: ThreadRow;
  selected: boolean;
  onSelect: () => void;
  onToggleStar: (e: React.MouseEvent) => void;
  density: Density;
  bulkMode: boolean;
  bulkChecked: boolean;
}) {
  const unread = (t.unread_count ?? 0) > 0;
  const fromName =
    t.latest_message?.sender_name?.trim() ||
    t.latest_message?.sender_email?.trim() ||
    "(unknown)";
  const fromInitials = avatarInitials(t.latest_message?.sender_name, t.latest_message?.sender_email);
  const fromColor = avatarColor(t.latest_message?.sender_email || t.latest_message?.sender_name || t.thread_id);
  const sla = deriveSlaChip(t);
  const snoozedUntil = extractSnoozeUntil(t.tags);
  const tags = Array.isArray(t.tags) ? t.tags.filter((x) => !x.startsWith("snooze:until:")) : [];
  const preview = t.latest_message?.body_preview || "";
  const showPreview = density !== "compact";
  const previewLines = density === "comfortable" ? 2 : 1;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={styles.clRow}
      data-selected={selected ? "true" : "false"}
      data-unread={unread ? "true" : "false"}
    >
      {selected && !bulkMode ? <span className={styles.clSelBar} aria-hidden /> : null}
      <div className={styles.clRowL}>
        {bulkMode ? (
          <button
            type="button"
            className={styles.clCheck}
            data-on={bulkChecked ? "true" : "false"}
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            aria-pressed={bulkChecked}
            aria-label={bulkChecked ? "Deselect conversation" : "Select conversation"}
          >
            {bulkChecked ? "✓" : ""}
          </button>
        ) : (
          <div className={styles.clAvatarWrap}>
            <span className={styles.clAvatar} style={{ background: fromColor }}>
              {fromInitials}
            </span>
            <span className={styles.clChannel} aria-hidden>
              <ChannelBadge channel={t.channel} />
            </span>
          </div>
        )}
      </div>

      <div className={styles.clRowM}>
        <div className={styles.clRowTop}>
          <span className={styles.clFrom}>{fromName}</span>
          {/* Mention badge: D0 surfaces when the current user appears in
              mentions_users. The orchestrator passes that decision via the
              row already filtered server-side — for now we only render
              when the array is populated as an indicator. */}
          {Array.isArray(t.mentions_users) && t.mentions_users.length > 0 ? (
            <MentionBadge className={styles.clMention} />
          ) : null}
          {(t.participant_count ?? 1) > 1 ? (
            <span className={styles.clParts}>· {t.participant_count} people</span>
          ) : null}
          <span style={{ flex: 1 }} />
          {t.starred ? (
            <button
              type="button"
              className={styles.clStar}
              data-on="true"
              onClick={onToggleStar}
              aria-label="Unstar"
              title="Unstar"
            >
              ★
            </button>
          ) : (
            <button
              type="button"
              className={styles.clStar}
              onClick={onToggleStar}
              aria-label="Star"
              title="Star"
            >
              ☆
            </button>
          )}
          <span className={styles.clTime}>{formatRelativeTime(t.last_message_at)}</span>
        </div>
        <div className={styles.clRowMid}>
          <span className={styles.clSubject}>
            {t.subject || "(No subject)"}
            {t.message_count > 1 ? (
              <span
                style={{
                  marginLeft: 6,
                  color: "var(--text-4)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                · {t.message_count}
              </span>
            ) : null}
          </span>
        </div>
        {showPreview && preview ? (
          <div className={styles.clPreview} style={{ WebkitLineClamp: previewLines }}>
            {preview}
          </div>
        ) : null}
        {(tags.length > 0 || sla || snoozedUntil || t.has_attachments || t.assignee_name) ? (
          <div className={styles.clRowTags}>
            {sla ? (
              <span className={styles.clSla} style={{ color: sla.color, background: sla.bg }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {sla.label}
              </span>
            ) : null}
            {snoozedUntil ? (
              <span
                className={styles.clSla}
                style={{ color: "#7A5AE0", background: "rgba(122,90,224,0.08)" }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                Snoozed · {formatRelativeTime(snoozedUntil)}
              </span>
            ) : null}
            {tags.map((tag) => (
              <TagPill key={tag} tag={tag} />
            ))}
            {t.has_attachments ? (
              <span
                className={styles.clAttach}
                title={
                  (t.attachment_count ?? 0) > 1
                    ? `${t.attachment_count} attachments`
                    : "1 attachment"
                }
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M16 9v8a4 4 0 0 1-8 0V7a3 3 0 0 1 6 0v9a2 2 0 0 1-4 0V8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {(t.attachment_count ?? 0) > 1 ? <span>{t.attachment_count}</span> : null}
              </span>
            ) : null}
            {t.connection_id != null && (t.mailbox_display_name || t.mailbox_email) ? (
              <span
                className={styles.clAttach}
                title={t.mailbox_display_name || t.mailbox_email || ""}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: mailboxColor(t.connection_id),
                    display: "inline-block",
                  }}
                />
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            {t.assignee_name ? (
              <span
                title={`Assigned to ${t.assignee_name}`}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: avatarColor(t.assignee_username || t.assignee_name),
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {avatarInitials(t.assignee_name)}
              </span>
            ) : (
              <span className={styles.clUnassigned}>Unassigned</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}


function BulkActionButton({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={styles.clBulkbtn}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {label}
    </button>
  );
}
