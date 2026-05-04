-- Phase 3: link email/text templates to workflow steps and route messages to
-- the right recipient. Also adds a scheduled-sends table for delayed steps
-- (Phase 3 only handles immediate; cron pickup arrives in Phase 4).
-- Also created at runtime via ensureOperationsSchema in backend/lib/operationsSchema.js.

ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS task_type VARCHAR(20) DEFAULT 'todo';
ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS email_template_id INTEGER
    REFERENCES process_email_templates(id) ON DELETE SET NULL;
ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS text_template_id INTEGER
    REFERENCES process_text_templates(id) ON DELETE SET NULL;
ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(30) DEFAULT 'tenant';
ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS recipient_value VARCHAR(255);
ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS send_timing VARCHAR(20) DEFAULT 'immediately';
ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS delay_amount INTEGER DEFAULT 0;
ALTER TABLE process_template_steps
  ADD COLUMN IF NOT EXISTS delay_unit VARCHAR(10) DEFAULT 'days';

-- Mirror to running steps so the launched copy carries the link.
ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS email_template_id INTEGER
    REFERENCES process_email_templates(id) ON DELETE SET NULL;
ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS text_template_id INTEGER
    REFERENCES process_text_templates(id) ON DELETE SET NULL;
ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(30) DEFAULT 'tenant';
ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS recipient_value VARCHAR(255);
ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS send_timing VARCHAR(20) DEFAULT 'immediately';
ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS scheduled_send_at TIMESTAMP;
ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;
ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS sent_communication_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_process_steps_scheduled_send
  ON process_steps(scheduled_send_at)
  WHERE scheduled_send_at IS NOT NULL AND sent_at IS NULL;

SELECT 'Migration 016 — process step messaging links ready' AS status;
