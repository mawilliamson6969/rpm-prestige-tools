-- LeadSimple-style features that extend the existing process system:
-- per-template roles & assignments, email/text templates, activity log,
-- stage history, communications log, attachments, and AI suggestions.
-- Also created at runtime via ensureOperationsSchema in backend/lib/operationsSchema.js.

-- 1. Process Type Roles -- role slots per template (CSM, Maintenance Coordinator…)
CREATE TABLE IF NOT EXISTS process_type_roles (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,
  role_name VARCHAR(100) NOT NULL,
  is_required BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(template_id, role_name)
);

-- 2. Role assignments on a running process
CREATE TABLE IF NOT EXISTS process_role_assignments (
  id SERIAL PRIMARY KEY,
  process_id INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  role_name VARCHAR(100) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(process_id, role_name)
);
CREATE INDEX IF NOT EXISTS idx_pra_user ON process_role_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_pra_process ON process_role_assignments(process_id);

-- 3. Email templates per process template (with merge fields like {{tenant.first_name}})
CREATE TABLE IF NOT EXISTS process_email_templates (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT,
  total_sends INTEGER DEFAULT 0,
  total_opens INTEGER DEFAULT 0,
  total_clicks INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pet_template ON process_email_templates(template_id);

-- 4. Text message templates
CREATE TABLE IF NOT EXISTS process_text_templates (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  total_sends INTEGER DEFAULT 0,
  total_delivered INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ptt_template ON process_text_templates(template_id);

-- 5. Activity log -- everything that happens on a process
CREATE TABLE IF NOT EXISTS process_activity_log (
  id SERIAL PRIMARY KEY,
  process_id INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  action_type VARCHAR(40) NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,
  actor_type VARCHAR(20) DEFAULT 'user',
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name VARCHAR(150),
  is_pinned BOOLEAN DEFAULT false,
  pinned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pinned_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pal_process ON process_activity_log(process_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pal_pinned ON process_activity_log(process_id) WHERE is_pinned = true;

-- 6. Stage history -- how long each process spent in each stage
CREATE TABLE IF NOT EXISTS process_stage_history (
  id SERIAL PRIMARY KEY,
  process_id INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL,
  stage_name VARCHAR(255),
  entered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  exited_at TIMESTAMP,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_psh_process ON process_stage_history(process_id, entered_at);
CREATE INDEX IF NOT EXISTS idx_psh_stage ON process_stage_history(stage_id);

-- 7. Communications log -- emails, texts, calls, notes against a process
CREATE TABLE IF NOT EXISTS process_communications (
  id SERIAL PRIMARY KEY,
  process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  direction VARCHAR(10),
  subject VARCHAR(500),
  body TEXT,
  from_address VARCHAR(255),
  to_address VARCHAR(255),
  status VARCHAR(20) DEFAULT 'sent',
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  email_template_id INTEGER REFERENCES process_email_templates(id) ON DELETE SET NULL,
  text_template_id INTEGER REFERENCES process_text_templates(id) ON DELETE SET NULL,
  external_id VARCHAR(255),
  sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pc_process ON process_communications(process_id, created_at DESC);

-- 8. File attachments tied to the process (as opposed to a single step)
CREATE TABLE IF NOT EXISTS process_attachments (
  id SERIAL PRIMARY KEY,
  process_id INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size BIGINT,
  mime_type VARCHAR(100),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pa_process ON process_attachments(process_id);

-- 9. AI suggestions on a process
CREATE TABLE IF NOT EXISTS process_ai_suggestions (
  id SERIAL PRIMARY KEY,
  process_id INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  suggestion_type VARCHAR(40) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  action_type VARCHAR(40),
  action_payload JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  confidence NUMERIC(3,2),
  responded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pas_pending ON process_ai_suggestions(process_id) WHERE status = 'pending';

-- 10. Stage category & exit rule extensions on existing stages
ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'active';
ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS exit_rule VARCHAR(50) DEFAULT 'manual';
ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS short_name VARCHAR(50);
ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS default_days INTEGER DEFAULT 0;

-- 11. Track when the process entered its current stage + parent/child sub-processes
ALTER TABLE processes ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMP DEFAULT NOW();
ALTER TABLE processes ADD COLUMN IF NOT EXISTS parent_process_id INTEGER REFERENCES processes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_processes_parent ON processes(parent_process_id);

SELECT 'Migration 015 — LeadSimple feature tables ready' AS status;
