"use client";

import Link from "next/link";
import styles from "../../app/(protected)/inbox/inbox.module.css";
import type { UseMailboxes } from "../../hooks/inbox/useMailboxes";
import type { UseStats } from "../../hooks/inbox/useStats";
import type { UseTeamUsers } from "../../hooks/inbox/useTeamUsers";
import type { ThreadListFilters } from "../../hooks/inbox/useThreadList";
import {
  CAT_STYLE,
  CATEGORY_ORDER,
  TEAM_COLORS,
  initials,
  mailboxColor,
} from "./inboxConstants";

type Props = {
  mailboxes: UseMailboxes;
  stats: UseStats;
  teamUsers: UseTeamUsers;
  filters: ThreadListFilters;
  applyPreset: (bucket: string) => void;
  setBucket: (b: string) => void;
  setCategory: (c: string | null) => void;
  setNarrowStatus: (s: string | null) => void;
  setTeamUserId: (id: number | null) => void;
  /** Mobile drawer toggle. */
  onItemClick?: () => void;
  /** Mobile-only menu button at the top of the sidebar. */
  onToggleMenu?: () => void;
};

export default function MailboxSidebar({
  mailboxes,
  stats,
  teamUsers,
  filters,
  applyPreset,
  setBucket,
  setCategory,
  setNarrowStatus,
  setTeamUserId,
  onItemClick,
  onToggleMenu,
}: Props) {
  const { stats: s } = stats;
  const allActiveHighlight =
    filters.narrowStatus === null &&
    filters.bucket !== "starred" &&
    ["open", "unread", "assignedToMe", "unassigned"].includes(filters.bucket);

  const close = () => onItemClick?.();
  const preset = (b: string) => {
    applyPreset(b);
    close();
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <button type="button" className={styles.menuBtn} onClick={onToggleMenu}>
          ☰ Menu
        </button>
      </div>

      <div className={styles.mailboxSectionLabel}>Mailboxes</div>
      <button
        type="button"
        className={`${styles.mailboxNavBtn} ${mailboxes.currentMailbox == null ? styles.active : ""}`}
        onClick={() => {
          mailboxes.switchTo(null);
          close();
        }}
      >
        <span className={styles.mailboxNavLabel}>All mailboxes</span>
        <span className={styles.badgeCount}>{s?.unread ?? "—"}</span>
      </button>
      {mailboxes.mailboxes.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`${styles.mailboxNavBtn} ${mailboxes.currentMailbox === m.id ? styles.active : ""}`}
          onClick={() => {
            mailboxes.switchTo(m.id);
            close();
          }}
        >
          <span className={styles.mailboxDot} style={{ background: mailboxColor(m.id) }} aria-hidden />
          <span className={styles.mailboxNavLabel}>
            {(m.display_name || m.mailbox_email || m.email_address || "Mailbox").trim()}
          </span>
          <span className={styles.badgeCount}>{m.unread_count ?? 0}</span>
        </button>
      ))}

      <div className={styles.divider} />

      <button
        type="button"
        className={`${styles.presetBtn} ${
          filters.bucket === "open" && !filters.teamUserId && !filters.category && !filters.narrowStatus
            ? styles.active
            : ""
        }`}
        onClick={() => preset("open")}
      >
        All Open
        <span className={styles.badgeCount}>{s?.totalOpen ?? "—"}</span>
      </button>
      <button
        type="button"
        className={`${styles.presetBtn} ${filters.bucket === "unread" ? styles.active : ""}`}
        onClick={() => preset("unread")}
      >
        Unread
        <span className={styles.badgeCount}>{s?.unread ?? "—"}</span>
      </button>
      <button
        type="button"
        className={`${styles.presetBtn} ${filters.bucket === "starred" ? styles.active : ""}`}
        onClick={() => preset("starred")}
      >
        Starred
        <span className={styles.badgeCount}>{s?.starred ?? "—"}</span>
      </button>
      <button
        type="button"
        className={`${styles.presetBtn} ${filters.bucket === "assignedToMe" ? styles.active : ""}`}
        onClick={() => preset("assignedToMe")}
      >
        Assigned to Me
        <span className={styles.badgeCount}>{s?.assignedToMe ?? "—"}</span>
      </button>
      <button
        type="button"
        className={`${styles.presetBtn} ${filters.bucket === "unassigned" ? styles.active : ""}`}
        onClick={() => preset("unassigned")}
      >
        Unassigned
        <span className={styles.badgeCount}>{s?.unassigned ?? "—"}</span>
      </button>

      <div className={styles.divider} />
      <div className={styles.catLabel}>Category</div>
      <div className={styles.pillGrid}>
        {CATEGORY_ORDER.map((c) => {
          const st = CAT_STYLE[c] || CAT_STYLE.other;
          return (
            <button
              key={c}
              type="button"
              className={`${styles.pill} ${filters.category === c ? styles.active : ""}`}
              style={{ background: st.bg, color: st.color }}
              onClick={() => {
                setBucket("open");
                setCategory(filters.category === c ? null : c);
                setNarrowStatus(null);
                setTeamUserId(null);
              }}
            >
              {c}
            </button>
          );
        })}
      </div>

      <div className={styles.divider} />
      <div className={styles.catLabel}>Team</div>
      <div className={styles.teamRow}>
        {teamUsers.teamUsers.map((u) => (
          <button
            key={u.id}
            type="button"
            className={`${styles.teamAvatar} ${filters.teamUserId === u.id ? styles.active : ""}`}
            style={{ background: TEAM_COLORS[u.username.toLowerCase()] || "#6a737b" }}
            title={u.displayName}
            onClick={() => {
              setBucket("open");
              setTeamUserId(filters.teamUserId === u.id ? null : u.id);
              setNarrowStatus(null);
            }}
          >
            {initials(u.displayName, null)}
          </button>
        ))}
      </div>

      <div className={styles.divider} />
      <div className={styles.catLabel}>Status</div>
      <div className={styles.statusRow}>
        {(
          [
            [null, "All active"],
            ["open", "Open"],
            ["waiting_on_tenant", "Waiting on tenant"],
            ["waiting_on_owner", "Waiting on owner"],
            ["waiting_on_vendor", "Waiting on vendor"],
            ["snoozed", "Snoozed"],
            ["closed", "Closed"],
          ] as const
        ).map(([val, label]) => (
          <button
            key={label}
            type="button"
            className={`${styles.statusBtn} ${
              val == null
                ? allActiveHighlight
                  ? styles.active
                  : ""
                : filters.narrowStatus === val
                  ? styles.active
                  : ""
            }`}
            onClick={() => {
              if (val == null) {
                setNarrowStatus(null);
                setBucket("open");
              } else {
                setNarrowStatus(val);
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.sidebarFooter}>
        <Link href="/inbox/settings" className={styles.mutedLink}>
          Inbox settings →
        </Link>
      </div>
    </aside>
  );
}
