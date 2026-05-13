"use client";

// Small shared bits used by ConversationList and ConversationView.
// Channel badge, mention badge, tag pill, sla chip, avatar circle.

import styles from "./conversation.module.css";
import type { ThreadChannel } from "../../../hooks/inbox/types";

/* ──────────────────────── Avatars ──────────────────────── */

const AVATAR_BG = [
  "#0098D0",
  "#1B2856",
  "#2E7D6B",
  "#6A1B9A",
  "#B45309",
  "#1F8A5B",
  "#B32317",
];

export function avatarColor(seed: string | number | null | undefined): string {
  if (seed == null) return AVATAR_BG[0];
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_BG[h % AVATAR_BG.length];
}

export function avatarInitials(name: string | null | undefined, email?: string | null): string {
  const s = (name || email || "?").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

/* ──────────────────────── Channel badge ──────────────────────── */

const CHANNEL_ICON: Record<ThreadChannel, string> = {
  email: "✉",
  sms: "💬",
  whatsapp: "🟢",
  voicemail: "📞",
  webchat: "💭",
};

export function ChannelBadge({
  channel,
  className,
}: {
  channel: ThreadChannel | null | undefined;
  className?: string;
}) {
  const ch = (channel ?? "email") as ThreadChannel;
  return (
    <span className={className} aria-label={`Channel: ${ch}`}>
      {CHANNEL_ICON[ch] || CHANNEL_ICON.email}
    </span>
  );
}

/* ──────────────────────── Mention badge ──────────────────────── */

export function MentionBadge({ className }: { className?: string }) {
  return (
    <span className={className} title="You were mentioned" aria-label="Mentioned">
      @
    </span>
  );
}

/* ──────────────────────── Tag pill ──────────────────────── */

const TAG_COLORS: Record<string, { dot?: string; bg?: string; color?: string }> = {
  "waiting:tenant": { dot: "#B45309" },
  "waiting:owner": { dot: "#B45309" },
  "waiting:vendor": { dot: "#B45309" },
  urgent: { dot: "#B32317" },
  legal: { dot: "#6A1B9A" },
  renewal: { dot: "#1F8A5B" },
  repair: { dot: "#0098D0" },
};

function tagLabel(t: string): string {
  if (t.startsWith("waiting:")) return `Waiting · ${t.slice("waiting:".length)}`;
  if (t.startsWith("snooze:until:")) return "Snoozed";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function TagPill({ tag }: { tag: string }) {
  if (tag.startsWith("snooze:until:")) return null; // surfaced as SLA-style chip instead
  const meta = TAG_COLORS[tag] || {};
  return (
    <span className={styles.tagPill} style={{ background: meta.bg, color: meta.color }}>
      {meta.dot ? <span className={styles.tagPillDot} style={{ background: meta.dot }} /> : null}
      {tagLabel(tag)}
    </span>
  );
}

/* ──────────────────────── SLA chip ──────────────────────── */

export type SlaChipSpec = { label: string; color: string; bg: string } | null;

/** Derive a placeholder SLA chip from sla_due_at. Phase 3 will replace this
 *  with the real policy-driven colors. For Phase 1 we render a neutral
 *  chip whenever a due date is set. */
export function deriveSlaChip(
  slaDueAt: string | null | undefined,
  slaPaused: boolean | null | undefined,
  status: string | null | undefined
): SlaChipSpec {
  if (!slaDueAt || slaPaused || status !== "open") return null;
  const due = new Date(slaDueAt).getTime();
  if (!Number.isFinite(due)) return null;
  const diffMin = Math.round((due - Date.now()) / 60000);
  if (diffMin < 0) {
    const h = Math.ceil(-diffMin / 60);
    return { label: `SLA breached · ${h}h ago`, color: "#B32317", bg: "rgba(179,35,23,0.08)" };
  }
  if (diffMin <= 30) {
    return { label: `SLA in ${diffMin}m`, color: "#B45309", bg: "rgba(180,83,9,0.10)" };
  }
  if (diffMin <= 120) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return {
      label: `SLA in ${h ? `${h}h ` : ""}${m}m`,
      color: "#0F766E",
      bg: "rgba(15,118,110,0.08)",
    };
  }
  if (diffMin <= 600) {
    const h = Math.floor(diffMin / 60);
    return { label: `SLA in ${h}h`, color: "#475569", bg: "rgba(71,85,105,0.07)" };
  }
  const d = Math.floor(diffMin / 1440);
  return { label: `SLA in ${d}d`, color: "#475569", bg: "rgba(71,85,105,0.07)" };
}

/* ──────────────────────── Snooze tag extractor ──────────────────────── */

export function extractSnoozeUntil(tags: string[] | null | undefined): string | null {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (t.startsWith("snooze:until:")) return t.slice("snooze:until:".length);
  }
  return null;
}

/* ──────────────────────── Format helpers ──────────────────────── */

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatAbsoluteTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
