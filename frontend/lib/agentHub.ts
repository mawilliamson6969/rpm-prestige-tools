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

// ============================================================
// Phase 2 types
// ============================================================

export type Stage =
  | "lead_received"
  | "owner_contacted"
  | "property_toured"
  | "agreement_pending"
  | "agreement_signed"
  | "tenant_placed"
  | "active_management"
  | "lost"
  | "declined";

export const PIPELINE_STAGES: Stage[] = [
  "lead_received",
  "owner_contacted",
  "property_toured",
  "agreement_pending",
  "agreement_signed",
  "tenant_placed",
  "active_management",
];

export const TERMINAL_STAGES: Stage[] = ["lost", "declined"];

export const STAGE_LABELS: Record<Stage, string> = {
  lead_received: "Lead Received",
  owner_contacted: "Owner Contacted",
  property_toured: "Property Toured",
  agreement_pending: "Agreement Pending",
  agreement_signed: "Agreement Signed",
  tenant_placed: "Tenant Placed",
  active_management: "Active Management",
  lost: "Lost",
  declined: "Declined",
};

const ALLOWED_NEXT: Record<Stage, Stage[]> = {
  lead_received: ["owner_contacted", "lost", "declined"],
  owner_contacted: ["property_toured", "lost", "declined"],
  property_toured: ["agreement_pending", "lost", "declined"],
  agreement_pending: ["agreement_signed", "lost", "declined"],
  agreement_signed: ["tenant_placed", "lost"],
  tenant_placed: ["active_management"],
  active_management: [],
  lost: [],
  declined: [],
};

export function nextStages(s: Stage): Stage[] {
  return ALLOWED_NEXT[s] || [];
}

export type Priority = "low" | "medium" | "high" | "urgent";
export type PaymentMethod = "check" | "ach" | "wire" | "zelle" | "other";
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskSource =
  | "manual"
  | "system_referral_thank_you"
  | "system_followup_reminder"
  | "system_other";
export type PropertyType =
  | "single_family"
  | "condo"
  | "townhome"
  | "duplex"
  | "multi_family"
  | "other";
export type PropertyStatus = "prospect" | "under_management" | "lost" | "inactive" | "deleted";
export type OwnerStatus = "active" | "lost" | "converted" | "dormant" | "deleted";

export type Owner = {
  id: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_mobile: string | null;
  phone_office: string | null;
  mailing_address_1: string | null;
  mailing_address_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_company: boolean;
  company_name: string | null;
  source_agent_id: number | null;
  source_agent_name: string | null;
  first_referral_date: string | null;
  notes: string | null;
  status: OwnerStatus;
  external_appfolio_id: string | null;
  property_count?: number;
  active_referral_count?: number;
  created_at: string;
  updated_at: string;
};

