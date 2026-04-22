-- Board-view enhancements: text_color / is_final / auto_advance on stages,
-- current_stage_id + board_position on processes. Seeding happens at runtime
-- in ensureOperationsSchema so it's conditional on existing data.

ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS text_color VARCHAR(7) DEFAULT '#042C53';
ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT false;
ALTER TABLE process_template_stages ADD COLUMN IF NOT EXISTS auto_advance BOOLEAN DEFAULT true;

ALTER TABLE processes ADD COLUMN IF NOT EXISTS current_stage_id INTEGER REFERENCES process_template_stages(id);
ALTER TABLE processes ADD COLUMN IF NOT EXISTS board_position INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_processes_current_stage ON processes(current_stage_id);
