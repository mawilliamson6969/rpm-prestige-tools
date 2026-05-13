"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ArrowUpRight,
  Search,
  Settings,
  Eye,
  EyeOff,
  Pin,
  PinOff,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChangePasswordModal from "./ChangePasswordModal";
import styles from "./sidebar.module.css";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import { useNarrowScreen } from "../hooks/useNarrowScreen";
import { useLayoutPrefs } from "../hooks/useLayoutPrefs";
import {
  ALL_NAV_ITEMS,
  NAV_GROUPS,
  NAV_ITEM_BY_ID,
  NAV_PINNED,
  navItemMatches,
  resolveActiveNavId,
  type NavGroup,
  type NavItem,
} from "../lib/nav-config";

const LS_COLLAPSED = "rpm-prestige-sidebar-collapsed";
const LS_GROUP_OPEN = "rpm-prestige-sidebar-groups-v2";
const MAX_USER_PINNED = 5;

type GroupOpenState = Record<string, boolean>;

function defaultGroupOpenState(): GroupOpenState {
  const o: GroupOpenState = {};
  for (const g of NAV_GROUPS) o[g.id] = !g.defaultClosed;
  return o;
}

function readGroupState(): GroupOpenState {
  if (typeof window === "undefined") return defaultGroupOpenState();
  try {
    const raw = localStorage.getItem(LS_GROUP_OPEN);
    if (!raw) return defaultGroupOpenState();
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out = defaultGroupOpenState();
    for (const k of Object.keys(out)) {
      if (typeof j[k] === "boolean") out[k] = j[k] as boolean;
    }
    return out;
  } catch {
    return defaultGroupOpenState();
  }
}

function userInitials(displayName: string, username: string) {
  const n = (displayName || username || "?").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase() || "?";
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner / Operator",
  admin: "Administrator",
  csm: "Client Success Manager",
  maintenance: "Maintenance Coordinator",
  operations: "Operations",
  staff: "Team Member",
};

