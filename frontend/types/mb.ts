/**
 * Monday-style boards ("mb_") shared types.
 *
 * Phase 1 substrate. Future phases import these for the new operations
 * hub UI. Keep these in sync with backend/migrations/029_mb_foundation.sql.
 *
 * Backend primary keys are SERIAL (INTEGER), not UUID — the existing
 * users.id is INTEGER, so all FKs to it must match. The spec referenced
 * UUIDs but we matched the repo convention.
 */

// ============================================================
// Enums
// ============================================================

export type BoardView =
  | "table"
  | "dashboard"
  | "calendar"
  | "kanban"
  | "workload"
  | "map";

export type ColumnType =
  | "text"
  | "status"
  | "priority"
  | "date"
  | "money"
  | "person"
  | "tags"
  | "number"
  | "score"
  | "longtext"
  | "url"
  | "file"
  | "dropdown";

/** Column types the Phase 3.5 admin UI lets users create. */
export const USER_CREATABLE_COLUMN_TYPES = [
  "text",
  "number",
  "date",
  "status",
  "person",
  "dropdown",
] as const;
export type UserCreatableColumnType = (typeof USER_CREATABLE_COLUMN_TYPES)[number];

export type SubitemStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "blocked"
  | "skipped";

export type UpdateType =
  | "comment"
  | "status_change"
  | "system"
  | "appfolio_sync";

export type CalloutType = "info" | "warn" | "alert" | "success";

export type MessageChannel = "email" | "sms" | "letter" | "note";

// ============================================================
// Column config + values
// ============================================================
//
// Per-column config lives on BoardColumn.config (jsonb). The shape depends
// on column_type; ColumnConfig is a discriminated union. Item.values is a
// loose record keyed by column.key — the typed accessor on the consuming
// side narrows by column type.

export interface StatusOption {
  label: string;
  value: string;
  color?: string;
}

export interface StatusColumnConfig {
  options: StatusOption[];
  defaultValue?: string;
}

export interface PriorityColumnConfig {
  levels: StatusOption[];
}

export interface DateColumnConfig {
  includeTime?: boolean;
  format?: string;
}

export interface MoneyColumnConfig {
  currency?: string;
  precision?: number;
}

export interface NumberColumnConfig {
  min?: number;
  max?: number;
  precision?: number;
  unit?: string;
}

export interface ScoreColumnConfig {
  min: number;
  max: number;
  thresholds?: Array<{ at: number; color: string; label?: string }>;
}

export interface TagsColumnConfig {
  allowed?: string[];
  allowCustom?: boolean;
}

export interface FileColumnConfig {
  maxFiles?: number;
  acceptedMimeTypes?: string[];
}

export type ColumnConfig =
  | (StatusColumnConfig & { kind?: "status" })
  | (PriorityColumnConfig & { kind?: "priority" })
  | (DateColumnConfig & { kind?: "date" })
  | (MoneyColumnConfig & { kind?: "money" })
  | (NumberColumnConfig & { kind?: "number" })
  | (ScoreColumnConfig & { kind?: "score" })
  | (TagsColumnConfig & { kind?: "tags" })
  | (FileColumnConfig & { kind?: "file" })
  | Record<string, unknown>;

export type ColumnValue =
  | { type: "text"; value: string | null }
  | { type: "longtext"; value: string | null }
  | { type: "status"; value: string | null }
  | { type: "priority"; value: string | null }
  | { type: "date"; value: string | null /* ISO */ }
  | { type: "money"; value: number | null; currency?: string }
  | { type: "person"; value: number | null /* user id */ }
  | { type: "tags"; value: string[] }
  | { type: "number"; value: number | null }
  | { type: "score"; value: number | null }
  | { type: "url"; value: string | null }
  | { type: "file"; value: Array<{ name: string; url: string; size?: number }> };

// ============================================================
// Core tables
// ============================================================

export interface Board {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  appfolio_resource_type: string | null;
  default_view: BoardView;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  /** Phase 3.5: system boards (e.g., Renewals) can't be renamed or archived via the UI. */
  is_system: boolean;
}

export interface BoardColumn {
  id: number;
  board_id: number;
  name: string;
  key: string;
  column_type: ColumnType;
  config: ColumnConfig;
  position: number;
  width: number;
  is_required: boolean;
  appfolio_field: string | null;
  created_at: string;
  /** Phase 3.5: soft-delete (null = active). */
  archived_at: string | null;
}

