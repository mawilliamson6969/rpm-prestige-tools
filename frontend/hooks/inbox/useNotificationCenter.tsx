"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type NotificationLevel = "info" | "warning" | "error";

export type NotificationItem = {
  id: number;
  level: NotificationLevel;
  message: string;
  createdAt: string;
  /** Optional source label, e.g. "Sync", "AI draft". */
  source?: string;
};

type Push = {
  level: NotificationLevel;
  message: string;
  source?: string;
};

export type UseNotificationCenterValue = {
  items: NotificationItem[];
  unreadCount: number;
  push: (n: Push) => void;
  markAllRead: () => void;
  clear: () => void;
};

const NotificationContext = createContext<UseNotificationCenterValue | null>(null);

const MAX_ITEMS = 25;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [lastReadId, setLastReadId] = useState<number>(0);
  const idRef = useRef(0);

  const push = useCallback(({ level, message, source }: Push) => {
    idRef.current += 1;
    const id = idRef.current;
    const next: NotificationItem = {
      id,
      level,
      message,
      source,
      createdAt: new Date().toISOString(),
    };
    setItems((prev) => [next, ...prev].slice(0, MAX_ITEMS));
  }, []);

  const markAllRead = useCallback(() => {
    setLastReadId(idRef.current);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setLastReadId(idRef.current);
  }, []);

  const unreadCount = useMemo(
    () => items.filter((it) => it.id > lastReadId).length,
    [items, lastReadId]
  );

  const value = useMemo<UseNotificationCenterValue>(
    () => ({ items, unreadCount, push, markAllRead, clear }),
    [items, unreadCount, push, markAllRead, clear]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationCenter() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotificationCenter must be used within a NotificationProvider");
  return ctx;
}
