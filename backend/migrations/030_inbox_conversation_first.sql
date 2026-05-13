-- Phase 1 (D0-aligned): conversation-first refactor.
--
-- Extends the threads table for the new conversation UI:
--   * channel               — email | sms | whatsapp | voicemail | webchat
--   * participant_count     — distinct sender count (for "X people" badge)
--   * mentions_users        — user ids @-mentioned anywhere in the thread
--   * tags                  — TEXT[] used to render the conversation pills,
--                             including the legacy waiting_on_* statuses
--
-- Also normalizes status to the D0 vocabulary: open | snoozed | closed.
-- Threads previously sitting in waiting_on_{tenant,owner,vendor} get
-- migrated to status=open with a matching `waiting:tenant` / `waiting:owner`
-- / `waiting:vendor` tag so no information is lost.
--
-- Idempotent. Mirrored at runtime by migrateInboxConversationFirst() in
-- backend/lib/db.js.

ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS channel           TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS participant_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS mentions_users    INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN IF NOT EXISTS tags              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_threads_channel ON threads(channel);
CREATE INDEX IF NOT EXISTS idx_threads_tags ON threads USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_threads_mentions ON threads USING GIN (mentions_users);

-- Backfill participant_count from the message table on first run.
UPDATE threads th
SET participant_count = GREATEST(1, COALESCE((
      SELECT COUNT(DISTINCT COALESCE(LOWER(sender_email), sender_name))
        FROM tickets
       WHERE thread_id = th.thread_id AND deleted_at IS NULL
    ), 1))
WHERE participant_count = 1;

-- Translate the existing waiting_on_* statuses into tags + status=open.
-- Uses array_append idempotently so re-running adds at most one matching tag.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT thread_id, status FROM threads
     WHERE status IN ('waiting_on_tenant', 'waiting_on_owner', 'waiting_on_vendor')
  LOOP
    UPDATE threads
       SET status = 'open',
           tags = CASE
             WHEN rec.status = 'waiting_on_tenant' AND NOT ('waiting:tenant' = ANY(tags))
               THEN array_append(tags, 'waiting:tenant')
             WHEN rec.status = 'waiting_on_owner' AND NOT ('waiting:owner' = ANY(tags))
               THEN array_append(tags, 'waiting:owner')
             WHEN rec.status = 'waiting_on_vendor' AND NOT ('waiting:vendor' = ANY(tags))
               THEN array_append(tags, 'waiting:vendor')
             ELSE tags
           END,
           updated_at = NOW()
     WHERE thread_id = rec.thread_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Update the per-message refresh trigger to keep participant_count current
-- alongside the existing aggregates. Channel and tags are left to explicit
-- mutations (the API + future ingest classifier).
CREATE OR REPLACE FUNCTION refresh_thread_from_message()
RETURNS TRIGGER AS $$
DECLARE
  v_count        INTEGER;
  v_unread       INTEGER;
  v_attach       BOOLEAN;
  v_first        TIMESTAMPTZ;
  v_last         TIMESTAMPTZ;
  v_last_in      TIMESTAMPTZ;
  v_participants INTEGER;
BEGIN
  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE is_read = FALSE),
    BOOL_OR(COALESCE(has_attachments, FALSE)),
    MIN(received_at),
    MAX(received_at),
    MAX(received_at) FILTER (WHERE direction = 'inbound'),
    GREATEST(1, COUNT(DISTINCT COALESCE(LOWER(sender_email), sender_name)))
  INTO v_count, v_unread, v_attach, v_first, v_last, v_last_in, v_participants
  FROM tickets
  WHERE thread_id = NEW.thread_id
    AND deleted_at IS NULL;

  INSERT INTO threads (
    thread_id, subject, connection_id, category, priority,
    linked_property_name, linked_tenant_name, linked_owner_name,
    ai_summary,
    message_count, unread_count, has_attachments,
    participant_count,
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
    COALESCE(v_participants, 1),
    COALESCE(v_first, NEW.received_at),
    COALESCE(v_last, NEW.received_at),
    COALESCE(v_last_in, NEW.received_at),
    COALESCE(NEW.is_starred, FALSE),
    -- D0-aligned: collapse legacy waiting_on_* into open.
    CASE
      WHEN inbox_status_message_to_thread(NEW.status) IN ('waiting_on_tenant', 'waiting_on_owner', 'waiting_on_vendor')
        THEN 'open'
      ELSE inbox_status_message_to_thread(NEW.status)
    END
  )
  ON CONFLICT (thread_id) DO UPDATE SET
    subject       = COALESCE(threads.subject, EXCLUDED.subject),
    connection_id = COALESCE(threads.connection_id, EXCLUDED.connection_id),
    message_count   = EXCLUDED.message_count,
    unread_count    = EXCLUDED.unread_count,
    has_attachments = EXCLUDED.has_attachments,
    participant_count = EXCLUDED.participant_count,
    first_message_at = LEAST(threads.first_message_at, EXCLUDED.first_message_at),
    last_message_at  = GREATEST(threads.last_message_at, EXCLUDED.last_message_at),
    last_inbound_at  = GREATEST(
      COALESCE(threads.last_inbound_at, EXCLUDED.last_inbound_at),
      EXCLUDED.last_inbound_at
    ),
    linked_property_name = COALESCE(EXCLUDED.linked_property_name, threads.linked_property_name),
    linked_tenant_name   = COALESCE(EXCLUDED.linked_tenant_name,   threads.linked_tenant_name),
    linked_owner_name    = COALESCE(EXCLUDED.linked_owner_name,    threads.linked_owner_name),
    ai_summary           = COALESCE(EXCLUDED.ai_summary, threads.ai_summary),
    -- Auto-reopen closed or snoozed threads on new inbound.
    status = CASE
      WHEN TG_OP = 'INSERT' AND threads.status IN ('closed', 'snoozed') THEN 'open'
      ELSE threads.status
    END,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
