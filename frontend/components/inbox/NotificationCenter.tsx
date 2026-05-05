"use client";

import { useEffect, useRef, useState } from "react";
import { useNotificationCenter } from "../../hooks/inbox/useNotificationCenter";

const LEVEL_COLOR: Record<string, string> = {
  info: "#1b2856",
  warning: "#e65100",
  error: "#b32317",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
}

export default function NotificationCenter() {
  const { items, unreadCount, markAllRead, clear } = useNotificationCenter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} new)` : ""}`}
        title="Notifications"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) markAllRead();
            return next;
          });
        }}
        style={{
          width: "2.25rem",
          height: "2.25rem",
          border: "1px solid #cfd4dc",
          borderRadius: 8,
          background: "#fff",
          cursor: "pointer",
          color: "#1b2856",
          fontSize: "1rem",
          position: "relative",
        }}
      >
        🔔
        {unreadCount > 0 ? (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: "1.1rem",
              height: "1.1rem",
              padding: "0 0.25rem",
              borderRadius: "999px",
              background: "#b32317",
              color: "#fff",
              fontSize: "0.7rem",
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 0.4rem)",
            width: "min(22rem, 90vw)",
            maxHeight: "60vh",
            background: "#fff",
            border: "1px solid #e2e4e8",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 30,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.65rem 0.85rem",
              borderBottom: "1px solid #e2e4e8",
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "#1b2856",
            }}
          >
            <span>Notifications</span>
            {items.length ? (
              <button
                type="button"
                onClick={clear}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#6a737b",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          <div style={{ overflowY: "auto" }}>
            {items.length === 0 ? (
              <div style={{ padding: "1rem", color: "#6a737b", fontSize: "0.85rem", textAlign: "center" }}>
                No recent notifications.
              </div>
            ) : (
              items.map((it) => (
                <div
                  key={it.id}
                  style={{
                    padding: "0.6rem 0.85rem",
                    borderBottom: "1px solid #f0f1f4",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.15rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: LEVEL_COLOR[it.level] || LEVEL_COLOR.info,
                      }}
                    />
                    <span style={{ fontSize: "0.78rem", color: "#6a737b" }}>
                      {it.source ? `${it.source} · ` : ""}
                      {relativeTime(it.createdAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.88rem", color: "#1b2856" }}>{it.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
