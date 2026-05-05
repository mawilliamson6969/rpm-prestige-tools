import { getPool } from "./db.js";

const STARTER_TEMPLATES = [
  {
    name: "New Owner Onboarding",
    description:
      "Complete onboarding process for new property owners from PMA signing through property listing",
    category: "Owner Relations",
    icon: "🏠",
    color: "#0098D0",
    estimated_days: 21,
  },
  {
    name: "Move-In Process",
    description: "Tenant move-in process from lease signing through first month follow-up",
    category: "Leasing",
    icon: "📦",
    color: "#10b981",
    estimated_days: 14,
  },
  {
    name: "Move-Out / Turnover",
    description: "Property turnover process from move-out notice through re-listing",
    category: "Maintenance",
    icon: "🔄",
    color: "#f59e0b",
    estimated_days: 30,
  },
  {
    name: "Lease Renewal",
    description: "Lease renewal process starting 90 days before expiration",
    category: "Leasing",
    icon: "📝",
    color: "#8b5cf6",
    estimated_days: 60,
  },
  {
    name: "Owner Termination",
    description: "Owner termination process from notice received through property handoff",
    category: "Owner Relations",
    icon: "⚠️",
    color: "#B32317",
    estimated_days: 45,
  },
  {
    name: "Maintenance Escalation",
    description: "Escalation process for high-priority or unresolved maintenance issues",
    category: "Maintenance",
    icon: "🔧",
    color: "#ef4444",
    estimated_days: 7,
  },
  {
    name: "Annual Property Inspection",
    description: "Annual interior/exterior property inspection and owner report",
    category: "Operations",
    icon: "🔍",
    color: "#6A737B",
    estimated_days: 14,
  },
  {
    name: "Eviction Process",
    description: "Legal eviction process from notice to vacate through court proceedings",
    category: "Operations",
    icon: "⚖️",
    color: "#1B2856",
    estimated_days: 90,
  },
];

