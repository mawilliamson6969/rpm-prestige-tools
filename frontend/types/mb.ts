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

export interface InstructionStep {
  title: string;
  body: string;
  checklist?: string[];
}

export interface InstructionDecision {
  condition: string;
  conditionBadge?: "green" | "amber" | "red";
  action: string;
}

export interface InstructionCallout {
  type: CalloutType;
  title: string;
  body: string;
}

export interface InstructionTemplate {
  id: string;
  name: string;
  channel: MessageChannel;
  subject?: string;
  body: string;
  variables: string[];
}

export interface InstructionLiveData {
  label: string;
  source: string;
}

export interface InstructionResource {
  name: string;
  description?: string;
  url: string;
  icon?: string;
}

export interface Instructions {
  objective: string;
  steps: InstructionStep[];
  decisionMatrix?: InstructionDecision[];
  callouts?: InstructionCallout[];
  templates?: InstructionTemplate[];
  liveData?: InstructionLiveData[];
  relatedResources?: InstructionResource[];
}

export interface EscalationTrigger {
  condition: string;
  action: string;
  notify?: string[];
  threshold?: number;
}

export interface CompletionChecklistItem {
  id: string;
  label: string;
  required?: boolean;
}

export interface SubitemTemplate {
  id: number;
  board_id: number;
  name: string;
  description: string | null;
  position: number;
  default_assignee_role: string | null;
  default_due_offset_days: number | null;
  estimated_minutes: number | null;
  is_automated: boolean;
  instructions: Instructions | Record<string, never>;
  escalation_triggers: EscalationTrigger[];
  completion_checklist: CompletionChecklistItem[];
  created_at: string;
  updated_at: string;
}

// ============================================================
// Updates / activity feed
// ============================================================

export interface ItemUpdate {
  id: number;
  item_id: number;
  user_id: number | null;
  body: string;
  update_type: UpdateType;
  metadata: Record<string, unknown>;
  posted_to_appfolio: boolean;
  appfolio_note_id: string | null;
  created_at: string;
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
