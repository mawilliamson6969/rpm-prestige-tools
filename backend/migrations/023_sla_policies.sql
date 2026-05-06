-- Phase 3: SLA policies. Replaces the single 24-hour rule with a policy
-- table and a per-thread sla_due_at / sla_paused bookkeeping pair.
--
-- Idempotent. Also applied at runtime by ensureSlaPoliciesSchema().

-- 1. Policy table.
CREATE TABLE IF NOT EXISTS sla_policies (
  id                      SERIAL PRIMARY KEY,
  name                    TEXT NOT NULL,
  match_category          TEXT,
  match_mailbox           TEXT,
  match_priority          TEXT,
  first_response_minutes  INTEGER NOT NULL,
  resolution_minutes      INTEGER,
  pause_on_statuses       TEXT[] NOT NULL DEFAULT
    ARRAY['waiting_on_tenant','waiting_on_owner','waiting_on_vendor','snoozed'],
  business_hours_only     BOOLEAN NOT NULL DEFAULT FALSE,
  active                  BOOLEAN NOT NULL DEFAULT TRUE,
  priority_rank           INTEGER NOT NULL DEFAULT 100,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_policies_active_rank
  ON sla_policies(active, priority_rank) WHERE active = TRUE;

-- Lets the seed insert stay idempotent. Two seeds shouldn't share a name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_policies_name ON sla_policies(name);

-- 2. Bookkeeping columns on threads. The Phase 1 schema already has
--    sla_policy_id / sla_due_at / sla_paused; we add the pause accumulator.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS sla_paused_at        TIMESTAMPTZ;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS sla_paused_total_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS sla_breached_at      TIMESTAMPTZ;

-- threads.sla_policy_id was Phase-1 declared as INTEGER without a FK; add
-- the FK now that sla_policies exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'threads_sla_policy_id_fkey'
  ) THEN
    ALTER TABLE threads
      ADD CONSTRAINT threads_sla_policy_id_fkey
      FOREIGN KEY (sla_policy_id) REFERENCES sla_policies(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_threads_sla_breached
  ON threads(sla_due_at) WHERE sla_paused = FALSE AND status <> 'closed';

-- 3. Business-hours helper. Adds N business minutes to a start timestamp,
--    where business hours are Mon-Fri 08:00–18:00 America/Chicago.
CREATE OR REPLACE FUNCTION add_business_minutes(start_ts TIMESTAMPTZ, mins INTEGER)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  cur               TIMESTAMPTZ := start_ts;
  remaining         INTEGER := GREATEST(mins, 0);
  local_day         DATE;
  local_clock       TIME;
  business_start    TIMESTAMPTZ;
  business_end      TIMESTAMPTZ;
  available_minutes INTEGER;
  dow               INTEGER;
BEGIN
  IF mins IS NULL OR mins <= 0 THEN
    RETURN start_ts;
  END IF;

  WHILE remaining > 0 LOOP
    local_day := (cur AT TIME ZONE 'America/Chicago')::date;
    dow       := EXTRACT(DOW FROM (cur AT TIME ZONE 'America/Chicago'));
    business_start := (local_day::timestamp + interval '8 hours')  AT TIME ZONE 'America/Chicago';
    business_end   := (local_day::timestamp + interval '18 hours') AT TIME ZONE 'America/Chicago';

    -- Weekend: jump to Monday morning.
    IF dow = 0 OR dow = 6 THEN
      cur := ((local_day + 1)::timestamp + interval '8 hours') AT TIME ZONE 'America/Chicago';
      CONTINUE;
    END IF;

    -- Before 8am local: jump to 8am.
    IF cur < business_start THEN
      cur := business_start;
      CONTINUE;
    END IF;

    -- After 6pm local: jump to next day 8am.
    IF cur >= business_end THEN
      cur := ((local_day + 1)::timestamp + interval '8 hours') AT TIME ZONE 'America/Chicago';
      CONTINUE;
    END IF;

    available_minutes := FLOOR(EXTRACT(EPOCH FROM (business_end - cur)) / 60)::INTEGER;
    IF remaining <= available_minutes THEN
      cur := cur + (remaining || ' minutes')::interval;
      remaining := 0;
    ELSE
      remaining := remaining - available_minutes;
      cur := ((local_day + 1)::timestamp + interval '8 hours') AT TIME ZONE 'America/Chicago';
    END IF;
  END LOOP;

  RETURN cur;
END;
$$ LANGUAGE plpgsql;

-- 4. Policy picker. Returns the lowest-priority_rank active policy whose
--    match_* columns all match (NULL = wildcard). Falls back to NULL if
--    no policy applies (no default seeded).
CREATE OR REPLACE FUNCTION pick_sla_policy(
  p_category TEXT,
  p_priority TEXT,
  p_mailbox  TEXT
) RETURNS INTEGER AS $$
  SELECT id FROM sla_policies
   WHERE active = TRUE
     AND (match_category IS NULL OR match_category = p_category)
     AND (match_priority IS NULL OR match_priority = p_priority)
     AND (match_mailbox  IS NULL OR match_mailbox  = p_mailbox)
   ORDER BY priority_rank ASC, id ASC
   LIMIT 1
$$ LANGUAGE SQL STABLE;

-- 5. Seed policies. Idempotent on name (uq_sla_policies_name).
INSERT INTO sla_policies (name, match_category, match_priority, first_response_minutes, business_hours_only, priority_rank) VALUES
  ('Emergency maintenance',  'maintenance', 'emergency', 60,        FALSE, 10),
  ('Owner complaint',        'owner',       'high',      120,       FALSE, 20),
  ('Standard maintenance',   'maintenance', NULL,        240,       FALSE, 30),
  ('Leasing inquiry',        'leasing',     NULL,        120,       FALSE, 30),
  ('Owner accounting',       'accounting',  NULL,        600,       TRUE,  40),
  ('Tenant general',         'tenant',      NULL,        600,       TRUE,  50),
  ('Default',                NULL,          NULL,        1440,      FALSE, 100)
ON CONFLICT (name) DO NOTHING;

-- 6. SLA bookkeeping trigger. BEFORE INSERT/UPDATE on threads.
--    - On INSERT: pick policy and compute sla_due_at from first_message_at.
--    - On UPDATE of category/priority/connection_id (no first response yet):
--      repick policy and recompute sla_due_at from first_message_at, plus
--      any accumulated paused minutes.
--    - On status change in/out of a pause status: stamp sla_paused_at,
--      accumulate paused minutes, advance sla_due_at on resume.
CREATE OR REPLACE FUNCTION recompute_thread_sla()
RETURNS TRIGGER AS $$
DECLARE
  v_mailbox TEXT;
  v_policy  sla_policies%ROWTYPE;
  v_paused_set TEXT[];
  v_was_pause BOOLEAN;
  v_now_pause BOOLEAN;
  v_paused_minutes INTEGER;
BEGIN
  -- Resolve a stable mailbox label for matching (mailbox_email of the
  -- connection, lowercased). NULL is fine — policy match treats it as
  -- "any".
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
    NEW.sla_paused := FALSE;
    NEW.sla_paused_total_minutes := 0;
    RETURN NEW;
  END IF;

  -- UPDATE path.
  -- 5.a. Repick policy when category/priority/connection_id changes AND no
  --      first response has been sent yet (so we don't move goalposts after
  --      the SLA was already met).
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

  -- 5.b. Pause / resume on status transition. Pause set comes from the
  --      active policy if any, else the default.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.sla_policy_id IS NOT NULL THEN
      SELECT pause_on_statuses INTO v_paused_set FROM sla_policies WHERE id = NEW.sla_policy_id;
    END IF;
    IF v_paused_set IS NULL THEN
      v_paused_set := ARRAY['waiting_on_tenant','waiting_on_owner','waiting_on_vendor','snoozed'];
    END IF;
    v_was_pause := OLD.status = ANY(v_paused_set);
    v_now_pause := NEW.status = ANY(v_paused_set);

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

  -- 5.c. Stamp first breach moment so we can spot newly-breached threads.
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

DROP TRIGGER IF EXISTS trg_thread_sla ON threads;
CREATE TRIGGER trg_thread_sla
  BEFORE INSERT OR UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION recompute_thread_sla();

-- 7. Add the "SLA breached" shared saved view. Idempotent on (name) via
--    the partial unique index from Phase 2.
INSERT INTO saved_views (name, icon, owner_id, is_shared, filters, sort, position) VALUES
  ('SLA breached', '⏰', NULL, TRUE,
    '{"sla_breached":true}'::jsonb,
    '{"sort":"priority"}'::jsonb, 7)
ON CONFLICT DO NOTHING;

-- 8. One-time backfill: assign a policy + sla_due_at to every existing
--    thread that doesn't have one. Idempotent — only acts on rows where
--    sla_policy_id IS NULL OR sla_due_at IS NULL.
UPDATE threads th
   SET sla_policy_id = COALESCE(th.sla_policy_id, pick_sla_policy(th.category, th.priority, lower(ec.mailbox_email))),
       sla_due_at = CASE
         WHEN th.sla_due_at IS NOT NULL THEN th.sla_due_at
         WHEN p.business_hours_only THEN add_business_minutes(th.first_message_at, p.first_response_minutes)
         ELSE th.first_message_at + (p.first_response_minutes || ' minutes')::interval
       END,
       updated_at = NOW()
  FROM (
    SELECT t.thread_id,
           COALESCE(t.sla_policy_id, pick_sla_policy(t.category, t.priority,
             lower((SELECT ec.mailbox_email FROM email_connections ec WHERE ec.id = t.connection_id))
           )) AS pid
      FROM threads t
     WHERE t.sla_policy_id IS NULL OR t.sla_due_at IS NULL
  ) AS sub
  LEFT JOIN sla_policies p ON p.id = sub.pid
  LEFT JOIN email_connections ec ON ec.id = th.connection_id
 WHERE th.thread_id = sub.thread_id;
