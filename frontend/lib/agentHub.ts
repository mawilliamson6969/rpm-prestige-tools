/**
 * Agent Hub frontend types + API helpers.
 *
 * Mirrors backend mappers/validators. Update both sides together.
 */
import { apiUrl } from "./api";

export type Tier = "cold" | "prospect" | "warm" | "partner" | "vip" | "dormant";
export type AgentStatus = "active" | "paused" | "dnc" | "skipped" | "converted" | "deleted";
export type Channel = "email" | "text" | "call" | "mail";
export type Niche = "luxury" | "first_time" | "investor" | "leases" | "relocation" | "multi" | "other";
export type Source =
  | "manual"
  | "mls_listing"
  | "linkedin"
  | "event"
  | "referral_from_agent"
  | "website_form"
  | "other";
export type ActivityType =
  | "email_sent"
  | "email_received"
  | "call_made"
  | "call_received"
  | "text_sent"
  | "text_received"
  | "postcard_sent"
  | "letter_sent"
  | "gift_sent"
  | "meeting_in_person"
  | "event_attended"
  | "note_added"
  | "system_event";
export type Direction = "inbound" | "outbound" | "internal";
export type RelationshipType =
  | "team"
  | "mentor"
  | "mentee"
  | "spouse"
  | "competitor"
  | "friend"
  | "other";
export type HubRole = "owner" | "manager" | "team" | "outreach" | "read_only";

export type Brokerage = {
  id: number;
  name: string;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  website: string | null;
  mls_office_id: string | null;
  notes: string | null;
  active: boolean;
  agent_count?: number;
  created_at: string;
  updated_at: string;
};

export type Agent = {
  id: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  pronouns: string | null;
  photo_url: string | null;
  license_number: string | null;
  license_state: string;
  license_status: string | null;
  license_expiration: string | null;
  mls_id: string | null;
  years_licensed: number | null;
  brokerage_id: number | null;
  brokerage_name: string | null;
  title: string | null;
  team_name: string | null;
  niche: Niche | null;
  target_zips: string[];
  average_price_point: number | null;
  annual_volume: number | null;
  referral_fee_split: number | null;
  email: string | null;
  phone_mobile: string | null;
  phone_office: string | null;
  mailing_address_1: string | null;
  mailing_address_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  preferred_channel: Channel | null;
  preferred_contact_time: string | null;
  do_not_contact: boolean;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_handle: string | null;
  personal_website: string | null;
  har_profile_url: string | null;
  tier: Tier;
  source: Source | null;
  source_detail: string | null;
  first_contact_date: string | null;
  last_interaction_date: string | null;
  relationship_owner_user_id: number | null;
  status: AgentStatus;
  notes: string | null;
  consent_to_email: boolean;
  consent_to_email_at: string | null;
  consent_to_sms: boolean;
  consent_to_sms_at: string | null;
  unsubscribed_at: string | null;
  merged_into_agent_id: number | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  updated_by: number | null;
  tags?: string[];
};

export type ChildEntry = { name?: string; birthday?: string; notes?: string };
export type PetEntry = { name?: string; type?: string; notes?: string };
export type ImportantDateEntry = { date?: string; label?: string; notes?: string };

export type PersonalDetails = {
  agent_id: number;
  birthday_month: number | null;
  birthday_day: number | null;
  birthday_year: number | null;
  spouse_name: string | null;
  spouse_birthday_month: number | null;
  spouse_birthday_day: number | null;
  anniversary_date: string | null;
  children: ChildEntry[];
  pets: PetEntry[];
  alma_mater: string | null;
  graduation_year: number | null;
  hometown: string | null;
  hobbies: string | null;
  food_preferences: string | null;
  gift_preferences: string | null;
  religious_observances: string | null;
  important_dates: ImportantDateEntry[];
  personal_notes: string | null;
  last_updated_at: string | null;
  updated_by: number | null;
};

export type Attachment = {
  id: number;
  activity_id: number;
  filename: string;
  file_url: string;
  file_type: string | null;
  file_size_bytes: number | null;
  uploaded_at: string;
  uploaded_by: number | null;
};

