"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import AppTopBar from "./AppTopBar";
import Sidebar from "./Sidebar";
import styles from "./sidebar-layout.module.css";
import { useNarrowScreen } from "../hooks/useNarrowScreen";

const LS_COLLAPSED = "rpm-prestige-sidebar-collapsed";

export default function SidebarLayout({ children }: { children: ReactNode }) {
  const narrow = useNarrowScreen();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(LS_COLLAPSED) === "1");
    } catch {
      setCollapsed(false);
    }
    setHydrated(true);
  }, []);

  const onCollapsedChange = useCallback((next: boolean) => {
    setCollapsed(next);
  }, []);

  const marginLeft = !hydrated ? 240 : narrow ? 0 : collapsed ? 60 : 240;

  return (
    <div className={styles.root}>
      {narrow && mobileOpen ? (
        <button type="button" className={styles.backdrop} aria-label="Close menu" onClick={() => setMobileOpen(false)} />
      ) : null}
      <Sidebar
        mobileDrawerOpen={mobileOpen}
        onMobileDrawerOpenChange={setMobileOpen}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />
      <div className={styles.main} style={{ marginLeft }}>
        <AppTopBar onMenuClick={() => setMobileOpen(true)} />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
