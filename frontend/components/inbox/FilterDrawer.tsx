"use client";

// Collapsible secondary filters — category, team, status. Replaces the
// equivalent sections in the legacy MailboxSidebar; the primary navigation
// (mailbox, bucket presets, saved views) now lives in the shell sidebar.

import { useState } from "react";
import styles from "../../app/(protected)/inbox/inbox.module.css";
import shellStyles from "./shell/inbox-shell.module.css";
import type { UseTeamUsers } from "../../hooks/inbox/useTeamUsers";
import type { ThreadListFilters } from "../../hooks/inbox/useThreadList";
import { CAT_STYLE, CATEGORY_ORDER, TEAM_COLORS, initials } from "./inboxConstants";

type Props = {
  filters: ThreadListFilters;
  teamUsers: UseTeamUsers;
  setBucket: (b: string) => void;
  setCategory: (c: string | null) => void;
  setNarrowStatus: (s: string | null) => void;
  setTeamUserId: (id: number | null) => void;
};

export default function FilterDrawer({
  filters,
  teamUsers,
  setBucket,
  setCategory,
  setNarrowStatus,
  setTeamUserId,
}: Props) {
  const [open, setOpen] = useState(false);

  const activeCount =
    (filters.category ? 1 : 0) +
    (filters.teamUserId != null ? 1 : 0) +
    (filters.narrowStatus ? 1 : 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={shellStyles.sbSearch}
        style={{ width: "auto", marginLeft: "auto", padding: "0 10px", cursor: "pointer" }}
        aria-expanded={open}
      >
        <span style={{ fontSize: 12, fontWeight: 500 }}>Filters{activeCount ? ` (${activeCount})` : ""}</span>
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--panel-2)",
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div>
            <div className={styles.catLabel} style={{ padding: "0 0 4px" }}>
              Category
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {CATEGORY_ORDER.map((c) => {
                const st = CAT_STYLE[c] || CAT_STYLE.other;
                const active = filters.category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setBucket("open");
                      setCategory(active ? null : c);
                      setNarrowStatus(null);
                      setTeamUserId(null);
                    }}
                    style={{
                      background: st.bg,
                      color: st.color,
                      border: active ? `1px solid ${st.color}` : "1px solid transparent",
                      borderRadius: 999,
                      padding: "2px 9px",
                      fontSize: 11,
                      fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>

          {teamUsers.teamUsers.length ? (
            <div>
              <div className={styles.catLabel} style={{ padding: "0 0 4px" }}>
                Team
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {teamUsers.teamUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setBucket("open");
                      setTeamUserId(filters.teamUserId === u.id ? null : u.id);
                      setNarrowStatus(null);
                    }}
                    title={u.displayName}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      border:
                        filters.teamUserId === u.id
                          ? "2px solid var(--accent)"
                          : "1px solid var(--border-strong)",
                      background: TEAM_COLORS[u.username.toLowerCase()] || "var(--text-3)",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {initials(u.displayName, null)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <div className={styles.catLabel} style={{ padding: "0 0 4px" }}>
              Status
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(
                [
                  [null, "All active"],
                  ["open", "Open"],
                  ["waiting_on_tenant", "Waiting · tenant"],
                  ["waiting_on_owner", "Waiting · owner"],
                  ["waiting_on_vendor", "Waiting · vendor"],
                  ["snoozed", "Snoozed"],
                  ["closed", "Closed"],
                ] as const
              ).map(([val, label]) => {
                const active =
                  val == null
                    ? !filters.narrowStatus
                    : filters.narrowStatus === val;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      if (val == null) {
                        setNarrowStatus(null);
                        setBucket("open");
                      } else {
                        setNarrowStatus(val);
                      }
                    }}
                    style={{
                      padding: "3px 9px",
                      fontSize: 11,
                      fontWeight: active ? 600 : 500,
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: active ? "var(--selected)" : "var(--bg)",
                      color: active ? "var(--accent)" : "var(--text-2)",
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