export interface Group {
  id: number;
  board_id: number;
  name: string;
  color: string | null;
  position: number;
  is_collapsed: boolean;
  created_at: string;
}

export interface Item {
  id: number;
  board_id: number;
  title: string;
  position: number;
  group_id: number | null;
  values: Record<string, unknown>;
  appfolio_id: string | null;
  appfolio_resource_type: string | null;
  created_by: number | null;
  assigned_to: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  /** Phase 5: subitem support — present on subitem rows. */
  parent_item_id?: number | null;
  subitem_template_id?: number | null;
  subitem_position?: number | null;
  subitem_detached_at?: string | null;
  instructions?: InstructionsBlob | null;
  /** Phase 6: when set, the parent's status is being auto-aggregated
   * from its subitems and the status cell renders read-only. */
  aggregated_status?: string | null;
  aggregated_status_at?: string | null;
}

// ============================================================
// Phase 5: subitems + embedded instructions
// ============================================================

export type InstructionSection =
  | "objective"
  | "steps"
  | "decision_matrix"
  | "email_templates"
  | "sms_templates"
  | "escalations"
  | "completion_checklist"
  | "related_resources";

export interface InstructionStepBlock {
  id: string;
  text_html: string;
  text_plain: string;
  has_checkbox: boolean;
  position: number;
}

export interface InstructionDecisionRow {
  id: string;
  condition: string;
  action: string;
  position: number;
}

export interface InstructionEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_plain: string;
}

export interface InstructionSmsTemplate {
  id: string;
  name: string;
  body: string;
}

export interface InstructionChecklistItem {
  id: string;
  label: string;
  is_required: boolean;
  position: number;
}

export interface InstructionResource {
  id: string;
  label: string;
  url: string;
  position: number;
}

export interface InstructionsBlob {
  objective?: { text: string };
  steps?: { steps: InstructionStepBlock[] };
  decision_matrix?: { rows: InstructionDecisionRow[] };
  email_templates?: { templates: InstructionEmailTemplate[] };
  sms_templates?: { templates: InstructionSmsTemplate[] };
  escalations?: { text_html: string; text_plain: string };
  completion_checklist?: { items: InstructionChecklistItem[] };
  related_resources?: { resources: InstructionResource[] };
}

export interface ResolvedInstructions {
  source: "linked" | "detached" | "custom";
  template_id: number | null;
  template_name: string | null;
  detached_at: string | null;
  instructions: InstructionsBlob;
}

export interface SubitemTemplate {
  id: number;
  board_id: number;
  name: string;
  description: string | null;
  position: number;
  workflow_name: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  instructions?: InstructionsBlob;
}

export interface ChecklistStateEntry {
  checklist_item_id: string;
  is_checked: boolean;
  checked_by: number | null;
  checked_at: string | null;
}

// ============================================================
// Phase 6: dashboards + aggregation
// ============================================================

export interface BoardSettings {
  board_id: number;
  auto_aggregate_status: boolean;
  auto_aggregate_progress: boolean;
  primary_date_column_id: number | null;
  updated_at: string;
}

export interface TriageReason {
  label: string;
  kind:
    | "negative_status"
    | "unassigned"
    | "mention"
    | "past_due"
    | "due_soon"
    | "low_renewal_score"
    | "stale";
  weight: number;
}

export interface TriageItem {
  id: number;
  board_id: number;
  board_name: string;
  board_slug: string;
  title: string;
  values: Record<string, unknown>;
  date_key: string | null;
  date_name: string | null;
  score: number;
  capped_score: number;
  reasons: TriageReason[];
  unread_mentions: number;
}

export interface TriageResponse {
  items: TriageItem[];
  total_qualified: number;
  overflow: number;
}

export interface CalendarItem {
  id: number;
  board_id: number;
  board_name: string;
  board_slug: string;
  title: string;
  date_key: string;
  date_name: string | null;
  date_value: string;
  status_value: string | null;
  status_label: string | null;
  status_color: string;
  owner: number | null;
}

export interface BoardProgressEntry {
  pct: number | null;
  total: number;
  done: number;
}

export interface SubitemVariableMap {
  subitem: Record<string, string>;
  item: Record<string, string>;
  subitem_columns: Array<{ key: string; name: string; type: string }>;
  item_columns: Array<{ key: string; name: string; type: string }>;
}

