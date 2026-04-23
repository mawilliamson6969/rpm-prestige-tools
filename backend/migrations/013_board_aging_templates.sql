-- Advanced board system: cross-board rules, drip campaigns, task templates,
-- automation engine v2, recurring tasks, aging, archive/delete, assignment rules.
-- Also created at runtime via ensureOperationsSchema.

CREATE TABLE IF NOT EXISTS process_cross_board_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(30) NOT NULL,
  source_template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
  source_stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL,
  destination_template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE NOT NULL,
  field_mapping JSONB DEFAULT '{}',
  conditions JSONB DEFAULT '{}',
  prevent_duplicates BOOLEAN DEFAULT true,
  duplicate_check_field VARCHAR(100) DEFAULT 'property_name',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS process_drip_campaigns (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS process_drip_steps (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES process_drip_campaigns(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  delay_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  subject VARCHAR(500),
  body TEXT NOT NULL,
  step_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS process_drip_log (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES process_drip_campaigns(id) ON DELETE SET NULL,
  step_id INTEGER REFERENCES process_drip_steps(id) ON DELETE SET NULL,
  process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE,
  channel VARCHAR(20),
  status VARCHAR(20) DEFAULT 'sent',
  sent_at TIMESTAMP DEFAULT NOW(),
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS assignment_round_robin (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
  last_assigned_user_id INTEGER REFERENCES users(id),
  assignment_count INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_id INTEGER REFERENCES process_templates(id) ON DELETE SET NULL,
  default_assignee_user_id INTEGER REFERENCES users(id),
  is_sequential BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_template_items (
  id SERIAL PRIMARY KEY,
  task_template_id INTEGER REFERENCES task_templates(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  task_type VARCHAR(20) DEFAULT 'todo',
  task_config JSONB DEFAULT '{}',
  priority VARCHAR(20) DEFAULT 'medium',
  due_date_config JSONB DEFAULT '{}',
  assignee_override_user_id INTEGER REFERENCES users(id),
  stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS process_automations (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'draft',
  folder VARCHAR(100),
  trigger_type VARCHAR(30) NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}',
  conditions JSONB DEFAULT '[]',
  timing_type VARCHAR(30) DEFAULT 'immediately',
  timing_config JSONB DEFAULT '{}',
  actions JSONB NOT NULL DEFAULT '[]',
  is_test_mode BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  test_card_id INTEGER REFERENCES processes(id),
  test_email VARCHAR(255),
  test_phone VARCHAR(50),
  run_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMP,
  last_error TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS process_automation_log (
  id SERIAL PRIMARY KEY,
  automation_id INTEGER REFERENCES process_automations(id) ON DELETE CASCADE,
  process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE,
  trigger_type VARCHAR(30),
  trigger_details JSONB,
  actions_executed JSONB,
  status VARCHAR(20) DEFAULT 'success',
  error_message TEXT,
  executed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recurring_task_configs (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
  task_template_id INTEGER REFERENCES task_templates(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  frequency_type VARCHAR(20) NOT NULL,
  frequency_config JSONB NOT NULL,
  stage_filter_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS task_type VARCHAR(20) DEFAULT 'todo';
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS task_config JSONB DEFAULT '{}';
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium';
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS start_date TIMESTAMP;
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS comments TEXT;
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]';
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS related_contact_name VARCHAR(255);
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS related_contact_email VARCHAR(255);
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS related_contact_phone VARCHAR(50);

ALTER TABLE processes ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP DEFAULT NOW();
ALTER TABLE processes ADD COLUMN IF NOT EXISTS last_activity_type VARCHAR(50);
ALTER TABLE processes ADD COLUMN IF NOT EXISTS last_activity_by INTEGER REFERENCES users(id);
ALTER TABLE processes ADD COLUMN IF NOT EXISTS automations_fired JSONB DEFAULT '[]';
ALTER TABLE processes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE processes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS aging_green_hours INTEGER DEFAULT 48;
ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS aging_yellow_hours INTEGER DEFAULT 96;
ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS card_badge_field VARCHAR(50) DEFAULT 'due_date';
ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS assignment_rule VARCHAR(30) DEFAULT 'manual';
ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS assignment_config JSONB DEFAULT '{}';
ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS duplication_rule VARCHAR(30) DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_process_automations_template ON process_automations(template_id, status);
CREATE INDEX IF NOT EXISTS idx_process_automation_log_automation ON process_automation_log(automation_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_drip_campaigns_stage ON process_drip_campaigns(stage_id);
CREATE INDEX IF NOT EXISTS idx_drip_log_process ON process_drip_log(process_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_template ON task_templates(template_id);
CREATE INDEX IF NOT EXISTS idx_cross_board_rules_source ON process_cross_board_rules(source_template_id);
