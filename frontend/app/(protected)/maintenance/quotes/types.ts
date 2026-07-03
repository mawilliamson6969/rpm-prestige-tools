export type QuoteStatus = "draft" | "sent" | "approved" | "rejected";
export type OwnerApprovalState = "pending" | "approved" | "declined";
export type LineKind = "labor" | "material";

export type Quote = {
  id: number;
  jobId: number;
  jobTitle?: string;
  propertyName?: string;
  title: string | null;
  status: QuoteStatus;
  ownerApprovalState: OwnerApprovalState;
  markupPct: number;
  esignRequestId: number | null;
  esignStatus: string | null;
  notes: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  lineCount: number;
  subtotal: number;
  markupAmount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
};

export type QuoteLine = {
  id: number;
  quoteId: number;
  kind: LineKind;
  description: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
  lineOrder: number;
};

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
};
