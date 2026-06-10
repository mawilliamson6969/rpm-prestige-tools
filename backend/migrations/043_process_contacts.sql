-- Contacts Phase 2: process ↔ contact links + per-template roles.
--
-- Builds on 042_contacts.sql (contacts + contact_identities must exist).
--
-- Model: a process attaches contacts BY ROLE. Email/SMS steps address
-- "role=tenant", and resolveRecipient() looks the address up through
-- process_contacts at send time — so swapping the tenant on a process
-- (or a sync refreshing their email) fixes every pending send at once.
--
-- contact_roles on process_templates declares which role slots a
-- template's People panel surfaces and which roles auto-attach at
-- launch. JSONB array of strings; seeded per starter template below.
--
-- Idempotent — applied at boot via ensureProcessContactsSchema().

-- ============================================================
-- 1. process_contacts
-- ============================================================

CREATE TABLE IF NOT EXISTS process_contacts (
  id          SERIAL PRIMARY KEY,
  process_id  INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  -- First contact attached for a role is primary; resolveRecipient picks
  -- primaries first. Multiple contacts per role are allowed (co-tenants).
  is_primary  BOOLEAN NOT NULL DEFAULT TRUE,
  -- NULL added_by = attached by the system (auto_launch / automation).
  added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_via   TEXT NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (added_via IN ('manual', 'auto_launch', 'automation')),
  UNIQUE (process_id, contact_id, role)
);

CREATE INDEX IF NOT EXISTS idx_process_contacts_process
  ON process_contacts (process_id, role);
CREATE INDEX IF NOT EXISTS idx_process_contacts_contact
  ON process_contacts (contact_id);

-- ============================================================
-- 2. contact_roles on process_templates
-- ============================================================

ALTER TABLE process_templates
  ADD COLUMN IF NOT EXISTS contact_roles JSONB NOT NULL DEFAULT '["tenant","owner"]'::jsonb;

-- Per-template seeds for the starter templates (idempotent — same value
-- on re-run). Templates not listed keep the tenant+owner default.
UPDATE process_templates SET contact_roles = '["tenant","owner"]'::jsonb          WHERE slug = 'renewals';
UPDATE process_templates SET contact_roles = '["tenant","owner"]'::jsonb          WHERE slug = 'move-outs';
UPDATE process_templates SET contact_roles = '["tenant","vendor","owner"]'::jsonb WHERE slug = 'maintenance-escalation';
UPDATE process_templates SET contact_roles = '["tenant"]'::jsonb                  WHERE slug = 'inspections';
UPDATE process_templates SET contact_roles = '["owner"]'::jsonb                   WHERE slug = 'owner-termination';
UPDATE process_templates SET contact_roles = '["tenant","owner"]'::jsonb          WHERE slug = 'evictions';
