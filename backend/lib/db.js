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
