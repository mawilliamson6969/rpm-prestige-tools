export type Assignment = {
  id: number;
  jobId: number;
  jobTitle?: string;
  propertyName?: string;
  techId: number;
  techName?: string;
  hourlyRate: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  hoursLogged: number;
  lineCost: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Monday 00:00 (local) of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Local YYYY-MM-DD key (not UTC) for day bucketing. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
