import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return pool;
}

export async function ensureOwnerTerminationSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS owner_termination_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submitter_type VARCHAR(32) NOT NULL,
      staff_member_name TEXT,
      email VARCHAR(255) NOT NULL,
      owner_first_name VARCHAR(255) NOT NULL,
      owner_last_name VARCHAR(255) NOT NULL,
      street_address TEXT NOT NULL,
      street_address_2 TEXT,
      city VARCHAR(255) NOT NULL,
      state VARCHAR(64) NOT NULL,
      zip_code VARCHAR(32) NOT NULL,
      date_received_in_writing DATE NOT NULL,
      requested_termination_date DATE NOT NULL,
      termination_reason VARCHAR(128) NOT NULL,
      reason_details TEXT,
      retention_offer_accepted VARCHAR(16) NOT NULL,
      improvement_feedback TEXT,
      guarantees_acknowledged BOOLEAN,
      deposit_waiver_acknowledged BOOLEAN,
      deposit_return_acknowledged BOOLEAN,
      keys_balance_acknowledged BOOLEAN,
      signature_data TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function ensureAnnouncementsSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active BOOLEAN NOT NULL DEFAULT true
    );
  `);

  await p.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS attachment_url TEXT`);
  await p.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS attachment_label TEXT`);
  await p.query(
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'`
  );
  await p.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);

  const { rows } = await p.query(`SELECT COUNT(*)::int AS c FROM announcements`);
  if (rows[0].c === 0) {
    await p.query(
      `INSERT INTO announcements (title, content, is_active) VALUES
       ($1, $2, true),
       ($3, $4, true),
       ($5, $6, true)`,
      [
        "April 10, 2026",
        "Company intranet is live! All internal tools will be consolidated here.",
        "April 10, 2026",
        "Owner Termination form is now digital. Use the link in Our Tools.",
        "April 10, 2026",
        "KPI Dashboard is pulling live data from AppFolio.",
      ]
    );
  }
}

