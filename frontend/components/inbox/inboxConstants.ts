export const MAILBOX_COLORS = ["#1565c0", "#2e7d32", "#6a1b9a", "#e65100", "#00897b"];

export function mailboxColor(connectionId: number | null | undefined) {
  if (connectionId == null || !Number.isFinite(connectionId)) return MAILBOX_COLORS[0];
  return MAILBOX_COLORS[Math.abs(connectionId) % MAILBOX_COLORS.length];
}

export function mailboxShortLabel(t: { mailbox_display_name?: string | null; mailbox_email?: string | null }) {
  const name = (t.mailbox_display_name || t.mailbox_email || "").trim();
  if (!name) return "";
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}

export const CATEGORY_ORDER = [
  "maintenance",
  "leasing",
  "accounting",
  "owner",
  "tenant",
  "vendor",
  "other",
] as const;

export const CATEGORY_OPTIONS = [
  "maintenance",
  "leasing",
  "accounting",
  "owner",
  "tenant",
  "vendor",
  "legal",
  "internal",
  "marketing",
  "other",
] as const;

export const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  maintenance: { bg: "#fff3e0", color: "#e65100" },
  leasing: { bg: "#e3f2fd", color: "#1565c0" },
  accounting: { bg: "#e8f5e9", color: "#2e7d32" },
  owner: { bg: "#f3e5f5", color: "#6a1b9a" },
  tenant: { bg: "#e0f2f1", color: "#00695c" },
  vendor: { bg: "#eceff1", color: "#546e7a" },
  other: { bg: "#f5f5f5", color: "#757575" },
  legal: { bg: "#ffebee", color: "#c62828" },
  internal: { bg: "#e8eaf6", color: "#3949ab" },
  marketing: { bg: "#f1f8e9", color: "#558b2f" },
};

export const TEAM_COLORS: Record<string, string> = {
  mike: "#0098d0",
  lori: "#b32317",
  leslie: "#1b2856",
  amanda: "#2e7d6b",
  amelia: "#6a1b9a",
};

export function priorityBarColor(p: number) {
  if (p >= 80) return "#b32317";
  if (p >= 50) return "#e65100";
  if (p >= 20) return "#f9a825";
  return "#9e9e9e";
}

export function priorityTier(p: number) {
  if (p >= 85) return 95;
  if (p >= 60) return 75;
  if (p >= 35) return 50;
  return 25;
}

export function relativeTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function initials(name: string | null | undefined, email: string | null | undefined) {
  const s = (name || email || "?").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  return s.slice(0, 2).toUpperCase();
}

export function hasNoAiContext(ctx: {
  property?: boolean;
  tenant?: boolean;
  owner?: boolean;
  workOrders?: number;
  delinquency?: string | null;
  leadsimple?: boolean;
} | null) {
  if (!ctx) return true;
  const wo = ctx.workOrders ?? 0;
  return (
    !ctx.property &&
    !ctx.tenant &&
    !ctx.owner &&
    wo === 0 &&
    (ctx.delinquency == null || ctx.delinquency === "") &&
    !ctx.leadsimple
  );
}
