"use client";

import { useState } from "react";
import styles from "./detail.module.css";
import type { ReactionEmoji, ReactionGroup } from "@/types/mb";

const EMOJI: ReactionEmoji[] = ["👍", "❤️", "😄", "🎉", "😢", "🚀"];

export default function ReactionBar({
  reactions,
  currentUserId,
  onToggle,
}: {
  reactions: ReactionGroup[];
  currentUserId: number | null;
  onToggle: (emoji: ReactionEmoji, mine: boolean) => Promise<void> | void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const myEmojis = new Set(
    reactions
      .filter((r) => r.users.some((u) => u.user_id === currentUserId))
      .map((r) => r.emoji)
  );

  return (
    <div className={styles.reactionBar}>
      {reactions.map((r) => {
        const mine = myEmojis.has(r.emoji);
        const title = r.users.map((u) => u.display_name).filter(Boolean).join(", ");
        return (
          <button
            key={r.emoji}
            type="button"
            className={`${styles.reactionChip} ${mine ? styles.reactionChipActive : ""}`}
            onClick={() => onToggle(r.emoji as ReactionEmoji, mine)}
            title={title}
          >
            <span>{r.emoji}</span>
            <span>{r.count}</span>
          </button>
        );
      })}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className={styles.reactionChip}
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Add reaction"
          title="Add reaction"
        >
          + 😊
        </button>
        {pickerOpen ? (
          <div
            className={styles.reactionPicker}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 4,
              background: "#fff",
              border: "1px solid rgba(27, 40, 86, 0.12)",
              borderRadius: 999,
              padding: "0.25rem 0.4rem",
              boxShadow: "0 6px 16px rgba(27, 40, 86, 0.18)",
              zIndex: 30,
            }}
          >
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                className={styles.reactionPickerBtn}
                onClick={() => {
                  setPickerOpen(false);
                  onToggle(e, myEmojis.has(e));
                }}
              >
                {e}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
