"use client";

import type { ThreadRow } from "./types";

/** Tiers map to the design's SLA chip colors (Phase 3 spec).
 *  Legacy values (`open` / `overdue`) remain so existing
 *  `data-variant=` selectors on `.slaBadge` still work. */
export type SlaBadgeVariant = "ok" | "late" | "warn" | "overdue" | "open" | "paused";

/** Exact chip colors from the Phase 3 design brief. Used by the new
 *  ConversationList / ConversationView. The legacy `data-variant` styles
 *  in inbox.module.css preserve their own (slightly muted) palette. */
export const SLA_CHIP_COLORS: Record<"late" | "warn" | "ok" | "paused", { bg: string; color: string }> = {
  late: { bg: "#FEE2E2", color: "#B32317" },
  warn: { bg: "#FEF3C7", color: "#B45309" },
  ok: { bg: "#DCFCE7", color: "#1F8A5B" },
  paused: { bg: "#F1F5F9", color: "#6A737B" },
};

export type SlaView = {
  variant: SlaBadgeVariant;
  /** Short label for the inline badge. */
  label: string;
  /** Long-form tooltip shown on hover (policy name + exact due time). */
  tooltip: string;
  /** Minutes remaining (negative when overdue, null when paused/responded). */
  minutesRemaining: number | null;
} | null;

const TWO_HOURS_MIN = 120;

export function formatSlaDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d`;
  }
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

function diffMinutes(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 60000;
}

function policyTooltip(thread: ThreadRow, dueAt?: Date | null): string {
  const policy = thread.sla_policy_name?.trim();
  const dueLabel = dueAt ? dueAt.toLocaleString() : "—";
  return policy ? `${policy} · due ${dueLabel}` : `Due ${dueLabel}`;
}

/**
 * Pure derivation of the SLA chip view from a thread row. Phase 3
 * tiering rules (matches design/.../inbox.jsx slaChip helper):
 *   - paused      → grey "SLA paused"
 *   - responded   → green "Responded in Xh" (first reply already sent)
 *   - overdue     → red "SLA breached · Xh ago"
 *   - warn (<2h)  → yellow "SLA in 18m" / "SLA in 1h 12m"
 *   - ok          → green "SLA in 4h" / "SLA in 2d"
 *   - no policy   → null (chip is not rendered)
 */
export function deriveSlaView(thread: ThreadRow | null): SlaView {
  if (!thread) return null;
  const now = new Date();
  const due = thread.sla_due_at ? new Date(thread.sla_due_at) : null;

  // Already responded — first SLA met or missed.
  if (thread.last_inbound_at && thread.last_outbound_at) {
    const inbound = new Date(thread.last_inbound_at);
    const outbound = new Date(thread.last_outbound_at);
    if (outbound >= inbound) {
      return {
        variant: "ok",
        label: `Responded in ${formatSlaDuration(diffMinutes(outbound, inbound))}`,
        tooltip: policyTooltip(thread, due),
        minutesRemaining: null,
      };
    }
  }

  // Paused — clock frozen by snooze or a waiting:* tag.
  if (thread.sla_paused) {
    return {
      variant: "paused",
      label: "SLA paused",
      tooltip: `${policyTooltip(thread, due)} · clock paused`,
      minutesRemaining: null,
    };
  }

  if (!due) return null;
  const remaining = diffMinutes(due, now);

  if (remaining < 0) {
    return {
      variant: "overdue",
      label: `SLA breached · ${formatSlaDuration(-remaining)} ago`,
      tooltip: policyTooltip(thread, due),
      minutesRemaining: remaining,
    };
  }

  if (remaining < TWO_HOURS_MIN) {
    return {
      variant: "warn",
      label: `SLA in ${formatSlaDuration(remaining)}`,
      tooltip: policyTooltip(thread, due),
      minutesRemaining: remaining,
    };
  }

  return {
    variant: "ok",
    label: `SLA in ${formatSlaDuration(remaining)}`,
    tooltip: policyTooltip(thread, due),
    minutesRemaining: remaining,
  };
}

/** Map a variant to the canonical chip palette. `overdue` collapses
 *  into `late`. */
export function slaChipColor(variant: SlaBadgeVariant): { bg: string; color: string } | null {
  switch (variant) {
    case "overdue":
    case "late":
      return SLA_CHIP_COLORS.late;
    case "warn":
      return SLA_CHIP_COLORS.warn;
    case "ok":
    case "open":
      return SLA_CHIP_COLORS.ok;
    case "paused":
      return SLA_CHIP_COLORS.paused;
    default:
      return null;
  }
}

/** Thin hook wrapper for component-tree usage. The pure `deriveSlaView`
 *  is preferred where the result needs to be computed per-row in a
 *  list — calling a hook in a `.map()` is illegal. */
export default function useSLA(thread: ThreadRow | null): SlaView {
  return deriveSlaView(thread);
}
