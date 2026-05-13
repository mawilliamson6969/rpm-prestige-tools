"use client";

import Link from "next/link";
import type { FormSummary } from "./types";
import styles from "./forms.module.css";

export type SidebarNav = { kind: "all" } | { kind: "category"; value: string };

type CategoryRow = { value: string; label: string; count: number };

type Props = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  nav: SidebarNav;
  onNav: (nav: SidebarNav) => void;
  totalForms: number;
  categories: CategoryRow[];
  favorites: FormSummary[];
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  isCompact: boolean;
};

function navKey(n: SidebarNav): string {
  if (n.kind === "all") return "all";
  return `cat:${n.value}`;
}

function itemClass(active: boolean, collapsed: boolean) {
  const base = collapsed ? styles.sidebarItemCollapsed : styles.sidebarItem;
  return `${base}${active ? ` ${styles.sidebarItemActive}` : ""}`;
}

export default function FormSidebar({
  collapsed,
  onToggleCollapse,
  nav,
  onNav,
  totalForms,
  categories,
  favorites,
  drawerOpen,
  onCloseDrawer,
  isCompact,
}: Props) {
  const active = navKey(nav);

  const aside = (
    <>
      {!isCompact && !collapsed ? (
        <div className={styles.sidebarSectionLabel}>Favorites</div>
      ) : null}
      {!collapsed || isCompact ? (
        <>
          {favorites.length === 0 ? (
            <p className={styles.sidebarEmptyHint}>★ Star a form to pin it here.</p>
          ) : (
            <ul className={styles.sidebarFavList}>
              {favorites.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/forms/${f.id}/submissions`}
                    className={styles.sidebarFavLink}
                    onClick={onCloseDrawer}
                  >
                    {f.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : collapsed && !isCompact ? (
        <div className={styles.sidebarCollapsedFavHint} title="Expand sidebar to see pinned forms">
          ★
        </div>
      ) : null}

      {!isCompact && !collapsed ? (
        <div className={styles.sidebarSectionLabel} style={{ marginTop: "1rem" }}>
          All forms
        </div>
      ) : null}
      {isCompact || !collapsed ? (
        <button
          type="button"
          className={itemClass(active === "all", collapsed && !isCompact)}
          onClick={() => onNav({ kind: "all" })}
          title="All forms"
        >
          {collapsed && !isCompact ? (
            <span className={styles.sidebarCollapsedGlyph} aria-hidden>
              ◎
            </span>
          ) : (
            <span className={styles.sidebarRowInner}>
              <span className={styles.sidebarBullet} aria-hidden>
                ○
              </span>
              <span>
                All <span className={styles.sidebarCount}>({totalForms})</span>
              </span>
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          className={`${styles.sidebarIconBtn}${active === "all" ? ` ${styles.sidebarItemActiveCollapsed}` : ""}`}
          title="All forms"
          aria-label={`All forms (${totalForms})`}
          onClick={() => onNav({ kind: "all" })}
        >
          ◎
        </button>
      )}

      {!isCompact && !collapsed ? (
        <div className={styles.sidebarSectionLabel} style={{ marginTop: "1rem" }}>
          Categories
        </div>
      ) : null}
      {categories.map((c) => {
        const ak = `cat:${c.value}`;
        const isActive = active === ak;
        return isCompact || !collapsed ? (
          <button
            key={c.value}
            type="button"
            className={itemClass(isActive, collapsed && !isCompact)}
            onClick={() => onNav({ kind: "category", value: c.value })}
            title={c.label}
          >
            {collapsed && !isCompact ? (
              <span className={styles.sidebarCollapsedAbbr}>{c.label.slice(0, 2)}</span>
            ) : (
              <span className={styles.sidebarRowInner}>
                <span>{c.label}</span>
                <span className={styles.sidebarCount}>({c.count})</span>
              </span>
            )}
          </button>
        ) : (
          <button
            key={c.value}
            type="button"
            className={`${styles.sidebarIconBtn}${isActive ? ` ${styles.sidebarItemActiveCollapsed}` : ""}`}
            title={`${c.label} (${c.count})`}
            aria-label={`${c.label}, ${c.count} forms`}
            onClick={() => onNav({ kind: "category", value: c.value })}
          >
            <span className={styles.sidebarCollapsedAbbr}>{c.label.slice(0, 2)}</span>
          </button>
        );
      })}

      {!isCompact ? (
        <button
          type="button"
          className={styles.sidebarCollapseBtn}
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
        >
          <span aria-hidden>{collapsed ? "⌄" : "⌃"}</span>
          {!collapsed ? <span> Collapse</span> : null}
        </button>
      ) : null}
    </>
  );

  return (
    <>
      {isCompact && drawerOpen ? (
        <button
          type="button"
          className={styles.drawerBackdrop}
          aria-label="Close menu"
          onClick={onCloseDrawer}
        />
      ) : null}
      <aside
        className={`${styles.formsSidebarOuter} ${collapsed && !isCompact ? styles.formsSidebarCollapsed : ""} ${isCompact ? styles.formsSidebarDrawer : ""} ${isCompact && drawerOpen ? styles.formsSidebarDrawerOpen : ""}`}
        aria-label="Forms navigation"
      >
        {aside}
      </aside>
    </>
  );
}
