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
  graph_id?: string | null;
  send_status?: "pending" | "sent" | "failed" | null;
  send_error?: string | null;
  sent_at?: string | null;
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

/** D0-aligned: status is one of three values. The legacy `waiting_on_*`
 *  values have been collapsed into `open` + a matching tag. The union
 *  still accepts them as input so existing code paths compile, but the
 *  backend will normalize them on PATCH. */
export type ThreadStatus =
  | "open"
  | "snoozed"
  | "closed"
  | "waiting_on_tenant"
  | "waiting_on_owner"
  | "waiting_on_vendor";

export type ThreadChannel =
  | "email"
  | "sms"
  | "whatsapp"
  | "voicemail"
  | "webchat";

export type ThreadPriority = "emergency" | "high" | "normal" | "low";

export type ThreadRow = {
  thread_id: string;
  subject: string | null;
  connection_id: number | null;
  status: ThreadStatus;
  assignee_id: number | null;
  assignee_username?: string | null;
  assignee_name?: string | null;
  category: string | null;
  priority: ThreadPriority;
  starred: boolean;
  linked_property_name: string | null;
  linked_tenant_name: string | null;
  linked_owner_name: string | null;
  message_count: number;
  unread_count: number;
  has_attachments: boolean;
  /** D0: distinct sender count on the thread. Default 1. */
  participant_count?: number;
  /** D0: user ids who have been @-mentioned anywhere in the thread. */
  mentions_users?: number[];
  /** D0: free-form labels. Includes the migrated waiting:tenant / waiting:owner
   *  / waiting:vendor tags from the legacy status values. */
  tags?: string[];
  /** D0: communication channel — email | sms | whatsapp | voicemail | webchat. */
  channel?: ThreadChannel;
  first_message_at: string;
  last_message_at: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_touched_by?: number | null;
  last_touched_at?: string | null;
  sla_policy_id?: number | null;
  sla_policy_name?: string | null;
  sla_due_at?: string | null;
  sla_paused?: boolean | null;
  sla_paused_at?: string | null;
  sla_paused_total_minutes?: number | null;
  sla_breached_at?: string | null;
  sla_first_response_minutes?: number | null;
  sla_business_hours_only?: boolean | null;
  ai_summary: string | null;
  ai_confidence?: number | null;
  mailbox_display_name?: string | null;
  mailbox_email?: string | null;
  mailbox_type?: string | null;
  my_permission?: string | null;
  has_ai_draft_ready?: boolean;
  /** Latest inbound message id, used for AI draft generation/dismiss which
   *  still hit /inbox/tickets/:id/ai-draft endpoints. */
  seed_ticket_id?: number | null;
  /** Latest message preview shown in the list — populated by the API. */
  latest_message?: {
    sender_name: string | null;
    sender_email: string | null;
    body_preview: string | null;
  } | null;
};

/** A single message inside a thread (one row in the underlying tickets table). */
export type ThreadMessage = {
  id: number;
  external_id: string | null;
  direction: "inbound" | "outbound";
  subject: string | null;
  body_preview: string | null;
  body_html: string | null;
  sender_name: string | null;
  sender_email: string | null;
  recipient_emails: string | null;
  received_at: string | null;
  is_read: boolean;
  has_attachments: boolean;
  ai_summary: string | null;
  category: string | null;
  priority: number;
  attachments?: ThreadAttachment[];
};

export type ThreadAttachment = {
  id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  direction: "inbound" | "outbound";
  /** True once Graph bytes have been pulled to disk; false means the
   *  thread detail just kicked off a lazy fetch and a refetch in a few
   *  seconds will surface the file. */
  fetched: boolean;
  created_at: string;
};
