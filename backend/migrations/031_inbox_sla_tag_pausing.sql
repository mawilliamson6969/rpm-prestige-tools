-- Phase 3 (post-D0): SLA pausing on waiting:* tags.
--
-- Phase 1 collapsed the legacy waiting_on_{tenant,owner,vendor} statuses
-- into status=open + a matching waiting:tenant / waiting:owner /
-- waiting:vendor tag. The SLA trigger (migration 023) only listens to
-- `status` changes, so once Phase 1 ran, threads previously paused for
-- "waiting on tenant" got their clocks resumed — wrong.
--
-- This migration teaches the trigger to treat tag changes the same way:
--
--   is_paused = status='snoozed' OR any tag matches waiting:*
--
-- and sweeps existing rows to re-pause threads carrying a waiting:* tag.
-- Idempotent. Mirrored at runtime in migrateInboxSlaTagPausing().

-- 1. Trigger rewrite. Detect "paused now" / "was paused" using a
--    combined status + tag predicate. The pause set is still honored
--    per-policy, but we fold the waiting:* tag check in regardless of
--    what the policy says — pausing while explicitly tagged "waiting on
--    X" is a hard rule of the design.
CREATE OR REPLACE FUNCTION recompute_thread_sla()
RETURNS TRIGGER AS $$
DECLARE
  v_mailbox TEXT;
  v_policy  sla_policies%ROWTYPE;
  v_paused_set TEXT[];
  v_was_pause BOOLEAN;
  v_now_pause BOOLEAN;
  v_paused_minutes INTEGER;
  v_had_waiting_tag BOOLEAN;
  v_has_waiting_tag BOOLEAN;