export type Activity = {
  id: number;
  agent_id: number;
  type: ActivityType;
  direction: Direction;
  subject: string | null;
  summary: string | null;
  body: string | null;
  external_id: string | null;
  metadata: Record<string, unknown>;
  automation_id: number | null;
  template_id: number | null;
  occurred_at: string;
  deleted_at: string | null;
  created_at: string;
  created_by: number | null;
  updated_at: string;
  attachments: Attachment[];
};

export type Tag = {
  id: number;
  agent_id: number;
  tag: string;
  created_at: string;
  created_by: number | null;
};

export type Relationship = {
  id: number;
  agent_a_id: number;
  agent_b_id: number;
  relationship_type: RelationshipType;
  notes: string | null;
  created_at: string;
  created_by: number | null;
  agent_a_name: string | null;
  agent_b_name: string | null;
};

export type HubPermissions = {
  user_id: number;
  role: HubRole;
  can_view_personal_details: boolean;
  can_change_tier: boolean;
  can_mark_dnc: boolean;
  can_export: boolean;
  can_merge: boolean;
  assigned_agent_ids: number[] | null;
  username: string | null;
  display_name: string | null;
  synthetic?: boolean;
};

export type DashboardSummary = {
  total: number;
  cold: number;
  prospect: number;
  warm: number;
  partner: number;
  vip: number;
  dormant: number;
  dnc: number;
  needs_attention: number;
  interactions_7d: number;
};

export type RecentActivity = {
  id: number;
  agent_id: number;
  type: ActivityType;
  direction: Direction;
  subject: string | null;
  summary: string | null;
  occurred_at: string;
  agent_name: string;
  agent_tier: Tier;
  logged_by_name: string | null;
};

export type UpcomingTouchpoint = {
  id: number;
  full_name: string;
  tier: Tier;
  kind: "birthday" | "spouse_birthday" | "anniversary";
  related_name: string | null;
  date: string;
  days_until: number;
};

export type NeedsAttentionAgent = {
  id: number;
  full_name: string;
  tier: Tier;
  brokerage_name: string | null;
  last_interaction_date: string | null;
  days_since: number;
};

// ============================================================
// API helpers
// ============================================================

type FetchInit = RequestInit & { authHeaders?: Record<string, string> };

export async function agentHubFetch<T>(path: string, init: FetchInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.authHeaders || {}),
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(apiUrl(path), { ...init, headers });
  // 401 → session expired. Bounce to /login. The auth context will clear
  // localStorage on its own when the user lands there.
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    // Throw so callers don't continue.
    throw Object.assign(new Error("Session expired."), { status: 401 });
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

// Convenience builders for common query strings.
export function agentListQuery(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// Tier color tokens — match the rest of the platform's badge colors.
export const TIER_META: Record<Tier, { label: string; bg: string; fg: string }> = {
  cold: { label: "Cold", bg: "#e6eef8", fg: "#1e3a8a" },
  prospect: { label: "Prospect", bg: "#fef3c7", fg: "#854d0e" },
  warm: { label: "Warm", bg: "#fde68a", fg: "#7c2d12" },
  partner: { label: "Partner", bg: "#bbf7d0", fg: "#14532d" },
  vip: { label: "VIP", bg: "#f5d0fe", fg: "#581c87" },
  dormant: { label: "Dormant", bg: "#e5e7eb", fg: "#374151" },
};

export const ACTIVITY_ICONS: Record<ActivityType, string> = {
  email_sent: "📧",
  email_received: "📨",
  call_made: "📞",
  call_received: "📲",
  text_sent: "💬",
  text_received: "💬",
  postcard_sent: "📮",
  letter_sent: "✉️",
  gift_sent: "🎁",
  meeting_in_person: "🤝",
  event_attended: "🎟️",
  note_added: "📝",
  system_event: "⚙️",
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  email_sent: "Email sent",
  email_received: "Email received",
  call_made: "Call made",
  call_received: "Call received",
  text_sent: "Text sent",
  text_received: "Text received",
  postcard_sent: "Postcard",
  letter_sent: "Letter",
  gift_sent: "Gift",
  meeting_in_person: "In-person meeting",
  event_attended: "Event",
  note_added: "Note",
  system_event: "System",
};

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}
