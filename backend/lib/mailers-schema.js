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
        'draft', 'queued', 'preauth_pending', 'sent', 'sent_test',
        'in_production', 'mailed', 'in_transit', 'out_for_delivery', 'delivered',
        'attempted', 'returned', 'failed', 'failed_funding', 'needs_attention',
        'address_warning', 'cancelled'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- Backfill: ensure new statuses are available even if the type was created in a previous deploy
    DO $$ BEGIN ALTER TYPE mail_status ADD VALUE IF NOT EXISTS 'preauth_pending'; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE mail_status ADD VALUE IF NOT EXISTS 'sent_test'; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE mail_status ADD VALUE IF NOT EXISTS 'in_production'; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE mail_status ADD VALUE IF NOT EXISTS 'mailed'; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE mail_status ADD VALUE IF NOT EXISTS 'failed_funding'; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE mail_status ADD VALUE IF NOT EXISTS 'needs_attention'; EXCEPTION WHEN others THEN NULL; END $$;
    DO $$ BEGIN ALTER TYPE mail_status ADD VALUE IF NOT EXISTS 'address_warning'; EXCEPTION WHEN others THEN NULL; END $$;

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

    -- LetterStream API additions
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS provider_doc_id VARCHAR(30);
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS provider_authcode VARCHAR(64);
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS provider_batch_id VARCHAR(30);
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS quoted_cost_cents INTEGER;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMPTZ;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS page_count INTEGER;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS current_scan_status VARCHAR(80);
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS current_scan_code VARCHAR(10);
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS last_scan_facility VARCHAR(255);
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS last_scan_zip VARCHAR(10);
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS test_mode BOOLEAN DEFAULT false;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS include_return_envelope BOOLEAN DEFAULT false;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS signature_file_path TEXT;
    -- v13: optional uploaded PDF (skips Puppeteer HTML render and mails the upload directly).
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS uploaded_pdf_path TEXT;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS uploaded_pdf_filename TEXT;
    -- v13: per-mailer letterhead customization (overrides defaults from sender_* cols).
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS letterhead_logo_url TEXT;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS letterhead_primary_color VARCHAR(16) DEFAULT '#1B2856';
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS letterhead_show_letterhead BOOLEAN DEFAULT true;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS letterhead_show_footer BOOLEAN DEFAULT true;
    ALTER TABLE mailers ADD COLUMN IF NOT EXISTS letterhead_footer_text TEXT;

    CREATE TABLE IF NOT EXISTS mailer_events (
      id SERIAL PRIMARY KEY,
      mailer_id INTEGER REFERENCES mailers(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      event_detail TEXT,
      event_time TIMESTAMPTZ DEFAULT NOW(),
      raw_payload JSONB,
      created_by TEXT DEFAULT 'system'
    );

    -- Webhook scan event columns
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_batch_id VARCHAR(30);
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_job_id VARCHAR(30);
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_doc_id VARCHAR(30);
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_tracking_id VARCHAR(40);
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_date TIMESTAMPTZ;
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_zip VARCHAR(10);
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_facility VARCHAR(255);
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_code VARCHAR(10);
    ALTER TABLE mailer_events ADD COLUMN IF NOT EXISTS scan_status VARCHAR(80);

    CREATE INDEX IF NOT EXISTS mailers_property_address_idx ON mailers (property_address);
    CREATE INDEX IF NOT EXISTS mailers_owner_name_idx ON mailers (owner_name);
    CREATE INDEX IF NOT EXISTS mailers_tenant_name_idx ON mailers (tenant_name);
    CREATE INDEX IF NOT EXISTS mailers_letter_category_idx ON mailers (letter_category);
    CREATE INDEX IF NOT EXISTS mailers_status_idx ON mailers (status);
    CREATE INDEX IF NOT EXISTS mailers_sent_at_idx ON mailers (sent_at);
    CREATE INDEX IF NOT EXISTS mailers_provider_doc_id_idx ON mailers (provider_doc_id);
    CREATE INDEX IF NOT EXISTS mailers_provider_job_id_idx ON mailers (provider_job_id);
    CREATE INDEX IF NOT EXISTS mailer_events_scan_doc_id_idx ON mailer_events (scan_doc_id);
  `);

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
