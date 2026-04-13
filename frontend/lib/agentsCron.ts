export type CronPreset = "minutes" | "hourly" | "daily" | "weekly";

export function buildCronExpression(opts: {
  preset: CronPreset;
  everyMinutes?: number;
  hour?: number;
  minute?: number;
  weekday?: number;
}): string {
  const minute = Math.min(59, Math.max(0, opts.minute ?? 0));
  const hour = Math.min(23, Math.max(0, opts.hour ?? 8));
  if (opts.preset === "minutes") {
    const n = Math.min(59, Math.max(1, opts.everyMinutes ?? 15));
    return `*/${n} * * * *`;
  }
  if (opts.preset === "hourly") {
    return `${minute} * * * *`;
  }
  if (opts.preset === "daily") {
    return `${minute} ${hour} * * *`;
  }
  const dow = Math.min(7, Math.max(0, opts.weekday ?? 1));
  return `${minute} ${hour} * * ${dow}`;
}

export function humanDescription(opts: {
  preset: CronPreset;
  everyMinutes?: number;
  hour?: number;
  minute?: number;
  weekday?: number;
}): string {
  const minute = Math.min(59, Math.max(0, opts.minute ?? 0));
  const hour = Math.min(23, Math.max(0, opts.hour ?? 8));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  if (opts.preset === "minutes") {
    const n = Math.min(59, Math.max(1, opts.everyMinutes ?? 15));
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  if (opts.preset === "hourly") {
    return `Every hour at :${String(minute).padStart(2, "0")}`;
  }
  if (opts.preset === "daily") {
    const h12 = hour % 12 || 12;
    const ampm = hour < 12 ? "AM" : "PM";
    return `Daily at ${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
  }
  const d = days[opts.weekday ?? 1] ?? "Monday";
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `Every ${d} at ${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}
