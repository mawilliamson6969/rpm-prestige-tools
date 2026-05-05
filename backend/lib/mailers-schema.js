import { getPool } from "./db.js";

export async function ensureMailersSchema() {
  const pool = getPool();
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE mail_type AS ENUM (
        'certified', 'certified_return_receipt', 'first_class', 'priority', 'postcard', 'marketing'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE mail_status AS ENUM (
        'draft', 'queued', 'sent', 'in_transit', 'out_for_delivery', 'delivered',
        'attempted', 'returned', 'failed', 'cancelled'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS mailers (
      id SERIAL PRIMARY KEY,
      document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
      letter_title TEXT NOT NULL,
      letter_html TEXT NOT NULL,
      mail_type mail_type NOT NULL DEFAULT 'certified',
      recipient_name TEXT NOT NULL,
      recipient_address TEXT NOT NULL,
      recipient_city TEXT NOT NULL DEFAULT 'Houston',
      recipient_state TEXT NOT NULL DEFAULT 'TX',
      recipient_zip TEXT NOT NULL,
      property_address TEXT,
      owner_name TEXT,
      tenant_name TEXT,
      letter_category TEXT,
      notes TEXT,
      sender_name TEXT DEFAULT 'Real Property Management Prestige',
      sender_address TEXT DEFAULT '4811 Hwy 6 N, Suite B',
      sender_city TEXT DEFAULT 'Houston',
      sender_state TEXT DEFAULT 'TX',
      sender_zip TEXT DEFAULT '77084',
      provider TEXT DEFAULT 'letterstream',
      provider_job_id TEXT,
      provider_tracking_number TEXT,
      provider_expected_delivery DATE,
      cost_cents INTEGER,
      triggered_by TEXT DEFAULT 'manual',
      triggered_from TEXT,
      sent_by TEXT,
      status mail_status DEFAULT 'draft',
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      last_status_check TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mailer_events (
      id SERIAL PRIMARY KEY,
      mailer_id INTEGER REFERENCES mailers(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      event_detail TEXT,
      event_time TIMESTAMPTZ DEFAULT NOW(),
      raw_payload JSONB,
      created_by TEXT DEFAULT 'system'
    );

    CREATE INDEX IF NOT EXISTS mailers_property_address_idx ON mailers (property_address);
    CREATE INDEX IF NOT EXISTS mailers_owner_name_idx ON mailers (owner_name);
    CREATE INDEX IF NOT EXISTS mailers_tenant_name_idx ON mailers (tenant_name);
    CREATE INDEX IF NOT EXISTS mailers_letter_category_idx ON mailers (letter_category);
    CREATE INDEX IF NOT EXISTS mailers_status_idx ON mailers (status);
    CREATE INDEX IF NOT EXISTS mailers_sent_at_idx ON mailers (sent_at);
  `);

  // Trigger (separate statement — CREATE OR REPLACE is not transactional-safe inside DO)
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_mailer_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS mailers_updated_at ON mailers;
    CREATE TRIGGER mailers_updated_at
    BEFORE UPDATE ON mailers
    FOR EACH ROW EXECUTE FUNCTION update_mailer_timestamp();
  `);
}