export type Property = {
  id: number;
  owner_id: number;
  owner_name: string | null;
  address_1: string;
  address_2: string | null;
  city: string;
  state: string;
  zip: string;
  property_type: PropertyType | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  year_built: number | null;
  notes: string | null;
  status: PropertyStatus;
  external_appfolio_property_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Referral = {
  id: number;
  agent_id: number;
  agent_name: string | null;
  agent_brokerage_name: string | null;
  agent_tier: Tier | null;
  agent_photo_url: string | null;
  owner_id: number;
  owner_name: string | null;
  property_id: number | null;
  property_address: string | null;
  property_city: string | null;
  stage: Stage;
  stage_changed_at: string;
  stage_changed_by: number | null;
  lost_reason: string | null;
  lost_at: string | null;
  declined_reason: string | null;
  declined_at: string | null;
  expected_monthly_rent: number | null;
  expected_management_fee_pct: number | null;
  expected_first_month_referral_fee: number | null;
  actual_monthly_rent: number | null;
  actual_management_fee_pct: number | null;
  actual_referral_fee_paid: number;
  tenant_placed_at: string | null;
  active_management_started_at: string | null;
  notes: string | null;
  internal_priority: Priority;
  expected_close_date: string | null;
  source_activity_id: number | null;
  created_at: string;
  updated_at: string;
};

export type StageHistoryEntry = {
  id: number;
  referral_id: number;
  from_stage: Stage | null;
  to_stage: Stage;
  changed_at: string;
  changed_by: number | null;
  changed_by_name: string | null;
  notes: string | null;
  duration_in_previous_stage: string | null; // Postgres INTERVAL serialized
};

export type Payment = {
  id: number;
  referral_id: number;
  amount: number;
  payment_date: string;
  payment_method: PaymentMethod;
  check_number: string | null;
  paid_to_name: string;
  notes: string | null;
  created_at: string;
  created_by: number | null;
  updated_at: string;
};

export type Revenue = {
  id: number;
  referral_id: number;
  month: string;
  rent_collected: number;
  management_fee_earned: number;
  notes: string | null;
  created_at: string;
  created_by: number | null;
  updated_at: string;
};

export type Task = {
  id: number;
  title: string;
  description: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  related_agent_id: number | null;
  related_agent_name: string | null;
  related_referral_id: number | null;
  related_owner_id: number | null;
  related_property_id: number | null;
  due_date: string | null;
  status: TaskStatus;
  priority: Priority;
  completed_at: string | null;
  completed_by: number | null;
  source: TaskSource;
  created_at: string;
  updated_at: string;
  created_by: number | null;
};

export type LifetimeValue = {
  agent_id: number;
  total_referrals_received: number;
  total_referrals_in_pipeline: number;
  total_referrals_converted: number;
  total_referrals_lost: number;
  total_referrals_declined: number;
  conversion_rate_pct: number;
  total_referral_fees_paid: number;
  total_revenue_generated: number;
  lifetime_relationship_value: number;
  first_referral_date: string | null;
  last_referral_date: string | null;
  avg_days_to_convert: number | null;
  last_calculated_at: string | null;
};

export type PipelineStats = {
  total_in_pipeline: number;
  total_expected_first_month_fees: number;
  total_expected_mrr: number;
  conversion_rate_qtr: number;
  by_stage: Array<{
    stage: Stage;
    count: number;
    expected_fees: number;
    expected_mrr: number;
    avg_days_in_stage: number | null;
  }>;
};

export type FinancialsSummary = {
  lifetime_fees_paid: number;
  ytd_fees_paid: number;
  mtd_fees_paid: number;
  lifetime_revenue_generated: number;
  ytd_revenue_generated: number;
  mtd_revenue_generated: number;
  net_margin: number;
  roi_ratio: number | null;
};

// ============================================================
// Phase 3 types
// ============================================================

// Phase 3 send channel — message delivery medium for templates and
// automations. Distinct from the Phase 1 `Channel` (agent contact
// preference: email/text/call/mail) which is unrelated to send infra.
export type MessageChannel = "email" | "sms" | "postcard" | "letter";
export type TriggerType = "time_based" | "event_based" | "manual";
export type RunStatus = "pending_approval" | "approved" | "running" | "completed" | "failed" | "skipped" | "cancelled" | "simulator";
export type ActionType =
  | "wait" | "send_email" | "send_sms" | "queue_postcard" | "queue_letter"
  | "log_activity" | "update_agent_field" | "create_task" | "notify_team"
  | "branch" | "end_sequence";

export type Automation = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  enabled: boolean;
  is_system: boolean;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  conditions: Array<{ field: string; op: string; value: unknown }>;
  actions: Array<{ type: ActionType; config: Record<string, unknown> }>;
  cooldown_period_days: number | null;
  max_runs_per_agent: number | null;
  requires_approval: boolean;
  approval_window_hours: number;
  created_at: string;
  updated_at: string;
  runs_30d?: number;
  completed_30d?: number;
  skipped_30d?: number;
  failed_30d?: number;
};

export type AutomationRun = {
  id: number;
  automation_id: number;
  automation_name: string | null;
  agent_id: number;
  agent_name: string | null;
  agent_tier?: Tier;
  agent_photo_url?: string | null;
  triggered_at: string;
  triggered_by: "cron" | "event" | "manual" | "simulator";
  triggered_by_event_id: string | null;
  status: RunStatus;
  skipped_reason: string | null;
  approval_required_until: string | null;
  approved_at: string | null;
  approved_by: number | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  cancelled_reason: string | null;
  completed_at: string | null;
  actions_total: number;
  actions_completed: number;
  actions_failed: number;
  error_log: unknown[];
  action_preview?: Array<{ sequence_index: number; action_type: ActionType; action_config: Record<string, unknown>; scheduled_for: string }>;
};

export type Template = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  body_html: string | null;
  merge_fields_used: string[];
  active: boolean;
  is_system: boolean;
  category: string | null;
  created_at: string;
  updated_at: string;
};

export type SendLogEntry = {
  id: number;
  agent_id: number;
  agent_name: string | null;
  channel: MessageChannel;
  direction: "outbound" | "inbound";
  automation_run_id: number | null;
  template_id: number | null;
  sent_at: string;
  to_address: string;
  subject: string | null;
  body: string | null;
  external_id: string | null;
  delivery_status: "sent" | "delivered" | "opened" | "clicked" | "replied" | "bounced" | "failed" | "unknown";
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  bounce_reason: string | null;
};

export type Postcard = {
  id: number;
  agent_id: number;
  agent_name: string | null;
  template_id: number | null;
  template_name: string | null;
  rendered_subject: string | null;
  rendered_body: string;
  mailing_address: { address_1?: string; address_2?: string; city?: string; state?: string; zip?: string; name?: string };
  generated_at: string;
  printed_at: string | null;
  mailed_at: string | null;
  cancelled_at: string | null;
  status: "pending" | "printed" | "mailed" | "cancelled";
};

