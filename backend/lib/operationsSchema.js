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
