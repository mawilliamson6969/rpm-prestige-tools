"use client";

// Inbox shell data context — D0.
//
// The shell sidebar lives in the /inbox layout (one level above InboxClient).
// Both the sidebar and the inbox page need the same data (mailboxes, stats,
// saved views) without polling twice, so we lift those hooks here and let
// the children consume them. Selection state (current mailbox, current
// saved view) also lives here so the sidebar can drive it and InboxClient
// can react.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import useMailboxes, { type UseMailboxes } from "../../../hooks/inbox/useMailboxes";
import useSavedViews, { type UseSavedViews } from "../../../hooks/inbox/useSavedViews";
import useStats, { type UseStats } from "../../../hooks/inbox/useStats";

const LS_COLLAPSED = "rpm-inbox-sidebar-collapsed";

/** A scoped "where am I" for the inbox content pane. */
export type InboxSection =
  | { kind: "personal"; bucket: "open" | "assignedToMe" | "mentions" | "drafts" }
  | { kind: "mailbox"; connectionId: number }
  | { kind: "view"; viewId: number }
  | { kind: "builtin"; key: "all-open" | "sla-at-risk" | "snoozed" | "starred" };

type ContextValue = {
  mailboxes: UseMailboxes;
  stats: UseStats;
  savedViews: UseSavedViews;
  section: InboxSection;
  setSection: (next: InboxSection) => void;
  /** Sidebar toggle. */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (next: boolean) => void;
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: (next: boolean) => void;
};

const InboxShellCtx = createContext<ContextValue | null>(null);

export function InboxShellProvider({ children }: { children: ReactNode }) {
  const mailboxes = useMailboxes();
  const stats = useStats();
  const savedViews = useSavedViews();
  const [section, setSection] = useState<InboxSection>({ kind: "personal", bucket: "open" });
  const [sidebarCollapsed, setCollapsedState] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Restore the persisted collapse state on mount. Skipping this in the
  // useState initializer keeps the SSR render deterministic.
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_COLLAPSED) === "1") setCollapsedState(true);
    } catch {
      /* ignore */
    }
  }, []);

  const setSidebarCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(LS_COLLAPSED, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const updateSection = useCallback(
    (next: InboxSection) => {
      setSection(next);
      if (next.kind === "mailbox") {
        mailboxes.switchTo(next.connectionId);
      } else if (next.kind === "personal" || next.kind === "builtin" || next.kind === "view") {
        mailboxes.switchTo(null);
      }
    },
    [mailboxes]
  );

  return (
    <InboxShellCtx.Provider
      value={{
        mailboxes,
        stats,
        savedViews,
        section,
        setSection: updateSection,
        sidebarCollapsed,
        setSidebarCollapsed,
        mobileDrawerOpen,
        setMobileDrawerOpen,
      }}
    >
      {children}
    </InboxShellCtx.Provider>
  );
}

export function useInboxShell(): ContextValue {
  const ctx = useContext(InboxShellCtx);
  if (!ctx) {
    throw new Error("useInboxShell must be used within InboxShellProvider");
  }
  return ctx;
}
