export type Review = {
  id: number;
  google_review_id: string;
  reviewer_name: string;
  reviewer_photo_url: string | null;
  star_rating: number;
  comment: string | null;
  create_time: string | null;
  update_time: string | null;
  reply_comment: string | null;
  reply_update_time: string | null;
  replied_by: number | null;
  replied_by_name: string | null;
  is_read: boolean;
  is_flagged: boolean;
  tags: string[] | null;
  internal_notes: string | null;
};

export type ReviewTemplate = {
  id: number;
  name: string;
  channel: "email" | "sms" | "both";
  subject: string | null;
  body: string;
  is_default: boolean;
  is_active: boolean;
  recipient_type: string;
  send_count: number;
  review_count: number;
  conversion_rate?: number;
  created_at: string;
  updated_at: string;
};

export type ReviewRequest = {
  id: number;
  template_id: number | null;
  template_name: string | null;
  recipient_name: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_type: string;
  channel: string;
  property_name: string | null;
  message_content: string | null;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  review_received: boolean;
  review_received_at: string | null;
  review_rating: number | null;
  triggered_by: string | null;
  team_member_id: number | null;
  team_member_name: string | null;
  tracking_token: string;
};

export type Automation = {
  id: number;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  template_id: number | null;
  template_name: string | null;
  channel: string;
  delay_hours: number;
  recipient_type: string;
  is_active: boolean;
  conditions: Record<string, unknown> | null;
  send_count: number;
  review_count: number;
  created_at: string;
};

export function starColor(rating: number) {
  if (rating >= 5) return "#10b981";
  if (rating >= 4) return "#34d399";
  if (rating >= 3) return "#f59e0b";
  if (rating >= 2) return "#f97316";
  return "#ef4444";
}

export function relTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86_400);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function absDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function initialsOf(name: string | null | undefined) {
  const n = String(name || "?").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase() || "?";
}

export function avatarColor(name: string | null | undefined) {
  const n = String(name || "?");
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
  const colors = ["#1b2856", "#0098D0", "#B32317", "#2E7D6B", "#6A11CB", "#C5960C"];
  return colors[hash % colors.length];
}
