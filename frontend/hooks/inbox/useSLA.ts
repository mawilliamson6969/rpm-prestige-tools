"use client";

import type { SlaPayload, TicketRow } from "./types";

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

/**
 * Pure SLA view computation. Phase 3 will wire `sla_policies` here so the badge
 * can be derived from a row alone, without a per-ticket fetch.
 */
export default function useSLA(ticket: TicketRow | null, sla: SlaPayload | null): SlaView {
  if (!sla || !ticket?.received_at) return null;

  if (sla.firstResponseAt != null && sla.hoursToFirstResponse != null) {
    const onTime = sla.hoursToFirstResponse <= sla.slaTarget;
    return {
      variant: onTime ? "ok" : "late",
      label: `Responded in ${formatSlaDuration(sla.hoursToFirstResponse)}`,
    };
  }

  if (sla.isOverdue) {
    return {
      variant: "overdue",
      label: `⚠ Overdue — ${sla.hoursOpen != null ? formatSlaDuration(sla.hoursOpen) : ""} without response`,
    };
  }

  return {
    variant: "open",
    label: `Open ${sla.hoursOpen != null ? formatSlaDuration(sla.hoursOpen) : ""}`.trim(),
  };
}
