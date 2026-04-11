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
