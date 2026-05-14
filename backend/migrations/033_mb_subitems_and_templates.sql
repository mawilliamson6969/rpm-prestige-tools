-- Phase 5: Subitems + embedded instructions.
--
-- Schema choice — subitems live in mb_items with parent_item_id rather
-- than in the dormant Phase 1 mb_subitems table:
--   * Subitems get the full column-machinery (values jsonb + every column
--     editor we built in Phase 3) for free.
--   * No fork of CRUD code between item and subitem.
--   * Phase 1's mb_subitems table (created but never written to) is left
--     in place — it would cost nothing and would create migration noise
--     to drop it.
--
-- Templates re-use Phase 1's mb_subitem_templates table, which already
-- carries an `instructions` JSONB column. Phase 5 keeps the whole 8-section
-- shape inside that one blob (objective / steps / decision_matrix /
-- email_templates / sms_templates / escalations / completion_checklist /
-- related_resources). A separate mb_instructions normalised table was
-- spec'd but adds complexity (8 rows per template) for no clear benefit
-- at this scale. See PHASE5_DEFERRED.md.
--
-- Trigger enforces the "no sub-sub-items" rule at the DB level. The API
-- layer pre-checks too, but the trigger is defence-in-depth.

-- ------------------------------------------------------------
-- 1. mb_items: subitem support
-- ------------------------------------------------------------

ALTER TABLE mb_items
  ADD COLUMN IF NOT EXISTS parent_item_id INTEGER
    REFERENCES mb_items(id) ON DELETE CASCADE;

ALTER TABLE mb_items
  ADD COLUMN IF NOT EXISTS subitem_template_id INTEGER
    REFERENCES mb_subitem_templates(id) ON DELETE SET NULL;

ALTER TABLE mb_items
  ADD COLUMN IF NOT EXISTS subitem_position NUMERIC;

ALTER TABLE mb_items
  ADD COLUMN IF NOT EXISTS subitem_detached_at TIMESTAMPTZ;

-- For detached or scratch (custom) subitems, the instructions blob lives
-- directly on the row. NULL means "still linked to template" — read
-- from the template instead.
ALTER TABLE mb_items
  ADD COLUMN IF NOT EXISTS instructions JSONB;

CREATE INDEX IF NOT EXISTS idx_mb_items_parent
  ON mb_items (parent_item_id, subitem_position)
  WHERE parent_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mb_items_subitem_template
  ON mb_items (subitem_template_id)
  WHERE subitem_template_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. No-sub-sub-items trigger
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION mb_items_block_sub_subitems()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_item_id IS NOT NULL THEN
    PERFORM 1 FROM mb_items p
      WHERE p.id = NEW.parent_item_id
        AND p.parent_item_id IS NOT NULL;
    IF FOUND THEN
      RAISE EXCEPTION 'Subitems cannot themselves have subitems (parent % is already a subitem).',
        NEW.parent_item_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mb_items_block_sub_subitems ON mb_items;
CREATE TRIGGER trg_mb_items_block_sub_subitems
  BEFORE INSERT OR UPDATE OF parent_item_id ON mb_items
  FOR EACH ROW EXECUTE FUNCTION mb_items_block_sub_subitems();

-- ------------------------------------------------------------
-- 3. mb_subitem_templates: Phase 5 columns
-- ------------------------------------------------------------

ALTER TABLE mb_subitem_templates
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- workflow_name groups templates into "starter packs" (e.g., five
-- templates all named 'Lease Renewal' get an "Add all 5" button in the
-- subitem picker). NULL = standalone template.
ALTER TABLE mb_subitem_templates
  ADD COLUMN IF NOT EXISTS workflow_name TEXT;

CREATE INDEX IF NOT EXISTS idx_mb_subitem_templates_archived
  ON mb_subitem_templates (archived_at);
CREATE INDEX IF NOT EXISTS idx_mb_subitem_templates_workflow
  ON mb_subitem_templates (board_id, workflow_name)
  WHERE workflow_name IS NOT NULL;

-- Phase 1 didn't enforce (board_id, name) uniqueness on templates;
-- add a partial unique index so the seed's ON CONFLICT works without
-- a primary key match.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mb_subitem_templates_board_name
  ON mb_subitem_templates (board_id, name);