export async function ensureCachedDashboardSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS cached_units (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_properties (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_rent_roll (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_income_statement (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      period VARCHAR(16) NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_work_orders (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_delinquency (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_owners (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_guest_cards (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_rental_applications (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_lease_expirations (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_vendors (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_rentengine_leads (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_rentengine_units (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_boom_applications (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_boom_properties (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_boom_units (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_leadsimple_deals (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_leadsimple_contacts (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_leadsimple_pipelines (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_leadsimple_tasks (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_leadsimple_processes (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_leadsimple_properties (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cached_leadsimple_conversations (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      status VARCHAR(32) NOT NULL,
      endpoints_synced INTEGER NOT NULL DEFAULT 0,
      total_rows_synced INTEGER NOT NULL DEFAULT 0,
      errors JSONB,
      triggered_by VARCHAR(64) NOT NULL
    );
  `);
  await p.query(`ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'appfolio'`);
}

export async function ensureUsersSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      role TEXT NOT NULL,
      email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_html TEXT`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`);

  // Drop any leftover CHECK constraint on `role` from the legacy schema so we
  // can store the new role values (owner/admin/csm/maintenance/operations/staff).
  await p.query(`
    DO $$
    DECLARE
      constraint_name TEXT;
    BEGIN
      FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
      LOOP
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$;
  `);
  await p.query(`ALTER TABLE users ALTER COLUMN role TYPE TEXT`);

  // Migrate legacy roles for the seeded team. Idempotent — only triggers when
  // a row is still on the old value.
  await p.query(`UPDATE users SET role = 'owner'       WHERE LOWER(username) = 'mike'    AND role = 'admin'`);
  await p.query(`UPDATE users SET role = 'csm'         WHERE LOWER(username) = 'lori'    AND role IN ('admin', 'viewer')`);
  await p.query(`UPDATE users SET role = 'csm'         WHERE LOWER(username) = 'leslie'  AND role = 'viewer'`);
  await p.query(`UPDATE users SET role = 'maintenance' WHERE LOWER(username) = 'amanda'  AND role = 'viewer'`);
  await p.query(`UPDATE users SET role = 'operations'  WHERE LOWER(username) = 'amelia'  AND role = 'viewer'`);
  await p.query(`UPDATE users SET role = 'staff'       WHERE role = 'viewer'`);

  await p.query(`CREATE INDEX IF NOT EXISTS idx_users_active ON users(active) WHERE active = TRUE`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role        TEXT NOT NULL,
      permission  TEXT NOT NULL,
      PRIMARY KEY (role, permission)
    )
  `);

  await p.query(`
    INSERT INTO role_permissions (role, permission) VALUES
      ('owner',       'all'),
      ('admin',       'all'),
      ('csm',         'inbox.read'),
      ('csm',         'inbox.reply'),
      ('csm',         'inbox.assign'),
      ('csm',         'leasing.manage'),
      ('csm',         'reports.view'),
      ('maintenance', 'inbox.read'),
      ('maintenance', 'inbox.reply'),
      ('maintenance', 'workorders.manage'),
      ('operations',  'inbox.read'),
      ('operations',  'inbox.reply'),
      ('operations',  'process.manage'),
      ('staff',       'inbox.read')
    ON CONFLICT DO NOTHING
  `);

  await p.query(`
    CREATE OR REPLACE FUNCTION user_has_permission(p_user_id INTEGER, p_permission TEXT)
    RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM users u
        JOIN role_permissions rp ON rp.role = u.role
        WHERE u.id = p_user_id
          AND u.active = TRUE
          AND (rp.permission = p_permission OR rp.permission = 'all')
      );
    $$ LANGUAGE SQL STABLE
  `);

  const { rows } = await p.query(`SELECT COUNT(*)::int AS c FROM users`);
  if (rows[0].c > 0) return;

  const password_hash = await bcrypt.hash("RpmPrestige2026!", 12);
  const seeds = [
    ["mike", "Mike Williamson", "owner", "mike@rpmhouston.com"],
    ["lori", "Lori", "csm", "lori@rpmhouston.com"],
    ["leslie", "Leslie", "csm", "leslie@rpmhouston.com"],
    ["amanda", "Amanda", "maintenance", "amanda@rpmhouston.com"],
    ["amelia", "Amelia", "operations", "amelia@rpmhouston.com"],
  ];
  for (const [username, display_name, role, email] of seeds) {
    await p.query(
      `INSERT INTO users (username, password_hash, display_name, role, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [username, password_hash, display_name, role, email]
    );
  }
}

export async function ensureAskAiSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ask_ai_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      sql_query TEXT NOT NULL,
      answer TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      response_time_ms INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ask_ai_history_user_created_idx ON ask_ai_history (user_id, created_at DESC);
  `);
}

export async function ensureInboxSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS email_connections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_address VARCHAR(255),
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT true,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_sync_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, email_address)
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      channel VARCHAR(20) NOT NULL DEFAULT 'email',
      external_id VARCHAR(500),
      thread_id VARCHAR(500),
      subject VARCHAR(500),
      body_preview TEXT,
      body_html TEXT,
      sender_name VARCHAR(255),
      sender_email VARCHAR(255),
      recipient_emails TEXT,
      priority INTEGER NOT NULL DEFAULT 50,
      category VARCHAR(50) NOT NULL DEFAULT 'other',
      ai_summary TEXT,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      linked_property_name VARCHAR(255),
      linked_tenant_name VARCHAR(255),
      linked_owner_name VARCHAR(255),
      has_attachments BOOLEAN NOT NULL DEFAULT false,
      is_read BOOLEAN NOT NULL DEFAULT false,
      is_starred BOOLEAN NOT NULL DEFAULT false,
      received_at TIMESTAMPTZ,
      first_response_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS tickets_external_id_uq ON tickets (external_id);
    CREATE INDEX IF NOT EXISTS tickets_status_received_idx ON tickets (status, received_at DESC);
    CREATE INDEX IF NOT EXISTS tickets_assigned_idx ON tickets (assigned_to);

    CREATE TABLE IF NOT EXISTS ticket_responses (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      response_type VARCHAR(20) NOT NULL DEFAULT 'note',
      body TEXT,
      body_html TEXT,
      sent_via VARCHAR(20),
      responded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      external_id VARCHAR(500),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ticket_responses_ticket_idx ON ticket_responses (ticket_id);

    CREATE TABLE IF NOT EXISTS ticket_ai_drafts (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      draft_text TEXT NOT NULL,
      context_used JSONB,
      drafted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ,
      UNIQUE (ticket_id)
    );
    CREATE INDEX IF NOT EXISTS ticket_ai_drafts_used_idx ON ticket_ai_drafts (ticket_id) WHERE used_at IS NULL;

    CREATE TABLE IF NOT EXISTS email_signatures (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      signature_html TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS email_signatures_user_idx ON email_signatures (user_id);

    CREATE TABLE IF NOT EXISTS email_sync_state (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_sync_at TIMESTAMPTZ,
      last_message_received_at TIMESTAMPTZ,
      sync_status VARCHAR(20) NOT NULL DEFAULT 'idle',
      messages_synced INTEGER NOT NULL DEFAULT 0,
      error_log TEXT,
      UNIQUE (user_id)
    );
  `);

  await migrateInboxMultiMailbox(p);

  await migrateInboxDeltaSync(p);

  await migrateThreadsFirst(p);

  await migrateInboxConversationFirst(p);

  await migrateSavedViews(p);

  await migrateSlaPolicies(p);

  await migrateInboxSlaTagPausing(p);

  await migrateAutomationRules(p);

  await migrateInboxAttachments(p);

  await seedEmailSignatures(p);
}

/** Phase 5: inbox attachments. Idempotent. */
async function migrateInboxAttachments(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id              SERIAL PRIMARY KEY,
      message_id      INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      thread_id       TEXT REFERENCES threads(thread_id) ON DELETE CASCADE,
      filename        TEXT NOT NULL,
      content_type    TEXT,
      size_bytes      BIGINT,
      storage_path    TEXT,
      storage_kind    TEXT NOT NULL DEFAULT 'disk',
      graph_id        TEXT,
      direction       TEXT NOT NULL,
      is_inline       BOOLEAN NOT NULL DEFAULT FALSE,
      fetched_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (direction IN ('inbound', 'outbound')),
      CHECK (storage_kind IN ('disk', 's3'))
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_attachments_thread  ON attachments(thread_id)`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_attachments_pending
       ON attachments(message_id) WHERE storage_path IS NULL AND direction = 'inbound'`
  );
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_attachments_graph_per_message
       ON attachments(message_id, graph_id) WHERE graph_id IS NOT NULL`
  );
}

/**
 * Phase 4: workflow automation rules. Idempotent — uses ON CONFLICT for the
 * seed inserts. Every seed ships in `shadow` mode; flipping to suggested or
 * auto is an admin action after at least 2 weeks of shadow review.
 */
async function migrateAutomationRules(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS automation_rules (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT,
      trigger         TEXT NOT NULL,
      conditions      JSONB NOT NULL DEFAULT '{}'::jsonb,
      action          TEXT NOT NULL,
      action_params   JSONB NOT NULL DEFAULT '{}'::jsonb,
      confidence_min  NUMERIC(3,2) NOT NULL DEFAULT 0.90,
      mode            TEXT NOT NULL DEFAULT 'shadow',
      active          BOOLEAN NOT NULL DEFAULT TRUE,
      priority_rank   INTEGER NOT NULL DEFAULT 100,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (mode IN ('shadow', 'suggested', 'auto')),
      CHECK (confidence_min >= 0 AND confidence_min <= 1)
    )
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_automation_rules_active_rank
       ON automation_rules(active, priority_rank) WHERE active = TRUE`
  );
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_rules_name ON automation_rules(name)`
  );

  await p.query(`
    CREATE TABLE IF NOT EXISTS automation_log (
      id              SERIAL PRIMARY KEY,
      rule_id         INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL,
      thread_id       TEXT REFERENCES threads(thread_id) ON DELETE CASCADE,
      trigger         TEXT NOT NULL,
      matched         BOOLEAN NOT NULL,
      proposed_action JSONB,
      revert_payload  JSONB,
      confidence      NUMERIC(3,2),
      mode            TEXT NOT NULL,
      executed        BOOLEAN NOT NULL DEFAULT FALSE,
      executed_at     TIMESTAMPTZ,
      reverted        BOOLEAN NOT NULL DEFAULT FALSE,
      reverted_at     TIMESTAMPTZ,
      reverted_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      skipped_reason  TEXT,
      feedback        TEXT,
      feedback_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      feedback_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (feedback IS NULL OR feedback IN ('good', 'wrong'))
    )
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_automation_log_thread ON automation_log(thread_id)`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_automation_log_executed_revertable
       ON automation_log(executed_at) WHERE executed = TRUE AND reverted = FALSE`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_automation_log_recent_shadow
       ON automation_log(rule_id, created_at DESC) WHERE mode = 'shadow' AND matched = TRUE`
  );
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_log_rule_thread_trigger
       ON automation_log(rule_id, thread_id, trigger)
       WHERE rule_id IS NOT NULL AND thread_id IS NOT NULL`
  );

  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2)`);

  await p.query(`
    INSERT INTO automation_rules
      (name, description, trigger, conditions, action, action_params,
       confidence_min, mode, priority_rank)
    VALUES
      ('Auto-route maintenance to Amanda',
       'Assign new maintenance threads to Amanda. Flip to auto after 2 weeks of shadow data.',
       'new_thread',
       '{"category":"maintenance"}'::jsonb,
       'assign',
       '{"assignee_username":"amanda"}'::jsonb,
       0.90, 'shadow', 10),
      ('Auto-route leasing to Lori',
       'Leasing threads default to Lori until Leslie comes online.',
       'new_thread',
       '{"category":"leasing"}'::jsonb,
       'assign',
       '{"assignee_username":"lori"}'::jsonb,
       0.90, 'shadow', 20),
      ('Escalate owner complaints',
       'Owner complaints with high priority get escalated to Lori.',
       'new_thread',
       '{"category":"owner","priority_in":["emergency","high"]}'::jsonb,
       'escalate',
       '{"assignee_username":"lori","priority":"high"}'::jsonb,
       0.85, 'shadow', 25),
      ('Escalate legal mentions',
       'Anything classified legal gets starred + assigned to Mike at high priority.',
       'new_thread',
       '{"category":"legal"}'::jsonb,
       'escalate',
       '{"assignee_username":"mike","priority":"high","star":true}'::jsonb,
       0.95, 'shadow', 5),
      ('Close marketing/no-reply',
       'Auto-close marketing newsletters and no-reply notifications.',
       'new_thread',
       '{"category":"marketing"}'::jsonb,
       'close',
       '{}'::jsonb,
       0.80, 'shadow', 60),
      ('Suggest work order for maintenance',
       'High-priority maintenance threads should get a work order created — suggested only, never auto.',
       'new_thread',
       '{"category":"maintenance","priority_in":["emergency","high"]}'::jsonb,
       'create_work_order',
       '{}'::jsonb,
       0.85, 'shadow', 50)
    ON CONFLICT (name) DO NOTHING
  `);
}

/**
 * Phase 3: SLA policies. Idempotent — uses ON CONFLICT for the seeded
 * policies and DO blocks for the FK constraint. The `recompute_thread_sla`
 * trigger fires BEFORE INSERT/UPDATE on threads so sla_due_at lands in the
 * row in a single write.
 */
async function migrateSlaPolicies(p) {
  await p.query(`
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
    )
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_sla_policies_active_rank
       ON sla_policies(active, priority_rank) WHERE active = TRUE`
  );
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_policies_name ON sla_policies(name)`
  );

  await p.query(`ALTER TABLE threads ADD COLUMN IF NOT EXISTS sla_paused_at TIMESTAMPTZ`);
  await p.query(
    `ALTER TABLE threads ADD COLUMN IF NOT EXISTS sla_paused_total_minutes INTEGER NOT NULL DEFAULT 0`
  );
  await p.query(`ALTER TABLE threads ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ`);

  await p.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'threads_sla_policy_id_fkey'
      ) THEN
        ALTER TABLE threads
          ADD CONSTRAINT threads_sla_policy_id_fkey
          FOREIGN KEY (sla_policy_id) REFERENCES sla_policies(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_threads_sla_breached
       ON threads(sla_due_at) WHERE sla_paused = FALSE AND status <> 'closed'`
  );

  await p.query(`
    CREATE OR REPLACE FUNCTION add_business_minutes(start_ts TIMESTAMPTZ, mins INTEGER)
    RETURNS TIMESTAMPTZ AS $$
    DECLARE
      cur               TIMESTAMPTZ := start_ts;
      remaining         INTEGER := GREATEST(mins, 0);
      local_day         DATE;
      business_start    TIMESTAMPTZ;
      business_end      TIMESTAMPTZ;
      available_minutes INTEGER;
      dow               INTEGER;
    BEGIN
      IF mins IS NULL OR mins <= 0 THEN RETURN start_ts; END IF;
      WHILE remaining > 0 LOOP
        local_day := (cur AT TIME ZONE 'America/Chicago')::date;
        dow       := EXTRACT(DOW FROM (cur AT TIME ZONE 'America/Chicago'));
        business_start := (local_day::timestamp + interval '8 hours')  AT TIME ZONE 'America/Chicago';
        business_end   := (local_day::timestamp + interval '18 hours') AT TIME ZONE 'America/Chicago';
        IF dow = 0 OR dow = 6 THEN
          cur := ((local_day + 1)::timestamp + interval '8 hours') AT TIME ZONE 'America/Chicago';
          CONTINUE;
        END IF;
        IF cur < business_start THEN cur := business_start; CONTINUE; END IF;
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
    $$ LANGUAGE plpgsql
  `);

  await p.query(`
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
    $$ LANGUAGE SQL STABLE
  `);

  await p.query(`
    INSERT INTO sla_policies (name, match_category, match_priority, first_response_minutes, business_hours_only, priority_rank) VALUES
      ('Emergency maintenance',  'maintenance', 'emergency', 60,   FALSE, 10),
      ('Owner complaint',        'owner',       'high',      120,  FALSE, 20),
      ('Standard maintenance',   'maintenance', NULL,        240,  FALSE, 30),
      ('Leasing inquiry',        'leasing',     NULL,        120,  FALSE, 30),
      ('Owner accounting',       'accounting',  NULL,        600,  TRUE,  40),
      ('Tenant general',         'tenant',      NULL,        600,  TRUE,  50),
      ('Default',                NULL,          NULL,        1440, FALSE, 100)
    ON CONFLICT (name) DO NOTHING
  `);

  await p.query(`
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

      IF NEW.sla_paused = FALSE
         AND NEW.sla_due_at IS NOT NULL
         AND NEW.sla_due_at < NOW()
         AND NEW.sla_breached_at IS NULL
      THEN
        NEW.sla_breached_at := NOW();
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await p.query(`DROP TRIGGER IF EXISTS trg_thread_sla ON threads`);
  await p.query(`
    CREATE TRIGGER trg_thread_sla
      BEFORE INSERT OR UPDATE ON threads
      FOR EACH ROW EXECUTE FUNCTION recompute_thread_sla()
  `);

  // One-time backfill: assign a policy + sla_due_at to every thread that
  // doesn't have one. Idempotent.
  await p.query(`
    UPDATE threads th
       SET sla_policy_id = COALESCE(th.sla_policy_id, pick_sla_policy(
             th.category,
             th.priority,
             lower((SELECT mailbox_email FROM email_connections ec WHERE ec.id = th.connection_id))
           )),
           sla_due_at = COALESCE(th.sla_due_at, CASE
             WHEN p.business_hours_only THEN add_business_minutes(th.first_message_at, p.first_response_minutes)
             WHEN p.id IS NOT NULL THEN th.first_message_at + (p.first_response_minutes || ' minutes')::interval
             ELSE NULL
           END),
           updated_at = NOW()
      FROM (
        SELECT t.thread_id,
               COALESCE(t.sla_policy_id, pick_sla_policy(
                 t.category,
                 t.priority,
                 lower((SELECT mailbox_email FROM email_connections ec WHERE ec.id = t.connection_id))
               )) AS pid
          FROM threads t
         WHERE t.sla_policy_id IS NULL OR t.sla_due_at IS NULL
      ) sub
      LEFT JOIN sla_policies p ON p.id = sub.pid
     WHERE th.thread_id = sub.thread_id
  `);
}

/**
 * Phase 3 (post-D0): teach the SLA trigger to pause/resume on waiting:*
 * tag presence, not just on status changes. Phase 1 collapsed the
 * legacy waiting_on_{tenant,owner,vendor} statuses into status=open
 * with a matching waiting:* tag, so the original trigger started
 * leaking — paused threads resumed when their status flipped to open.
 *
 * Idempotent. Mirrored in migrations/031_inbox_sla_tag_pausing.sql.
 */
async function migrateInboxSlaTagPausing(p) {
  await p.query(`
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

      v_had_waiting_tag := EXISTS (
        SELECT 1 FROM unnest(COALESCE(OLD.tags, ARRAY[]::TEXT[])) AS t WHERE t LIKE 'waiting:%'
      );
      v_has_waiting_tag := EXISTS (
        SELECT 1 FROM unnest(COALESCE(NEW.tags, ARRAY[]::TEXT[])) AS t WHERE t LIKE 'waiting:%'
      );

      IF (NEW.status IS DISTINCT FROM OLD.status)
         OR (v_had_waiting_tag IS DISTINCT FROM v_has_waiting_tag)
      THEN
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

      IF NEW.sla_paused = FALSE
         AND NEW.sla_due_at IS NOT NULL
         AND NEW.sla_due_at < NOW()
         AND NEW.sla_breached_at IS NULL
      THEN
        NEW.sla_breached_at := NOW();
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  // Trigger is already attached to threads from migrateSlaPolicies; the
  // CREATE OR REPLACE FUNCTION above is enough.

  // Re-pause any thread carrying a waiting:* tag whose pause flag got
  // lost in the Phase 1 status flip. Idempotent.
  await p.query(`
    UPDATE threads
       SET sla_paused = TRUE,
           sla_paused_at = COALESCE(sla_paused_at, NOW()),
           updated_at = NOW()
     WHERE sla_paused = FALSE
       AND status <> 'closed'
       AND EXISTS (
         SELECT 1 FROM unnest(COALESCE(tags, ARRAY[]::TEXT[])) AS t WHERE t LIKE 'waiting:%'
       )
  `);

  await p.query(`
    UPDATE threads
       SET sla_paused = TRUE,
           sla_paused_at = COALESCE(sla_paused_at, NOW()),
           updated_at = NOW()
     WHERE sla_paused = FALSE
       AND status = 'snoozed'
  `);

  // Reshape the seeded "SLA breached" saved view to match the design's
  // broader "SLA at risk" definition (sla_at_risk = open & not paused &
  // due within 2h or already breached). The shell sidebar's hardcoded
  // SLA-at-risk item uses the same filter on the API.
  await p.query(`
    UPDATE saved_views
       SET name = 'SLA at risk',
           filters = '{"sla_at_risk":true}'::jsonb,
           sort = '{"sort":"priority"}'::jsonb,
           updated_at = NOW()
     WHERE is_shared = TRUE
       AND name IN ('SLA breached', 'SLA at risk')
  `);
}

/**
 * Phase 2: saved views. Idempotent — relies on a partial unique index on
 * (name) WHERE is_shared = TRUE for the shared seed set.
 */
async function migrateSavedViews(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS saved_views (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      icon        TEXT,
      owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      is_shared   BOOLEAN NOT NULL DEFAULT FALSE,
      filters     JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort        JSONB,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_saved_views_owner ON saved_views(owner_id, position)`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_saved_views_shared ON saved_views(is_shared) WHERE is_shared = TRUE`
  );
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_views_shared_name
       ON saved_views(name) WHERE is_shared = TRUE`
  );

  await p.query(`
    INSERT INTO saved_views (name, icon, owner_id, is_shared, filters, sort, position) VALUES
      ('Overdue maintenance', '🔧', NULL, TRUE,
        '{"category":"maintenance","status":"open","sla_breached":true}'::jsonb,
        '{"sort":"priority"}'::jsonb, 0),
      ('Owner complaints', '⚠️', NULL, TRUE,
        '{"category":"owner","priority_in":["emergency","high"],"status":"open"}'::jsonb,
        '{"sort":"priority"}'::jsonb, 1),
      ('Waiting on tenant', '⌛', NULL, TRUE,
        '{"status":"waiting_on_tenant"}'::jsonb,
        '{"sort":"newest"}'::jsonb, 2),
      ('Waiting on owner', '⌛', NULL, TRUE,
        '{"status":"waiting_on_owner"}'::jsonb,
        '{"sort":"newest"}'::jsonb, 3),
      ('Unread threads', '✉️', NULL, TRUE,
        '{"has_unread":true,"bucket":"unread"}'::jsonb,
        '{"sort":"newest"}'::jsonb, 4),
      ('Starred', '⭐', NULL, TRUE,
        '{"starred":true}'::jsonb,
        '{"sort":"newest"}'::jsonb, 5),
      ('Unassigned', '👤', NULL, TRUE,
        '{"unassigned":true,"status":"open"}'::jsonb,
        '{"sort":"newest"}'::jsonb, 6),
      ('SLA breached', '⏰', NULL, TRUE,
        '{"sla_breached":true}'::jsonb,
        '{"sort":"priority"}'::jsonb, 7)
    ON CONFLICT DO NOTHING
  `);
}

/**
 * Phase 1: thread is the canonical entity.
 * Idempotent. Creates threads + triggers + helper functions and runs the
 * one-time backfill. Subsequent runs are cheap because the backfill INSERT
 * uses ON CONFLICT DO NOTHING.
 */
async function migrateThreadsFirst(p) {
  await p.query(
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'inbound'`
  );

  await p.query(`
    CREATE TABLE IF NOT EXISTS threads (
      thread_id              TEXT PRIMARY KEY,
      subject                TEXT,
      connection_id          INTEGER REFERENCES email_connections(id) ON DELETE SET NULL,
      status                 TEXT NOT NULL DEFAULT 'open',
      assignee_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
      category               TEXT,
      priority               TEXT NOT NULL DEFAULT 'normal',
      starred                BOOLEAN NOT NULL DEFAULT FALSE,
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
      sla_policy_id          INTEGER,
      sla_due_at             TIMESTAMPTZ,
      sla_paused             BOOLEAN NOT NULL DEFAULT FALSE,
      ai_summary             TEXT,
      ai_confidence          NUMERIC(3,2),
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_status_assignee ON threads(status, assignee_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_category_status ON threads(category, status)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_connection_last_message ON threads(connection_id, last_message_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_sla_due ON threads(sla_due_at) WHERE status = 'open'`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_starred ON threads(starred) WHERE starred = TRUE`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_unread ON threads(unread_count) WHERE unread_count > 0`);

  await p.query(`
    CREATE OR REPLACE FUNCTION inbox_priority_int_to_text(p INTEGER)
    RETURNS TEXT AS $$
      SELECT CASE
        WHEN p IS NULL  THEN 'normal'
        WHEN p >= 85    THEN 'emergency'
        WHEN p >= 60    THEN 'high'
        WHEN p >= 35    THEN 'normal'
        ELSE                 'low'
      END;
    $$ LANGUAGE SQL IMMUTABLE
  `);

  await p.query(`
    CREATE OR REPLACE FUNCTION inbox_status_message_to_thread(s TEXT)
    RETURNS TEXT AS $$
      SELECT CASE
        WHEN s IN ('open', 'in_progress') THEN 'open'
        WHEN s = 'waiting'                THEN 'waiting_on_tenant'
        WHEN s = 'resolved'               THEN 'closed'
        ELSE                                   COALESCE(s, 'open')
      END;
    $$ LANGUAGE SQL IMMUTABLE
  `);

  await p.query(`
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
        subject       = COALESCE(threads.subject, EXCLUDED.subject),
        connection_id = COALESCE(threads.connection_id, EXCLUDED.connection_id),
        message_count   = EXCLUDED.message_count,
        unread_count    = EXCLUDED.unread_count,
        has_attachments = EXCLUDED.has_attachments,
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
        status = CASE
          WHEN TG_OP = 'INSERT' AND threads.status = 'closed' THEN 'open'
          ELSE threads.status
        END,
        updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await p.query(`DROP TRIGGER IF EXISTS trg_refresh_thread ON tickets`);
  await p.query(`
    CREATE TRIGGER trg_refresh_thread
      AFTER INSERT OR UPDATE ON tickets
      FOR EACH ROW EXECUTE FUNCTION refresh_thread_from_message()
  `);

  await p.query(`
    CREATE OR REPLACE FUNCTION refresh_thread_from_response()
    RETURNS TRIGGER AS $$
    DECLARE
      v_thread_id TEXT;
      v_sent_at   TIMESTAMPTZ;
    BEGIN
      IF NEW.response_type <> 'reply' THEN RETURN NEW; END IF;
      IF NEW.send_status IS DISTINCT FROM 'sent' THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' AND OLD.send_status = 'sent' AND OLD.graph_id = NEW.graph_id THEN
        RETURN NEW;
      END IF;
      SELECT thread_id INTO v_thread_id FROM tickets WHERE id = NEW.ticket_id;
      IF v_thread_id IS NULL THEN RETURN NEW; END IF;
      v_sent_at := COALESCE(NEW.sent_at, NOW());
      UPDATE threads SET
        last_outbound_at = GREATEST(COALESCE(last_outbound_at, v_sent_at), v_sent_at),
        last_message_at  = GREATEST(last_message_at, v_sent_at),
        updated_at       = NOW()
      WHERE thread_id = v_thread_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await p.query(`DROP TRIGGER IF EXISTS trg_refresh_thread_from_response ON ticket_responses`);
  await p.query(`
    CREATE TRIGGER trg_refresh_thread_from_response
      AFTER INSERT OR UPDATE ON ticket_responses
      FOR EACH ROW EXECUTE FUNCTION refresh_thread_from_response()
  `);

  // One-time backfill (idempotent — ON CONFLICT DO NOTHING). Subsequent
  // updates flow through the triggers.
  await p.query(`
    INSERT INTO threads (
      thread_id, subject, connection_id, category, priority,
      linked_property_name, linked_tenant_name, linked_owner_name, ai_summary,
      message_count, unread_count, has_attachments,
      first_message_at, last_message_at, last_inbound_at,
      starred, status, assignee_id
    )
    SELECT
      t.thread_id,
      (SELECT subject FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
         ORDER BY received_at ASC NULLS LAST, id ASC LIMIT 1),
      (SELECT connection_id FROM tickets WHERE thread_id = t.thread_id AND deleted_at IS NULL
         ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1),
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
    ON CONFLICT (thread_id) DO NOTHING
  `);

  await p.query(`
    UPDATE threads th
    SET last_outbound_at = GREATEST(COALESCE(th.last_outbound_at, sub.max_sent), sub.max_sent),
        last_message_at  = GREATEST(th.last_message_at, sub.max_sent),
        updated_at       = NOW()
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
      AND (th.last_outbound_at IS NULL OR th.last_outbound_at < sub.max_sent)
  `);
}

/**
 * Phase 1 (D0-aligned): conversation-first additions.
 * Adds channel / participant_count / mentions_users / tags columns, migrates
 * legacy waiting_on_* statuses to status=open + tags, and updates the
 * per-message trigger to keep participant_count current. Idempotent.
 * Mirrored in migrations/030_inbox_conversation_first.sql.
 */
async function migrateInboxConversationFirst(p) {
  await p.query(`
    ALTER TABLE threads
      ADD COLUMN IF NOT EXISTS channel           TEXT NOT NULL DEFAULT 'email',
      ADD COLUMN IF NOT EXISTS participant_count INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS mentions_users    INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
      ADD COLUMN IF NOT EXISTS tags              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
  `);

  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_channel ON threads(channel)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_tags ON threads USING GIN (tags)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_threads_mentions ON threads USING GIN (mentions_users)`);

  // Backfill participant_count from the message table on first run. Threads
  // already past this point keep their computed value.
  await p.query(`
    UPDATE threads th
    SET participant_count = GREATEST(1, COALESCE((
          SELECT COUNT(DISTINCT COALESCE(LOWER(sender_email), sender_name))
            FROM tickets
           WHERE thread_id = th.thread_id AND deleted_at IS NULL
        ), 1))
    WHERE participant_count = 1
  `);

  // Translate the legacy waiting_on_* statuses into tags + status=open.
  await p.query(`
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
    $$ LANGUAGE plpgsql
  `);

  // Update the per-message refresh trigger to keep participant_count fresh
  // and to auto-collapse legacy waiting_on_* statuses on insert.
  await p.query(`
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
    $$ LANGUAGE plpgsql
  `);
}

async function migrateInboxDeltaSync(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS mailbox_sync_state (
      connection_id          INTEGER PRIMARY KEY REFERENCES email_connections(id) ON DELETE CASCADE,
      delta_link             TEXT,
      last_synced_at         TIMESTAMPTZ,
      last_success_at        TIMESTAMPTZ,
      last_error             TEXT,
      last_error_at          TIMESTAMPTZ,
      messages_processed     BIGINT NOT NULL DEFAULT 0,
      full_sync_in_progress  BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await p.query(`ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS graph_id TEXT`);
  await p.query(`ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS send_status TEXT NOT NULL DEFAULT 'sent'`);
  await p.query(`ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS send_error TEXT`);
  await p.query(`ALTER TABLE ticket_responses ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_ticket_responses_graph_id
      ON ticket_responses(graph_id) WHERE graph_id IS NOT NULL
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_ticket_responses_failed
      ON ticket_responses(send_status) WHERE send_status = 'failed'
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_tickets_deleted
      ON tickets(deleted_at) WHERE deleted_at IS NOT NULL
  `);
}

async function migrateInboxMultiMailbox(p) {
  await p.query(`ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS mailbox_type VARCHAR(20) DEFAULT 'personal'`);
  await p.query(`ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS mailbox_email VARCHAR(255)`);
  await p.query(`ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`);
  await p.query(
    `ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS sync_last_message_at TIMESTAMPTZ`
  );

  await p.query(`
    CREATE TABLE IF NOT EXISTS inbox_permissions (
      id SERIAL PRIMARY KEY,
      connection_id INTEGER NOT NULL REFERENCES email_connections(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission VARCHAR(20) NOT NULL DEFAULT 'read',
      granted_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (connection_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS inbox_permissions_user_idx ON inbox_permissions (user_id);
  `);

  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS connection_id INTEGER REFERENCES email_connections(id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS tickets_connection_id_idx ON tickets (connection_id)`);

  await p.query(`
    UPDATE email_connections
    SET mailbox_type = 'personal'
    WHERE mailbox_type IS NULL OR trim(mailbox_type) = ''
  `);
  await p.query(`
    UPDATE email_connections
    SET mailbox_email = email_address
    WHERE mailbox_email IS NULL AND email_address IS NOT NULL
  `);

  await p.query(`
    UPDATE tickets t
    SET connection_id = sub.cid
    FROM (
      SELECT t2.id AS tid,
        (SELECT ec.id FROM email_connections ec
         WHERE ec.user_id = t2.source_user_id AND ec.is_active = true
           AND COALESCE(ec.mailbox_type, 'personal') = 'personal'
         ORDER BY ec.id DESC LIMIT 1) AS cid
      FROM tickets t2
      WHERE t2.connection_id IS NULL AND t2.source_user_id IS NOT NULL
    ) sub
    WHERE t.id = sub.tid AND sub.cid IS NOT NULL
  `);

  await p.query(`ALTER TABLE email_connections DROP CONSTRAINT IF EXISTS email_connections_user_id_email_address_key`);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS email_connections_user_mailbox_lower_uq
    ON email_connections (user_id, lower(mailbox_email))
  `);

  await p.query(`
    INSERT INTO inbox_permissions (connection_id, user_id, permission, granted_by)
    SELECT ec.id, ec.user_id, 'admin', ec.user_id
    FROM email_connections ec
    WHERE ec.is_active = true
      AND NOT EXISTS (SELECT 1 FROM inbox_permissions ip WHERE ip.connection_id = ec.id AND ip.user_id = ec.user_id)
  `);

  // Grant admin inbox permissions to anyone whose role grants 'all' (owner/admin).
  await p.query(`
    INSERT INTO inbox_permissions (connection_id, user_id, permission, granted_by)
    SELECT ec.id, u.id, 'admin', u.id
    FROM email_connections ec
    CROSS JOIN users u
    WHERE ec.is_active = true
      AND u.active = TRUE
      AND user_has_permission(u.id, 'all')
    ON CONFLICT (connection_id, user_id) DO NOTHING
  `);
}

/**
 * Creates `video_folders` alone first. Older deployments had a batched migration where
 * `CREATE INDEX ... ON videos(folder_id)` failed before `folder_id` existed, rolling back the whole batch
 * and leaving `video_folders` missing — split steps avoid that.
 */
export async function ensureVideoFoldersTable() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS video_folders (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      parent_folder_id INTEGER REFERENCES video_folders(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS video_folders_parent_idx ON video_folders (parent_folder_id)`
  );
}

export async function ensureVideosSchema() {
  const p = getPool();
  await ensureVideoFoldersTable();

  await p.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      filename VARCHAR(255) NOT NULL,
      thumbnail_filename VARCHAR(255),
      duration_seconds INTEGER,
      file_size_bytes BIGINT,
      mime_type VARCHAR(50) DEFAULT 'video/webm',
      recording_type VARCHAR(20) DEFAULT 'screen',
      transcript TEXT,
      transcript_status VARCHAR(20) DEFAULT 'pending',
      processing_status VARCHAR(20) DEFAULT 'none',
      visibility VARCHAR(20) DEFAULT 'private',
      share_token VARCHAR(64),
      recorded_by INTEGER REFERENCES users(id),
      views_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS video_comments (
      id SERIAL PRIMARY KEY,
      video_id INTEGER REFERENCES videos(id),
      user_id INTEGER REFERENCES users(id),
      comment TEXT NOT NULL,
      timestamp_seconds INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(
    `CREATE INDEX IF NOT EXISTS videos_recorded_by_idx ON videos (recorded_by, created_at DESC)`
  );
  await p.query(`CREATE INDEX IF NOT EXISTS videos_visibility_idx ON videos (visibility)`);
  await p.query(`CREATE INDEX IF NOT EXISTS videos_share_token_idx ON videos (share_token)`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS video_comments_video_idx ON video_comments (video_id, created_at ASC)`
  );

  await p.query(
    `ALTER TABLE videos ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES video_folders(id)`
  );
  await p.query(
    `ALTER TABLE videos ADD COLUMN IF NOT EXISTS processing_status VARCHAR(20) DEFAULT 'none'`
  );
  await p.query(`CREATE INDEX IF NOT EXISTS videos_folder_idx ON videos (folder_id)`);
}

export async function ensureWikiSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS wiki_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      description TEXT,
      icon VARCHAR(50) DEFAULT '📁',
      display_order INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wiki_pages (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES wiki_categories(id),
      parent_page_id INTEGER REFERENCES wiki_pages(id),
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL,
      content_markdown TEXT DEFAULT '',
      status VARCHAR(20) DEFAULT 'published',
      is_pinned BOOLEAN DEFAULT false,
      display_order INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      last_edited_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(category_id, slug)
    );

    CREATE TABLE IF NOT EXISTS wiki_page_versions (
      id SERIAL PRIMARY KEY,
      page_id INTEGER REFERENCES wiki_pages(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      title VARCHAR(255),
      content_markdown TEXT,
      change_summary VARCHAR(255),
      edited_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wiki_attachments (
      id SERIAL PRIMARY KEY,
      page_id INTEGER REFERENCES wiki_pages(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      file_size_bytes BIGINT,
      mime_type VARCHAR(100),
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS wiki_pages_category_idx ON wiki_pages (category_id, display_order, updated_at DESC);
    CREATE INDEX IF NOT EXISTS wiki_page_versions_page_idx ON wiki_page_versions (page_id, version_number DESC);
  `);

  const { rows } = await p.query(`SELECT COUNT(*)::int AS c FROM wiki_categories`);
  if (rows[0].c > 0) return;

  const seeds = [
    ["Leasing", "leasing", "🏠", "Showing procedures, application processing, move-in checklists"],
    ["Maintenance", "maintenance", "🔧", "Work order workflows, vendor management, technician playbooks"],
    ["Client Success", "client-success", "🤝", "Owner onboarding, monthly reporting, retention processes"],
    ["Accounting", "accounting", "💰", "Rent collection, owner disbursements, delinquency procedures"],
    ["Operations", "operations", "⚙️", "Call center scripts, emergency procedures, team onboarding"],
    ["Sales / BDM", "sales", "📈", "Lead follow-up, PMA signing, owner pitch process"],
  ];
  let order = 0;
  for (const [name, slug, icon, description] of seeds) {
    await p.query(
      `INSERT INTO wiki_categories (name, slug, description, icon, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, slug, description, icon, order++]
    );
  }
}

export async function ensureMaintenanceDashboardSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS cached_work_orders_all (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wo_all_status ON cached_work_orders_all ((appfolio_data->>'status'));
    CREATE INDEX IF NOT EXISTS idx_wo_all_vendor ON cached_work_orders_all ((appfolio_data->>'vendor'));
    CREATE INDEX IF NOT EXISTS idx_wo_all_created ON cached_work_orders_all ((appfolio_data->>'created_at'));
    CREATE INDEX IF NOT EXISTS idx_wo_all_completed ON cached_work_orders_all ((appfolio_data->>'completed_on'));
    CREATE INDEX IF NOT EXISTS idx_wo_all_wo_id ON cached_work_orders_all ((appfolio_data->>'work_order_id'));

    CREATE TABLE IF NOT EXISTS cached_work_order_labor (
      id SERIAL PRIMARY KEY,
      appfolio_data JSONB NOT NULL,
      synced_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wo_labor_wo_id ON cached_work_order_labor ((appfolio_data->>'work_order_id'));
    CREATE INDEX IF NOT EXISTS idx_wo_labor_tech ON cached_work_order_labor ((appfolio_data->>'maintenance_tech'));
    CREATE INDEX IF NOT EXISTS idx_wo_labor_date ON cached_work_order_labor ((appfolio_data->>'date'));

    CREATE TABLE IF NOT EXISTS technician_config (
      id SERIAL PRIMARY KEY,
      technician_name VARCHAR(255) UNIQUE NOT NULL,
      hourly_cost NUMERIC(10,2) DEFAULT 25.00,
      is_active BOOLEAN DEFAULT true,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS maintenance_surveys (
      id SERIAL PRIMARY KEY,
      work_order_id VARCHAR(50),
      access_token VARCHAR(64) UNIQUE NOT NULL,
      tenant_email VARCHAR(255),
      tenant_name VARCHAR(255),
      property_name VARCHAR(255),
      vendor_name VARCHAR(255),
      is_inhouse BOOLEAN,
      satisfaction_score INTEGER,
      completely_resolved BOOLEAN,
      timely_completion BOOLEAN,
      comments TEXT,
      submitted_at TIMESTAMP,
      sent_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Auto-seed technician_config from labor data
  try {
    await p.query(`
      INSERT INTO technician_config (technician_name, hourly_cost, is_active)
      SELECT DISTINCT appfolio_data->>'maintenance_tech', 25.00, true
      FROM cached_work_order_labor
      WHERE appfolio_data->>'maintenance_tech' IS NOT NULL
        AND appfolio_data->>'maintenance_tech' != ''
      ON CONFLICT (technician_name) DO NOTHING
    `);
  } catch (e) {
    // Labor table may be empty on first run
  }
}

export async function ensurePlaybookSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS playbook_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      description TEXT,
      icon VARCHAR(50) DEFAULT '📋',
      display_order INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS playbook_pages (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES playbook_categories(id),
      parent_page_id INTEGER REFERENCES playbook_pages(id),
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL,
      content_markdown TEXT DEFAULT '',
      status VARCHAR(20) DEFAULT 'published',
      is_pinned BOOLEAN DEFAULT false,
      display_order INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      last_edited_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(category_id, slug)
    );

    CREATE TABLE IF NOT EXISTS playbook_page_versions (
      id SERIAL PRIMARY KEY,
      page_id INTEGER REFERENCES playbook_pages(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      title VARCHAR(255),
      content_markdown TEXT,
      change_summary VARCHAR(255),
      edited_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS playbook_attachments (
      id SERIAL PRIMARY KEY,
      page_id INTEGER REFERENCES playbook_pages(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      file_size_bytes BIGINT,
      mime_type VARCHAR(100),
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS playbook_pages_category_idx ON playbook_pages (category_id, display_order, updated_at DESC);
    CREATE INDEX IF NOT EXISTS playbook_page_versions_page_idx ON playbook_page_versions (page_id, version_number DESC);
  `);

  const { rows } = await p.query(`SELECT COUNT(*)::int AS c FROM playbook_categories`);
  if (rows[0].c > 0) return;

  const seeds = [
    ["Leasing", "leasing", "🏠", "Showing procedures, application processing, lease agreements"],
    ["Maintenance", "maintenance", "🔧", "Work order workflows, vendor management, emergency procedures"],
    ["Move-In", "move-in", "📦", "Move-in inspections, key handoff, tenant onboarding"],
    ["Move-Out", "move-out", "🚚", "Move-out procedures, deposit reconciliation, turnover"],
    ["Owner Onboarding", "owner-onboarding", "🤝", "PMA signing, property setup, owner portal access"],
    ["Rent Collection", "rent-collection", "💰", "Payment processing, delinquency notices, eviction timelines"],
    ["Lease Renewals", "lease-renewals", "📝", "Renewal offers, rent adjustments, re-signing process"],
    ["Inspections", "inspections", "🔍", "Routine inspections, drive-by checks, compliance audits"],
  ];
  let order = 0;
  for (const [name, slug, icon, description] of seeds) {
    await p.query(
      `INSERT INTO playbook_categories (name, slug, description, icon, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, slug, description, icon, order++]
    );
  }
}

export async function ensureWalkthruSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS walkthru_reports (
      id SERIAL PRIMARY KEY,
      report_type VARCHAR(20) NOT NULL DEFAULT 'move_in',
      status VARCHAR(20) DEFAULT 'in_progress',
      property_address VARCHAR(500) NOT NULL,
      unit_number VARCHAR(50),
      resident_name VARCHAR(255) NOT NULL,
      resident_email VARCHAR(255),
      resident_phone VARCHAR(50),
      lease_start_date DATE,
      lease_end_date DATE,
      report_date DATE DEFAULT CURRENT_DATE,
      access_token VARCHAR(64) UNIQUE NOT NULL,
      signature_data TEXT,
      signed_at TIMESTAMP,
      pdf_filename VARCHAR(255),
      linked_file_id INTEGER REFERENCES files(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS walkthru_rooms (
      id SERIAL PRIMARY KEY,
      report_id INTEGER REFERENCES walkthru_reports(id) ON DELETE CASCADE,
      room_name VARCHAR(100) NOT NULL,
      room_order INTEGER DEFAULT 0,
      is_custom BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS walkthru_items (
      id SERIAL PRIMARY KEY,
      room_id INTEGER REFERENCES walkthru_rooms(id) ON DELETE CASCADE,
      item_name VARCHAR(200) NOT NULL,
      item_order INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'pending',
      comment TEXT,
      photo_filenames TEXT[] DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`CREATE INDEX IF NOT EXISTS walkthru_reports_status_idx ON walkthru_reports (status, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS walkthru_reports_access_token_idx ON walkthru_reports (access_token)`);
  await p.query(`CREATE INDEX IF NOT EXISTS walkthru_rooms_report_idx ON walkthru_rooms (report_id, room_order ASC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS walkthru_items_room_idx ON walkthru_items (room_id, item_order ASC)`);
}

export async function ensureDocumentsSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Document',
      content TEXT DEFAULT '',
      folder TEXT DEFAULT 'General',
      tags TEXT[] DEFAULT '{}',
      owner TEXT,
      pinned BOOLEAN DEFAULT false,
      archived BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await p.query(`CREATE INDEX IF NOT EXISTS documents_folder_idx ON documents (folder)`);
  await p.query(`CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents (owner)`);
  await p.query(`CREATE INDEX IF NOT EXISTS documents_archived_idx ON documents (archived)`);
  await p.query(`CREATE INDEX IF NOT EXISTS documents_updated_idx ON documents (updated_at DESC)`);

  await p.query(`
    CREATE OR REPLACE FUNCTION documents_set_updated_at() RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await p.query(`DROP TRIGGER IF EXISTS documents_updated_at_trigger ON documents`);
  await p.query(`
    CREATE TRIGGER documents_updated_at_trigger
      BEFORE UPDATE ON documents
      FOR EACH ROW
      EXECUTE FUNCTION documents_set_updated_at();
  `);
}

const TEAM_SIGNATURE_HTML = {
  mike: `<p>Best regards,</p>
<p><strong>Mike Williamson</strong><br>Owner/Operator<br>Real Property Management Prestige<br>A Neighborly® Company<br><a href="https://www.rpmhouston.com">www.rpmhouston.com</a><br>Houston, TX</p>`,
  lori: `<p>Best regards,</p>
<p><strong>Lori</strong><br>Client Success Manager<br>Real Property Management Prestige<br>A Neighborly® Company<br><a href="https://www.rpmhouston.com">www.rpmhouston.com</a><br>Houston, TX</p>`,
  leslie: `<p>Best regards,</p>
<p><strong>Leslie</strong><br>Business Development Manager<br>Real Property Management Prestige<br>A Neighborly® Company<br><a href="https://www.rpmhouston.com">www.rpmhouston.com</a><br>Houston, TX</p>`,
  amanda: `<p>Best regards,</p>
<p><strong>Amanda</strong><br>Maintenance Coordinator<br>Real Property Management Prestige<br>A Neighborly® Company<br><a href="https://www.rpmhouston.com">www.rpmhouston.com</a><br>Houston, TX</p>`,
  amelia: `<p>Best regards,</p>
<p><strong>Amelia</strong><br>Operations Support<br>Real Property Management Prestige<br>A Neighborly® Company<br><a href="https://www.rpmhouston.com">www.rpmhouston.com</a><br>Houston, TX</p>`,
};

async function seedEmailSignatures(p) {
  await p.query(
    `INSERT INTO email_signatures (user_id, name, signature_html, is_default)
     SELECT u.id, 'Imported', trim(u.signature_html), true
     FROM users u
     WHERE u.signature_html IS NOT NULL AND trim(u.signature_html) <> ''
       AND NOT EXISTS (SELECT 1 FROM email_signatures es WHERE es.user_id = u.id)`
  );

  const { rows: users } = await p.query(
    `SELECT id, lower(username) AS u FROM users WHERE lower(username) = ANY($1::text[])`,
    [["mike", "lori", "leslie", "amanda", "amelia"]]
  );
  for (const row of users) {
    const { rows: cnt } = await p.query(`SELECT COUNT(*)::int AS c FROM email_signatures WHERE user_id = $1`, [
      row.id,
    ]);
    if (cnt[0].c > 0) continue;
    const html = TEAM_SIGNATURE_HTML[row.u];
    if (!html) continue;
    await p.query(
      `INSERT INTO email_signatures (user_id, name, signature_html, is_default, updated_at)
       VALUES ($1, 'Standard', $2, true, NOW())`,
      [row.id, html]
    );
  }
}
