-- Contacts Phase 1: first-class contacts hub (PR 1 of 2).
--
-- Why this exists: the cached_* AppFolio mirrors are wiped and reloaded
-- on every sync (sync-engine.js DELETE-then-reinsert), so their row ids
-- are ephemeral and nothing can FK to them. Contacts is the stable
-- identity layer between the AppFolio cache and the rest of the app
-- (processes, inbox, OpenPhone).
--
-- Scope (PR 1):
--   * contacts            — one row per human/company
--   * contact_identities  — links a contact to its source records
--                           (same human can be a tenant AND an owner)
--
-- Deliberately deferred to PR 2 (process integration):
--   * process_contacts (process_id, contact_id, role)
--   * contact_roles on process_templates
--   * email-task recipient resolution through contacts
--
-- Conventions matched to existing codebase (025_agent_hub.sql):
--   * SERIAL pks, INTEGER FKs to users(id), TIMESTAMPTZ DEFAULT NOW()
--   * CHECK constraints validate enums in-database
--   * Merge machinery lifted from agent_hub_agents
--     (merged_into_* + partial indexes that exclude merged rows)
--   * Idempotent — safe to re-run on every boot via ensureContactsSchema()

-- ============================================================
-- 1. contacts
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
  id                      SERIAL PRIMARY KEY,

  -- Identity
  display_name            TEXT NOT NULL,
  first_name              TEXT,
  last_name               TEXT,
  company                 TEXT,

  -- Primary reachability (sync-managed unless overridden — see manual_overrides)
  email                   TEXT,
  phone                   TEXT,
  alt_emails              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  alt_phones              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Organization
  tags                    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  notes                   TEXT,

  -- Field-level provenance. Keys are column names a human has edited by
  -- hand ({"email": true, ...}); the AppFolio sync skips these fields so
  -- a manual correction is never silently overwritten by the next sync.
  manual_overrides        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Merge machinery (agent_hub pattern). A merged row stays for
  -- forensic history; merged_into_contact_id points at the survivor.
  merged_into_contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  merged_at               TIMESTAMPTZ,
  merged_by               INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- System
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at             TIMESTAMPTZ
);

-- Email lookup is the dedup workhorse: sync matches incoming AppFolio
-- rows to existing contacts by exact lowercased email. Excludes merged
-- and archived rows so they never absorb new identities.
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts (LOWER(email))
  WHERE email IS NOT NULL
    AND merged_into_contact_id IS NULL
    AND archived_at IS NULL;

-- Fuzzy name search for the /contacts list. pg_trgm already installed
-- by 025_agent_hub.sql; the IF NOT EXISTS makes this standalone-safe.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON contacts USING gin (display_name gin_trgm_ops)
  WHERE merged_into_contact_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_updated
  ON contacts (updated_at DESC)
  WHERE merged_into_contact_id IS NULL AND archived_at IS NULL;

-- ============================================================
-- 2. contact_identities
-- ============================================================
--
-- One row per (source, external_id) pair. The same human appears once
-- in contacts but may hold several identities — tenant at one property,
-- owner of another. Sync upserts here keyed by the UNIQUE constraint,
-- never by cache row ids.
--
-- metadata carries source-specific context the card and PR-2 auto-attach
-- need (tenant: property_id/property_name/unit/lease dates; owner:
-- nothing extra — property linkage goes through cached_properties.owner_i_ds).

CREATE TABLE IF NOT EXISTS contact_identities (
  id              SERIAL PRIMARY KEY,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source IN (
    'appfolio_tenant',
    'appfolio_owner',
    'appfolio_vendor',
    'rentengine_lead',
    'manual'
  )),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_identities_contact
  ON contact_identities (contact_id);

-- PR 2 auto-attach looks up "tenant identity whose metadata property_id
-- matches the process's property". Expression index keeps that cheap.
CREATE INDEX IF NOT EXISTS idx_contact_identities_property
  ON contact_identities ((metadata ->> 'property_id'))
  WHERE metadata ->> 'property_id' IS NOT NULL;
