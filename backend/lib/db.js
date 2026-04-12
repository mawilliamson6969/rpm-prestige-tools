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
      role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'viewer')),
      email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_html TEXT`);

  const { rows } = await p.query(`SELECT COUNT(*)::int AS c FROM users`);
  if (rows[0].c > 0) return;

  const password_hash = await bcrypt.hash("RpmPrestige2026!", 12);
  const seeds = [
    ["mike", "Mike Williamson", "admin", "mike@rpmhouston.com"],
    ["lori", "Lori", "admin", "lori@rpmhouston.com"],
    ["leslie", "Leslie", "viewer", "leslie@rpmhouston.com"],
    ["amanda", "Amanda", "viewer", "amanda@rpmhouston.com"],
    ["amelia", "Amelia", "viewer", "amelia@rpmhouston.com"],
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

  await seedEmailSignatures(p);
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
