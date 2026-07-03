export type Subcontractor = {
  id: number;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  trades: string[];
  zipCoverage: string[];
  coiExpiry: string | null;
  w9OnFile: boolean;
  notes: string | null;
  avgRating: number | null;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SubRating = {
  id: number;
  job_id: number | null;
  job_title: string | null;
  rating: number;
  notes: string | null;
  created_at: string;
};

export type CoiState = "current" | "expiring" | "expired" | "none";

/** Green >30d out, orange within 30d, red lapsed, gray none. Matches the
 *  backend COI-expiry alert window (WARN_DAYS = 30). */
export function coiState(coiExpiry: string | null): CoiState {
  if (!coiExpiry) return "none";
  const due = new Date(coiExpiry).getTime();
  if (Number.isNaN(due)) return "none";
  const days = (due - Date.now()) / 864e5;
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "current";
}