export interface Subitem {
  id: number;
  item_id: number;
  title: string;
  position: number;
  status: SubitemStatus;
  assigned_to: number | null;
  due_date: string | null;
  completed_at: string | null;
  estimated_minutes: number | null;
  is_automated: boolean;
  template_id: number | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Subitem template + structured instructions
// ============================================================

// (Phase 1's placeholder InstructionStep / InstructionDecision /
// InstructionCallout / InstructionTemplate / InstructionLiveData /
// InstructionResource / Instructions interfaces were removed in Phase 5.
// They were sketched for a never-implemented feature and conflicted with
// the Phase 5 instruction types defined earlier in this file
// (InstructionStepBlock, InstructionDecisionRow, etc.). No code in the
// repo referenced the old shapes.)

// (Phase 1's EscalationTrigger / CompletionChecklistItem / SubitemTemplate
// placeholders were removed in Phase 5 — superseded by the Phase 5
// instruction types earlier in this file. No code referenced them.)

// ============================================================
// Updates / activity feed
// ============================================================

export interface ItemUpdate {
  id: number;
  /** Phase 7: rekeyed to process_id. Legacy item_id retained as optional for any pre-migration consumers. */
  item_id?: number;
  process_id?: number | null;
  user_id: number | null;
  body: string;
  update_type: UpdateType;
  metadata: Record<string, unknown>;
  /** Phase 7: AppFolio cross-post fields are legacy; updates are now process-scoped. */
  posted_to_appfolio?: boolean;
  appfolio_note_id?: string | null;
  created_at: string;
  /** Phase 4 additions: */
  parent_update_id?: number | null;
  body_html?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  user_display_name?: string | null;
  user_username?: string | null;
  reactions?: ReactionGroup[];
  mentions?: MentionRef[];
  attachments?: AttachmentRef[];
}

export type ReactionEmoji = "👍" | "❤️" | "😄" | "🎉" | "😢" | "🚀";

export interface ReactionGroup {
  emoji: ReactionEmoji | string;
  count: number;
  users: Array<{ user_id: number; display_name: string | null }>;
}

export interface MentionRef {
  mentioned_user_id: number;
  seen_at: string | null;
  display_name: string | null;
}

export interface AttachmentRef {
  id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: number | null;
  created_at: string;
}

export interface ItemContext {
  linked: boolean;
  tenant: {
    linked: boolean;
    synced_at: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    lease_from?: string | null;
    lease_to?: string | null;
    rent?: string | number | null;
    balance?: string | number | null;
  };
  property: {
    linked: boolean;
    synced_at: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    property_type?: string | null;
    owner_name?: string | null;
    owner_email?: string | null;
    owner_phone?: string | null;
    unit_count?: number | string | null;
    occupied_count?: number | string | null;
  };
}

export interface RelatedItemRef {
  id: number;
  board_id: number;
  board_name: string;
  board_slug: string;
  title: string;
  tenant_name: string | null;
  property: string | null;
  status: string | null;
}

export interface SubitemUpdate {
  id: number;
  subitem_id: number;
  user_id: number | null;
  body: string;
  update_type: UpdateType;
  metadata: Record<string, unknown>;
  posted_to_appfolio: boolean;
  appfolio_note_id: string | null;
  created_at: string;
}

// ============================================================
// Audit + webhook log (read-only — admin views)
// ============================================================

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ApiLogEntry {
  id: number;
  user_id: number | null;
  method: HttpMethod;
  endpoint: string;
  request_payload: unknown;
  response_status: number | null;
  response_body: unknown;
  duration_ms: number | null;
  error_message: string | null;
  triggered_by_item_id: number | null;
  triggered_by_subitem_id: number | null;
  created_at: string;
}

export interface WebhookEvent {
  id: number;
  topic: string | null;
  event_type: string | null;
  resource_id: string | null;
  payload: unknown;
  signature: string | null;
  processed_at: string | null;
  process_error: string | null;
  created_at: string;
}

// ============================================================
// Aggregated read shapes
// ============================================================

export interface BoardWithSchema extends Board {
  columns: BoardColumn[];
  groups: Group[];
}

export interface ItemWithSubitems extends Item {
  subitems: Subitem[];
}
