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