type Props = {
  mobileDrawerOpen: boolean;
  onMobileDrawerOpenChange: (open: boolean) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

export default function Sidebar({
  mobileDrawerOpen,
  onMobileDrawerOpenChange,
  collapsed,
  onCollapsedChange,
}: Props) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, logout, isAdmin, token, authHeaders } = useAuth();
  const narrow = useNarrowScreen();
  const isMobile = narrow;
  const { prefs, update, saveNow, reset } = useLayoutPrefs();

  const [groupOpen, setGroupOpen] = useState<GroupOpenState>(defaultGroupOpenState);
  const [query, setQuery] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Live badges
  const [unread, setUnread] = useState<number | null>(null);
  const [queued, setQueued] = useState<number | null>(null);
  const [formsBadge, setFormsBadge] = useState<number | null>(null);

  const userWrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGroupOpen(readGroupState());
  }, []);

  const persistGroup = useCallback((next: GroupOpenState) => {
    setGroupOpen(next);
    try {
      localStorage.setItem(LS_GROUP_OPEN, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleGroup = useCallback(
    (id: string) => {
      persistGroup({ ...groupOpen, [id]: !groupOpen[id] });
    },
    [groupOpen, persistGroup]
  );

  /* ---------- Live badge fetching (preserved from previous Sidebar) ---------- */

  const loadBadges = useCallback(async () => {
    if (!token) return;
    try {
      const [rIn, rAg, rFm] = await Promise.all([
        fetch(apiUrl("/inbox/stats"), { cache: "no-store", headers: { ...authHeaders() } }),
        fetch(apiUrl("/agents/metrics/summary"), { cache: "no-store", headers: { ...authHeaders() } }),
        fetch(apiUrl("/forms/badge"), { cache: "no-store", headers: { ...authHeaders() } }),
      ]);
      const [jIn, jAg, jFm] = await Promise.all([
        rIn.json().catch(() => ({})),
        rAg.json().catch(() => ({})),
        rFm.json().catch(() => ({})),
      ]);
      if (rIn.ok && typeof jIn.unread === "number") setUnread(jIn.unread);
      if (rAg.ok && typeof jAg.queuedForReview === "number") setQueued(jAg.queuedForReview);
      if (rFm.ok) {
        const total = (jFm.unreviewedSubmissions || 0) + (jFm.pendingApprovals || 0);
        setFormsBadge(total);
      }
    } catch {
      setUnread(null);
      setQueued(null);
      setFormsBadge(null);
    }
  }, [token, authHeaders]);

  useEffect(() => {
    loadBadges();
    const t = setInterval(loadBadges, 60_000);
    return () => clearInterval(t);
  }, [loadBadges]);

  /* ---------- ⌘K shortcut ---------- */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (collapsed && !isMobile) onCollapsedChange(false);
        if (isMobile) onMobileDrawerOpenChange(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, isMobile, onCollapsedChange, onMobileDrawerOpenChange]);

  /* ---------- Click outside user menu ---------- */

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!userWrapRef.current?.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  /* ---------- Active item resolution ---------- */

  const tab = searchParams?.get("tab") ?? null;
  const activeId = useMemo(() => resolveActiveNavId(pathname, tab), [pathname, tab]);

  /* ---------- Pin / hide prefs ---------- */

  const validIds = useMemo(() => new Set(ALL_NAV_ITEMS.map((it) => it.id)), []);
  const userPinnedIds = useMemo(
    () => prefs.sidebarPinned.filter((id) => validIds.has(id)).slice(0, MAX_USER_PINNED),
    [prefs.sidebarPinned, validIds]
  );
  const hiddenIds = useMemo(
    () => new Set(prefs.sidebarHidden.filter((id) => validIds.has(id))),
    [prefs.sidebarHidden, validIds]
  );
  const userPinnedSet = useMemo(() => new Set(userPinnedIds), [userPinnedIds]);
  const defaultPinnedSet = useMemo(() => new Set(NAV_PINNED.map((it) => it.id)), []);

  const togglePin = useCallback(
    (id: string) => {
      update((p) => {
        const current = new Set(p.sidebarPinned);
        if (current.has(id)) {
          current.delete(id);
        } else {
          if (current.size >= MAX_USER_PINNED) return p;
          current.add(id);
        }
        return { ...p, sidebarPinned: Array.from(current) };
      }, 800);
    },
    [update]
  );

  const toggleHidden = useCallback(
    (id: string) => {
      update((p) => {
        const current = new Set(p.sidebarHidden);
        if (current.has(id)) current.delete(id);
        else current.add(id);
        return { ...p, sidebarHidden: Array.from(current) };
      }, 800);
    },
    [update]
  );

  const onResetPrefs = useCallback(async () => {
    if (!window.confirm("Reset sidebar pin/hide preferences to defaults?")) return;
    await reset();
  }, [reset]);

  /* ---------- Render-state helpers ---------- */

  const showLabels = isMobile || !collapsed;
  const narrowColumn = !isMobile && collapsed;

  const closeMobileIfNav = useCallback(() => {
    if (isMobile) onMobileDrawerOpenChange(false);
  }, [isMobile, onMobileDrawerOpenChange]);

  const toggleCollapse = useCallback(() => {
    if (isMobile) {
      onMobileDrawerOpenChange(false);
      return;
    }
    const next = !collapsed;
    onCollapsedChange(next);
    try {
      localStorage.setItem(LS_COLLAPSED, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed, isMobile, onCollapsedChange, onMobileDrawerOpenChange]);

  const onSignOut = () => {
    setUserMenuOpen(false);
    logout();
    router.replace("/login");
  };

  const badgeForItem = (item: NavItem): number | null => {
    if (!item.badge) return null;
    if (item.badge === "inbox-unread") return unread;
    if (item.badge === "agents-queue") return queued;
    if (item.badge === "forms-pending") return formsBadge;
    return null;
  };

  /* ---------- Filter + visibility ---------- */

  const q = query.trim().toLowerCase();
  const isFiltering = q.length > 0;

  const itemVisible = (item: NavItem): boolean => {
    if (item.adminOnly && !isAdmin) return false;
    if (hiddenIds.has(item.id) && !editMode) return false;
    if (isFiltering && !navItemMatches(item, query)) return false;
    return true;
  };

  /* ---------- Pinned section content ----------
     Default pinned (NAV_PINNED) plus any user-pinned items that aren't
     already pinned by default. Hidden + filter rules apply. */
  const pinnedRendered: NavItem[] = useMemo(() => {
    const out: NavItem[] = [];
    for (const it of NAV_PINNED) {
      if (itemVisible(it)) out.push(it);
    }
    for (const id of userPinnedIds) {
      if (defaultPinnedSet.has(id)) continue;
      const it = NAV_ITEM_BY_ID.get(id);
      if (it && itemVisible(it)) out.push(it);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFiltering, query, hiddenIds, userPinnedIds, isAdmin, editMode]);

  /* ---------- Render row ---------- */

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeId === item.id;
    const badgeVal = badgeForItem(item);
    const cn = `${styles.item} ${isActive ? styles.itemActive : ""}`;
    const tooltip = narrowColumn ? <span className={styles.tooltip}>{item.label}</span> : null;

    if (item.external) {
      return (
        <a
          key={item.id}
          href={item.external}
          target="_blank"
          rel="noopener noreferrer"
          className={cn}
          title={narrowColumn ? item.label : undefined}
          onClick={closeMobileIfNav}
        >
          <span
            className={styles.iconWrap}
            style={item.brandColor ? { color: item.brandColor } : undefined}
          >
            <Icon size={16} strokeWidth={2} />
          </span>
          {showLabels ? (
            <>
              <span className={styles.label}>{item.label}</span>
              <span className={styles.extArrow} aria-hidden>
                <ArrowUpRight size={12} strokeWidth={2.2} />
              </span>
            </>
          ) : null}
          {tooltip}
        </a>
      );
    }

    const href = item.href || "/";
    return (
      <Link
        key={item.id}
        href={href}
        className={cn}
        onClick={closeMobileIfNav}
        title={narrowColumn ? item.label : undefined}
      >
        <span className={styles.iconWrap}>
          <Icon size={16} strokeWidth={2} />
        </span>
        {showLabels ? <span className={styles.label}>{item.label}</span> : null}
        {showLabels && badgeVal !== null && badgeVal > 0 ? (
          <span className={styles.badge} aria-label={`${badgeVal}`}>
            {badgeVal > 99 ? "99+" : badgeVal}
          </span>
        ) : null}
        {tooltip}
      </Link>
    );
  };

  /* ---------- Render group (or fully filtered out) ---------- */

  const renderGroup = (group: NavGroup) => {
    const visible = group.items.filter(itemVisible);
    if (isFiltering && visible.length === 0) return null;
    const isOpen = isFiltering ? true : groupOpen[group.id] !== false;
    return (
      <div
        key={group.id}
        className={`${styles.group} ${isOpen ? "" : styles.groupClosed}`}
      >
        {showLabels ? (
          <button
            type="button"
            className={styles.groupHeader}
            onClick={() => !isFiltering && toggleGroup(group.id)}
            aria-expanded={isOpen}
          >
            <span className={styles.groupLabel}>{group.label}</span>
            <span className={styles.groupChevron} aria-hidden>
              <ChevronDown size={12} strokeWidth={2.2} />
            </span>
          </button>
        ) : null}
        <div className={styles.items}>{visible.map(renderItem)}</div>
      </div>
    );
  };

  /* ---------- Edit-mode row (pin / hide) ---------- */

  const renderEditableItem = (item: NavItem) => {
    const Icon = item.icon;
    const isPinned = userPinnedSet.has(item.id) || defaultPinnedSet.has(item.id);
    const isHidden = hiddenIds.has(item.id);
    const canPin = !defaultPinnedSet.has(item.id);
    return (
      <div
        key={item.id}
        className={`${styles.editRow} ${isHidden ? styles.editRowGhost : ""}`}
      >
        <span className={styles.iconWrap}>
          <Icon size={14} strokeWidth={2} />
        </span>
        <span className={styles.editLabel}>{item.label}</span>
        {canPin ? (
          <button
            type="button"
            className={`${styles.editBtn} ${isPinned ? styles.editBtnActive : ""}`}
            onClick={() => togglePin(item.id)}
            disabled={!isPinned && userPinnedIds.length >= MAX_USER_PINNED}
            title={isPinned ? "Unpin from top" : "Pin to top"}
            aria-label={isPinned ? "Unpin" : "Pin"}
          >
            {isPinned ? <PinOff size={13} strokeWidth={2} /> : <Pin size={13} strokeWidth={2} />}
          </button>
        ) : null}
        <button
          type="button"
          className={styles.editBtn}
          onClick={() => toggleHidden(item.id)}
          title={isHidden ? "Show in sidebar" : "Hide from sidebar"}
          aria-label={isHidden ? "Show" : "Hide"}
        >
          {isHidden ? <EyeOff size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
        </button>
      </div>
    );
  };

  /* ---------- Final render ---------- */

  return (
    <aside
      className={styles.shell}
      data-collapsed={collapsed && !isMobile ? "true" : "false"}
      data-mobile={isMobile ? "true" : "false"}
      data-drawer-open={isMobile && mobileDrawerOpen ? "true" : "false"}
      data-edit-mode={editMode ? "true" : "false"}
      aria-label="Main navigation"
    >
      <div className={styles.brand}>
        <Link
          href="/"
          className={styles.brandMark}
          onClick={closeMobileIfNav}
          title="RPM Prestige"
          aria-label="RPM Prestige Home"
        >
          <span>R</span>
        </Link>
        {showLabels ? (
          <Link href="/" className={styles.brandText} onClick={closeMobileIfNav}>
            <span className={styles.brandT1}>RPM Prestige</span>
            <span className={styles.brandT2}>Houston · CT</span>
          </Link>
        ) : null}
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={toggleCollapse}
          aria-label={isMobile ? "Close menu" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isMobile ? "Close menu" : collapsed ? "Expand" : "Collapse"}
        >
          {isMobile ? (
            <X size={14} strokeWidth={2.2} />
          ) : collapsed ? (
            <ChevronRight size={14} strokeWidth={2.2} />
          ) : (
            <ChevronLeft size={14} strokeWidth={2.2} />
          )}
        </button>
      </div>

      {showLabels && !editMode ? (
        <div className={styles.search}>
          <span className={styles.searchIcon} aria-hidden>
            <Search size={14} strokeWidth={2.2} />
          </span>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search Hub…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search navigation"
          />
          <span className={styles.kbd} aria-hidden>
            ⌘K
          </span>
        </div>
      ) : null}

      {editMode && showLabels ? (
        <div className={styles.editToolbar}>
          <span className={styles.editToolbarTitle}>Customize</span>
          <button type="button" className={styles.editToolbarBtn} onClick={onResetPrefs}>
            Reset
          </button>
          <button
            type="button"
            className={`${styles.editToolbarBtn} ${styles.editToolbarBtnPrimary}`}
            onClick={async () => {
              await saveNow(prefs);
              setEditMode(false);
            }}
          >
            Done
          </button>
        </div>
      ) : null}

      <nav className={styles.nav} aria-label="Primary">
        {editMode && showLabels ? (
          <>
            <div className={styles.editSectionLabel}>Pinned (default)</div>
            {NAV_PINNED.map(renderEditableItem)}
            {NAV_GROUPS.map((g) => {
              const visibleByRole = g.items.filter((it) => !it.adminOnly || isAdmin);
              if (visibleByRole.length === 0) return null;
              return (
                <div key={g.id}>
                  <div className={styles.editSectionLabel}>{g.label}</div>
                  {visibleByRole.map(renderEditableItem)}
                </div>
              );
            })}
          </>
        ) : (
          <>
            {pinnedRendered.length > 0 ? (
              <div className={styles.group}>
                <div className={styles.items}>{pinnedRendered.map(renderItem)}</div>
              </div>
            ) : null}
            {NAV_GROUPS.map(renderGroup)}
          </>
        )}
      </nav>

      <div className={styles.userFooter}>
        {!editMode && showLabels ? (
          <button type="button" className={styles.gear} onClick={() => setEditMode(true)}>
            <Settings size={13} strokeWidth={2} />
            <span className={styles.gearLabel}>Customize sidebar</span>
          </button>
        ) : null}

        <div ref={userWrapRef} style={{ position: "relative" }}>
          <button
            type="button"
            className={styles.user}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            onClick={() => setUserMenuOpen((o) => !o)}
            title={narrowColumn ? user?.displayName || user?.username || "Account" : undefined}
          >
            <span className={styles.avatar}>
              {userInitials(user?.displayName || "", user?.username || "")}
            </span>
            {showLabels ? (
              <span className={styles.userMeta}>
                <span className={styles.userName}>
                  {user?.displayName?.trim() || user?.username || "Account"}
                </span>
                <span className={styles.userRole}>
                  {ROLE_LABELS[user?.role || "staff"] ?? "Team Member"}
                </span>
              </span>
            ) : null}
          </button>

          {userMenuOpen ? (
            <div className={styles.userMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  setPwdOpen(true);
                }}
              >
                Change password
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuDanger}
                onClick={onSignOut}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </aside>
  );
}
