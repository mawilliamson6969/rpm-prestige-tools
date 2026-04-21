-- Custom fields: reusable field definitions + per-entity values for
-- process templates, processes, projects, and process steps.
-- Also created at runtime via ensureOperationsSchema in backend/lib/operationsSchema.js.

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
