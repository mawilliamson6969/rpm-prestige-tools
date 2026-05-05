"use client";

import type { ThreadRow } from "./types";

export type SlaBadgeVariant = "ok" | "late" | "overdue" | "open";

export type SlaView = {
  variant: SlaBadgeVariant;
  label: string;
} | null;

export function formatSlaDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded}h`;
}

function diffHours(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

/**
 * Pure SLA view computation against a thread row. Phase 3 will plug in real
 * `sla_policies`; for now we surface whatever `sla_due_at` is set on the
 * thread (or fall back to a simple "open since first inbound" view).
 */
export default function useSLA(thread: ThreadRow | null): SlaView {
  if (!thread) return null;
  const now = new Date();

  // First-response SLA satisfied: outbound after the latest inbound.
  if (thread.last_inbound_at && thread.last_outbound_at) {
    const inbound = new Date(thread.last_inbound_at);
    const outbound = new Date(thread.last_outbound_at);
    if (outbound >= inbound) {
      return {
        variant: "ok",
        label: `Responded in ${formatSlaDuration(diffHours(outbound, inbound))}`,
      };
    }
  }

  // Explicit SLA breach.
  if (thread.sla_due_at && !thread.sla_paused) {
    const due = new Date(thread.sla_due_at);
    if (due < now) {
      const overdue = diffHours(now, due);
      return {
        variant: "overdue",
        label: `⚠ Overdue by ${formatSlaDuration(overdue)}`,
      };
    }
  }

  // Open thread waiting for a first response.
  if (thread.last_inbound_at) {
    const inbound = new Date(thread.last_inbound_at);
    const open = diffHours(now, inbound);
    if (open >= 0) {
      return {
        variant: open > 8 ? "late" : "open",
        label: `Open ${formatSlaDuration(open)}`,
      };
    }
  }
  return null;
}
