"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./detail.module.css";

export interface MentionableUser {
  id: number;
  username: string;
  displayName: string;
}

export default function MentionDropdown({
  query,
  position,
  users,
  onPick,
  onClose,
}: {
  query: string;
  position: { top: number; left: number } | null;
  users: MentionableUser[];
  onPick: (user: MentionableUser) => void;
  onClose: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? users.filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q)
      )
    : users.slice(0, 10);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, users.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const picked = filtered[activeIdx];
        if (picked) onPick(picked);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const picked = filtered[activeIdx];
        if (picked) {
          e.preventDefault();
          onPick(picked);
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [filtered, activeIdx, onClose, onPick]);

  if (!position || filtered.length === 0) return null;

  return (
    <div
      ref={ref}
      className={styles.mentionPopup}
      style={{ top: position.top, left: position.left }}
    >
      {filtered.map((u, i) => (
        <button
          type="button"
          key={u.id}
          className={`${styles.mentionItem} ${i === activeIdx ? styles.mentionItemActive : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(u);
          }}
          onMouseEnter={() => setActiveIdx(i)}
        >
          <span style={{ fontWeight: 700 }}>{u.displayName}</span>
          <span style={{ color: "#6a737b", fontSize: "0.78rem" }}>
            @{u.username}
          </span>
        </button>
      ))}
    </div>
  );
}
