-- Phase A: analytics columns.
--
-- Adds two timestamps that the analytics page needs and the live `threads`
-- aggregates didn't track:
--
--   * first_outbound_at — first reply on the thread (any direction='outbound'
--     ticket_response in send_status='sent'). Used for "median first reply"
--     and SLA hit-rate.
--   * closed_at         — the moment status flipped to 'closed'. Used for
--     "median resolution" and any window-scoped "closed in window" query.
--
-- Backfills both from existing data, then teaches the response trigger to
-- stamp first_outbound_at on the first sent reply, plus a small new trigger
-- to stamp/clear closed_at on status transitions. Idempotent. Mirrored at
-- runtime in migrateInboxAnalyticsColumns().

ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS first_outbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_threads_closed_at
  ON threads(closed_at) WHERE status = 'closed';
CREATE INDEX IF NOT EXISTS idx_threads_first_message_at
  ON threads(first_message_at);

-- 1. Backfill first_outbound_at from ticket_responses. Only sets when the
--    column is currently NULL so re-running is a no-op.
UPDATE threads th
   SET first_outbound_at = sub.first_sent,
       updated_at        = NOW()
  FROM (
    SELECT t.thread_id,
           MIN(COALESCE(tr.sent_at, tr.created_at)) AS first_sent
      FROM ticket_responses tr
      JOIN tickets t ON t.id = tr.ticket_id
     WHERE tr.response_type = 'reply'
       AND COALESCE(tr.send_status, 'sent') = 'sent'
       AND t.thread_id IS NOT NULL
     GROUP BY t.thread_id
  ) AS sub
 WHERE th.thread_id = sub.thread_id
   AND th.first_outbound_at IS NULL;

-- 2. Backfill closed_at for already-closed threads. We don't have a precise
--    history; the best approximation we have is the last touch — that's
--    when the status was set. Idempotent.
UPDATE threads
   SET closed_at = COALESCE(last_touched_at, updated_at),
       updated_at = NOW()
 WHERE status = 'closed' AND closed_at IS NULL;

-- 3. Trigger: keep closed_at in sync with status. Fires alongside the SLA
--    trigger; both are BEFORE UPDATE, no ordering dependency between them.
CREATE OR REPLACE FUNCTION recompute_thread_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'closed' THEN
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
      NEW.closed_at := NOW();
    ELSIF NEW.status <> 'closed' AND OLD.status = 'closed' THEN
      NEW.closed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_thread_closed_at ON threads;
CREATE TRIGGER trg_thread_closed_at
  BEFORE INSERT OR UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION recompute_thread_closed_at();

-- 4. Extend refresh_thread_from_response to stamp first_outbound_at the
--    first time a reply succeeds. The existing function already touches
--    last_outbound_at; we just COALESCE the first-stamp in.
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
    RETURN NEW;
  END IF;
  SELECT thread_id INTO v_thread_id FROM tickets WHERE id = NEW.ticket_id;
  IF v_thread_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_sent_at := COALESCE(NEW.sent_at, NOW());
  UPDATE threads SET
    last_outbound_at  = GREATEST(COALESCE(last_outbound_at, v_sent_at), v_sent_at),
    last_message_at   = GREATEST(last_message_at, v_sent_at),
    first_outbound_at = COALESCE(first_outbound_at, v_sent_at),
    updated_at        = NOW()
  WHERE thread_id = v_thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
