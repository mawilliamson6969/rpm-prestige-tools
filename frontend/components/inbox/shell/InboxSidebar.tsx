"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useAuth } from "../../../context/AuthContext";
import styles from "./inbox-shell.module.css";
import { useInboxShell, type InboxSection } from "./InboxShellContext";
import {
  AtIcon,
  BarIcon,
  BoltIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CogIcon,
  EditIcon,
  FolderIcon,
  InboxIcon,
  PaperIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  UserIcon,
} from "./SidebarIcons";
import type { SavedView } from "../../../hooks/inbox/useSavedViews";

function avatarInitials(displayName: string | undefined, username: string | undefined): string {
  const n = (displayName || username || "?").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase() || "?";
}

type SectionId = "personal" | "shared" | "views" | "tools";

export default function InboxSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "/inbox";
  const { user } = useAuth();
  const {
    mailboxes,
    stats,
    savedViews,
    section,
    setSection,
    sidebarCollapsed,
    setSidebarCollapsed,
    mobileDrawerOpen,
    setMobileDrawerOpen,
  } = useInboxShell();

  const collapsed = sidebarCollapsed;
  const s = stats.stats;

  // Active state — route-based for /inbox/* sub-routes, section-based
  // within /inbox.
  const onInboxRoot = pathname === "/inbox";
  const onAnalytics = pathname.startsWith("/inbox/analytics");
  const onRules = pathname.startsWith("/inbox/rules");
  const onSettings = pathname.startsWith("/inbox/settings");
  const onSearch = pathname.startsWith("/inbox/search");

  const isPersonalActive = (bucket: "open" | "assignedToMe" | "mentions" | "drafts") =>
    onInboxRoot && section.kind === "personal" && section.bucket === bucket;
  const isMailboxActive = (id: number) =>
    onInboxRoot && section.kind === "mailbox" && section.connectionId === id;
  const isViewActive = (viewId: number) =>
    onInboxRoot && section.kind === "view" && section.viewId === viewId;
  const isBuiltinActive = (key: "all-open" | "sla-at-risk" | "snoozed" | "starred") =>
    onInboxRoot && section.kind === "builtin" && section.key === key;

  const goSection = useCallback(
    (next: InboxSection) => {
      setSection(next);
      if (pathname !== "/inbox") {
        router.push("/inbox");
      }
      if (mobileDrawerOpen) setMobileDrawerOpen(false);
    },
    [pathname, router, setSection, mobileDrawerOpen, setMobileDrawerOpen]
  );

  const goRoute = useCallback(
    (href: string) => {
      router.push(href);
      if (mobileDrawerOpen) setMobileDrawerOpen(false);
    },
    [router, mobileDrawerOpen, setMobileDrawerOpen]
  );

  const onToggleCollapse = useCallback(() => {
    setSidebarCollapsed(!collapsed);
  }, [collapsed, setSidebarCollapsed]);

  // Per-user saved views: ones owned by current user or shared. Shared
  // built-ins from seed data already cover "Starred" so we hide that
  // particular row from the user-views list to avoid duplication with the
  // hard-coded built-in.
  const userViews = useMemo<SavedView[]>(() => {
    return (savedViews.views || []).filter((v) => {
      const isStarredBuiltin = v.is_shared && v.name.toLowerCase() === "starred";
      return !isStarredBuiltin;
    });
  }, [savedViews.views]);

  const personalRows = [
    {
      key: "open" as const,
      icon: <InboxIcon size={16} />,
      label: "Inbox",
      count: s?.totalOpen ?? null,
      onClick: () => goSection({ kind: "personal", bucket: "open" }),
      active: isPersonalActive("open"),
    },
    {
      key: "assignedToMe" as const,
      icon: <UserIcon size={16} />,
      label: "Assigned to me",
      count: s?.assignedToMe ?? null,
      onClick: () => goSection({ kind: "personal", bucket: "assignedToMe" }),
      active: isPersonalActive("assignedToMe"),
    },
    {
      key: "mentions" as const,
      icon: <AtIcon size={16} />,
      label: "Mentions",
      count: null,
      disabled: true,
      title: "Coming soon — mentions feed ships with Phase 4.",
      onClick: () => undefined,
      active: false,
    },
    {
      key: "drafts" as const,
      icon: <PaperIcon size={16} />,
      label: "Drafts",
      count: null,
      disabled: true,
      title: "Coming soon — drafts list ships with the compose redesign.",
      onClick: () => undefined,
      active: false,
    },
  ];

  const builtinRows = [
    {
      key: "all-open" as const,
      icon: <FolderIcon size={16} />,
      label: "All open",
      count: s?.totalOpen ?? null,
      onClick: () => goSection({ kind: "builtin", key: "all-open" }),
      active: isBuiltinActive("all-open"),
    },
    {
      key: "sla-at-risk" as const,
      icon: <ClockIcon size={16} />,
      label: "SLA at risk",
      count: null,
      dot: "#B32317",
      onClick: () => goSection({ kind: "builtin", key: "sla-at-risk" }),
      active: isBuiltinActive("sla-at-risk"),
    },
    {
      key: "snoozed" as const,
      icon: <ClockIcon size={16} />,
      label: "Snoozed",
      count: null,
      onClick: () => goSection({ kind: "builtin", key: "snoozed" }),
      active: isBuiltinActive("snoozed"),
    },
    {
      key: "starred" as const,
      icon: <StarIcon size={16} />,
      label: "Starred",
      count: s?.starred ?? null,
      onClick: () => goSection({ kind: "builtin", key: "starred" }),
      active: isBuiltinActive("starred"),
    },
  ];

  const renderItem = (opts: {
    sectionId: SectionId;
    label: string;
    icon: React.ReactNode;
    count?: number | null;
    dot?: string | null;
    active: boolean;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    showAccentBar?: boolean;
  }) => {
    const showCount = !collapsed && opts.count != null;
    const showDot = !collapsed && !!opts.dot;
    const showMeta = showCount || showDot;
    return (
      <button
        key={`${opts.sectionId}-${opts.label}`}
        type="button"
        className={styles.sbItem}
        data-active={opts.active ? "true" : "false"}
        data-disabled={opts.disabled ? "true" : "false"}
        onClick={opts.disabled ? undefined : opts.onClick}
        title={opts.title || (collapsed ? opts.label : undefined)}
        aria-current={opts.active ? "page" : undefined}
      >
        {opts.active && opts.showAccentBar !== false ? <span className={styles.sbBar} aria-hidden /> : null}
        <span className={styles.sbIconWrap}>{opts.icon}</span>
        {!collapsed ? <span className={styles.sbLabel}>{opts.label}</span> : null}
        {showMeta ? (
          <span className={styles.sbMeta}>
            {showDot ? <span className={styles.sbDot} style={{ background: opts.dot! }} aria-hidden /> : null}
            {showCount ? <span className={styles.sbCount}>{opts.count}</span> : null}
          </span>
        ) : null}
      </button>
    );
  };

  const sectionHd = (label: string, action?: { onClick: () => void; ariaLabel: string }) => {
    if (collapsed) {
      return <div className={styles.sbSep} aria-hidden />;
    }
    return (
      <div className={styles.sbSectionHd}>
        <span>{label}</span>
        {action ? (
          <button type="button" className={styles.sbAdd} onClick={action.onClick} aria-label={action.ariaLabel}>
            <PlusIcon size={12} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <aside
      className={styles.sidebar}
      data-collapsed={collapsed ? "true" : "false"}
      data-mobile-open={mobileDrawerOpen ? "true" : "false"}
      aria-label="Inbox navigation"
    >
      <div className={styles.sbTop}>
        <div className={styles.sbBrand}>
          <span className={styles.sbLogo} aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path
                d="M3 11l9-7 9 7v8.5a1.5 1.5 0 0 1-1.5 1.5h-3v-7h-9v7h-3A1.5 1.5 0 0 1 3 19.5z"
                fill="var(--accent)"
              />
            </svg>
          </span>
          {!collapsed ? (
            <div className={styles.sbBrandText}>
              <div className={styles.sbBrandName}>RPM Prestige</div>
              <div className={styles.sbBrandSub}>Operations workspace</div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={styles.sbCompose}
          data-collapsed={collapsed ? "true" : "false"}
          onClick={() => {
            // D0 wires the button to whatever the current new-message flow
            // does. The Phase 1 inbox does not yet have stand-alone
            // compose, so for now we focus the reply composer if a thread
            // is selected, otherwise drop the user on the inbox root.
            if (pathname !== "/inbox") router.push("/inbox");
            if (mobileDrawerOpen) setMobileDrawerOpen(false);
          }}
          title={collapsed ? "Compose" : undefined}
        >
          {collapsed ? (
            <EditIcon size={16} />
          ) : (
            <>
              <span className={styles.sbComposeLabel}>
                <EditIcon size={14} />
                Compose
              </span>
              <span className={styles.sbKbd}>C</span>
            </>
          )}
        </button>

        {!collapsed ? (
          <button type="button" className={styles.sbSearch} onClick={() => goRoute("/inbox/search")}>
            <SearchIcon size={14} />
            <span className={styles.sbSearchLabel}>Search everything</span>
            <span className={styles.sbKbdGhost}>⌘K</span>
          </button>
        ) : (
          <button
            type="button"
            className={styles.sbIconOnly}
            onClick={() => goRoute("/inbox/search")}
            title="Search"
            aria-label="Search"
          >
            <SearchIcon size={16} />
          </button>
        )}
      </div>

      <div className={styles.sbScroll}>
        {sectionHd("Personal")}
        {personalRows.map((row) =>
          renderItem({
            sectionId: "personal",
            label: row.label,
            icon: row.icon,
            count: row.count,
            active: row.active,
            onClick: row.onClick,
            disabled: row.disabled,
            title: row.title,
          })
        )}

        {sectionHd("Shared inboxes")}
        {mailboxes.mailboxes.length === 0 && !collapsed ? (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-4)",
              padding: "4px 10px",
              fontStyle: "italic",
            }}
          >
            {mailboxes.loading ? "Loading…" : "No shared mailboxes yet."}
          </div>
        ) : null}
        {mailboxes.mailboxes.map((m) =>
          renderItem({
            sectionId: "shared",
            label: (m.display_name || m.mailbox_email || m.email_address || "Mailbox").trim(),
            icon: <InboxIcon size={16} />,
            count: m.unread_count,
            dot: m.unread_count && m.unread_count > 0 ? "#6A737B" : null,
            active: isMailboxActive(m.id),
            onClick: () => goSection({ kind: "mailbox", connectionId: m.id }),
          })
        )}

        {sectionHd("Views", {
          onClick: () => {
            // Forward to the existing Save View modal in InboxClient via a
            // global event. D0 keeps the modal where it already lives.
            if (pathname !== "/inbox") router.push("/inbox");
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("inbox:open-save-view"));
            }
            if (mobileDrawerOpen) setMobileDrawerOpen(false);
          },
          ariaLabel: "Save current filters as a view",
        })}
        {builtinRows.map((row) =>
          renderItem({
            sectionId: "views",
            label: row.label,
            icon: row.icon,
            count: row.count,
            dot: row.dot ?? null,
            active: row.active,
            onClick: row.onClick,
          })
        )}
        {userViews.map((v) =>
          renderItem({
            sectionId: "views",
            label: v.name,
            icon: <FolderIcon size={16} />,
            count: v.open_count ?? null,
            active: isViewActive(v.id),
            onClick: () => goSection({ kind: "view", viewId: v.id }),
          })
        )}

        {sectionHd("Tools")}
        {renderItem({
          sectionId: "tools",
          label: "Analytics",
          icon: <BarIcon size={16} />,
          active: onAnalytics,
          onClick: () => goRoute("/inbox/analytics"),
        })}
        {renderItem({
          sectionId: "tools",
          label: "Rules",
          icon: <BoltIcon size={16} />,
          active: onRules,
          onClick: () => goRoute("/inbox/rules"),
        })}
        {renderItem({
          sectionId: "tools",
          label: "Settings",
          icon: <CogIcon size={16} />,
          active: onSettings,
          onClick: () => goRoute("/inbox/settings"),
        })}
        {onSearch
          ? renderItem({
              sectionId: "tools",
              label: "Search",
              icon: <SearchIcon size={16} />,
              active: onSearch,
              onClick: () => goRoute("/inbox/search"),
            })
          : null}
      </div>

      <div className={styles.sbBottom}>
        {!collapsed ? (
          <button type="button" className={styles.sbUser} aria-label="Account">
            <span className={styles.sbAvatar} aria-hidden>
              {avatarInitials(user?.displayName, user?.username)}
            </span>
            <span className={styles.sbUserText}>
              <span className={styles.sbUserName}>
                {user?.displayName?.trim() || user?.username || "Account"}
              </span>
              <span className={styles.sbUserStatus}>
                <span className={styles.sbStatusDot} aria-hidden /> Available
              </span>
            </span>
          </button>
        ) : (
          <span className={styles.sbAvatar} aria-hidden style={{ margin: "0 auto" }}>
            {avatarInitials(user?.displayName, user?.username)}
          </span>
        )}
        <button
          type="button"
          className={styles.sbCollapseBtn}
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRightIcon size={12} /> : <ChevronLeftIcon size={12} />}
        </button>
      </div>
    </aside>
  );
}
