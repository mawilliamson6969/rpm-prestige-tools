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
  createdAt: string;
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