-- ------------------------------------------------------------
-- 4. Per-subitem checklist state
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mb_subitem_checklist_state (
  id                 SERIAL PRIMARY KEY,
  subitem_item_id    INTEGER NOT NULL REFERENCES mb_items(id) ON DELETE CASCADE,
  checklist_item_id  TEXT NOT NULL,
  is_checked         BOOLEAN NOT NULL DEFAULT FALSE,
  checked_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checked_at         TIMESTAMPTZ,
  UNIQUE (subitem_item_id, checklist_item_id)
);

CREATE INDEX IF NOT EXISTS idx_mb_checklist_state_subitem
  ON mb_subitem_checklist_state (subitem_item_id);

-- ------------------------------------------------------------
-- 5. Seed: Lease Renewal workflow (5 templates on the Renewals board)
-- ------------------------------------------------------------
--
-- All five share workflow_name = 'Lease Renewal' so the picker can offer
-- "Add all 5 steps" as a single action. Each template's instructions
-- blob carries content for the relevant subset of the 8 sections (per
-- the Phase 5 spec's seed guidance). Names are prefixed "01." / "02." /
-- ... so they sort intuitively in the picker without relying on
-- mb_subitem_templates.position.

DO $$
DECLARE
  v_board_id INTEGER;
BEGIN
  SELECT id INTO v_board_id FROM mb_boards WHERE slug = 'renewals';
  IF v_board_id IS NULL THEN
    RAISE NOTICE 'Renewals board not seeded; skipping Lease Renewal template seed.';
    RETURN;
  END IF;

  -- 1. Identify renewal window
  INSERT INTO mb_subitem_templates
    (board_id, name, description, position, workflow_name, instructions, escalation_triggers, completion_checklist)
  VALUES (
    v_board_id,
    'Lease Renewal — 01. Identify renewal window',
    'Confirm the lease end date, determine the outreach window, and surface tenant/property context.',
    10,
    'Lease Renewal',
    jsonb_build_object(
      'objective', jsonb_build_object(
        'text', 'Confirm the lease end date for {{item.tenant_name}} at {{item.property}} and decide whether to begin renewal outreach now. Industry standard is to start the renewal conversation 90 days before lease end.'
      ),
      'steps', jsonb_build_object('steps', jsonb_build_array(
        jsonb_build_object('id','s1','text_html','Pull the most recent lease end date from AppFolio and compare with the value on this item.','text_plain','Pull the most recent lease end date from AppFolio and compare with the value on this item.','has_checkbox',true,'position',1),
        jsonb_build_object('id','s2','text_html','Check the tenant''s recent payment history and any open work orders. Note any concerns.','text_plain','Check the tenant''s recent payment history and any open work orders. Note any concerns.','has_checkbox',true,'position',2),
        jsonb_build_object('id','s3','text_html','Decide: proceed with renewal outreach, or recommend non-renewal? Use the decision matrix below.','text_plain','Decide: proceed with renewal outreach, or recommend non-renewal? Use the decision matrix below.','has_checkbox',false,'position',3)
      )),
      'decision_matrix', jsonb_build_object('rows', jsonb_build_array(
        jsonb_build_object('id','d1','condition','Renewal Score >= 70 and no open work orders','action','Proceed with renewal — move to Step 02.','position',1),
        jsonb_build_object('id','d2','condition','Renewal Score 40–69 or 1+ late payments in last 90 days','action','Flag for owner review before sending offer.','position',2),
        jsonb_build_object('id','d3','condition','Renewal Score < 40 or 3+ late payments / open complaints','action','Recommend non-renewal — skip to Step 05.','position',3)
      )),
      'email_templates', jsonb_build_object('templates', jsonb_build_array()),
      'sms_templates', jsonb_build_object('templates', jsonb_build_array()),
      'escalations', jsonb_build_object('text_html','Escalate to the property manager if the tenant has an active legal dispute or unresolved damage claim.','text_plain','Escalate to the property manager if the tenant has an active legal dispute or unresolved damage claim.'),
      'completion_checklist', jsonb_build_object('items', jsonb_build_array(
        jsonb_build_object('id','c1','label','Lease end date confirmed against AppFolio','is_required',true,'position',1),
        jsonb_build_object('id','c2','label','Tenant payment history reviewed','is_required',true,'position',2),
        jsonb_build_object('id','c3','label','Owner consulted (if score is 40–69)','is_required',false,'position',3)
      )),
      'related_resources', jsonb_build_object('resources', jsonb_build_array())
    ),
    '[]'::jsonb, '[]'::jsonb
  )
  ON CONFLICT (board_id, name) DO UPDATE
    SET description = EXCLUDED.description,
        instructions = EXCLUDED.instructions,
        workflow_name = EXCLUDED.workflow_name,
        updated_at = NOW();

  -- 2. Send renewal offer
  INSERT INTO mb_subitem_templates
    (board_id, name, description, position, workflow_name, instructions, escalation_triggers, completion_checklist)
  VALUES (
    v_board_id,
    'Lease Renewal — 02. Send renewal offer',
    'Send the renewal offer to the tenant with terms, due date, and a clear call to action.',
    20,
    'Lease Renewal',
    jsonb_build_object(
      'objective', jsonb_build_object(
        'text', 'Send {{item.tenant_name}} a clear, professional renewal offer for {{item.property}} with the agreed terms. Confirm receipt and set a response deadline.'
      ),
      'steps', jsonb_build_object('steps', jsonb_build_array(
        jsonb_build_object('id','s1','text_html','Confirm the renewal terms with the owner (rent, lease length, any incentives) before sending.','text_plain','Confirm the renewal terms with the owner before sending.','has_checkbox',true,'position',1),
        jsonb_build_object('id','s2','text_html','Send the renewal offer email (template below). Update the <strong>Renewal Offer Sent</strong> date on this item.','text_plain','Send the renewal offer email and update the Renewal Offer Sent date on this item.','has_checkbox',true,'position',2),
        jsonb_build_object('id','s3','text_html','Send a follow-up SMS so the offer doesn''t sit in their inbox unread.','text_plain','Send a follow-up SMS.','has_checkbox',true,'position',3),
        jsonb_build_object('id','s4','text_html','Set <strong>Status</strong> to <em>In Outreach</em> on the parent item.','text_plain','Set Status to In Outreach on the parent item.','has_checkbox',true,'position',4)
      )),
      'decision_matrix', jsonb_build_object('rows', jsonb_build_array()),
      'email_templates', jsonb_build_object('templates', jsonb_build_array(
        jsonb_build_object(
          'id','e1',
          'name','Initial renewal offer',
          'subject','Time to renew your lease at {{item.property}}',
          'body_html','<p>Hi {{item.tenant_name}},</p><p>Your lease at {{item.property}} is set to end on <strong>{{item.lease_end_date}}</strong>. We''d love to have you stay.</p><p>Below are the renewal terms for your next 12-month lease. Please review and let us know your decision by the response deadline.</p><p>[Renewal terms — fill in: monthly rent, lease length, security deposit changes, any incentives]</p><p>If you have questions, just reply to this email or text us. We''re happy to walk through anything.</p><p>Thanks,<br>The Property Management Team</p>',
          'body_plain','Hi {{item.tenant_name}},\n\nYour lease at {{item.property}} is set to end on {{item.lease_end_date}}. We''d love to have you stay.\n\nBelow are the renewal terms for your next 12-month lease. Please review and let us know your decision by the response deadline.\n\n[Renewal terms — fill in: monthly rent, lease length, security deposit changes, any incentives]\n\nIf you have questions, just reply to this email or text us. We''re happy to walk through anything.\n\nThanks,\nThe Property Management Team'
        )
      )),
      'sms_templates', jsonb_build_object('templates', jsonb_build_array(
        jsonb_build_object('id','sm1','name','Renewal offer SMS','body','Hi {{item.tenant_name}}, we just emailed you a lease renewal offer for {{item.property}}. Reply here if you have any questions or prefer to talk by phone. — Property Management')
      )),
      'escalations', jsonb_build_object('text_html','If you can''t reach the tenant after 48 hours, alert the property manager.','text_plain','If you can''t reach the tenant after 48 hours, alert the property manager.'),
      'completion_checklist', jsonb_build_object('items', jsonb_build_array(
        jsonb_build_object('id','c1','label','Owner-approved terms in hand','is_required',true,'position',1),
        jsonb_build_object('id','c2','label','Renewal offer email sent','is_required',true,'position',2),
        jsonb_build_object('id','c3','label','Renewal Offer Sent date updated on parent item','is_required',true,'position',3),
        jsonb_build_object('id','c4','label','Follow-up SMS sent','is_required',false,'position',4)
      )),
      'related_resources', jsonb_build_object('resources', jsonb_build_array())
    ),
    '[]'::jsonb, '[]'::jsonb
  )
  ON CONFLICT (board_id, name) DO UPDATE
    SET description = EXCLUDED.description,
        instructions = EXCLUDED.instructions,
        workflow_name = EXCLUDED.workflow_name,
        updated_at = NOW();

  -- 3. Follow up if no response
  INSERT INTO mb_subitem_templates
    (board_id, name, description, position, workflow_name, instructions, escalation_triggers, completion_checklist)
  VALUES (
    v_board_id,
    'Lease Renewal — 03. Follow up if no response',
    'Reach the tenant again if they haven''t responded to the initial offer within the response window.',
    30,
    'Lease Renewal',
    jsonb_build_object(
      'objective', jsonb_build_object(
        'text', 'Re-engage {{item.tenant_name}} if the initial renewal offer for {{item.property}} hasn''t received a response within 7 days. Make it easy for them to say yes — or to tell us they''re leaving.'
      ),
      'steps', jsonb_build_object('steps', jsonb_build_array(
        jsonb_build_object('id','s1','text_html','Confirm there''s been no response on email, SMS, or phone.','text_plain','Confirm there''s been no response on email, SMS, or phone.','has_checkbox',true,'position',1),
        jsonb_build_object('id','s2','text_html','Send the follow-up email (template below). Adjust tone based on the tenant''s history with us.','text_plain','Send the follow-up email.','has_checkbox',true,'position',2),
        jsonb_build_object('id','s3','text_html','If no response after another 5 days, call the tenant directly. Log the outcome on the parent item.','text_plain','If no response after another 5 days, call directly.','has_checkbox',true,'position',3),
        jsonb_build_object('id','s4','text_html','If still no response, set parent <strong>Status</strong> to <em>Awaiting Response</em> and notify the owner.','text_plain','If still no response, set parent Status to Awaiting Response and notify the owner.','has_checkbox',false,'position',4)
      )),
      'decision_matrix', jsonb_build_object('rows', jsonb_build_array()),
      'email_templates', jsonb_build_object('templates', jsonb_build_array(
        jsonb_build_object(
          'id','e1',
          'name','Renewal follow-up',
          'subject','Quick check-in on your renewal at {{item.property}}',
          'body_html','<p>Hi {{item.tenant_name}},</p><p>Just following up on the renewal offer we sent for your lease at {{item.property}} (ending {{item.lease_end_date}}). I want to make sure it didn''t get lost in your inbox.</p><p>Whether you''re planning to renew or move on, we''d love to know so we can plan ahead. A quick reply works — even a "still deciding" is helpful.</p><p>Happy to hop on a call if it''s easier.</p><p>Thanks,<br>The Property Management Team</p>',
          'body_plain','Hi {{item.tenant_name}},\n\nJust following up on the renewal offer we sent for your lease at {{item.property}} (ending {{item.lease_end_date}}). I want to make sure it didn''t get lost in your inbox.\n\nWhether you''re planning to renew or move on, we''d love to know so we can plan ahead. A quick reply works — even a "still deciding" is helpful.\n\nHappy to hop on a call if it''s easier.\n\nThanks,\nThe Property Management Team'
        )
      )),
      'sms_templates', jsonb_build_object('templates', jsonb_build_array()),
      'escalations', jsonb_build_object('text_html','After two unanswered follow-ups (email + SMS + phone call), escalate to the property manager. They will decide whether to assume non-renewal and begin pre-leasing the unit.','text_plain','After two unanswered follow-ups, escalate to the property manager.'),
      'completion_checklist', jsonb_build_object('items', jsonb_build_array(
        jsonb_build_object('id','c1','label','Follow-up email sent','is_required',true,'position',1),
        jsonb_build_object('id','c2','label','Phone call attempted (if email also unanswered)','is_required',false,'position',2),
        jsonb_build_object('id','c3','label','Outcome logged on parent item','is_required',true,'position',3)
      )),
      'related_resources', jsonb_build_object('resources', jsonb_build_array())
    ),
    '[]'::jsonb, '[]'::jsonb
  )
  ON CONFLICT (board_id, name) DO UPDATE
    SET description = EXCLUDED.description,
        instructions = EXCLUDED.instructions,
        workflow_name = EXCLUDED.workflow_name,
        updated_at = NOW();

  -- 4. Process renewal acceptance
  INSERT INTO mb_subitem_templates
    (board_id, name, description, position, workflow_name, instructions, escalation_triggers, completion_checklist)
  VALUES (
    v_board_id,
    'Lease Renewal — 04. Process renewal acceptance',
    'Once the tenant accepts, generate and execute the new lease, then update the system of record.',
    40,
    'Lease Renewal',
    jsonb_build_object(
      'objective', jsonb_build_object(
        'text', 'Lock in the renewal for {{item.tenant_name}} at {{item.property}}: generate the new lease, get it signed, and update AppFolio + this board.'
      ),
      'steps', jsonb_build_object('steps', jsonb_build_array(
        jsonb_build_object('id','s1','text_html','Generate the renewal lease in AppFolio with the agreed terms.','text_plain','Generate the renewal lease in AppFolio.','has_checkbox',true,'position',1),
        jsonb_build_object('id','s2','text_html','Send the lease for e-signature. Track until both parties have signed.','text_plain','Send for e-signature.','has_checkbox',true,'position',2),
        jsonb_build_object('id','s3','text_html','Update AppFolio: new lease term, rent, and any addendums.','text_plain','Update AppFolio with the new lease.','has_checkbox',true,'position',3),
        jsonb_build_object('id','s4','text_html','Set parent <strong>Status</strong> to <em>Renewed</em>. Move to the next renewal in the queue.','text_plain','Set parent Status to Renewed.','has_checkbox',true,'position',4)
      )),
      'decision_matrix', jsonb_build_object('rows', jsonb_build_array()),
      'email_templates', jsonb_build_object('templates', jsonb_build_array(
        jsonb_build_object(
          'id','e1',
          'name','Lease signing confirmation',
          'subject','Your renewed lease at {{item.property}} is ready to sign',
          'body_html','<p>Hi {{item.tenant_name}},</p><p>Great news — your renewed lease for {{item.property}} is ready. We''ve sent it to you for e-signature in a separate email. Please review and sign within 5 business days.</p><p>If anything doesn''t match what we discussed, reply here right away and we''ll fix it.</p><p>Thanks,<br>The Property Management Team</p>',
          'body_plain','Hi {{item.tenant_name}},\n\nGreat news — your renewed lease for {{item.property}} is ready. We''ve sent it to you for e-signature in a separate email. Please review and sign within 5 business days.\n\nIf anything doesn''t match what we discussed, reply here right away and we''ll fix it.\n\nThanks,\nThe Property Management Team'
        )
      )),
      'sms_templates', jsonb_build_object('templates', jsonb_build_array()),
      'escalations', jsonb_build_object('text_html','If the tenant pushes back on terms after acceptance, loop in the owner before negotiating.','text_plain','If the tenant pushes back on terms after acceptance, loop in the owner before negotiating.'),
      'completion_checklist', jsonb_build_object('items', jsonb_build_array(
        jsonb_build_object('id','c1','label','New lease generated in AppFolio','is_required',true,'position',1),
        jsonb_build_object('id','c2','label','Lease sent for e-signature','is_required',true,'position',2),
        jsonb_build_object('id','c3','label','Both parties have signed','is_required',true,'position',3),
        jsonb_build_object('id','c4','label','AppFolio updated with new term/rent','is_required',true,'position',4),
        jsonb_build_object('id','c5','label','Parent Status set to Renewed','is_required',true,'position',5)
      )),
      'related_resources', jsonb_build_object('resources', jsonb_build_array(
        jsonb_build_object('id','r1','label','AppFolio lease generation guide (internal)','url','https://help.appfolio.com/','position',1)
      ))
    ),
    '[]'::jsonb, '[]'::jsonb
  )
  ON CONFLICT (board_id, name) DO UPDATE
    SET description = EXCLUDED.description,
        instructions = EXCLUDED.instructions,
        workflow_name = EXCLUDED.workflow_name,
        updated_at = NOW();

  -- 5. Handle non-renewal
  INSERT INTO mb_subitem_templates
    (board_id, name, description, position, workflow_name, instructions, escalation_triggers, completion_checklist)
  VALUES (
    v_board_id,
    'Lease Renewal — 05. Handle non-renewal',
    'Process a non-renewal cleanly: confirm move-out date, brief the maintenance team, prepare for re-leasing.',
    50,
    'Lease Renewal',
    jsonb_build_object(
      'objective', jsonb_build_object(
        'text', 'Run the playbook when {{item.tenant_name}} is leaving {{item.property}}. Goal: minimize vacancy and prepare the unit for the next tenant.'
      ),
      'steps', jsonb_build_object('steps', jsonb_build_array(
        jsonb_build_object('id','s1','text_html','Confirm the tenant''s intent to vacate in writing (email is fine).','text_plain','Confirm the tenant''s intent to vacate in writing.','has_checkbox',true,'position',1),
        jsonb_build_object('id','s2','text_html','Schedule the move-out inspection for the lease end date or within 3 days after.','text_plain','Schedule the move-out inspection.','has_checkbox',true,'position',2),
        jsonb_build_object('id','s3','text_html','Brief the maintenance team on turnover scope (clean, paint, repairs).','text_plain','Brief the maintenance team on turnover scope.','has_checkbox',true,'position',3),
        jsonb_build_object('id','s4','text_html','Begin pre-leasing — list the unit, schedule showings.','text_plain','Begin pre-leasing.','has_checkbox',true,'position',4),
        jsonb_build_object('id','s5','text_html','Set parent <strong>Status</strong> to <em>Not Renewing</em>.','text_plain','Set parent Status to Not Renewing.','has_checkbox',true,'position',5)
      )),
      'decision_matrix', jsonb_build_object('rows', jsonb_build_array(
        jsonb_build_object('id','d1','condition','Tenant gave proper notice (30+ days)','action','Standard turnover; release security deposit per state rules.','position',1),
        jsonb_build_object('id','d2','condition','Tenant did NOT give proper notice','action','Review lease for early-termination clauses; consult owner before final disposition.','position',2),
        jsonb_build_object('id','d3','condition','Tenant abandoned the unit (no notice, no contact)','action','Escalate to the property manager and legal counsel.','position',3)
      )),
      'email_templates', jsonb_build_object('templates', jsonb_build_array()),
      'sms_templates', jsonb_build_object('templates', jsonb_build_array()),
      'escalations', jsonb_build_object('text_html','If the tenant is leaving under acrimonious circumstances or there are outstanding balances or damages, involve the property manager before close-out.','text_plain','If the tenant is leaving under acrimonious circumstances or there are outstanding balances or damages, involve the property manager.'),
      'completion_checklist', jsonb_build_object('items', jsonb_build_array(
        jsonb_build_object('id','c1','label','Move-out date confirmed','is_required',true,'position',1),
        jsonb_build_object('id','c2','label','Move-out inspection scheduled','is_required',true,'position',2),
        jsonb_build_object('id','c3','label','Maintenance turnover briefed','is_required',true,'position',3),
        jsonb_build_object('id','c4','label','Unit listed for pre-leasing','is_required',false,'position',4),
        jsonb_build_object('id','c5','label','Parent Status set to Not Renewing','is_required',true,'position',5)
      )),
      'related_resources', jsonb_build_object('resources', jsonb_build_array())
    ),
    '[]'::jsonb, '[]'::jsonb
  )
  ON CONFLICT (board_id, name) DO UPDATE
    SET description = EXCLUDED.description,
        instructions = EXCLUDED.instructions,
        workflow_name = EXCLUDED.workflow_name,
        updated_at = NOW();
END $$;
