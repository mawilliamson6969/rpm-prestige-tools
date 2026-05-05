-- Phase 1: thread is the canonical entity in the inbox.
--
-- Schema and trigger logic adapted to the existing F2/F3 reality:
--   * `tickets` is inbound-only (outbound replies live in `ticket_responses`
--     with their own graph_id / sent_at). The spec's `direction` column on
--     tickets is added with default 'inbound' for forward-compat but is not
--     load-bearing for now.
--   * `mailbox` is represented by `connection_id` (FK to email_connections).
--   * Property/tenant/owner FKs are deferred — those entities live in
--     `cached_*` tables today, not a canonical owner table. We mirror the
--     classifier's text labels onto threads instead.
--   * Status translation: open / in_progress → open, waiting →
--     waiting_on_tenant, resolved → closed.
--   * Closed threads automatically reopen when a new inbound message arrives.
--
-- Idempotent: also applied at runtime by ensureThreadsSchema() in lib/db.js.

-- 0. Forward-compat marker on the message-level table. Inbound-only today.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'inbound';

-- 1. The threads table.
CREATE TABLE IF NOT EXISTS threads (
  thread_id              TEXT PRIMARY KEY,
  subject                TEXT,
  connection_id          INTEGER REFERENCES email_connections(id) ON DELETE SET NULL,
  status                 TEXT NOT NULL DEFAULT 'open',
  assignee_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category               TEXT,
  priority               TEXT NOT NULL DEFAULT 'normal',
  starred                BOOLEAN NOT NULL DEFAULT FALSE,
  -- Mirror of the AI classifier's labels from the latest inbound message.
  linked_property_name   TEXT,
  linked_tenant_name     TEXT,
  linked_owner_name      TEXT,
  message_count          INTEGER NOT NULL DEFAULT 0,
  unread_count           INTEGER NOT NULL DEFAULT 0,
  has_attachments        BOOLEAN NOT NULL DEFAULT FALSE,
  first_message_at       TIMESTAMPTZ NOT NULL,
  last_message_at        TIMESTAMPTZ NOT NULL,
  last_inbound_at        TIMESTAMPTZ,
  last_outbound_at       TIMESTAMPTZ,
  last_touched_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_touched_at        TIMESTAMPTZ,
  sla_policy_id          INTEGER,            -- FK added in Phase 3
  sla_due_at             TIMESTAMPTZ,
  sla_paused             BOOLEAN NOT NULL DEFAULT FALSE,
  ai_summary             TEXT,
  ai_confidence          NUMERIC(3,2),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threads_status_assignee
  ON threads(status, assignee_id);
CREATE INDEX IF NOT EXISTS idx_threads_category_status
  ON threads(category, status);
CREATE INDEX IF NOT EXISTS idx_threads_connection_last_message
  ON threads(connection_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_sla_due
  ON threads(sla_due_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_threads_starred
  ON threads(starred) WHERE starred = TRUE;
CREATE INDEX IF NOT EXISTS idx_threads_unread
  ON threads(unread_count) WHERE unread_count > 0;

-- 2. Translation helpers (priority int → text, status legacy → thread).
CREATE OR REPLACE FUNCTION inbox_priority_int_to_text(p INTEGER)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN p IS NULL  THEN 'normal'
    WHEN p >= 85    THEN 'emergency'
    WHEN p >= 60    THEN 'high'
    WHEN p >= 35    THEN 'normal'
    ELSE                 'low'
  END;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION inbox_status_message_to_thread(s TEXT)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN s IN ('open', 'in_progress') THEN 'open'
    WHEN s = 'waiting'                THEN 'waiting_on_tenant'
    WHEN s = 'resolved'               THEN 'closed'
    ELSE                                   COALESCE(s, 'open')
  END;
$$ LANGUAGE SQL IMMUTABLE;

-- 3. Inbound trigger: a new tickets row creates / updates the thread.
--    Aggregates message_count and unread_count from the live tickets table
--    (excluding soft-deleted rows). Reopens a closed thread on new inbound.
CREATE OR REPLACE FUNCTION refresh_thread_from_message()
RETURNS TRIGGER AS $$
DECLARE
  v_count       INTEGER;
  v_unread      INTEGER;
  v_attach      BOOLEAN;
  v_first       TIMESTAMPTZ;
  v_last        TIMESTAMPTZ;
  v_last_in     TIMESTAMPTZ;
BEGIN
  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Recompute thread aggregates from the tickets table (cheap; thread_id is indexed).
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE is_read = FALSE),
    BOOL_OR(COALESCE(has_attachments, FALSE)),
    MIN(received_at),
    MAX(received_at),
    MAX(received_at) FILTER (WHERE direction = 'inbound')
  INTO v_count, v_unread, v_attach, v_first, v_last, v_last_in
  FROM tickets
  WHERE thread_id = NEW.thread_id
    AND deleted_at IS NULL;

  INSERT INTO threads (
    thread_id, subject, connection_id, category, priority,
    linked_property_name, linked_tenant_name, linked_owner_name,
    ai_summary,
    message_count, unread_count, has_attachments,
    first_message_at, last_message_at, last_inbound_at,
    starred, status
  ) VALUES (
    NEW.thread_id,
    NEW.subject,
    NEW.connection_id,
    NEW.category,
    inbox_priority_int_to_text(NEW.priority),
    NEW.linked_property_name,
    NEW.linked_tenant_name,
    NEW.linked_owner_name,
    NEW.ai_summary,
    COALESCE(v_count, 1),
    COALESCE(v_unread, CASE WHEN NEW.is_read THEN 0 ELSE 1 END),
    COALESCE(v_attach, COALESCE(NEW.has_attachments, FALSE)),
    COALESCE(v_first, NEW.received_at),
    COALESCE(v_last, NEW.received_at),
    COALESCE(v_last_in, NEW.received_at),
    COALESCE(NEW.is_starred, FALSE),
    inbox_status_message_to_thread(NEW.status)
  )
  ON CONFLICT (thread_id) DO UPDATE SET
    -- Subject/connection only set if currently NULL — preserve user edits.
    subject       = COALESCE(threads.subject, EXCLUDED.subject),
    connection_id = COALESCE(threads.connection_id, EXCLUDED.connection_id),
    -- Aggregates are authoritative from the recompute.
    message_count   = EXCLUDED.message_count,
    unread_count    = EXCLUDED.unread_count,
    has_attachments = EXCLUDED.has_attachments,
    first_message_at = LEAST(threads.first_message_at, EXCLUDED.first_message_at),
    last_message_at  = GREATEST(threads.last_message_at, EXCLUDED.last_message_at),
    last_inbound_at  = GREATEST(
      COALESCE(threads.last_inbound_at, EXCLUDED.last_inbound_at),
      EXCLUDED.last_inbound_at
    ),
    -- Pull through latest classifier output if the message has it; otherwise keep.
    linked_property_name = COALESCE(EXCLUDED.linked_property_name, threads.linked_property_name),
    linked_tenant_name   = COALESCE(EXCLUDED.linked_tenant_name,   threads.linked_tenant_name),
    linked_owner_name    = COALESCE(EXCLUDED.linked_owner_name,    threads.linked_owner_name),
    ai_summary           = COALESCE(EXCLUDED.ai_summary, threads.ai_summary),
    -- Auto-reopen closed threads when a new inbound message arrives.
    status = CASE
      WHEN TG_OP = 'INSERT' AND threads.status = 'closed' THEN 'open'
      ELSE threads.status
    END,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_thread ON tickets;
CREATE TRIGGER trg_refresh_thread
  AFTER INSERT OR UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION refresh_thread_from_message();

-- 4. Outbound trigger: a sent ticket_responses row bumps last_outbound_at /
--    last_message_at on its parent thread. Only fires when a row transitions
--    to send_status='sent' so failed/pending rows don't pollute timing.
CREATE OR REPLACE FUNCTION refresh_thread_from_response()
RETURNS TRIGGER AS $$
DECLARE
  v_thread_id TEXT;
  v_sent_at   TIMESTAMPTZ;
BEGIN
  IF NEW.response_type <> 'reply' THEN
    RETURN NEW;
  END IF;
  IF NEW.send_status IS DISTINCT FROM 'sent' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.send_status = 'sent' AND OLD.graph_id = NEW.graph_id THEN
    -- Already accounted for; avoid double-bumping.
    RETURN NEW;
  END IF;
  SELECT thread_id INTO v_thread_id FROM tickets WHERE id = NEW.ticket_id;
  IF v_thread_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_sent_at := COALESCE(NEW.sent_at, NOW());
  UPDATE threads SET
    last_outbound_at = GREATEST(COALESCE(last_outbound_at, v_sent_at), v_sent_at),
    last_message_at  = GREATEST(last_message_at, v_sent_at),
    updated_at       = NOW()
  WHERE thread_id = v_thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_thread_from_response ON ticket_responses;
CREATE TRIGGER trg_refresh_thread_from_response
  AFTER INSERT OR UPDATE ON ticket_responses
  FOR EACH ROW EXECUTE FUNCTION refresh_thread_from_response();

-- 5. Backfill from existing tickets. Idempotent (ON CONFLICT DO NOTHING) so
--    re-running is safe; the triggers keep things current after that.
INSERT INTO threads (
  thread_id, subject, connection_id, category, priority,
  linked_property_name, linked_tenant_name, linked_owner_name, ai_summary,
  message_count, unread_count, has_attachments,
  first_message_at, last_message_at, last_inbound_at,
  starred, status, assignee_id
)
SELECT
  t.thread_id,
  -- Pick the seed message's subject deterministically (oldest receipt).
  (SELECT subject FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
     ORDER BY received_at ASC NULLS LAST, id ASC LIMIT 1),
  -- Seed connection from the most recent inbound message in the thread.
  (SELECT connection_id FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
     ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1),
  -- Latest non-null category.
  (SELECT category FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
     AND category IS NOT NULL ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1),
  inbox_priority_int_to_text(MAX(t.priority)),
  (SELECT linked_property_name FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
     AND linked_property_name IS NOT NULL ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1),
  (SELECT linked_tenant_name FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
     AND linked_tenant_name IS NOT NULL ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1),
  (SELECT linked_owner_name FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
     AND linked_owner_name IS NOT NULL ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1),
  (SELECT ai_summary FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
     AND ai_summary IS NOT NULL ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1),
  COUNT(*),
  COUNT(*) FILTER (WHERE t.is_read = FALSE),
  BOOL_OR(COALESCE(t.has_attachments, FALSE)),
  MIN(t.received_at),
  MAX(t.received_at),
  MAX(t.received_at),
  BOOL_OR(COALESCE(t.is_starred, FALSE)),
  inbox_status_message_to_thread(
    (SELECT status FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
       ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1)
  ),
  (SELECT assigned_to FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
     AND assigned_to IS NOT NULL ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1)
FROM tickets t
WHERE t.thread_id IS NOT NULL AND t.deleted_at IS NULL
GROUP BY t.thread_id
ON CONFLICT (thread_id) DO NOTHING;

-- After the backfill, walk ticket_responses once to set last_outbound_at on
-- threads that already had outbound replies in the legacy table. Idempotent.
UPDATE threads th
SET last_outbound_at = GREATEST(
      COALESCE(th.last_outbound_at, sub.max_sent),
      sub.max_sent
    ),
    last_message_at = GREATEST(th.last_message_at, sub.max_sent),
    updated_at = NOW()
FROM (
  SELECT t.thread_id, MAX(COALESCE(tr.sent_at, tr.created_at)) AS max_sent
  FROM ticket_responses tr
  JOIN tickets t ON t.id = tr.ticket_id
  WHERE tr.response_type = 'reply'
    AND COALESCE(tr.send_status, 'sent') = 'sent'
    AND t.thread_id IS NOT NULL
  GROUP BY t.thread_id
) AS sub
WHERE th.thread_id = sub.thread_id
  AND (th.last_outbound_at IS NULL OR th.last_outbound_at < sub.max_sent);
