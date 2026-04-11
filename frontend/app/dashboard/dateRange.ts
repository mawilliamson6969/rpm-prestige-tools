export type DatePresetId =
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "ytd"
  | "last_12"
  | "custom";

const pad = (n: number) => String(n).padStart(2, "0");

export function toYyyyMmDd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getDateRange(
  preset: DatePresetId,
  customStart?: string,
  customEnd?: string
): { start: string; end: string; label: string } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const end = toYyyyMmDd(today);

  if (preset === "custom" && customStart && customEnd) {
    return { start: customStart, end: customEnd, label: "Custom range" };
  }

  if (preset === "ytd") {
    return { start: `${y}-01-01`, end, label: "Year to Date" };
  }

  if (preset === "this_month") {
    return { start: `${y}-${pad(m + 1)}-01`, end, label: "This Month" };
  }

  if (preset === "last_month") {
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    return {
      start: toYyyyMmDd(first),
      end: toYyyyMmDd(last),
      label: "Last Month",
    };
  }

  if (preset === "this_quarter") {
    const q = Math.floor(m / 3);
    const startMonth = q * 3;
    const start = new Date(y, startMonth, 1);
    return { start: toYyyyMmDd(start), end, label: "This Quarter" };
  }

  if (preset === "last_12") {
    const startD = new Date(today);
    startD.setMonth(startD.getMonth() - 12);
    return { start: toYyyyMmDd(startD), end, label: "Last 12 Months" };
  }

  return { start: `${y}-01-01`, end, label: "Year to Date" };
}

export const PRESET_OPTIONS: { id: DatePresetId; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "this_quarter", label: "This Quarter" },
  { id: "ytd", label: "Year to Date" },
  { id: "last_12", label: "Last 12 Months" },
  { id: "custom", label: "Custom Range" },
];