export type SystemConfig = {
  id: number;
  kill_switch_enabled: boolean;
  kill_switch_reason: string | null;
  kill_switch_engaged_at: string | null;
  rate_limit_emails_per_hour: number;
  rate_limit_emails_per_day: number;
  rate_limit_sms_per_hour: number;
  rate_limit_sms_per_day: number;
  default_sender_email: string | null;
  default_sender_name: string | null;
  physical_address: string | null;
  referral_fee_offer_text: string | null;
  referral_fee_landing_url: string | null;
  launch_checklist_complete: boolean;
  launch_checklist_completed_at: string | null;
  updated_at: string;
};

// ============================================================
// Phase 4 types
// ============================================================

export type FlagType =
  | "likely_referrer"
  | "dormancy_risk"
  | "tier_upgrade_candidate"
  | "tier_downgrade_candidate"
  | "re_engagement_candidate"
  | "vip_consideration";

export type FlagSeverity = "info" | "watch" | "action";
export type FlagConfidence = "low" | "medium" | "high";

export type EngagementScore = {
  id: number;
  agent_id: number;
  agent_name: string | null;
  agent_tier: Tier | null;
  calculated_at: string;
  score: number;
  tier_recommendation: Tier | null;
  tier_recommendation_changed: boolean;
  components: {
    recency: number;
    frequency: number;
    two_way: number;
    referrals: number;
    financials: number;
  };
  explanation: string[];
  score_30d_ago?: number | null;
};

export type PredictiveFlag = {
  id: number;
  agent_id: number;
  agent_name: string | null;
  agent_tier: Tier | null;
  agent_photo_url: string | null;
  flag_type: FlagType;
  severity: FlagSeverity;
  confidence: FlagConfidence;
  reasoning: string;
  data_points: Record<string, unknown>;
  first_flagged_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  snooze_until: string | null;
};

export type Cohort = {
  id: number;
  name: string;
  description: string | null;
  definition: Record<string, unknown>;
  is_system: boolean;
  metrics: {
    total_agents: number;
    tier_distribution: Record<string, number>;
    agents_with_referral: number;
    converted_referrals: number;
    conversion_rate_pct: number;
    avg_days_to_first_referral: number | null;
    avg_referrals_per_agent: string;
    avg_revenue_per_agent: string;
    avg_fees_per_agent: string;
    active_retention_pct: number;
    calculated_at: string;
  } | null;
  metrics_calculated_at: string | null;
  created_at: string;
};

export type MarketEntry = {
  id: number;
  zip: string;
  month: string;
  avg_lease_price: number | null;
  median_lease_price: number | null;
  total_active_listings: number | null;
  total_leased: number | null;
  avg_days_on_market: number | null;
  inventory_level: "low" | "balanced" | "high" | null;
  notable_events: string | null;
  data_source: "manual" | "appfolio" | "mls_export" | "external";
  source_notes: string | null;
};

export const FLAG_LABELS: Record<FlagType, string> = {
  likely_referrer: "Likely Referrer",
  dormancy_risk: "Dormancy Risk",
  tier_upgrade_candidate: "Tier Upgrade Candidate",
  tier_downgrade_candidate: "Tier Downgrade Candidate",
  re_engagement_candidate: "Re-engagement Candidate",
  vip_consideration: "VIP Consideration",
};

export const FLAG_ICONS: Record<FlagType, string> = {
  likely_referrer: "🎯",
  dormancy_risk: "⚠️",
  tier_upgrade_candidate: "⬆️",
  tier_downgrade_candidate: "⬇️",
  re_engagement_candidate: "🔄",
  vip_consideration: "⭐",
};

export const SEVERITY_META: Record<FlagSeverity, { bg: string; fg: string; label: string }> = {
  action: { bg: "#fee2e2", fg: "#991b1b", label: "Action" },
  watch: { bg: "#fef3c7", fg: "#854d0e", label: "Watch" },
  info: { bg: "#dbeafe", fg: "#1e40af", label: "Info" },
};

export function scoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#65a30d";
  if (score >= 40) return "#ca8a04";
  if (score >= 20) return "#ea580c";
  return "#b91c1c";
}

// Stage badge color tokens.
export const STAGE_META: Record<Stage, { bg: string; fg: string }> = {
  lead_received: { bg: "#e0f2fe", fg: "#0369a1" },
  owner_contacted: { bg: "#dbeafe", fg: "#1e40af" },
  property_toured: { bg: "#ede9fe", fg: "#5b21b6" },
  agreement_pending: { bg: "#fef3c7", fg: "#92400e" },
  agreement_signed: { bg: "#fde68a", fg: "#78350f" },
  tenant_placed: { bg: "#bbf7d0", fg: "#14532d" },
  active_management: { bg: "#a7f3d0", fg: "#064e3b" },
  lost: { bg: "#fecaca", fg: "#991b1b" },
  declined: { bg: "#e5e7eb", fg: "#374151" },
};

export function formatMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
}

export function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / 86400000);
}

export function daysSinceColor(days: number): string {
  if (days < 7) return "#16a34a";
  if (days < 14) return "#ca8a04";
  if (days < 30) return "#ea580c";
  return "#b91c1c";
}

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
