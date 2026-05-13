import type { BoardColumn, Group, Item, StatusOption } from "@/types/mb";

export type CountdownBucketKey =
  | "overdue"
  | "0_30"
  | "31_60"
  | "61_90"
  | "91_plus";

export interface CountdownBucket {
  key: CountdownBucketKey;
  label: string;
  description: string;
  color: string;
  /** Filter predicate against days-until-lease-end. null/undefined items fall into 91+. */
  match: (daysUntil: number | null) => boolean;
}

export const COUNTDOWN_BUCKETS: CountdownBucket[] = [
  {
    key: "overdue",
    label: "Overdue / Lease ended",
    description: "Lease end date is in the past",
    color: "#b32317",
    match: (d) => d != null && d < 0,
  },
  {
    key: "0_30",
    label: "Due in 0–30 days",
    description: "Action this week",
    color: "#ef4444",
    match: (d) => d != null && d >= 0 && d <= 30,
  },
  {
    key: "31_60",
    label: "Due in 31–60 days",
    description: "Outreach window",
    color: "#f59e0b",
    match: (d) => d != null && d >= 31 && d <= 60,
  },
  {
    key: "61_90",
    label: "Due in 61–90 days",
    description: "Plan upcoming",
    color: "#0098d0",
    match: (d) => d != null && d >= 61 && d <= 90,
  },
  {
    key: "91_plus",
    label: "Due in 91+ days",
    description: "Long horizon",
    color: "#6a737b",
    match: (d) => d == null || d >= 91,
  },
];

export interface TeamUser {
  id: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  active: boolean;
}

export interface RenewalsBoardData {
  board: { id: number; name: string; slug: string };
  columns: BoardColumn[];
  groups: Group[];
  items: Item[];
}

export type SortDir = "asc" | "desc";

export interface SortState {
  columnKey: string | null;
  dir: SortDir;
}

/** Pull the days-until-lease-end from an item's stored values. */
export function daysUntilLeaseEnd(item: Item): number | null {
  const v = item.values?.lease_end_date;
  if (typeof v !== "string" || v.length === 0) return null;
  const target = new Date(`${v}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function bucketForItem(item: Item): CountdownBucket {
  const d = daysUntilLeaseEnd(item);
  return COUNTDOWN_BUCKETS.find((b) => b.match(d)) ?? COUNTDOWN_BUCKETS[COUNTDOWN_BUCKETS.length - 1];
}

export function statusOptionsFor(col: BoardColumn): StatusOption[] {
  const cfg = col.config as { options?: StatusOption[] } | undefined;
  return Array.isArray(cfg?.options) ? cfg!.options! : [];
}

export function isReadOnly(col: BoardColumn): boolean {
  const cfg = col.config as { readOnly?: boolean } | undefined;
  return cfg?.readOnly === true;
}

export interface ScoreThreshold {
  at: number;
  color: string;
  label?: string;
}

export function scoreThresholds(col: BoardColumn): ScoreThreshold[] {
  const cfg = col.config as { thresholds?: ScoreThreshold[] } | undefined;
  return Array.isArray(cfg?.thresholds) ? cfg!.thresholds! : [];
}

export function colorForScore(score: number | null, thresholds: ScoreThreshold[]): string {
  if (score == null || thresholds.length === 0) return "#6a737b";
  const sorted = [...thresholds].sort((a, b) => a.at - b.at);
  for (const t of sorted) {
    if (score <= t.at) return t.color;
  }
  return sorted[sorted.length - 1]?.color ?? "#6a737b";
}

/** Compare values for sorting; null/undefined sort last regardless of direction. */
export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const mul = dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mul;
  return String(a).localeCompare(String(b), undefined, { numeric: true }) * mul;
}