export async function ensureOperationsSchema() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS process_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100),
      icon VARCHAR(10) DEFAULT '📋',
      color VARCHAR(7) DEFAULT '#0098D0',
      estimated_days INTEGER DEFAULT 14,
      is_active BOOLEAN DEFAULT true,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS process_template_steps (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      assigned_role VARCHAR(100),
      assigned_user_id INTEGER REFERENCES users(id),
      due_days_offset INTEGER DEFAULT 0,
      depends_on_step INTEGER,
      is_required BOOLEAN DEFAULT true,
      auto_action VARCHAR(50),
      auto_action_config JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS processes (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES process_templates(id),
      name VARCHAR(255) NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      property_name VARCHAR(500),
      property_id INTEGER,
      contact_name VARCHAR(255),
      contact_email VARCHAR(255),
      contact_phone VARCHAR(50),
      started_at TIMESTAMP DEFAULT NOW(),
      target_completion DATE,
      completed_at TIMESTAMP,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS process_steps (
      id SERIAL PRIMARY KEY,
      process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE,
      template_step_id INTEGER REFERENCES process_template_steps(id),
      step_number INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      assigned_user_id INTEGER REFERENCES users(id),
      assigned_role VARCHAR(100),
      due_date DATE,
      completed_at TIMESTAMP,
      completed_by INTEGER REFERENCES users(id),
      depends_on_step_id INTEGER REFERENCES process_steps(id),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      priority VARCHAR(20) DEFAULT 'normal',
      assigned_user_id INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      property_name VARCHAR(500),
      property_id INTEGER,
      contact_name VARCHAR(255),
      due_date DATE,
      due_time TIME,
      reminder_at TIMESTAMP,
      completed_at TIMESTAMP,
      completed_by INTEGER REFERENCES users(id),
      process_step_id INTEGER REFERENCES process_steps(id),
      category VARCHAR(100),
      tags TEXT[] DEFAULT '{}',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      process_step_id INTEGER REFERENCES process_steps(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      comment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      process_step_id INTEGER REFERENCES process_steps(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255),
      file_size INTEGER,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date, status);
    CREATE INDEX IF NOT EXISTS idx_process_steps_assigned ON process_steps(assigned_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_process_steps_process ON process_steps(process_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_processes_status ON processes(status);
    CREATE INDEX IF NOT EXISTS idx_processes_property ON processes(property_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      link TEXT,
      read_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
  `);

  await pool.query(
    `ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS auto_action VARCHAR(50)`
  );
  await pool.query(
    `ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS auto_action_config JSONB`
  );
  await pool.query(
    `ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS automation_status VARCHAR(20)`
  );
  await pool.query(
    `ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS automation_error TEXT`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'active',
      priority VARCHAR(20) DEFAULT 'normal',
      category VARCHAR(100),
      color VARCHAR(7) DEFAULT '#0098D0',
      icon VARCHAR(10) DEFAULT '📁',
      owner_user_id INTEGER REFERENCES users(id),
      property_name VARCHAR(500),
      property_id INTEGER,
      start_date DATE,
      target_date DATE,
      completed_at TIMESTAMP,
      budget NUMERIC(12,2),
      spent NUMERIC(12,2) DEFAULT 0,
      tags TEXT[] DEFAULT '{}',
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_milestones (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      due_date DATE,
      status VARCHAR(20) DEFAULT 'pending',
      completed_at TIMESTAMP,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_notes (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      title VARCHAR(255),
      content TEXT NOT NULL,
      is_pinned BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      role VARCHAR(50) DEFAULT 'member',
      added_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id);
  `);

  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_field_definitions (
      id SERIAL PRIMARY KEY,
      entity_type VARCHAR(20) NOT NULL,
      entity_id INTEGER NOT NULL,
      field_name VARCHAR(255) NOT NULL,
      field_label VARCHAR(255) NOT NULL,
      field_type VARCHAR(30) NOT NULL,
      field_config JSONB DEFAULT '{}',
      is_required BOOLEAN DEFAULT false,
      sort_order INTEGER DEFAULT 0,
      section_name VARCHAR(100) DEFAULT 'Details',
      placeholder TEXT,
      help_text TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS custom_field_values (
      id SERIAL PRIMARY KEY,
      field_definition_id INTEGER REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
      entity_type VARCHAR(20) NOT NULL,
      entity_id INTEGER NOT NULL,
      value_text TEXT,
      value_number NUMERIC(12,2),
      value_boolean BOOLEAN,
      value_date DATE,
      value_datetime TIMESTAMP,
      value_json JSONB,
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(field_definition_id, entity_type, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cfd_entity ON custom_field_definitions(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_cfv_entity ON custom_field_values(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_cfv_definition ON custom_field_values(field_definition_id);
  `);

  // Process stages (optional grouping of steps)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS process_template_stages (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      stage_order INTEGER DEFAULT 0,
      color VARCHAR(7),
      icon VARCHAR(10),
      is_gate BOOLEAN DEFAULT false,
      gate_condition JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS process_stages (
      id SERIAL PRIMARY KEY,
      process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE,
      template_stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      stage_order INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'pending',
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_process_template_stages_tpl
      ON process_template_stages(template_id, stage_order);
    CREATE INDEX IF NOT EXISTS idx_process_stages_process
      ON process_stages(process_id, stage_order);
  `);

  await pool.query(
    `ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS stage_id INTEGER REFERENCES process_stages(id) ON DELETE SET NULL`
  );

  // Conditional logic
  await pool.query(`
    CREATE TABLE IF NOT EXISTS process_conditions (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES process_templates(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      trigger_type VARCHAR(50) NOT NULL,
      trigger_config JSONB NOT NULL DEFAULT '{}',
      action_type VARCHAR(50) NOT NULL,
      action_config JSONB NOT NULL DEFAULT '{}',
      is_active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS process_condition_log (
      id SERIAL PRIMARY KEY,
      condition_id INTEGER REFERENCES process_conditions(id) ON DELETE SET NULL,
      process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE,
      trigger_type VARCHAR(50),
      action_type VARCHAR(50),
      result VARCHAR(20),
      details JSONB,
      executed_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_process_conditions_tpl_trigger
      ON process_conditions(template_id, trigger_type, is_active);
    CREATE INDEX IF NOT EXISTS idx_process_condition_log_process
      ON process_condition_log(process_id, executed_at DESC);
  `);

  // Custom due dates + instructions on template/process steps
  await pool.query(
    `ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS due_date_type VARCHAR(30) DEFAULT 'offset_from_start'`
  );
  await pool.query(
    `ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS due_date_config JSONB DEFAULT '{}'`
  );
  await pool.query(
    `ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS instructions TEXT`
  );
  await pool.query(
    `ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS due_date_type VARCHAR(30) DEFAULT 'offset_from_start'`
  );
  await pool.query(
    `ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS due_date_config JSONB DEFAULT '{}'`
  );
  await pool.query(
    `ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS instructions TEXT`
  );

  // Task enhancements: due date types, instructions, parent_task_id, dependencies
  await pool.query(
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date_type VARCHAR(30) DEFAULT 'fixed_date'`
  );
  await pool.query(
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date_config JSONB DEFAULT '{}'`
  );
  await pool.query(
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS instructions TEXT`
  );
  await pool.query(
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE`
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      dependency_type VARCHAR(20) DEFAULT 'blocks',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(task_id, depends_on_task_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_dependencies_dep ON task_dependencies(depends_on_task_id);
  `);

  // Board-view stage enhancements
  await pool.query(
    `ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS text_color VARCHAR(7) DEFAULT '#042C53'`
  );
  await pool.query(
    `ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT false`
  );
  await pool.query(
    `ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS auto_advance BOOLEAN DEFAULT true`
  );
  await pool.query(
    `ALTER TABLE processes ADD COLUMN IF NOT EXISTS current_stage_id INTEGER REFERENCES process_template_stages(id)`
  );
  await pool.query(
    `ALTER TABLE processes ADD COLUMN IF NOT EXISTS board_position INTEGER DEFAULT 0`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_processes_current_stage ON processes(current_stage_id)`
  );

  // --- Spec Part 1: advanced board system tables ---
  await pool.query(`
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

    CREATE INDEX IF NOT EXISTS idx_process_automations_template ON process_automations(template_id, status);
    CREATE INDEX IF NOT EXISTS idx_process_automation_log_automation ON process_automation_log(automation_id, executed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_drip_campaigns_stage ON process_drip_campaigns(stage_id);
    CREATE INDEX IF NOT EXISTS idx_drip_log_process ON process_drip_log(process_id);
    CREATE INDEX IF NOT EXISTS idx_task_templates_template ON task_templates(template_id);
    CREATE INDEX IF NOT EXISTS idx_cross_board_rules_source ON process_cross_board_rules(source_template_id);
  `);

  // --- Alters on existing tables for board + aging + task enhancements ---
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS task_type VARCHAR(20) DEFAULT 'todo'`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS task_config JSONB DEFAULT '{}'`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium'`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS start_date TIMESTAMP`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS comments TEXT`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS related_contact_name VARCHAR(255)`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS related_contact_email VARCHAR(255)`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS related_contact_phone VARCHAR(50)`);

  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS last_activity_type VARCHAR(50)`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS last_activity_by INTEGER REFERENCES users(id)`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS automations_fired JSONB DEFAULT '[]'`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);

  await pool.query(`ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS aging_green_hours INTEGER DEFAULT 48`);
  await pool.query(`ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS aging_yellow_hours INTEGER DEFAULT 96`);
  await pool.query(`ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS card_badge_field VARCHAR(50) DEFAULT 'due_date'`);
  await pool.query(`ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS assignment_rule VARCHAR(30) DEFAULT 'manual'`);
  await pool.query(`ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS assignment_config JSONB DEFAULT '{}'`);
  await pool.query(`ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS duplication_rule VARCHAR(30) DEFAULT 'none'`);

  // --- LeadSimple-style features (migration 015) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS process_type_roles (
      id SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,
      role_name VARCHAR(100) NOT NULL,
      is_required BOOLEAN DEFAULT false,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(template_id, role_name)
    );

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
  `);

  // Phase 3: link email/text templates to workflow steps + route messages.
  await pool.query(`ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS task_type VARCHAR(20) DEFAULT 'todo'`);
  await pool.query(`ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS email_template_id INTEGER REFERENCES process_email_templates(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS text_template_id INTEGER REFERENCES process_text_templates(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(30) DEFAULT 'tenant'`);
  await pool.query(`ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS recipient_value VARCHAR(255)`);
  await pool.query(`ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS send_timing VARCHAR(20) DEFAULT 'immediately'`);
  await pool.query(`ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS delay_amount INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS delay_unit VARCHAR(10) DEFAULT 'days'`);

  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS email_template_id INTEGER REFERENCES process_email_templates(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS text_template_id INTEGER REFERENCES process_text_templates(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(30) DEFAULT 'tenant'`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS recipient_value VARCHAR(255)`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS send_timing VARCHAR(20) DEFAULT 'immediately'`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS scheduled_send_at TIMESTAMP`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP`);
  await pool.query(`ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS sent_communication_id INTEGER`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_process_steps_scheduled_send ON process_steps(scheduled_send_at) WHERE scheduled_send_at IS NOT NULL AND sent_at IS NULL`);

  // Phase 4: autopilot rules + execution log.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS process_autopilot_rules (
      id SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      is_enabled BOOLEAN DEFAULT FALSE,
      frequency VARCHAR(10) NOT NULL DEFAULT 'month',
      day_of_period INTEGER DEFAULT 1,
      time_of_day TIME DEFAULT '06:00:00',
      timezone VARCHAR(64) DEFAULT 'America/Chicago',
      starting_stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL,
      condition_entity VARCHAR(20) DEFAULT 'unit',
      conditions JSONB DEFAULT '[]'::jsonb,
      process_name_template VARCHAR(500),
      prevent_duplicate BOOLEAN DEFAULT TRUE,
      duplicate_check_field VARCHAR(100) DEFAULT 'property_name',
      last_run_at TIMESTAMP,
      next_run_at TIMESTAMP,
      total_runs INTEGER DEFAULT 0,
      total_processes_created INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_par_template ON process_autopilot_rules(template_id);
    CREATE INDEX IF NOT EXISTS idx_par_next_run
      ON process_autopilot_rules(next_run_at) WHERE is_enabled = TRUE;

    CREATE TABLE IF NOT EXISTS process_autopilot_log (
      id SERIAL PRIMARY KEY,
      rule_id INTEGER NOT NULL REFERENCES process_autopilot_rules(id) ON DELETE CASCADE,
      run_at TIMESTAMP DEFAULT NOW(),
      status VARCHAR(20) DEFAULT 'success',
      entities_matched INTEGER DEFAULT 0,
      processes_created INTEGER DEFAULT 0,
      duplicates_skipped INTEGER DEFAULT 0,
      errors JSONB,
      details JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_pal_rule ON process_autopilot_log(rule_id, run_at DESC);
  `);
  await pool.query(`ALTER TABLE process_templates ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT TRUE`);

  // Hotfix: process_automations.test_card_id was created without an ON DELETE
  // rule, so deleting a process that any automation referenced as its test
  // card raised a foreign-key error. Re-add the constraint with SET NULL.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'process_automations'
          AND constraint_name = 'process_automations_test_card_id_fkey'
      ) THEN
        ALTER TABLE process_automations DROP CONSTRAINT process_automations_test_card_id_fkey;
      END IF;
      ALTER TABLE process_automations
        ADD CONSTRAINT process_automations_test_card_id_fkey
        FOREIGN KEY (test_card_id) REFERENCES processes(id) ON DELETE SET NULL;
    END$$;
  `);

  await pool.query(`ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'active'`);
  await pool.query(`ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS exit_rule VARCHAR(50) DEFAULT 'manual'`);
  await pool.query(`ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS short_name VARCHAR(50)`);
  await pool.query(`ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS default_days INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS parent_process_id INTEGER REFERENCES processes(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_processes_parent ON processes(parent_process_id)`);

  // Seed default stages per template if that template has none yet.
  const STAGE_SEEDS = {
    "New Owner Onboarding": [
      ["Lead", "#B5D4F4", "#042C53", false],
      ["PMA Signed", "#CECBF6", "#26215C", false],
      ["Setup", "#FAC775", "#412402", false],
      ["Inspection", "#9FE1CB", "#04342C", false],
      ["Go Live", "#C0DD97", "#173404", true],
    ],
    "Move-In Process": [
      ["Lease Signed", "#B5D4F4", "#042C53", false],
      ["Pre-Move-In Prep", "#FAC775", "#412402", false],
      ["Move-In Day", "#9FE1CB", "#04342C", false],
      ["Follow-Up", "#C0DD97", "#173404", true],
    ],
    "Move-Out / Turnover": [
      ["Notice Received", "#B5D4F4", "#042C53", false],
      ["Pre-Inspection", "#CECBF6", "#26215C", false],
      ["Move-Out Day", "#FAC775", "#412402", false],
      ["Make-Ready", "#F5C4B3", "#4A1B0C", false],
      ["Deposit Settled", "#9FE1CB", "#04342C", false],
      ["Relisted", "#C0DD97", "#173404", true],
    ],
    "Lease Renewal": [
      ["Notice Sent", "#B5D4F4", "#042C53", false],
      ["Analysis", "#FAC775", "#412402", false],
      ["Tenant Response", "#9FE1CB", "#04342C", false],
      ["Lease Signing", "#C0DD97", "#173404", false],
      ["Complete", "#C0DD97", "#173404", true],
    ],
    "Maintenance Escalation": [
      ["Reported", "#F5C4B3", "#4A1B0C", false],
      ["Diagnosed", "#FAC775", "#412402", false],
      ["Vendor Dispatched", "#9FE1CB", "#04342C", false],
      ["Repair Complete", "#C0DD97", "#173404", false],
      ["Closed", "#C0DD97", "#173404", true],
    ],
    "Eviction Process": [
      ["Notice Period", "#F7C1C1", "#501313", false],
      ["Legal Filing", "#F09595", "#791F1F", false],
      ["Court Date", "#FAC775", "#412402", false],
      ["Judgment", "#9FE1CB", "#04342C", false],
      ["Possession", "#C0DD97", "#173404", true],
    ],
    "Owner Termination": [
      ["Request Received", "#F7C1C1", "#501313", false],
      ["Retention Attempt", "#FAC775", "#412402", false],
      ["Offboarding", "#9FE1CB", "#04342C", false],
      ["Complete", "#C0DD97", "#173404", true],
    ],
    "Annual Property Inspection": [
      ["Scheduled", "#B5D4F4", "#042C53", false],
      ["Inspection Day", "#FAC775", "#412402", false],
      ["Report & Follow-Up", "#9FE1CB", "#04342C", false],
      ["Complete", "#C0DD97", "#173404", true],
    ],
  };
  const { rows: existingTemplates } = await pool.query(
    `SELECT id, name FROM process_templates WHERE is_active = true`
  );
  for (const t of existingTemplates) {
    const seeds = STAGE_SEEDS[t.name];
    if (!seeds) continue;
    const { rows: existingStages } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM process_template_stages WHERE template_id = $1`,
      [t.id]
    );
    if (existingStages[0].c > 0) continue;
    for (const [i, [name, color, textColor, isFinal]] of seeds.entries()) {
      await pool.query(
        `INSERT INTO process_template_stages
           (template_id, name, stage_order, color, text_color, is_final, auto_advance)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [t.id, name, i, color, textColor, isFinal]
      );
    }
  }

  const { rows: existing } = await pool.query(`SELECT COUNT(*)::int AS c FROM process_templates`);
  if (existing[0].c > 0) return;

  const { rows: admin } = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`
  );
  const createdBy = admin[0]?.id ?? null;

  for (const t of STARTER_TEMPLATES) {
    await pool.query(
      `INSERT INTO process_templates (name, description, category, icon, color, estimated_days, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
      [t.name, t.description, t.category, t.icon, t.color, t.estimated_days, createdBy]
    );
  }
  console.log("[operations] Seeded 8 starter process templates.");
}
