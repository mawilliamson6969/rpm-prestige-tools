-- Operations Hub: process templates, active processes, and standalone tasks.
-- Also created at runtime via ensureOperationsSchema in backend/lib/operationsSchema.js.

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