BEGIN
  IF NEW.connection_id IS NOT NULL THEN
    SELECT lower(coalesce(mailbox_email, email_address)) INTO v_mailbox
      FROM email_connections WHERE id = NEW.connection_id;
  ELSE
    v_mailbox := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.sla_policy_id := pick_sla_policy(NEW.category, NEW.priority, v_mailbox);
    IF NEW.sla_policy_id IS NOT NULL THEN
      SELECT * INTO v_policy FROM sla_policies WHERE id = NEW.sla_policy_id;
      IF v_policy.business_hours_only THEN
        NEW.sla_due_at := add_business_minutes(NEW.first_message_at, v_policy.first_response_minutes);
      ELSE
        NEW.sla_due_at := NEW.first_message_at + (v_policy.first_response_minutes || ' minutes')::interval;
      END IF;
    END IF;
    -- Start paused if the inserted thread is already in a paused state
    -- (e.g. backfill paths that hand us a fully-formed row).
    v_has_waiting_tag := EXISTS (
      SELECT 1 FROM unnest(COALESCE(NEW.tags, ARRAY[]::TEXT[])) AS t WHERE t LIKE 'waiting:%'
    );
    IF NEW.status = 'snoozed' OR v_has_waiting_tag THEN
      NEW.sla_paused := TRUE;
      NEW.sla_paused_at := NOW();
    ELSE
      NEW.sla_paused := FALSE;
    END IF;
    NEW.sla_paused_total_minutes := 0;
    RETURN NEW;
  END IF;

  -- UPDATE path.
  IF (NEW.category    IS DISTINCT FROM OLD.category
   OR NEW.priority    IS DISTINCT FROM OLD.priority
   OR NEW.connection_id IS DISTINCT FROM OLD.connection_id)
     AND NEW.last_outbound_at IS NULL
  THEN
    NEW.sla_policy_id := pick_sla_policy(NEW.category, NEW.priority, v_mailbox);
    IF NEW.sla_policy_id IS NOT NULL THEN
      SELECT * INTO v_policy FROM sla_policies WHERE id = NEW.sla_policy_id;
      IF v_policy.business_hours_only THEN
        NEW.sla_due_at := add_business_minutes(NEW.first_message_at, v_policy.first_response_minutes)
          + (COALESCE(NEW.sla_paused_total_minutes, 0) || ' minutes')::interval;
      ELSE
        NEW.sla_due_at := NEW.first_message_at
          + (v_policy.first_response_minutes || ' minutes')::interval
          + (COALESCE(NEW.sla_paused_total_minutes, 0) || ' minutes')::interval;
      END IF;
    END IF;
  END IF;

  -- Pause / resume — react to status OR tag changes.
  v_had_waiting_tag := EXISTS (
    SELECT 1 FROM unnest(COALESCE(OLD.tags, ARRAY[]::TEXT[])) AS t WHERE t LIKE 'waiting:%'
  );
  v_has_waiting_tag := EXISTS (
    SELECT 1 FROM unnest(COALESCE(NEW.tags, ARRAY[]::TEXT[])) AS t WHERE t LIKE 'waiting:%'
  );

  IF (NEW.status IS DISTINCT FROM OLD.status)
     OR (v_had_waiting_tag IS DISTINCT FROM v_has_waiting_tag)
  THEN
    -- Policy-defined pause set still respected; the waiting:* check is
    -- folded in as an extra "any tag → paused" rule.
    IF NEW.sla_policy_id IS NOT NULL THEN
      SELECT pause_on_statuses INTO v_paused_set FROM sla_policies WHERE id = NEW.sla_policy_id;
    END IF;
    IF v_paused_set IS NULL THEN
      v_paused_set := ARRAY['snoozed'];
    END IF;

    v_was_pause := (OLD.status = ANY(v_paused_set)) OR v_had_waiting_tag;
    v_now_pause := (NEW.status = ANY(v_paused_set)) OR v_has_waiting_tag;

    IF v_now_pause AND NOT v_was_pause THEN
      NEW.sla_paused := TRUE;
      NEW.sla_paused_at := NOW();
    ELSIF v_was_pause AND NOT v_now_pause THEN
      v_paused_minutes := GREATEST(
        FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(OLD.sla_paused_at, NOW()))) / 60)::INTEGER,
        0
      );
      NEW.sla_paused := FALSE;
      NEW.sla_paused_at := NULL;
      NEW.sla_paused_total_minutes := COALESCE(OLD.sla_paused_total_minutes, 0) + v_paused_minutes;
      IF NEW.sla_due_at IS NOT NULL THEN
        NEW.sla_due_at := NEW.sla_due_at + (v_paused_minutes || ' minutes')::interval;
      END IF;
    END IF;
  END IF;

  -- First-breach stamp.
  IF NEW.sla_paused = FALSE
     AND NEW.sla_due_at IS NOT NULL
     AND NEW.sla_due_at < NOW()
     AND NEW.sla_breached_at IS NULL
  THEN
    NEW.sla_breached_at := NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. One-time correction: re-pause threads whose Phase-1 migration
--    resumed them when status flipped to 'open'. Any thread carrying a
--    waiting:* tag should be paused regardless of status. Skips rows
--    already paused so re-running is a no-op.
UPDATE threads
   SET sla_paused = TRUE,
       sla_paused_at = COALESCE(sla_paused_at, NOW()),
       updated_at = NOW()
 WHERE sla_paused = FALSE
   AND status <> 'closed'
   AND EXISTS (
     SELECT 1 FROM unnest(COALESCE(tags, ARRAY[]::TEXT[])) AS t WHERE t LIKE 'waiting:%'
   );

-- 3. Same correction for status='snoozed' rows whose pause flag was
--    lost in earlier reschuffles (defensive).
UPDATE threads
   SET sla_paused = TRUE,
       sla_paused_at = COALESCE(sla_paused_at, NOW()),
       updated_at = NOW()
 WHERE sla_paused = FALSE
   AND status = 'snoozed';

-- 4. Rename the legacy "SLA breached" saved view to "SLA at risk" and
--    broaden its filter to match the design's definition: open + not
--    paused + due within the next 2 hours OR already breached. The
--    sidebar's hardcoded "SLA at risk" item uses the same filter so this
--    keeps the two surfaces in sync.
UPDATE saved_views
   SET name = 'SLA at risk',
       filters = '{"sla_at_risk":true}'::jsonb,
       sort = '{"sort":"priority"}'::jsonb,
       updated_at = NOW()
 WHERE is_shared = TRUE
   AND name IN ('SLA breached', 'SLA at risk');
