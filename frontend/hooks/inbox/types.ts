export type EmailSignatureRow = {
  id: number;
  name: string;
  signatureHtml: string;
  isDefault: boolean;
};

export type TicketRow = {
  id: number;
  subject: string | null;
  body_preview: string | null;
  sender_name: string | null;
  sender_email: string | null;
  recipient_emails: string | null;
  priority: number;
  category: string;
  status: string;
  is_read: boolean;
  is_starred: boolean;
  received_at: string | null;
  first_response_at?: string | null;
  ai_summary: string | null;
  linked_property_name: string | null;
  linked_tenant_name: string | null;
  linked_owner_name: string | null;
  body_html: string | null;
  assigned_to?: number | null;
  assignee_username?: string | null;
  assignee_name?: string | null;
  has_ai_draft_ready?: boolean;
  connection_id?: number | null;
  mailbox_display_name?: string | null;
  mailbox_email?: string | null;
  mailbox_type?: string | null;
  inbox_permission?: string | null;
  reply_from_email?: string | null;
};

export type AiDraftPayload = {
  draft_text: string;
  context_used: ContextUsedShape | null;
  created_at: string;
};

export type ContextUsedShape = {
  property?: boolean;
  propertyName?: string | null;
  tenant?: boolean;
  tenantName?: string | null;
  owner?: boolean;
  ownerName?: string | null;
  workOrders?: number;
  delinquency?: string | null;
  leadsimple?: boolean;
};

export type SlaPayload = {
  hoursOpen: number | null;
  hoursToFirstResponse: number | null;
  isOverdue: boolean;
  slaTarget: number;
  receivedAt: string | null;
  firstResponseAt: string | null;
};

export type ResponseRow = {
  id: number;
  response_type: string;
  body: string | null;
  body_html: string | null;
  sent_via: string | null;
  created_at: string;
  responded_by_name: string | null;
};

export type Stats = {
  totalOpen: number;
  unread: number;
  assignedToMe: number;
  unassigned: number;
  starred: number;
  byCategory: Record<string, number>;
};

export type TeamUser = {
  id: number;
  username: string;
  displayName: string;
  email?: string | null;
};

export type MailboxConnection = {
  id: number;
  email_address: string | null;
  mailbox_type: string | null;
  mailbox_email: string | null;
  display_name: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  my_permission: string | null;
  unread_count: number | null;
  /** Per-mailbox delta-sync state. Populated once mailbox_sync_state has rows. */
  delta_last_synced_at?: string | null;
  delta_last_success_at?: string | null;
  delta_last_error?: string | null;
  delta_last_error_at?: string | null;
  delta_messages_processed?: number | null;
  delta_full_sync_in_progress?: boolean | null;
};

export type ComposeMode = "reply" | "note";

export type ListSort = "newest" | "oldest" | "priority" | "updated";
