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

  await seedEmailSignatures(p);
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
