-- Phase 6: free-form notes attached to the AI Context panel's entities.
--
-- Threads link to properties/tenants/owners by name today (text columns
-- on threads), not by ID — the IDs live inside cached_* JSONB blobs that
-- get refreshed nightly. We key notes on (entity_kind, entity_key) so
-- they survive re-syncs cleanly: kind ∈ {property, tenant, owner},
-- key is the case-normalized name.
--
-- Idempotent. Mirrored at runtime in migrateInboxContextNotes().

CREATE TABLE IF NOT EXISTS thread_entity_notes (
  id            SERIAL PRIMARY KEY,
  entity_kind   TEXT NOT NULL,
  entity_key    TEXT NOT NULL,
  body          TEXT NOT NULL,
  author_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (entity_kind IN ('property', 'tenant', 'owner'))
);

CREATE INDEX IF NOT EXISTS idx_thread_entity_notes_entity
  ON thread_entity_notes(entity_kind, entity_key, created_at DESC);
