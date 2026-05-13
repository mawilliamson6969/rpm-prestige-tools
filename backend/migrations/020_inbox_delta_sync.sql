-- Inbox sync v2: delta-based inbound + tracked outbound.
-- Idempotent; also applied at runtime by ensureInboxSchema() in lib/db.js.

-- 1. Per-mailbox delta sync state.
--    Keyed on connection_id (1:1 with email_connections) so a connection delete
--    cleans up the state row automatically.
CREATE TABLE IF NOT EXISTS mailbox_sync_state (
  connection_id           INTEGER PRIMARY KEY REFERENCES email_connections(id) ON DELETE CASCADE,
  delta_link              TEXT,
  last_synced_at          TIMESTAMPTZ,
  last_success_at         TIMESTAMPTZ,
  last_error              TEXT,
  last_error_at           TIMESTAMPTZ,
  messages_processed      BIGINT NOT NULL DEFAULT 0,
  full_sync_in_progress   BOOLEAN NOT NULL DEFAULT FALSE
);

-- 2. Outbound message tracking on ticket_responses (replies sent via Graph).
ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS graph_id     TEXT;
ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS send_status  TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS send_error   TEXT;
ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS sent_at      TIMESTAMPTZ;

-- Soft-delete on tickets so a Graph @removed message hides without losing
-- the historical thread (for audit + Phase-1 thread reconstruction).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ticket_responses_graph_id
  ON ticket_responses(graph_id) WHERE graph_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_responses_failed
  ON ticket_responses(send_status) WHERE send_status = 'failed';
CREATE INDEX IF NOT EXISTS idx_tickets_deleted
  ON tickets(deleted_at) WHERE deleted_at IS NOT NULL;
