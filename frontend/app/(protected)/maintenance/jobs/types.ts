export type JobStatus =
  | "new"
  | "triaged"
  | "quoted"
  | "scheduled"
  | "in_progress"
  | "complete"
  | "invoiced";

export type JobPriority = "low" | "normal" | "high" | "urgent";

export type JobSource = "tenant_report" | "inspection" | "owner_request";

export type MaintJob = {
  id: number;
  propertyId: string;
  propertyName?: string;
  propertyAddress?: string;
  unitId: string | null;
  unitName?: string;
  projectId: number | null;
  subcontractorId: number | null;
  title: string;
  description: string | null;
  status: JobStatus;
  priority: JobPriority;
  source: JobSource | null;
  slaDueAt: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PropertyOption = {
  id: string;
  name: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
};

export type UnitOption = {
  id: string;
  name: string | null;
  address1: string | null;
};

/** Pipeline order, used for the status filter chips and the pipeline picker. */
export const STATUS_ORDER: JobStatus[] = [
  "new",
  "triaged",
  "quoted",
  "scheduled",
  "in_progress",
  "complete",
  "invoiced",
];

export const STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  triaged: "Triaged",
  quoted: "Quoted",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  complete: "Complete",
  invoiced: "Invoiced",
};

export const PRIORITY_LABELS: Record<JobPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const SOURCE_LABELS: Record<JobSource, string> = {
  tenant_report: "Tenant Report",
  inspection: "Inspection",
  owner_request: "Owner Request",
};
