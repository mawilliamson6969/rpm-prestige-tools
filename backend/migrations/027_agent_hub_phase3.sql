-- Phase 3: automation engine + compliance + send infrastructure.
--
-- Builds on Phases 1 + 2. Phase 1 must apply (agent_hub_agents,
-- agent_hub_personal_details, agent_hub_audit_log, etc.) and Phase 2
-- must apply (agent_hub_referrals, agent_hub_tasks, etc.) before this.
--
-- Out of scope (Phase 4+):
--   * HAR Matrix CSV upload
--   * Lob.com integration (postcards stay in manual print queue)
--   * Predictive analytics, market data fetching
--
-- Conventions match Phases 1+2: SERIAL pks, INTEGER FKs, TIMESTAMPTZ
-- DEFAULT NOW(), CHECK enums, idempotent IF NOT EXISTS, applied at
-- boot via ensureAgentHubPhase3Schema().

-- ============================================================
-- 1. agent_hub_automations
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_automations (
  id                          SERIAL PRIMARY KEY,
  name                        TEXT NOT NULL,
  slug                        TEXT NOT NULL,
  description                 TEXT,
  enabled                     BOOLEAN NOT NULL DEFAULT FALSE,
  is_system                   BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_type                TEXT NOT NULL,
  trigger_config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  conditions                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  cooldown_period_days        INTEGER,
  max_runs_per_agent          INTEGER,
  requires_approval           BOOLEAN NOT NULL DEFAULT TRUE,
  approval_window_hours       INTEGER NOT NULL DEFAULT 48,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (trigger_type IN ('time_based', 'event_based', 'manual')),
  CHECK (cooldown_period_days IS NULL OR cooldown_period_days >= 0),
  CHECK (max_runs_per_agent IS NULL OR max_runs_per_agent > 0),
  CHECK (approval_window_hours > 0 AND approval_window_hours <= 720)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_automations_name ON agent_hub_automations (name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_automations_slug ON agent_hub_automations (slug);
CREATE INDEX IF NOT EXISTS idx_agent_hub_automations_enabled ON agent_hub_automations (enabled);
CREATE INDEX IF NOT EXISTS idx_agent_hub_automations_trigger_type ON agent_hub_automations (trigger_type);

DROP TRIGGER IF EXISTS trg_agent_hub_automations_updated_at ON agent_hub_automations;
CREATE TRIGGER trg_agent_hub_automations_updated_at
  BEFORE UPDATE ON agent_hub_automations
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 2. agent_hub_automation_runs
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_automation_runs (
  id                              SERIAL PRIMARY KEY,
  automation_id                   INTEGER NOT NULL REFERENCES agent_hub_automations(id) ON DELETE CASCADE,
  agent_id                        INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  triggered_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_by                    TEXT NOT NULL,
  triggered_by_event_id           TEXT,
  status                          TEXT NOT NULL DEFAULT 'pending_approval',
  skipped_reason                  TEXT,
  approval_required_until         TIMESTAMPTZ,
  approved_at                     TIMESTAMPTZ,
  approved_by                     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at                    TIMESTAMPTZ,
  cancelled_by                    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancelled_reason                TEXT,
  completed_at                    TIMESTAMPTZ,
  actions_total                   INTEGER NOT NULL DEFAULT 0,
  actions_completed               INTEGER NOT NULL DEFAULT 0,
  actions_failed                  INTEGER NOT NULL DEFAULT 0,
  error_log                       JSONB NOT NULL DEFAULT '[]'::jsonb,
  simulator_output                JSONB,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending_approval','approved','running','completed','failed','skipped','cancelled','simulator')),
  CHECK (triggered_by IN ('cron','event','manual','simulator'))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_runs_status ON agent_hub_automation_runs (status);
CREATE INDEX IF NOT EXISTS idx_agent_hub_runs_agent ON agent_hub_automation_runs (agent_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_runs_automation ON agent_hub_automation_runs (automation_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_runs_pending_approval
  ON agent_hub_automation_runs (approval_required_until)
  WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS idx_agent_hub_runs_pending_execution
  ON agent_hub_automation_runs (status, triggered_at)
  WHERE status IN ('approved','running');

-- Idempotency:
--   * Event-based: one run per (automation, agent, event_id) — prevents
--     double-firing on event retries. Excludes simulator runs.
--   * Time-based + manual: one run per (automation, agent, calendar day).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_runs_event
  ON agent_hub_automation_runs (automation_id, agent_id, triggered_by_event_id)
  WHERE triggered_by_event_id IS NOT NULL AND triggered_by != 'simulator';
-- triggered_at is TIMESTAMPTZ. Casting timestamptz -> date is STABLE
-- (it depends on the session timezone) so Postgres refuses to use it
-- in an index expression. Anchoring to UTC via AT TIME ZONE 'UTC' yields
-- a timestamp WITHOUT time zone, and timestamp::date IS immutable. UTC
-- is the right anchor because the idempotency window is "one run per
-- calendar day globally," not per-viewer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_runs_daily
  ON agent_hub_automation_runs (
    automation_id,
    agent_id,
    (((triggered_at AT TIME ZONE 'UTC')::date))
  )
  WHERE triggered_by_event_id IS NULL AND triggered_by != 'simulator';

-- ============================================================
-- 3. agent_hub_automation_action_queue
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_automation_action_queue (
  id                  SERIAL PRIMARY KEY,
  automation_run_id   INTEGER NOT NULL REFERENCES agent_hub_automation_runs(id) ON DELETE CASCADE,
  sequence_index      INTEGER NOT NULL,
  action_type         TEXT NOT NULL,
  action_config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              TEXT NOT NULL DEFAULT 'pending',
  executing_at        TIMESTAMPTZ,                 -- Lease timestamp; protects against worker crash mid-execute
  executed_at         TIMESTAMPTZ,
  external_id         TEXT,                         -- Set BEFORE send to claim idempotency
  result              JSONB,
  error_text          TEXT,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  CHECK (status IN ('pending','executing','completed','failed','skipped')),
  CHECK (action_type IN (
    'wait','send_email','send_sms','queue_postcard','queue_letter',
    'log_activity','update_agent_field','create_task','notify_team',
    'branch','end_sequence'
  ))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_actq_run
  ON agent_hub_automation_action_queue (automation_run_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_agent_hub_actq_pending
  ON agent_hub_automation_action_queue (status, scheduled_for)
  WHERE status IN ('pending','executing');

-- ============================================================
-- 4. agent_hub_message_templates
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_message_templates (
  id                  SERIAL PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  channel             TEXT NOT NULL,
  subject             TEXT,                          -- emails only
  body                TEXT NOT NULL,
  body_html           TEXT,                          -- emails: rich version
  merge_fields_used   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  is_system           BOOLEAN NOT NULL DEFAULT FALSE,
  category            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (channel IN ('email','sms','postcard','letter')),
  CHECK (category IS NULL OR category IN ('birthday','onboarding','dormant','thank_you','market_update','general')),
  -- CAN-SPAM / consent: every email template MUST contain unsubscribe + physical address.
  -- BOTH body and body_html (when provided) must contain the merge fields,
  -- because sendEmail uses body_html when present. App layer validateTemplate()
  -- mirrors this for friendlier errors.
  CHECK (
    channel != 'email' OR (
      body LIKE '%{{unsubscribe_link}}%' AND body LIKE '%{{physical_address}}%'
      AND (
        body_html IS NULL
        OR (body_html LIKE '%{{unsubscribe_link}}%' AND body_html LIKE '%{{physical_address}}%')
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_templates_channel ON agent_hub_message_templates (channel);
CREATE INDEX IF NOT EXISTS idx_agent_hub_templates_category ON agent_hub_message_templates (category);

DROP TRIGGER IF EXISTS trg_agent_hub_templates_updated_at ON agent_hub_message_templates;
CREATE TRIGGER trg_agent_hub_templates_updated_at
  BEFORE UPDATE ON agent_hub_message_templates
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

-- ============================================================
-- 5. agent_hub_send_log
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_send_log (
  id                      SERIAL PRIMARY KEY,
  agent_id                INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE RESTRICT,
  channel                 TEXT NOT NULL,
  direction               TEXT NOT NULL DEFAULT 'outbound',
  automation_run_id       INTEGER REFERENCES agent_hub_automation_runs(id) ON DELETE SET NULL,
  action_queue_id         INTEGER REFERENCES agent_hub_automation_action_queue(id) ON DELETE SET NULL,
  template_id             INTEGER REFERENCES agent_hub_message_templates(id) ON DELETE SET NULL,
  sent_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_address              TEXT NOT NULL,
  subject                 TEXT,
  body                    TEXT,
  external_id             TEXT,                       -- Graph msg id, OpenPhone msg id, postcard queue id
  delivery_status         TEXT NOT NULL DEFAULT 'sent',
  opened_at               TIMESTAMPTZ,
  clicked_at              TIMESTAMPTZ,
  replied_at              TIMESTAMPTZ,
  bounced_at              TIMESTAMPTZ,
  bounce_reason           TEXT,
  reply_external_id       TEXT,
  CHECK (channel IN ('email','sms','postcard','letter')),
  CHECK (direction IN ('outbound','inbound')),
  CHECK (delivery_status IN ('sent','delivered','opened','clicked','replied','bounced','failed','unknown'))
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_send_log_agent
  ON agent_hub_send_log (agent_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_send_log_channel
  ON agent_hub_send_log (channel, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_hub_send_log_status
  ON agent_hub_send_log (delivery_status);
CREATE INDEX IF NOT EXISTS idx_agent_hub_send_log_run
  ON agent_hub_send_log (automation_run_id)
  WHERE automation_run_id IS NOT NULL;
-- external_id unique among non-null — prevents double-logs from retries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hub_send_log_external
  ON agent_hub_send_log (channel, external_id)
  WHERE external_id IS NOT NULL;

-- ============================================================
-- 6. agent_hub_postcard_print_queue
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_postcard_print_queue (
  id                          SERIAL PRIMARY KEY,
  agent_id                    INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE RESTRICT,
  automation_run_id           INTEGER REFERENCES agent_hub_automation_runs(id) ON DELETE SET NULL,
  template_id                 INTEGER REFERENCES agent_hub_message_templates(id) ON DELETE SET NULL,
  rendered_subject            TEXT,
  rendered_body               TEXT NOT NULL,
  mailing_address             JSONB NOT NULL,           -- snapshot at queue time
  generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  printed_at                  TIMESTAMPTZ,
  mailed_at                   TIMESTAMPTZ,
  mailed_by                   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at                TIMESTAMPTZ,
  cancelled_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancelled_reason            TEXT,
  notes                       TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_postcard_pending
  ON agent_hub_postcard_print_queue (generated_at)
  WHERE mailed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_postcard_agent
  ON agent_hub_postcard_print_queue (agent_id, generated_at DESC);

-- ============================================================
-- 7. agent_hub_unsubscribe_tokens
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_hub_unsubscribe_tokens (
  id              SERIAL PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  agent_id        INTEGER NOT NULL REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  send_log_id     INTEGER REFERENCES agent_hub_send_log(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_unsub_tokens_agent
  ON agent_hub_unsubscribe_tokens (agent_id);

-- ============================================================
-- 8. agent_hub_dnc
-- ============================================================
-- Master DNC suppression list. Phase 1's `agent_hub_agents.do_not_contact`
-- column is the per-agent flag; this table tracks email/phone-level DNC
-- including for non-agent records (e.g. someone who unsubscribes via a
-- shared email used by multiple agents).

CREATE TABLE IF NOT EXISTS agent_hub_dnc (
  id              SERIAL PRIMARY KEY,
  agent_id        INTEGER REFERENCES agent_hub_agents(id) ON DELETE CASCADE,
  email           TEXT,
  phone           TEXT,
  reason          TEXT NOT NULL,
  source          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (reason IN ('unsubscribed','bounce_hard','manual','spam_complaint','reply_received')),
  -- At least one of agent_id, email, phone must be set so the row is meaningful.
  CHECK (agent_id IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_agent_hub_dnc_email
  ON agent_hub_dnc (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_dnc_phone
  ON agent_hub_dnc (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_hub_dnc_agent
  ON agent_hub_dnc (agent_id) WHERE agent_id IS NOT NULL;

-- ============================================================
-- 9. agent_hub_system_config
-- ============================================================
-- Single row keyed on id=1.

CREATE TABLE IF NOT EXISTS agent_hub_system_config (
  id                              INTEGER PRIMARY KEY DEFAULT 1,
  kill_switch_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  kill_switch_reason              TEXT,
  kill_switch_engaged_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kill_switch_engaged_at          TIMESTAMPTZ,
  rate_limit_emails_per_hour      INTEGER NOT NULL DEFAULT 50,
  rate_limit_emails_per_day       INTEGER NOT NULL DEFAULT 200,
  rate_limit_sms_per_hour         INTEGER NOT NULL DEFAULT 20,
  rate_limit_sms_per_day          INTEGER NOT NULL DEFAULT 100,
  default_sender_email            TEXT,
  default_sender_name             TEXT,
  physical_address                TEXT,                   -- CAN-SPAM footer
  referral_fee_offer_text         TEXT,
  referral_fee_landing_url        TEXT,
  -- Launch checklist gate. Engine refuses to flip enabled=true on any
  -- automation until this is set true via a deliberate owner click.
  launch_checklist_complete       BOOLEAN NOT NULL DEFAULT FALSE,
  launch_checklist_completed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  launch_checklist_completed_at   TIMESTAMPTZ,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (id = 1)
);

DROP TRIGGER IF EXISTS trg_agent_hub_sysconfig_updated_at ON agent_hub_system_config;
CREATE TRIGGER trg_agent_hub_sysconfig_updated_at
  BEFORE UPDATE ON agent_hub_system_config
  FOR EACH ROW EXECUTE FUNCTION agent_hub_touch_updated_at();

INSERT INTO agent_hub_system_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Phase 3 also adds personal_outreach_flag to agent_hub_agents (Phase 1 table).
-- Set to TRUE when an agent replies to an outbound automation, blocking
-- further automated sends until Mike/Lori clears it.
ALTER TABLE agent_hub_agents
  ADD COLUMN IF NOT EXISTS personal_outreach_flag BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agent_hub_agents
  ADD COLUMN IF NOT EXISTS personal_outreach_flagged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_hub_agents_personal_outreach
  ON agent_hub_agents (personal_outreach_flag)
  WHERE personal_outreach_flag = TRUE;

-- ============================================================
-- SEEDS: starter message templates (10)
-- ============================================================
-- Templates are seeded with is_system=true. Mike/Lori can edit copy
-- via the UI but cannot delete system templates.
--
-- Note: every email template includes {{unsubscribe_link}} and
-- {{physical_address}} as required by the CHECK constraint.

INSERT INTO agent_hub_message_templates (slug, name, channel, category, subject, body, is_system, merge_fields_used)
VALUES
  ('birthday_card_postcard', 'Birthday card (postcard)', 'postcard', 'birthday',
   NULL,
   $$Hope you have a great year ahead, {{first_name}}.

— Mike$$,
   TRUE,
   ARRAY['first_name']),
  ('partner_welcome_email', 'Partner welcome email', 'email', 'onboarding',
   'Welcome to the partner network, {{first_name}}',
   $$Hi {{first_name}},

You're now in our partner tier — which means whenever you send us an owner who signs a management agreement, we pay you {{referral_fee_offer_text}}. No tier review, no quarterly check-in, just a straightforward referral fee.

A few things to know:
- The relationship to sell stays with you. We manage; you remain the agent of record on any future sale.
- I'm reachable at this email or directly. Your dedicated point of contact is me, not a junior associate.
- We track every referral in a system so you can see status anytime — drop me a line if you want a login.

Looking forward to working together,
Mike
RPM Prestige

—
{{physical_address}}
{{unsubscribe_link}}$$,
   TRUE,
   ARRAY['first_name','referral_fee_offer_text','physical_address','unsubscribe_link']),
  ('partner_welcome_packet', 'Partner welcome packet (postcard)', 'postcard', 'onboarding',
   NULL,
   $${{first_name}},

Welcome aboard. Quick reference card with referral fee terms, my direct line, and what to send when an owner is ready to talk to us.

Direct: {{mike_direct_phone}}
Email: {{mike_email}}

— Mike, RPM Prestige$$,
   TRUE,
   ARRAY['first_name','mike_direct_phone','mike_email']),
  ('partner_30day_checkin', 'Partner 30-day check-in', 'email', 'onboarding',
   'Quick check-in',
   $$Hi {{first_name}},

A month into the partnership — anything you need from me?

A common question at the 30-day mark: "what kind of owners are best to send your way?" Short answer: any rental property the owner can't or doesn't want to manage themselves. SFR, condo, small multi, all fine. We'll talk to the owner and figure out fit.

Mike
RPM Prestige

—
{{physical_address}}
{{unsubscribe_link}}$$,
   TRUE,
   ARRAY['first_name','physical_address','unsubscribe_link']),
  ('dormant_checkin_email', 'Dormant re-engagement check-in', 'email', 'dormant',
   'Long time, {{first_name}}',
   $$Hi {{first_name}},

It's been a minute since we last connected. No pitch — just wanted to say I'm still here and the referral relationship is still open whenever you've got an owner who needs management.

Houston rentals are still tight. If you're hearing from owners who are tired of the management headache, send them my way.

Mike

—
{{physical_address}}
{{unsubscribe_link}}$$,
   TRUE,
   ARRAY['first_name','physical_address','unsubscribe_link']),
  ('dormant_market_postcard', 'Dormant market update (postcard)', 'postcard', 'dormant',
   NULL,
   $${{first_name}},

Houston rental market this quarter:
- Median rent: {{market_median_rent}}
- Avg days on market: {{market_avg_dom}}
- Vacancy: {{market_vacancy_pct}}

If owners are asking, send them my way.

— Mike
{{mike_direct_phone}}$$,
   TRUE,
   ARRAY['first_name','market_median_rent','market_avg_dom','market_vacancy_pct','mike_direct_phone']),
  ('post_conversion_thank_you_email', 'Post-conversion thank you email', 'email', 'thank_you',
   'Thank you for the referral on {{property_address}}',
   $$Hi {{first_name}},

Tenant is placed at {{property_address}} for {{owner_name}} — thank you for the referral.

A reminder of how this works:
- The sale relationship stays with you. We manage the property; we don't compete on the sale side.
- Your referral fee of {{referral_fee_offer_text}} will be paid within {{referral_fee_payment_window_days}} days.
- I'll send a first-month update so you can see how the property's doing.

Send the next one whenever you're ready.

Mike

—
{{physical_address}}
{{unsubscribe_link}}$$,
   TRUE,
   ARRAY['first_name','property_address','owner_name','referral_fee_offer_text','referral_fee_payment_window_days','physical_address','unsubscribe_link']),
  ('post_conversion_thank_you_postcard', 'Post-conversion thank you (postcard)', 'postcard', 'thank_you',
   NULL,
   $${{first_name}} —

Thank you for the referral on {{property_address}}. Genuinely appreciate it.

— Mike$$,
   TRUE,
   ARRAY['first_name','property_address']),
  ('first_month_check_in_email', 'First month check-in', 'email', 'thank_you',
   'First month update on {{property_address}}',
   $$Hi {{first_name}},

Quick update on {{property_address}}, one month in:
- Tenant moved in on time, no issues.
- Rent paid on time.
- {{first_month_summary}}

Let me know if {{owner_name}} is hearing anything I should be aware of.

Mike

—
{{physical_address}}
{{unsubscribe_link}}$$,
   TRUE,
   ARRAY['first_name','property_address','first_month_summary','owner_name','physical_address','unsubscribe_link']),
  ('quarterly_market_update_email', 'Quarterly market update', 'email', 'market_update',
   'Houston rental market — {{quarter}} update',
   $$Hi {{first_name}},

Quick {{quarter}} read on the Houston rental market for the partner network:

{{market_summary}}

What this means for your owner conversations:
{{partner_insight}}

As always, send any owners who need management our way. We'll handle the rest.

Mike

—
{{physical_address}}
{{unsubscribe_link}}$$,
   TRUE,
   ARRAY['first_name','quarter','market_summary','partner_insight','physical_address','unsubscribe_link'])
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- SEEDS: 5 starter automations
-- ============================================================
-- All seeded with enabled=false. Owner must complete the launch
-- checklist + click enable per-automation.

INSERT INTO agent_hub_automations
  (slug, name, description, is_system, trigger_type, trigger_config, conditions, actions,
   cooldown_period_days, max_runs_per_agent, requires_approval, approval_window_hours)
VALUES
  ('birthday_touchpoint',
   'Birthday touchpoint',
   'Queue a postcard 5 days before each warm+/partner/VIP agent''s birthday.',
   TRUE,
   'time_based',
   '{"trigger":"birthday","offset_days":-5}'::jsonb,
   '[
     {"field":"tier","op":"in","value":["warm","partner","vip"]},
     {"field":"do_not_contact","op":"eq","value":false},
     {"field":"has_birthday","op":"eq","value":true},
     {"field":"has_mailing_address","op":"eq","value":true}
   ]'::jsonb,
   '[
     {"type":"queue_postcard","config":{"template_slug":"birthday_card_postcard"}},
     {"type":"log_activity","config":{"summary":"Birthday postcard queued"}}
   ]'::jsonb,
   350, NULL, TRUE, 48),
  ('new_partner_onboarding',
   'New partner onboarding sequence',
   '4-step onboarding for newly-promoted partners: welcome email, packet, personal call task, 30-day check-in.',
   TRUE,
   'event_based',
   '{"event":"agent_tier_changed","to_tier":"partner"}'::jsonb,
   '[
     {"field":"consent_to_email","op":"eq","value":true}
   ]'::jsonb,
   '[
     {"type":"send_email","config":{"template_slug":"partner_welcome_email"}},
     {"type":"wait","config":{"days":3}},
     {"type":"queue_postcard","config":{"template_slug":"partner_welcome_packet"}},
     {"type":"wait","config":{"days":11}},
     {"type":"create_task","config":{"assign":"mike","title":"Personal call to {{first_name}}"}},
     {"type":"wait","config":{"days":16}},
     {"type":"send_email","config":{"template_slug":"partner_30day_checkin"}}
   ]'::jsonb,
   365, 1, TRUE, 48),
  ('dormant_re_engagement',
   'Dormant agent re-engagement',
   'When a warm/partner agent goes 120 days without interaction, run a 3-touch re-engagement.',
   TRUE,
   'time_based',
   '{"trigger":"days_since_last_interaction","threshold":120}'::jsonb,
   '[
     {"field":"tier","op":"in","value":["warm","partner"]},
     {"field":"do_not_contact","op":"eq","value":false},
     {"field":"consent_to_email","op":"eq","value":true},
     {"field":"status","op":"eq","value":"active"}
   ]'::jsonb,
   '[
     {"type":"send_email","config":{"template_slug":"dormant_checkin_email"}},
     {"type":"wait","config":{"days":14}},
     {"type":"branch","config":{"if":"reply_received_in_last_14d","then_actions":[{"type":"end_sequence","config":{}}],"else_actions":[
       {"type":"queue_postcard","config":{"template_slug":"dormant_market_postcard"}}
     ]}},
     {"type":"wait","config":{"days":16}},
     {"type":"branch","config":{"if":"reply_received","then_actions":[{"type":"end_sequence","config":{}}],"else_actions":[
       {"type":"update_agent_field","config":{"field":"tier","value":"dormant"}},
       {"type":"create_task","config":{"assign":"mike","title":"Decide on personal call to {{first_name}}"}}
     ]}}
   ]'::jsonb,
   180, NULL, TRUE, 48),
  ('post_conversion_thank_you',
   'Post-conversion thank-you sequence',
   'When a referral hits tenant_placed, send a thank-you email + postcard, promote cold-tier agents to warm, and follow up at 30 days.',
   TRUE,
   'event_based',
   '{"event":"referral_stage_changed","to_stage":"tenant_placed"}'::jsonb,
   '[
     {"field":"do_not_contact","op":"eq","value":false},
     {"field":"consent_to_email","op":"eq","value":true}
   ]'::jsonb,
   '[
     {"type":"send_email","config":{"template_slug":"post_conversion_thank_you_email"}},
     {"type":"queue_postcard","config":{"template_slug":"post_conversion_thank_you_postcard"}},
     {"type":"branch","config":{"if":"agent_tier_eq_cold","then_actions":[
       {"type":"update_agent_field","config":{"field":"tier","value":"warm"}}
     ],"else_actions":[]}},
     {"type":"wait","config":{"days":30}},
     {"type":"send_email","config":{"template_slug":"first_month_check_in_email"}}
   ]'::jsonb,
   0, NULL, TRUE, 72),
  ('quarterly_market_update',
   'Quarterly market update',
   'Send a Houston market update to warm/partner/VIP agents at the start of each quarter.',
   TRUE,
   'time_based',
   '{"trigger":"fixed_schedule","schedule_cron":"0 9 1 1,4,7,10 *"}'::jsonb,
   '[
     {"field":"tier","op":"in","value":["warm","partner","vip"]},
     {"field":"consent_to_email","op":"eq","value":true},
     {"field":"status","op":"eq","value":"active"}
   ]'::jsonb,
   '[
     {"type":"send_email","config":{"template_slug":"quarterly_market_update_email"}}
   ]'::jsonb,
   80, NULL, TRUE, 72)
ON CONFLICT (slug) DO NOTHING;
