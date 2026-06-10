/**
 * Contacts hub types — mirror backend/routes/contacts.js responses.
 * Update both sides together.
 */

export type IdentitySource =
  | "appfolio_tenant"
  | "appfolio_owner"
  | "appfolio_vendor"
  | "rentengine_lead"
  | "manual";

export const SOURCE_LABELS: Record<IdentitySource, string> = {
  appfolio_tenant: "Tenant",
  appfolio_owner: "Owner",
  appfolio_vendor: "Vendor",
  rentengine_lead: "Lead",
  manual: "Manual",
};

export type ContactListRow = {
  id: number;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  updated_at: string;
  sources: IdentitySource[];
};

export type Contact = ContactListRow & {
  alt_emails: string[];
  alt_phones: string[];
  notes: string | null;
  manual_overrides: Record<string, boolean>;
  created_at: string;
  archived_at: string | null;
};

export type ContactIdentity = {
  id: number;
  source: IdentitySource;
  external_id: string;
  metadata: {
    property_id?: string;
    property_name?: string;
    unit?: string;
    lease_from?: string;
    lease_to?: string;
    status?: string;
    vendor_type?: string;
  };
  last_synced_at: string | null;
  created_at: string;
};

export type ContactThread = {
  thread_id: string;
  subject: string | null;
  status: string;
  last_message_at: string;
  message_count: number;
};

export type ContactProcess = {
  id: number;
  name: string;
  status: string;
  role: string;
  is_primary: boolean;
  property_name: string | null;
  started_at: string | null;
  template_slug: string | null;
};
