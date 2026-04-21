import { getPool } from "./db.js";

export async function ensureFormsSchema() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS forms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100),
      status VARCHAR(20) DEFAULT 'draft',
      is_multi_step BOOLEAN DEFAULT false,
      settings JSONB DEFAULT '{}',
      branding JSONB DEFAULT '{}',
      access_type VARCHAR(20) DEFAULT 'public',
      access_token VARCHAR(64) UNIQUE,
      slug VARCHAR(255) UNIQUE,
      submit_button_text VARCHAR(100) DEFAULT 'Submit',
      success_message TEXT DEFAULT 'Thank you! Your submission has been received.',
      success_redirect_url VARCHAR(500),
      is_active BOOLEAN DEFAULT true,
      submissions_count INTEGER DEFAULT 0,
      views_count INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS form_pages (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      title VARCHAR(255),
      description TEXT,
      page_order INTEGER DEFAULT 0,
      is_visible BOOLEAN DEFAULT true,
      visibility_conditions JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS form_fields (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      page_id INTEGER REFERENCES form_pages(id) ON DELETE SET NULL,
      field_key VARCHAR(100) NOT NULL,
      field_type VARCHAR(30) NOT NULL,
      label VARCHAR(500) NOT NULL,
      description TEXT,
      placeholder TEXT,
      help_text TEXT,
      is_required BOOLEAN DEFAULT false,
      is_hidden BOOLEAN DEFAULT false,
      default_value TEXT,
      validation JSONB DEFAULT '{}',
      field_config JSONB DEFAULT '{}',
      conditional_logic JSONB,
      pre_fill_config JSONB,
      layout JSONB DEFAULT '{"width": "full"}',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS form_submissions (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      submission_data JSONB NOT NULL,
      encrypted_fields JSONB,
      status VARCHAR(20) DEFAULT 'submitted',
      ip_address VARCHAR(45),
      user_agent TEXT,
      referrer VARCHAR(500),
      submitted_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP,
      reviewed_by INTEGER REFERENCES users(id),
      notes TEXT,
      process_id INTEGER REFERENCES processes(id) ON DELETE SET NULL,
      property_id INTEGER,
      property_name VARCHAR(500),
      contact_name VARCHAR(255),
      contact_email VARCHAR(255),
      tags TEXT[] DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS form_submission_files (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER REFERENCES form_submissions(id) ON DELETE CASCADE,
      field_key VARCHAR(100),
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255),
      file_size INTEGER,
      mime_type VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS form_automations (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      name VARCHAR(255),
      trigger_type VARCHAR(30) DEFAULT 'on_submit',
      action_type VARCHAR(50) NOT NULL,
      action_config JSONB NOT NULL,
      is_active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS form_analytics (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      event_type VARCHAR(30) NOT NULL,
      event_data JSONB,
      session_id VARCHAR(64),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status, is_active);
    CREATE INDEX IF NOT EXISTS idx_forms_slug ON forms(slug);
    CREATE INDEX IF NOT EXISTS idx_forms_token ON forms(access_token);
    CREATE INDEX IF NOT EXISTS idx_form_fields_form ON form_fields(form_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_form_fields_page ON form_fields(page_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(status);
    CREATE INDEX IF NOT EXISTS idx_form_analytics_form ON form_analytics(form_id, created_at);
  `);
}
