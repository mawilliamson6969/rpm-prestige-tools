"use client";

import { useEffect, type ReactNode } from "react";
import "./inbox-tokens.css";
import styles from "./inbox-shell.module.css";
import InboxSidebar from "./InboxSidebar";
import { useInboxShell } from "./InboxShellContext";

const MOBILE_BREAKPOINT = "(max-width: 1023px)";

export default function InboxShell({ children }: { children: ReactNode }) {
  const { mobileDrawerOpen, setMobileDrawerOpen, sidebarCollapsed, setSidebarCollapsed } = useInboxShell();

  // On wider viewports, the drawer is irrelevant — make sure we don't keep
  // a stale open flag that overrides the static sidebar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    const sync = () => {
      if (!mq.matches && mobileDrawerOpen) setMobileDrawerOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [mobileDrawerOpen, setMobileDrawerOpen]);

  // The Esc key closes the mobile drawer.
  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileDrawerOpen, setMobileDrawerOpen]);

  // The "[" keyboard shortcut toggles sidebar collapse (matches the
  // design's intent of a fast switch between labels and icons).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target && target.isContentEditable) return;
      setSidebarCollapsed(!sidebarCollapsed);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  return (
    <div className={`${styles.appShell} inbox-root`}>
      {mobileDrawerOpen ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close menu"
          onClick={() => setMobileDrawerOpen(false)}
        />
      ) : null}
      <InboxSidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
