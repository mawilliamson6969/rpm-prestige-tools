export type ProjectStatus = "active" | "on_hold" | "complete" | "cancelled";

export type MaintProject = {
  id: number;
  name: string;
  propertyId: string | null;
  propertyName?: string;
  unitId: string | null;
  unitName?: string;
  status: ProjectStatus;
  processId: number | null;
  processName: string | null;
  processStatus: string | null;
  totalSteps: number;
  completedSteps: number;
  jobCount: number;
  targetCompletion: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChildJob = {
  id: number;
  title: string;
  status: string;
  priority: string;
};

export type ProcessTemplate = {
  id: number;
  name: string;
  category?: string | null;
  icon?: string | null;
  color?: string | null;
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On Hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

export const STATUS_ORDER: ProjectStatus[] = ["active", "on_hold", "complete", "cancelled"];
