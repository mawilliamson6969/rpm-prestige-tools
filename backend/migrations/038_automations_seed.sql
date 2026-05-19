-- Prestige Connect Phase 1: two starter automations so the UI has
-- something to demo + something to copy. Disabled by default — the
-- user flips the toggle once they've reviewed the step config.
--
-- 1. Emergency work order alert
--    Trigger: appfolio.work_order.created
--    Filter:  payload.priority equals "Emergency"
--    Send SMS:   "EMERGENCY at {{event.payload.property_address}}: {{event.payload.description}}"
--                (number left blank until the admin pastes Amanda's mobile)
--    Create card: dropped on the maintenance board for a human owner
--
-- 2. Auto-draft SMS reply
--    Trigger: openphone.message.received
--    AI draft: prompt -> context.draft
--    Create card: human-in-the-loop review before sending

DO $$
DECLARE
  v_id INTEGER;
BEGIN
  -- Emergency work order alert ------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM automations WHERE name = 'Emergency work order alert'
  ) THEN
    INSERT INTO automations (name, description, trigger_type, enabled)
    VALUES (
      'Emergency work order alert',
      'When AppFolio reports a work order with priority Emergency, text the maintenance coordinator and create a 4-hour card on the maintenance board.',
      'appfolio.work_order.created',
      false
    )
    RETURNING id INTO v_id;

    INSERT INTO automation_steps (automation_id, step_order, step_type, config) VALUES
      (v_id, 1, 'filter', jsonb_build_object(
        'field', 'event.payload.priority',
        'operator', 'equals',
        'value', 'Emergency'
      )),
      (v_id, 2, 'send_sms', jsonb_build_object(
        'to', '',
        'body', 'EMERGENCY at {{event.payload.property_address}}: {{event.payload.description}}'
      )),
      (v_id, 3, 'create_card', jsonb_build_object(
        'board_id', 0,
        'title', 'EMERGENCY: {{event.payload.property_address}}',
        'description', '{{event.payload.description}}',
        'due_in_hours', 4
      ));
  END IF;

  -- Auto-draft SMS reply -----------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM automations WHERE name = 'Auto-draft SMS reply'
  ) THEN
    INSERT INTO automations (name, description, trigger_type, enabled, max_runs_per_day)
    VALUES (
      'Auto-draft SMS reply',
      'When a tenant texts in, Claude drafts a reply and parks it on a review column. A human still has to send it.',
      'openphone.message.received',
      false,
      100
    )
    RETURNING id INTO v_id;

    INSERT INTO automation_steps (automation_id, step_order, step_type, config) VALUES
      (v_id, 1, 'ai_draft', jsonb_build_object(
        'prompt', 'You are Lori from Real Property Management Prestige. Draft a friendly, professional reply to this tenant message: {{event.payload.text}}',
        'output_key', 'draft',
        'max_tokens', 400
      )),
      (v_id, 2, 'create_card', jsonb_build_object(
        'board_id', 0,
        'title', 'Pending SMS reply',
        'description', 'Draft: {{context.draft}}\n\nIncoming from: {{event.payload.from}}\nOriginal: {{event.payload.text}}'
      ));
  END IF;
END $$;
