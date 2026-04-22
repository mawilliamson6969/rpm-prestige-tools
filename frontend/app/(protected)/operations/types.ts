export type TaskPriority = "urgent" | "high" | "normal" | "low";
export type TaskStatus = "pending" | "in_progress" | "completed" | "canceled";
export type ProcessStatus = "active" | "paused" | "completed" | "canceled";
export type StepStatus = "pending" | "in_progress" | "completed" | "skipped" | "blocked";

export type Task = {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedUserId: number | null;
  assignedUserName?: string;
  createdBy: number | null;
  propertyName: string | null;
  propertyId: number | null;
  contactName: string | null;
  dueDate: string | null;
  dueTime: string | null;
  reminderAt: string | null;
  completedAt: string | null;
  completedBy: number | null;
  processStepId: number | null;
  processId?: number;
  processName?: string;
  projectId?: number | null;
  projectName?: string;
  projectColor?: string;
  projectIcon?: string;
  category: string | null;
  tags: string[];
  notes: string | null;
  instructions?: string | null;
  dueDateType?: string | null;
  dueDateConfig?: Record<string, unknown> | null;
  parentTaskId?: number | null;
  subtaskCount?: number;
  completedSubtaskCount?: number;
  blockedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type Template = {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  icon: string;
  color: string;
  estimatedDays: number;
  isActive: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  stepCount?: number;
};

export type AutoActionType =
  | "send_email"
  | "notify"
  | "create_folder"
  | "create_task"
  | "auto_complete_delay"
  | "webhook"
  | "launch_process";

export type AutoActionConfig = Record<string, unknown> | null;

export type TemplateStep = {
  id: number;
  templateId: number;
  stepNumber: number;
  name: string;
  description: string | null;
  assignedRole: string | null;
  assignedUserId: number | null;
  dueDaysOffset: number;
  dependsOnStep: number | null;
  isRequired: boolean;
  autoAction: AutoActionType | null;
  autoActionConfig: AutoActionConfig;
  stageId?: number | null;
  dueDateType?: DueDateType;
  dueDateConfig?: Record<string, unknown>;
  instructions?: string | null;
  createdAt: string;
};

export type DueDateType =
  | "offset_from_start"
  | "offset_from_step"
  | "offset_from_stage"
  | "offset_from_field"
  | "fixed_date"
  | "same_day_as_step"
  | "no_due_date";

export type TemplateStage = {
  id: number;
  templateId: number;
  name: string;
  description: string | null;
  stageOrder: number;
  color: string | null;
  textColor?: string | null;
  icon: string | null;
  isGate: boolean;
  isFinal?: boolean;
  autoAdvance?: boolean;
  gateCondition: unknown;
  createdAt: string;
};

export type ProcessStageRecord = {
  id: number;
  processId: number;
  templateStageId: number | null;
  name: string;
  stageOrder: number;
  status: "pending" | "active" | "completed" | "skipped";
  startedAt: string | null;
  completedAt: string | null;
  color?: string | null;
  icon?: string | null;
  isGate?: boolean;
};

export type TriggerType =
  | "step_completed"
  | "stage_completed"
  | "all_steps_completed"
  | "field_equals"
  | "field_greater_than"
  | "field_changed"
  | "due_date_approaching"
  | "overdue"
  | "process_launched"
  | "process_status_changed";

export type ActionType =
  | "create_task"
  | "skip_step"
  | "complete_step"
  | "reassign_step"
  | "reassign_process"
  | "send_notification"
  | "send_email"
  | "move_to_stage"
  | "launch_process"
  | "update_field"
  | "change_process_status"
  | "webhook";

export type ProcessCondition = {
  id: number;
  templateId: number;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  actionType: ActionType;
  actionConfig: Record<string, unknown>;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

export type ConditionLogEntry = {
  id: number;
  conditionId: number | null;
  conditionName: string | null;
  triggerType: string;
  actionType: string;
  result: "success" | "failed";
  details: { summary?: string; error?: string } | null;
  executedAt: string;
};

export const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  step_completed: "Step is completed",
  stage_completed: "Stage is completed",
  all_steps_completed: "All steps are completed",
  field_equals: "Field equals value",
  field_greater_than: "Field exceeds value",
  field_changed: "Field is changed",
  due_date_approaching: "Due date approaching",
  overdue: "Item becomes overdue",
  process_launched: "Process is launched",
  process_status_changed: "Process status changes",
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  create_task: "Create Task",
  skip_step: "Skip Step",
  complete_step: "Complete Step",
  reassign_step: "Reassign Step",
  reassign_process: "Reassign Process",
  send_notification: "Send Notification",
  send_email: "Send Email",
  move_to_stage: "Move to Stage",
  launch_process: "Launch Process",
  update_field: "Update Field",
  change_process_status: "Change Status",
  webhook: "Call Webhook",
};

export const DUE_DATE_TYPE_LABELS: Record<DueDateType, string> = {
  offset_from_start: "X days after process starts",
  offset_from_step: "X days after step is completed",
  offset_from_stage: "X days after stage is completed",
  offset_from_field: "Relative to date field",
  fixed_date: "Fixed date",
  same_day_as_step: "Same day as step",
  no_due_date: "No due date",
};

export const AUTO_ACTION_LABELS: Record<AutoActionType, { label: string; icon: string }> = {
  send_email: { label: "Send Email", icon: "✉️" },
  notify: { label: "Send Notification", icon: "🔔" },
  create_folder: { label: "Create Folder", icon: "📁" },
  create_task: { label: "Create Task", icon: "✅" },
  auto_complete_delay: { label: "Wait / Delay", icon: "⏱️" },
  webhook: { label: "Webhook", icon: "🪝" },
  launch_process: { label: "Launch Process", icon: "🚀" },
};

export type ProcessRecord = {
  id: number;
  templateId: number | null;
  name: string;
  status: ProcessStatus;
  propertyName: string | null;
  propertyId: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  startedAt: string;
  targetCompletion: string | null;
  completedAt: string | null;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  templateName?: string;
  templateIcon?: string;
  templateColor?: string;
  totalSteps?: number;
  completedSteps?: number;
  currentStepName?: string;
};

export type ProcessStep = {
  id: number;
  processId: number;
  templateStepId: number | null;
  stepNumber: number;
  name: string;
  description: string | null;
  status: StepStatus;
  assignedUserId: number | null;
  assignedUserName?: string;
  assignedRole: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completedBy: number | null;
  completedByName?: string;
  dependsOnStepId: number | null;
  notes: string | null;
  autoAction: AutoActionType | null;
  autoActionConfig: AutoActionConfig;
  automationStatus: "running" | "completed" | "failed" | null;
  automationError: string | null;
  stageId?: number | null;
  dueDateType?: string | null;
  dueDateConfig?: Record<string, unknown> | null;
  instructions?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeamUser = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "viewer";
  email?: string | null;
};

export type ProjectStatus = "active" | "on_hold" | "completed" | "canceled";
export type MilestoneStatus = "pending" | "in_progress" | "completed";
export type MemberRole = "owner" | "member" | "viewer";

export type Project = {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: string;
  category: string | null;
  color: string;
  icon: string;
  ownerUserId: number | null;
  ownerName?: string;
  propertyName: string | null;
  propertyId: number | null;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  budget: number | null;
  spent: number;
  tags: string[];
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  totalTasks?: number;
  completedTasks?: number;
  totalMilestones?: number;
  completedMilestones?: number;
  memberCount?: number;
};

export type ProjectMilestone = {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: MilestoneStatus;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
};

export type ProjectNote = {
  id: number;
  projectId: number;
  userId: number | null;
  userName?: string;
  title: string | null;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProjectMember = {
  id: number;
  projectId: number;
  userId: number | null;
  displayName?: string;
  username?: string;
  role: MemberRole;
  addedAt: string;
};

export const PROJECT_CATEGORIES = [
  "Leasing",
  "Maintenance",
  "Operations",
  "Marketing",
  "Finance",
  "Owner Relations",
  "Growth",
  "Compliance",
  "Technology",
  "Team Development",
];

export const PROJECT_COLORS = [
  "#0098D0",
  "#1B2856",
  "#B32317",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#6A737B",
  "#0ea5e9",
  "#f97316",
];

export const PROJECT_ICONS = ["📁", "🚀", "🏠", "📈", "💡", "🎯", "🛠️", "📋", "💰", "🧭", "🌱", "⚡"];

export type CustomFieldEntityType =
  | "process_template"
  | "process"
  | "process_template_step"
  | "process_step"
  | "project";

export type CustomFieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multiselect"
  | "email"
  | "phone"
  | "url"
  | "file"
  | "user"
  | "property"
  | "address"
  | "rating"
  | "color"
  | "checklist";

export type CustomFieldConfig = {
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  rows?: number;
  maxFiles?: number;
  acceptTypes?: string;
  trueLabel?: string;
  falseLabel?: string;
  maxLength?: number;
  allowMultiple?: boolean;
  items?: string[];
  checked?: boolean[];
  fillAtLaunch?: boolean;
};

export type CustomFieldDefinition = {
  id: number;
  entityType: CustomFieldEntityType;
  entityId: number;
  fieldName: string;
  fieldLabel: string;
  fieldType: CustomFieldType;
  fieldConfig: CustomFieldConfig;
  isRequired: boolean;
  sortOrder: number;
  sectionName: string;
  placeholder: string | null;
  helpText: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomFieldValue = {
  id: number;
  fieldDefinitionId: number;
  entityType: CustomFieldEntityType;
  entityId: number;
  fieldType: CustomFieldType;
  fieldLabel?: string;
  fieldName?: string;
  value: unknown;
  updatedBy: number | null;
  updatedAt: string;
};

export const FIELD_TYPE_META: Record<
  CustomFieldType,
  { icon: string; label: string; description: string }
> = {
  text: { icon: "📝", label: "Text", description: "Single line text" },
  textarea: { icon: "📄", label: "Long Text", description: "Multi-line text area" },
  number: { icon: "🔢", label: "Number", description: "Numeric value" },
  currency: { icon: "💰", label: "Currency", description: "Dollar amount" },
  percentage: { icon: "📊", label: "Percentage", description: "Percent value" },
  date: { icon: "📅", label: "Date", description: "Date picker" },
  datetime: { icon: "🕐", label: "Date & Time", description: "Date + time picker" },
  boolean: { icon: "✅", label: "Yes / No", description: "Toggle" },
  select: { icon: "📋", label: "Dropdown", description: "Single select" },
  multiselect: { icon: "🏷️", label: "Multi-Select", description: "Multiple options" },
  email: { icon: "📧", label: "Email", description: "Email address" },
  phone: { icon: "📞", label: "Phone", description: "Phone number" },
  url: { icon: "🔗", label: "URL", description: "Link / website" },
  file: { icon: "📎", label: "File Upload", description: "Attach files" },
  user: { icon: "👤", label: "Team Member", description: "Pick a teammate" },
  property: { icon: "🏠", label: "Property", description: "Pick a property" },
  address: { icon: "📍", label: "Address", description: "Street / city / state / zip" },
  rating: { icon: "⭐", label: "Rating", description: "Star rating" },
  color: { icon: "🎨", label: "Color", description: "Color picker" },
  checklist: { icon: "☑️", label: "Checklist", description: "List of check items" },
};

export const FIELD_TYPE_ORDER: CustomFieldType[] = [
  "text",
  "textarea",
  "number",
  "currency",
  "percentage",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiselect",
  "email",
  "phone",
  "url",
  "file",
  "user",
  "property",
  "address",
  "rating",
  "color",
  "checklist",
];

export const PRIORITY_OPTIONS: TaskPriority[] = ["urgent", "high", "normal", "low"];
export const CATEGORIES = [
  "Leasing",
  "Maintenance",
  "Operations",
  "Owner Relations",
  "Admin",
  "Marketing",
  "Finance",
  "Other",
];
export const ROLES = ["CSM", "BDM", "Maintenance", "Operations", "Owner"];
