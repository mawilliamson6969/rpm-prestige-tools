export type StepType =
  | "filter"
  | "send_sms"
  | "send_email"
  | "create_card"
  | "ai_draft"
  | "delay"
  | "branch";

export type AutomationSchedule = {
  id: number;
  cron_expression: string;
  timezone: string;
  enabled: boolean;
  last_fired_at: string | null;
  next_fire_at: string | null;
};

export type StepConfig = Record<string, unknown>;

export type AutomationStep = {
  id?: number;
  step_order?: number;
  step_type: StepType;
  config: StepConfig;
  /** Branch step children — only set when step_type === "branch". */
  true_steps?: AutomationStep[];
  false_steps?: AutomationStep[];
};

export type Automation = {
  id: number;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  enabled: boolean;
  max_runs_per_day: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  steps: AutomationStep[];
  schedule?: AutomationSchedule | null;
};

export type AutomationListRow = {
  id: number;
  name: string;
  description: string | null;
  trigger_type: string;
  enabled: boolean;
  max_runs_per_day: number | null;
  created_at: string;
  updated_at: string;
  step_count: number;
  last_run_at: string | null;
  success_rate_pct: number | null;
  runs_last_24h: number;
};

export type RunStatus =
  | "success"
  | "failed"
  | "filtered_out"
  | "skipped"
  | "running"
  | "retrying"
  | "dead_letter";

export type AutomationRun = {
  id: number;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  step_results: Array<{
    step_id?: number;
    step_order: number;
    step_type: string;
    status: string;
    output: unknown;
    error: string | null;
  }>;
  error: string | null;
  event_id: number;
  event_type: string | null;
  event_payload: unknown;
  attempt?: number;
  max_attempts?: number;
  next_retry_at?: string | null;
  resume_from_step?: number | null;
};

export const TRIGGER_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  {
    value: "appfolio.work_order.created",
    label: "AppFolio: Work order created",
    description: "Fires when AppFolio reports a new work order via webhook.",
  },
  {
    value: "appfolio.lease.signed",
    label: "AppFolio: Lease signed",
    description: "Fires when a lease is signed in AppFolio.",
  },
  {
    value: "openphone.message.received",
    label: "OpenPhone: Inbound SMS",
    description: "Fires when an inbound SMS arrives on an OpenPhone number.",
  },
  {
    value: "openphone.call.completed",
    label: "OpenPhone: Missed call / call ended",
    description: "Fires when an OpenPhone call wraps up.",
  },
  {
    value: "openphone.voicemail.received",
    label: "OpenPhone: Voicemail",
    description: "Fires when a voicemail is left.",
  },
  {
    value: "ms_graph.message.created",
    label: "Microsoft Graph: Email received",
    description: "Fires when a Graph subscription notifies of a new email.",
  },
  {
    value: "ms_graph.event.created",
    label: "Microsoft Graph: Calendar event",
    description: "Fires when a calendar event is created.",
  },
  {
    value: "internal.form.submitted",
    label: "Internal: Form submitted",
    description: "Fires when a form built in Form Builder gets a submission.",
  },
  {
    value: "internal.board.card_created",
    label: "Internal: Card created on a board",
    description: "Fires when a new card is added to any process board.",
  },
  {
    value: "internal.board.card_moved",
    label: "Internal: Card moved between columns",
    description: "Fires when a card moves to a different column (group) on a board.",
  },
  {
    value: "schedule.triggered",
    label: "Schedule: Cron / time-based",
    description: "Fires on a recurring schedule. Configure the cron expression and timezone below.",
  },
  {
    value: "custom.event",
    label: "Internal: Custom event",
    description:
      "Fires on any event-bus type matching a pattern — exact, or a prefix when it ends in .*. Configure the pattern below.",
  },
];

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  filter: "Filter",
  send_sms: "Send SMS",
  send_email: "Send Email",
  create_card: "Create card on board",
  ai_draft: "AI draft (Claude)",
  delay: "Delay (wait, then continue)",
  branch: "Branch (if / else)",
};

export const FILTER_OPERATORS: Array<{ value: string; label: string }> = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "exists", label: "is set" },
  { value: "not_exists", label: "is empty" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
];

export function defaultConfigFor(stepType: StepType): StepConfig {
  switch (stepType) {
    case "filter":
      return { field: "event.payload.priority", operator: "equals", value: "" };
    case "send_sms":
      return { to: "", body: "" };
    case "send_email":
      return { to: "", subject: "", body: "" };
    case "create_card":
      return { board_id: "", title: "", description: "", due_in_hours: "" };
    case "ai_draft":
      return { prompt: "", output_key: "draft", max_tokens: 600 };
    case "delay":
      return { duration_minutes: 15, duration_hours: 0, duration_days: 0 };
    case "branch":
      return { field: "event.payload.priority", operator: "equals", value: "Emergency" };
    default:
      return {};
  }
}
