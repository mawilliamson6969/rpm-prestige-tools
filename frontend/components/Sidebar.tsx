"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChangePasswordModal from "./ChangePasswordModal";
import styles from "./sidebar.module.css";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import { useNarrowScreen } from "../hooks/useNarrowScreen";
import { useLayoutPrefs } from "../hooks/useLayoutPrefs";
import { DEFAULT_SIDEBAR_ITEMS, type SidebarNavItem } from "../lib/layoutPrefs";

const LS_COLLAPSED = "rpm-prestige-sidebar-collapsed";
const LS_SUB = "rpm-prestige-sidebar-submenu";
const MAX_PINNED = 5;

type SubState = { dashboard: boolean; eos: boolean; operations: boolean };

function readSub(): SubState {
  if (typeof window === "undefined") return { dashboard: true, eos: false, operations: false };
  try {
    const raw = localStorage.getItem(LS_SUB);
    if (!raw) return { dashboard: true, eos: false, operations: false };
    const j = JSON.parse(raw) as Partial<SubState>;
    return {
      dashboard: typeof j.dashboard === "boolean" ? j.dashboard : true,
      eos: typeof j.eos === "boolean" ? j.eos : false,
      operations: typeof j.operations === "boolean" ? j.operations : false,
    };
  } catch {
    return { dashboard: true, eos: false, operations: false };
  }
}

function userInitials(displayName: string, username: string) {
  const n = (displayName || username || "?").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return n.slice(0, 2).toUpperCase() || "?";
}

const EXTERNAL = [
  { label: "AppFolio", href: "https://rpmtx033.appfolio.com" },
  { label: "LeadSimple", href: "https://app.leadsimple.com" },
  { label: "RentEngine", href: "https://app.rentengine.io/owner/default" },
  { label: "Blanket", href: "https://rpmprestige.blankethomes.com/pm" },
  { label: "Boom", href: "https://www.boompay.app/" },
  { label: "RPM Intranet", href: "https://rpmintranet.com/login" },
  { label: "Our Website", href: "https://www.prestigerpm.com/" },
  { label: "OpenPhone", href: "https://app.openphone.com" },
] as const;

