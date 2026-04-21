-- Operations Hub enhancements: stages, conditions, due date types, subtasks, dependencies.
-- Also created at runtime via ensureOperationsSchema in backend/lib/operationsSchema.js.

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

ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS stage_id INTEGER REFERENCES process_template_stages(id) ON DELETE SET NULL;
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS stage_id INTEGER REFERENCES process_stages(id) ON DELETE SET NULL;

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

ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS due_date_type VARCHAR(30) DEFAULT 'offset_from_start';
ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS due_date_config JSONB DEFAULT '{}';
ALTER TABLE process_template_steps ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS due_date_type VARCHAR(30) DEFAULT 'offset_from_start';
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS due_date_config JSONB DEFAULT '{}';
ALTER TABLE process_steps ADD COLUMN IF NOT EXISTS instructions TEXT;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date_type VARCHAR(30) DEFAULT 'fixed_date';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date_config JSONB DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS task_dependencies (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type VARCHAR(20) DEFAULT 'blocks',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_process_template_stages_tpl ON process_template_stages(template_id, stage_order);
CREATE INDEX IF NOT EXISTS idx_process_stages_process ON process_stages(process_id, stage_order);
CREATE INDEX IF NOT EXISTS idx_process_conditions_tpl_trigger ON process_conditions(template_id, trigger_type, is_active);
CREATE INDEX IF NOT EXISTS idx_process_condition_log_process ON process_condition_log(process_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_dep ON task_dependencies(depends_on_task_id);
