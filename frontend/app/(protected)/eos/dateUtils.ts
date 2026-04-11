/** Monday (local) of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export type DatePreset =
  | "this_quarter"
  | "last_quarter"
  | "last_13_weeks"
  | "last_6_months"
  | "ytd"
  | "custom";

function quarterStartMonth(q: number) {
  return (q - 1) * 3;
}

/** Returns [start, end] inclusive as ymd strings for preset (weekly uses Monday bounds). */
export function rangeForPreset(preset: DatePreset, customStart?: string, customEnd?: string): { start: string; end: string } {
  const now = new Date();
  if (preset === "custom" && customStart && customEnd) {
    return { start: customStart.slice(0, 10), end: customEnd.slice(0, 10) };
  }
  if (preset === "last_13_weeks") {
    const end = mondayOf(now);
    const start = new Date(end);
    start.setDate(start.getDate() - 12 * 7);
    return { start: ymd(start), end: ymd(end) };
  }
  if (preset === "last_6_months") {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return { start: ymd(start), end: ymd(end) };
  }
  if (preset === "ytd") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { start: ymd(start), end: ymd(now) };
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3) + 1;
  if (preset === "this_quarter") {
    const start = new Date(y, quarterStartMonth(q), 1);
    const end = new Date(y, quarterStartMonth(q) + 3, 0);
    return { start: ymd(start), end: ymd(end) };
  }
  if (preset === "last_quarter") {
    let lq = q - 1;
    let ly = y;
    if (lq < 1) {
      lq = 4;
      ly = y - 1;
    }
    const start = new Date(ly, quarterStartMonth(lq), 1);
    const end = new Date(ly, quarterStartMonth(lq) + 3, 0);
    return { start: ymd(start), end: ymd(end) };
  }
  const end = mondayOf(now);
  const start = new Date(end);
  start.setDate(start.getDate() - 12 * 7);
  return { start: ymd(start), end: ymd(end) };
}

export function currentQuarterLabel(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `Q${q} ${now.getFullYear()}`;
}

export function quarterOptions(centerYear: number, span = 2): string[] {
  const out: string[] = [];
  for (let y = centerYear - span; y <= centerYear + span; y++) {
    for (let q = 1; q <= 4; q++) {
      out.push(`Q${q} ${y}`);
    }
  }
  return out;
}
