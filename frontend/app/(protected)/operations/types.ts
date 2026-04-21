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
  autoAction: string | null;
  autoActionConfig: unknown;
  createdAt: string;
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