type Props = {
  mobileDrawerOpen: boolean;
  onMobileDrawerOpenChange: (open: boolean) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

export default function Sidebar({ mobileDrawerOpen, onMobileDrawerOpenChange, collapsed, onCollapsedChange }: Props) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, logout, isAdmin, token, authHeaders } = useAuth();
  const narrow = useNarrowScreen();
  const isMobile = narrow;
  const { prefs, update, saveNow, reset } = useLayoutPrefs();

  const [subOpen, setSubOpen] = useState<SubState>({ dashboard: true, eos: false, operations: false });
  const [flyout, setFlyout] = useState<null | "dashboard" | "eos" | "operations">(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [unread, setUnread] = useState<number | null>(null);
  const [queued, setQueued] = useState<number | null>(null);
  const [formsBadge, setFormsBadge] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const userWrapRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setSubOpen(readSub());
  }, []);

  const persistSub = useCallback((next: SubState) => {
    setSubOpen(next);
    try {
      localStorage.setItem(LS_SUB, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

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

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!userWrapRef.current?.contains(e.target as Node)) setUserMenuOpen(false);
      if (flyout && shellRef.current && !shellRef.current.contains(e.target as Node)) {
        setFlyout(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [flyout]);

  const dashboardTab = searchParams?.get("tab") || "executive";

  const hubActive = pathname === "/";
  const dashboardActive = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const inboxActive = pathname === "/inbox" || pathname.startsWith("/inbox/");
  const agentsActive = pathname === "/agents" || pathname.startsWith("/agents/");
  const eosSectionActive = pathname.startsWith("/eos");
  const operationsSectionActive = pathname.startsWith("/operations");

  const showLabels = isMobile || !collapsed;
  const narrowColumn = !isMobile && collapsed;

  useEffect(() => {
    if (!narrowColumn) setFlyout(null);
  }, [narrowColumn]);

  const onSignOut = () => {
    setUserMenuOpen(false);
    logout();
    router.replace("/login");
  };

  const toggleCollapse = () => {
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
    setFlyout(null);
  };

  const toggleDashboardSub = () => {
    if (narrowColumn) {
      setFlyout((f) => (f === "dashboard" ? null : "dashboard"));
      return;
    }
    persistSub({ ...subOpen, dashboard: !subOpen.dashboard });
  };
  const toggleEosSub = () => {
    if (narrowColumn) {
      setFlyout((f) => (f === "eos" ? null : "eos"));
      return;
    }
    persistSub({ ...subOpen, eos: !subOpen.eos });
  };
  const toggleOperationsSub = () => {
    if (narrowColumn) {
      setFlyout((f) => (f === "operations" ? null : "operations"));
      return;
    }
    persistSub({ ...subOpen, operations: !subOpen.operations });
  };

  const closeMobileIfNav = () => {
    if (isMobile) onMobileDrawerOpenChange(false);
    setFlyout(null);
  };

  const dashSubLinks = useMemo(
    () =>
      [
        { tab: "executive", label: "Executive" },
        { tab: "maintenance", label: "Maintenance" },
        { tab: "finance", label: "Finance" },
        { tab: "portfolio", label: "Portfolio" },
        { tab: "leasing", label: "Leasing" },
      ] as const,
    []
  );

  const eosSubLinks = useMemo(
    () =>
      [
        { href: "/eos/scorecard", label: "Scorecard" },
        { href: "/eos/scorecards", label: "Individual Scorecards" },
        { href: "/eos/rocks", label: "Rocks" },
        { href: "/eos/l10", label: "L10 Meetings" },
      ] as const,
    []
  );

  const operationsSubLinks = useMemo(
    () =>
      isAdmin
        ? ([
            { href: "/operations/tasks", label: "Tasks" },
            { href: "/operations/projects", label: "Projects" },
            { href: "/operations/processes", label: "Processes" },
            { href: "/operations/templates", label: "Templates" },
          ] as const)
        : ([
            { href: "/operations/tasks", label: "Tasks" },
            { href: "/operations/projects", label: "Projects" },
            { href: "/operations/processes", label: "Processes" },
          ] as const),
    [isAdmin]
  );

  const showCollapsedTooltips = narrowColumn;

  /* ========== Edit-mode: reorder/pin/hide ========== */

  const itemById = useMemo(() => {
    const m = new Map<string, SidebarNavItem>();
    for (const i of DEFAULT_SIDEBAR_ITEMS) m.set(i.id, i);
    return m;
  }, []);

  const orderedIds = useMemo(() => {
    const base = prefs.sidebarOrder.length > 0 ? prefs.sidebarOrder : DEFAULT_SIDEBAR_ITEMS.map((i) => i.id);
    const seen = new Set(base);
    for (const i of DEFAULT_SIDEBAR_ITEMS) if (!seen.has(i.id)) base.push(i.id);
    return base.filter((id) => itemById.has(id));
  }, [prefs.sidebarOrder, itemById]);

  const pinnedIds = useMemo(
    () => prefs.sidebarPinned.filter((id) => itemById.has(id)).slice(0, MAX_PINNED),
    [prefs.sidebarPinned, itemById]
  );
  const hiddenIds = useMemo(
    () => new Set(prefs.sidebarHidden.filter((id) => itemById.has(id))),
    [prefs.sidebarHidden, itemById]
  );
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const togglePin = useCallback(
    (id: string) => {
      update((p) => {
        const current = new Set(p.sidebarPinned);
        if (current.has(id)) {
          current.delete(id);
        } else {
          if (current.size >= MAX_PINNED) return p;
          current.add(id);
        }
        return { ...p, sidebarPinned: Array.from(current) };
      }, 1000);
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
      }, 1000);
    },
    [update]
  );

  const reorderItem = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      update((p) => {
        const base =
          p.sidebarOrder.length > 0 ? [...p.sidebarOrder] : DEFAULT_SIDEBAR_ITEMS.map((i) => i.id);
        for (const i of DEFAULT_SIDEBAR_ITEMS) if (!base.includes(i.id)) base.push(i.id);
        const fromIdx = base.indexOf(fromId);
        const toIdx = base.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) return p;
        base.splice(fromIdx, 1);
        base.splice(toIdx, 0, fromId);
        return { ...p, sidebarOrder: base };
      }, 1000);
    },
    [update]
  );

  const onReset = useCallback(async () => {
    if (!window.confirm("Reset sidebar layout to defaults?")) return;
    await reset();
  }, [reset]);

  const onDoneEdit = async () => {
    await saveNow(prefs);
    setEditMode(false);
  };

  /* ========== Render primary rows ========== */

  const renderDropdownSub = (key: "dashboard" | "eos" | "operations") => {
    if (!showLabels) return null;
    if (key === "dashboard" && subOpen.dashboard) {
      return (
        <div className={styles.subWrap} style={{ maxHeight: 320 }}>
          <div className={styles.subList}>
            {dashSubLinks.map(({ tab, label }) => {
              const href = `/dashboard?tab=${tab}`;
              const active = dashboardActive && dashboardTab === tab;
              return (
                <Link
                  key={tab}
                  href={href}
                  className={`${styles.subLink} ${active ? styles.subLinkActive : ""}`}
                  onClick={closeMobileIfNav}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      );
    }
    if (key === "eos" && subOpen.eos) {
      return (
        <div className={styles.subWrap} style={{ maxHeight: 200 }}>
          <div className={styles.subList}>
            {eosSubLinks.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`${styles.subLink} ${active ? styles.subLinkActive : ""}`}
                  onClick={closeMobileIfNav}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      );
    }
    if (key === "operations" && subOpen.operations) {
      return (
        <div className={styles.subWrap} style={{ maxHeight: 200 }}>
          <div className={styles.subList}>
            {operationsSubLinks.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`${styles.subLink} ${active ? styles.subLinkActive : ""}`}
                  onClick={closeMobileIfNav}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  const renderNormalRow = (item: SidebarNavItem, opts: { isPinnedDisplay?: boolean } = {}) => {
    const pinMark = opts.isPinnedDisplay ? <span className={styles.pinStar}>★</span> : null;
    if (item.type === "dropdown") {
      const activeCheck =
        item.id === "dashboard" ? dashboardActive : item.id === "eos" ? eosSectionActive : operationsSectionActive;
      const toggle =
        item.id === "dashboard" ? toggleDashboardSub : item.id === "eos" ? toggleEosSub : toggleOperationsSub;
      const openState =
        item.id === "dashboard" ? subOpen.dashboard : item.id === "eos" ? subOpen.eos : subOpen.operations;
      return (
        <div key={`row-${item.id}`}>
          <button
            type="button"
            className={`${styles.row} ${activeCheck ? styles.rowActive : ""}`}
            onClick={toggle}
            title={showCollapsedTooltips ? item.label : undefined}
          >
            <span className={styles.icon} aria-hidden>
              {item.icon}
            </span>
            {showLabels ? (
              <>
                {pinMark}
                <span className={styles.label}>{item.label}</span>
                <span className={`${styles.chevron} ${openState ? styles.chevronOpen : ""}`} aria-hidden>
                  ▸
                </span>
              </>
            ) : null}
          </button>
          {renderDropdownSub(item.id as "dashboard" | "eos" | "operations")}
        </div>
      );
    }
    const href = item.href || "/";
    const active = pathname === href || pathname.startsWith(`${href}/`);
    const badge =
      item.id === "inbox" && unread != null && unread > 0
        ? unread
        : item.id === "agents" && queued != null && queued > 0
        ? queued
        : item.id === "forms" && formsBadge && formsBadge > 0
        ? formsBadge
        : null;
    return (
      <Link
        key={`row-${item.id}`}
        href={href}
        className={`${styles.row} ${active ? styles.rowActive : ""}`}
        onClick={closeMobileIfNav}
        title={showCollapsedTooltips ? item.label : undefined}
      >
        <span className={styles.icon} aria-hidden>
          {item.icon}
        </span>
        {showLabels ? (
          <>
            {pinMark}
            <span className={styles.label}>{item.label}</span>
          </>
        ) : null}
        {badge ? (
          <span className={`${styles.badge} ${styles.badgePulse}`} aria-label={`${badge}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </Link>
    );
  };

  /* ========== Edit mode rows ========== */

  const renderEditableRow = (item: SidebarNavItem) => {
    const pinned = pinnedSet.has(item.id);
    const hidden = hiddenIds.has(item.id);
    const dragging = dragId === item.id;
    return (
      <div
        key={`edit-${item.id}`}
        className={`${styles.editableRow} ${hidden ? styles.editableRowGhost : ""} ${
          dragging ? styles.editableRowDragging : ""
        }`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.id);
          setDragId(item.id);
        }}
        onDragOver={(e) => {
          if (dragId && dragId !== item.id) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const fromId = e.dataTransfer.getData("text/plain") || dragId;
          setDragId(null);
          if (fromId && fromId !== item.id) reorderItem(fromId, item.id);
        }}
        onDragEnd={() => setDragId(null)}
      >
        <span className={styles.editableDragHandle} aria-hidden>
          ⋮⋮
        </span>
        <span className={styles.icon} aria-hidden>
          {item.icon}
        </span>
        <span className={styles.editableLabel}>{item.label}</span>
        <button
          type="button"
          className={`${styles.editableBtn} ${pinned ? styles.editableBtnPinned : ""}`}
          onClick={() => togglePin(item.id)}
          title={pinned ? "Unpin" : `Pin to top${pinnedIds.length >= MAX_PINNED && !pinned ? " (max 5 reached)" : ""}`}
          aria-label={pinned ? "Unpin item" : "Pin item"}
          disabled={!pinned && pinnedIds.length >= MAX_PINNED}
        >
          {pinned ? "★" : "☆"}
        </button>
        <button
          type="button"
          className={styles.editableBtn}
          onClick={() => toggleHidden(item.id)}
          title={hidden ? "Show" : "Hide"}
          aria-label={hidden ? "Show item" : "Hide item"}
        >
          {hidden ? "🙈" : "👁"}
        </button>
      </div>
    );
  };

  /* ========== Final render ========== */

  const visibleOrderedIds = orderedIds.filter((id) => !pinnedSet.has(id) && !hiddenIds.has(id));
  const pinnedItems = pinnedIds.map((id) => itemById.get(id)).filter(Boolean) as SidebarNavItem[];
  const hiddenItems = Array.from(hiddenIds).map((id) => itemById.get(id)).filter(Boolean) as SidebarNavItem[];
  const nonHiddenOrderedItems = orderedIds
    .filter((id) => !hiddenIds.has(id) || editMode)
    .map((id) => itemById.get(id))
    .filter(Boolean) as SidebarNavItem[];

  return (
    <aside
      ref={shellRef}
      className={styles.shell}
      data-collapsed={collapsed && !isMobile ? "true" : "false"}
      data-mobile={isMobile ? "true" : "false"}
      data-drawer-open={isMobile && mobileDrawerOpen ? "true" : "false"}
      data-edit-mode={editMode ? "true" : "false"}
      aria-label="Main navigation"
    >
      <div className={styles.topRow}>
        <button
          type="button"
          className={styles.toggle}
          onClick={toggleCollapse}
          aria-label={isMobile ? "Close menu" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isMobile ? "✕" : collapsed ? "»" : "«"}
        </button>
        <div className={styles.logoBlock}>
          {showLabels ? (
            <Link href="/" className={styles.logoMark} onClick={closeMobileIfNav} title="RPM Prestige">
              RPM Prestige
            </Link>
          ) : (
            <Link href="/" className={styles.logoMarkCompact} onClick={closeMobileIfNav} title="RPM Prestige">
              R
            </Link>
          )}
        </div>
      </div>

      {editMode && showLabels ? (
        <div className={styles.editToolbar}>
          <span className={styles.editToolbarTitle}>Edit Sidebar</span>
          <button
            type="button"
            className={styles.editToolbarBtn}
            onClick={onReset}
            title="Reset to default"
          >
            Reset
          </button>
          <button
            type="button"
            className={`${styles.editToolbarBtn} ${styles.editToolbarBtnPrimary}`}
            onClick={onDoneEdit}
          >
            Done
          </button>
        </div>
      ) : null}

      <nav className={styles.scroll} aria-label="Primary">
        {editMode && showLabels ? (
          <>
            <div className={styles.pinnedLabel}>Order · Pin · Hide</div>
            {nonHiddenOrderedItems.map((item) => renderEditableRow(item))}
            {hiddenItems.length > 0 ? (
              <>
                <div className={styles.hiddenLabel}>Hidden</div>
                {hiddenItems.map((item) => renderEditableRow(item))}
              </>
            ) : null}
          </>
        ) : (
          <>
            {pinnedItems.length > 0 && showLabels ? (
              <>
                <div className={styles.pinnedLabel}>
                  <span aria-hidden>★</span> Pinned
                </div>
                {pinnedItems.map((item) => renderNormalRow(item, { isPinnedDisplay: true }))}
                <div className={styles.pinnedDivider} aria-hidden />
              </>
            ) : null}

            {visibleOrderedIds.map((id) => {
              const item = itemById.get(id);
              if (!item) return null;
              if (item.section === "tools" && visibleOrderedIds.indexOf(id) > 0) {
                const prevId = visibleOrderedIds[visibleOrderedIds.indexOf(id) - 1];
                const prevItem = itemById.get(prevId);
                if (prevItem?.section !== "tools") {
                  return (
                    <div key={`tools-anchor-${id}`}>
                      {showLabels ? <div className={styles.sectionLabel}>Tools</div> : null}
                      {renderNormalRow(item)}
                    </div>
                  );
                }
              }
              return renderNormalRow(item);
            })}

            {/* Narrow-column dropdown flyouts */}
            {narrowColumn && flyout === "dashboard" ? (
              <div
                className={styles.subList}
                style={{
                  position: "fixed",
                  left: 60,
                  top: 96,
                  zIndex: 1300,
                  background: "#1b2856",
                  borderRadius: 12,
                  padding: "0.5rem 0",
                  minWidth: 200,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {dashSubLinks.map(({ tab, label }) => {
                  const href = `/dashboard?tab=${tab}`;
                  const active = dashboardActive && dashboardTab === tab;
                  return (
                    <Link
                      key={tab}
                      href={href}
                      className={`${styles.subLink} ${active ? styles.subLinkActive : ""}`}
                      style={{ color: "#fff" }}
                      onClick={closeMobileIfNav}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            ) : null}

            {narrowColumn && flyout === "eos" ? (
              <div
                className={styles.subList}
                style={{
                  position: "fixed",
                  left: 60,
                  top: 200,
                  zIndex: 1300,
                  background: "#1b2856",
                  borderRadius: 12,
                  padding: "0.5rem 0",
                  minWidth: 200,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {eosSubLinks.map(({ href, label }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`${styles.subLink} ${active ? styles.subLinkActive : ""}`}
                      style={{ color: "#fff" }}
                      onClick={closeMobileIfNav}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            ) : null}

            {narrowColumn && flyout === "operations" ? (
              <div
                className={styles.subList}
                style={{
                  position: "fixed",
                  left: 60,
                  top: 240,
                  zIndex: 1300,
                  background: "#1b2856",
                  borderRadius: 12,
                  padding: "0.5rem 0",
                  minWidth: 200,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {operationsSubLinks.map(({ href, label }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`${styles.subLink} ${active ? styles.subLinkActive : ""}`}
                      style={{ color: "#fff" }}
                      onClick={closeMobileIfNav}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            ) : null}

            {/* External section (always shown) */}
            {showLabels ? <div className={styles.sectionLabel}>External</div> : null}
            {EXTERNAL.map((item) => (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.row}
                title={item.label}
              >
                <span className={styles.icon} aria-hidden>
                  {showLabels ? "\u00a0" : "↗"}
                </span>
                {showLabels ? (
                  <>
                    <span className={styles.label}>{item.label}</span>
                    <span className={styles.externalMark} aria-hidden>
                      ↗
                    </span>
                  </>
                ) : null}
              </a>
            ))}

            {isAdmin ? (
              <>
                {showLabels ? <div className={styles.sectionLabel}>Admin</div> : null}
                <Link
                  href="/admin/users"
                  className={`${styles.row} ${pathname.startsWith("/admin/users") ? styles.rowActive : ""}`}
                  onClick={closeMobileIfNav}
                  title={showCollapsedTooltips ? "User Management" : undefined}
                >
                  <span className={styles.icon} aria-hidden>
                    👥
                  </span>
                  {showLabels ? <span className={styles.label}>User Management</span> : null}
                </Link>
                <Link
                  href="/admin/forms"
                  className={`${styles.row} ${pathname.startsWith("/admin/forms") ? styles.rowActive : ""}`}
                  onClick={closeMobileIfNav}
                  title={showCollapsedTooltips ? "Form Submissions" : undefined}
                >
                  <span className={styles.icon} aria-hidden>
                    📋
                  </span>
                  {showLabels ? <span className={styles.label}>Form Submissions</span> : null}
                </Link>
                <Link
                  href="/admin/walkthru"
                  className={`${styles.row} ${pathname.startsWith("/admin/walkthru") ? styles.rowActive : ""}`}
                  onClick={closeMobileIfNav}
                  title={showCollapsedTooltips ? "Walk-Thru Reports" : undefined}
                >
                  <span className={styles.icon} aria-hidden>
                    📝
                  </span>
                  {showLabels ? <span className={styles.label}>Walk-Thru Reports</span> : null}
                </Link>
              </>
            ) : null}
          </>
        )}
      </nav>

      {!editMode && showLabels ? (
        <button
          type="button"
          className={styles.sidebarEditGear}
          onClick={() => setEditMode(true)}
          aria-label="Edit sidebar layout"
        >
          ⚙ Customize sidebar
        </button>
      ) : null}

      <div className={styles.userFooter}>
        <div className={styles.userWrap} ref={userWrapRef}>
          <button
            type="button"
            className={styles.userBtn}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            onClick={() => setUserMenuOpen((o) => !o)}
            title={showCollapsedTooltips ? (user?.displayName || user?.username || "Account") : undefined}
          >
            <span className={styles.avatar}>{userInitials(user?.displayName || "", user?.username || "")}</span>
            {showLabels ? (
              <span className={styles.label}>{user?.displayName?.trim() || user?.username || "Account"}</span>
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
              <button type="button" role="menuitem" className={styles.userMenuDanger} onClick={onSignOut}>
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
