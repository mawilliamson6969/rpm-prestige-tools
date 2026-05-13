"use client";

import type { ThreadRow } from "./types";

/** Maps to the `data-variant=` attribute on `.slaBadge` in inbox.module.css.
 *  Phase 3 introduces the green/yellow/red tiering on top of the legacy
 *  ok/late/overdue/open variants. */
export type SlaBadgeVariant = "ok" | "late" | "overdue" | "open" | "paused";

export type SlaView = {
  variant: SlaBadgeVariant;
  /** Short label for the inline badge. */
  label: string;
  /** Long-form tooltip shown on hover (policy name + exact due time). */
  tooltip: string;
} | null;

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function formatSlaDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = m / 60;
  const rounded = Math.round(h * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded}h`;
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
 * Phase-3 SLA view. Tiering rules:
 *   - paused      → gray (status is in pause set; sla_paused = true)
 *   - responded   → green "Responded in Xh" (last_outbound_at >= last_inbound_at)
 *   - overdue     → red, sla_due_at < now
 *   - soon        → yellow, < 2 h remaining  (mapped to "late")
 *   - ok          → green, ≥ 2 h remaining   (mapped to "open")
 *   - no policy   → null (don't render the badge at all)
 */
export default function useSLA(thread: ThreadRow | null): SlaView {
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
      };
    }
  }

  // Paused — clock frozen by a waiting status.
  if (thread.sla_paused) {
    return {
      variant: "paused",
      label: "SLA paused",
      tooltip: `${policyTooltip(thread, due)} · clock paused while waiting`,
    };
  }

  if (!due) return null;

  if (due < now) {
    return {
      variant: "overdue",
      label: `⚠ Overdue ${formatSlaDuration(diffMinutes(now, due))}`,
      tooltip: policyTooltip(thread, due),
    };
  }

  const remainingMs = due.getTime() - now.getTime();
  const remainingLabel = formatSlaDuration(remainingMs / 60000);
  if (remainingMs < TWO_HOURS_MS) {
    return {
      variant: "late",
      label: `Due in ${remainingLabel}`,
      tooltip: policyTooltip(thread, due),
    };
  }
  return {
    variant: "ok",
    label: `Due in ${remainingLabel}`,
    tooltip: policyTooltip(thread, due),
  };
}
