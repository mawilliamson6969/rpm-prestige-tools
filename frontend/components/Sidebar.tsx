"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChangePasswordModal from "./ChangePasswordModal";
import styles from "./sidebar.module.css";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import { useNarrowScreen } from "../hooks/useNarrowScreen";

const LS_COLLAPSED = "rpm-prestige-sidebar-collapsed";
const LS_SUB = "rpm-prestige-sidebar-submenu";

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

  const [subOpen, setSubOpen] = useState<SubState>({ dashboard: true, eos: false, operations: false });
  const [flyout, setFlyout] = useState<null | "dashboard" | "eos" | "operations">(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [unread, setUnread] = useState<number | null>(null);
  const [queued, setQueued] = useState<number | null>(null);

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
      const [rIn, rAg] = await Promise.all([
        fetch(apiUrl("/inbox/stats"), { cache: "no-store", headers: { ...authHeaders() } }),
        fetch(apiUrl("/agents/metrics/summary"), { cache: "no-store", headers: { ...authHeaders() } }),
      ]);
      const [jIn, jAg] = await Promise.all([rIn.json().catch(() => ({})), rAg.json().catch(() => ({}))]);
      if (rIn.ok && typeof jIn.unread === "number") setUnread(jIn.unread);
      if (rAg.ok && typeof jAg.queuedForReview === "number") setQueued(jAg.queuedForReview);
    } catch {
      setUnread(null);
      setQueued(null);
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

  /** Wide rail: expanded desktop, or mobile drawer (always full width labels). */
  const showLabels = isMobile || !collapsed;
  /** Desktop icon-only column. */
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
            { href: "/operations/processes", label: "Processes" },
            { href: "/operations/templates", label: "Templates" },
          ] as const)
        : ([
            { href: "/operations/tasks", label: "Tasks" },
            { href: "/operations/processes", label: "Processes" },
          ] as const),
    [isAdmin]
  );

  const showCollapsedTooltips = narrowColumn;

  return (
    <aside
      ref={shellRef}
      className={styles.shell}
      data-collapsed={collapsed && !isMobile ? "true" : "false"}
      data-mobile={isMobile ? "true" : "false"}
      data-drawer-open={isMobile && mobileDrawerOpen ? "true" : "false"}
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
        {isMobile ? (
          <span className="sr-only" aria-live="polite">
            Navigation
          </span>
        ) : null}
      </div>

      <nav className={styles.scroll} aria-label="Primary">
        <Link
          href="/"
          className={`${styles.row} ${hubActive ? styles.rowActive : ""}`}
          onClick={closeMobileIfNav}
          title={showCollapsedTooltips ? "Hub" : undefined}
        >
          <span className={styles.icon} aria-hidden>
            🏠
          </span>
          {showLabels ? <span className={styles.label}>Hub</span> : null}
        </Link>

        <button
          type="button"
          className={`${styles.row} ${dashboardActive ? styles.rowActive : ""}`}
          onClick={toggleDashboardSub}
          title={showCollapsedTooltips ? "Dashboard" : undefined}
        >
          <span className={styles.icon} aria-hidden>
            📊
          </span>
          {showLabels ? (
            <>
              <span className={styles.label}>Dashboard</span>
              <span className={`${styles.chevron} ${subOpen.dashboard ? styles.chevronOpen : ""}`} aria-hidden>
                ▸
              </span>
            </>
          ) : null}
        </button>
        {showLabels && subOpen.dashboard ? (
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
        ) : null}

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

        <Link
          href="/inbox"
          className={`${styles.row} ${inboxActive ? styles.rowActive : ""}`}
          onClick={closeMobileIfNav}
          title={showCollapsedTooltips ? "Inbox" : undefined}
        >
          <span className={styles.icon} aria-hidden>
            📧
          </span>
          {showLabels ? <span className={styles.label}>Inbox</span> : null}
          {unread != null && unread > 0 ? (
            <span className={`${styles.badge} ${styles.badgePulse}`} aria-label={`${unread} unread`}>
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>

        <Link
          href="/agents"
          className={`${styles.row} ${agentsActive ? styles.rowActive : ""}`}
          onClick={closeMobileIfNav}
          title={showCollapsedTooltips ? "Agents" : undefined}
        >
          <span className={styles.icon} aria-hidden>
            🤖
          </span>
          {showLabels ? <span className={styles.label}>Agents</span> : null}
          {queued != null && queued > 0 ? (
            <span className={`${styles.badge} ${styles.badgePulse}`} aria-label={`${queued} in queue`}>
              {queued > 99 ? "99+" : queued}
            </span>
          ) : null}
        </Link>

        <div className={styles.sectionLabel}>Tools</div>

        <button
          type="button"
          className={`${styles.row} ${eosSectionActive ? styles.rowActive : ""}`}
          onClick={toggleEosSub}
          title={showCollapsedTooltips ? "EOS" : undefined}
        >
          <span className={styles.icon} aria-hidden>
            📈
          </span>
          {showLabels ? (
            <>
              <span className={styles.label}>EOS</span>
              <span className={`${styles.chevron} ${subOpen.eos ? styles.chevronOpen : ""}`} aria-hidden>
                ▸
              </span>
            </>
          ) : null}
        </button>
        {showLabels && subOpen.eos ? (
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

        <button
          type="button"
          className={`${styles.row} ${operationsSectionActive ? styles.rowActive : ""}`}
          onClick={toggleOperationsSub}
          title={showCollapsedTooltips ? "Operations" : undefined}
        >
          <span className={styles.icon} aria-hidden>
            🗂️
          </span>
          {showLabels ? (
            <>
              <span className={styles.label}>Operations</span>
              <span className={`${styles.chevron} ${subOpen.operations ? styles.chevronOpen : ""}`} aria-hidden>
                ▸
              </span>
            </>
          ) : null}
        </button>
        {showLabels && subOpen.operations ? (
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

        {(
          [
            { href: "/ask", label: "Ask the AI", icon: "💬" },
            { href: "/videos", label: "Videos", icon: "🎬" },
            { href: "/wiki", label: "Wiki", icon: "📚" },
            { href: "/playbooks", label: "Playbooks", icon: "📋" },
            { href: "/files", label: "Files", icon: "📁" },
            { href: "/marketing/calendar", label: "Marketing", icon: "📅" },
          ] as const
        ).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.row} ${active ? styles.rowActive : ""}`}
              onClick={closeMobileIfNav}
              title={showCollapsedTooltips ? item.label : undefined}
            >
              <span className={styles.icon} aria-hidden>
                {item.icon}
              </span>
              {showLabels ? <span className={styles.label}>{item.label}</span> : null}
            </Link>
          );
        })}

        <div className={styles.sectionLabel}>External</div>
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
            <div className={styles.sectionLabel}>Admin</div>
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
      </nav>

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
