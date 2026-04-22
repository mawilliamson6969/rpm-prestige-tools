import { getPool } from "./db.js";

export async function ensureFormsPhase4Schema() {
  const pool = getPool();

  // 1. Versioning
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_versions (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      form_snapshot JSONB NOT NULL,
      fields_snapshot JSONB NOT NULL,
      pages_snapshot JSONB NOT NULL,
      logic_snapshot JSONB,
      change_summary TEXT,
      published_at TIMESTAMP,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_form_versions_form ON form_versions(form_id, version_number DESC);
  `);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS current_version INTEGER DEFAULT 1`);
  await pool.query(`ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS form_version INTEGER`);

  // 2. Scheduling & access
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS opens_at TIMESTAMP`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS closes_at TIMESTAMP`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS closed_message TEXT DEFAULT 'This form is no longer accepting responses.'`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS max_submissions INTEGER`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS require_password BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS form_password VARCHAR(255)`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS one_submission_per_email BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS ip_limit INTEGER`);

  // 3. Approvals
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS approval_config JSONB DEFAULT '{}'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_submission_approvals (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER REFERENCES form_submissions(id) ON DELETE CASCADE,
      approver_user_id INTEGER REFERENCES users(id),
      status VARCHAR(20) DEFAULT 'pending',
      decision_notes TEXT,
      decided_at TIMESTAMP,
      step_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_form_approvals_submission ON form_submission_approvals(submission_id);
    CREATE INDEX IF NOT EXISTS idx_form_approvals_approver ON form_submission_approvals(approver_user_id, status);
  `);

  // 4. Distribution
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_distributions (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      channel VARCHAR(20) NOT NULL,
      recipient_email VARCHAR(255),
      recipient_phone VARCHAR(50),
      recipient_name VARCHAR(255),
      personal_link VARCHAR(500),
      personal_token VARCHAR(64) UNIQUE,
      status VARCHAR(20) DEFAULT 'sent',
      sent_at TIMESTAMP DEFAULT NOW(),
      opened_at TIMESTAMP,
      submitted_at TIMESTAMP,
      submission_id INTEGER REFERENCES form_submissions(id),
      source VARCHAR(50),
      source_id VARCHAR(100),
      error_message TEXT,
      created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_form_dist_form ON form_distributions(form_id);
    CREATE INDEX IF NOT EXISTS idx_form_dist_token ON form_distributions(personal_token);
  `);

  // 5. Document templates
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_document_templates (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      template_type VARCHAR(20) DEFAULT 'pdf',
      template_content TEXT NOT NULL,
      template_config JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS form_generated_documents (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES form_document_templates(id) ON DELETE SET NULL,
      submission_id INTEGER REFERENCES form_submissions(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      file_path VARCHAR(500),
      generated_at TIMESTAMP DEFAULT NOW(),
      generated_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_form_doc_tpl_form ON form_document_templates(form_id);
    CREATE INDEX IF NOT EXISTS idx_form_gen_docs_submission ON form_generated_documents(submission_id);
  `);

  // 6. Collaboration
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_submission_notes (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER REFERENCES form_submissions(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      note TEXT NOT NULL,
      is_internal BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS form_submission_tags (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER REFERENCES form_submissions(id) ON DELETE CASCADE,
      tag VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (submission_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_form_sub_notes ON form_submission_notes(submission_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_form_sub_tags ON form_submission_tags(submission_id);
  `);
  await pool.query(`ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id)`);
  await pool.query(`ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal'`);
  await pool.query(`ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false`);
}
