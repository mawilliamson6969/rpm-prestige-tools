import { getPool } from "./db.js";

const CHI_TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date`;

export { CHI_TODAY };

export async function ensureAgentsSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      category VARCHAR(50) DEFAULT 'general',
      status VARCHAR(20) DEFAULT 'inactive',
      owner_user_id INTEGER REFERENCES users(id),
      trigger_type VARCHAR(20) DEFAULT 'schedule',
      trigger_config JSONB DEFAULT '{}'::jsonb,
      system_prompt TEXT,
      system_prompt_version INTEGER DEFAULT 1,
      actions_config JSONB DEFAULT '[]'::jsonb,
      guardrails JSONB DEFAULT '{}'::jsonb,
      confidence_threshold INTEGER DEFAULT 85,
      daily_action_limit INTEGER DEFAULT 50,
      data_sources TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      icon VARCHAR(10) DEFAULT '🤖',
      color VARCHAR(7) DEFAULT '#0098D0',
      last_run_at TIMESTAMPTZ,
      next_run_at TIMESTAMPTZ,
      total_actions_taken INTEGER DEFAULT 0,
      total_actions_auto INTEGER DEFAULT 0,
      total_actions_queued INTEGER DEFAULT 0,
      total_human_overrides INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_prompt_versions (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      system_prompt TEXT NOT NULL,
      change_notes VARCHAR(500),
      changed_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (agent_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS agent_activity_log (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      trigger_event TEXT,
      trigger_data JSONB,
      decision TEXT,
      action_taken TEXT,
      action_data JSONB,
      confidence_score INTEGER,
      context_used JSONB,
      result VARCHAR(20) DEFAULT 'pending',
      result_details TEXT,
      human_feedback VARCHAR(20),
      human_feedback_notes TEXT,
      feedback_by INTEGER REFERENCES users(id),
      feedback_at TIMESTAMPTZ,
      execution_time_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS agent_activity_log_agent_id_idx ON agent_activity_log (agent_id);
    CREATE INDEX IF NOT EXISTS agent_activity_log_created_at_idx ON agent_activity_log (created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_training_examples (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      example_type VARCHAR(20) NOT NULL,
      input_context TEXT NOT NULL,
      agent_response TEXT NOT NULL,
      human_corrected_response TEXT,
      correction_notes TEXT,
      added_by INTEGER REFERENCES users(id),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_metrics (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      metric_date DATE NOT NULL,
      actions_taken INTEGER DEFAULT 0,
      actions_auto_sent INTEGER DEFAULT 0,
      actions_queued INTEGER DEFAULT 0,
      human_overrides INTEGER DEFAULT 0,
      human_approvals INTEGER DEFAULT 0,
      avg_confidence_score NUMERIC(5,2),
      errors INTEGER DEFAULT 0,
      avg_execution_time_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(agent_id, metric_date)
    );

    CREATE TABLE IF NOT EXISTS agent_queued_actions (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      action_type VARCHAR(50) NOT NULL,
      action_data JSONB NOT NULL,
      context JSONB,
      ai_draft TEXT,
      confidence_score INTEGER,
      status VARCHAR(20) DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TIMESTAMPTZ,
      review_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS agent_queued_actions_agent_status_idx
      ON agent_queued_actions (agent_id, status) WHERE status = 'pending';
  `);

  const { rows: cnt } = await p.query(`SELECT COUNT(*)::int AS c FROM agents`);
  if (cnt[0].c > 0) return;

  const templates = [
    {
      name: "Lead Speed-to-Response Agent",
      slug: "lead-response",
      category: "leasing",
      icon: "🏃",
      color: "#2D8B4E",
      trigger_type: "schedule",
      trigger_config: { cron: "*/2 * * * *", description: "Every 2 minutes" },
      description:
        "Automatically responds to new RentEngine leads within 2 minutes with a personalized email including property details and showing availability.",
      data_sources: ["rentengine", "appfolio"],
      confidence_threshold: 85,
      daily_action_limit: 50,
      guardrails: {
        never: ["send financial data", "make promises about pricing", "respond to existing tenants"],
        always: ["include opt-out language", "CC Leslie on all responses"],
        escalate: ["If lead mentions legal issues", "If lead asks about Section 8"],
      },
      system_prompt:
        "You are a leasing agent for RPM Prestige, a professional property management company in Houston, TX. You are responding to a new rental inquiry. Be warm, professional, and helpful. Include the property address, key features, rent amount, and available showing times. Always invite them to schedule a showing. Do not make promises about approval or pricing flexibility.",
    },
    {
      name: "Delinquency Notice Agent",
      slug: "delinquency-notice",
      category: "accounting",
      icon: "💰",
      color: "#B32317",
      trigger_type: "schedule",
      trigger_config: { cron: "0 7 * * *", description: "Daily at 7:00 AM" },
      description:
        "Monitors delinquency daily and auto-sends notices at 5, 15, and 30-day thresholds per Texas Property Code requirements.",
      data_sources: ["appfolio"],
      confidence_threshold: 90,
      daily_action_limit: 20,
      guardrails: {
        never: [
          "threaten eviction before 30 days",
          "share tenant info with other tenants",
          "waive fees without admin approval",
        ],
        always: [
          "include Texas Property Code references",
          "log all notices for compliance",
          "CC Lori on all notices",
        ],
        escalate: [
          "At 30+ days for eviction decision",
          "If tenant disputes the amount",
          "If tenant mentions hardship",
        ],
      },
      system_prompt:
        "You are a compliance-focused accounting assistant for RPM Prestige in Houston, TX. You prepare delinquency notices aligned with Texas Property Code. Be factual, professional, and never threatening before legally appropriate thresholds.",
    },
    {
      name: "Lease Renewal Agent",
      slug: "lease-renewal",
      category: "leasing",
      icon: "📋",
      color: "#0098D0",
      trigger_type: "schedule",
      trigger_config: { cron: "0 8 * * *", description: "Daily at 8:00 AM" },
      description:
        "Monitors lease expirations and automatically sends renewal offers at 90, 60, and 45-day intervals with market-adjusted rent suggestions.",
      data_sources: ["appfolio", "leadsimple"],
      confidence_threshold: 80,
      daily_action_limit: 10,
      guardrails: { never: [], always: [], escalate: [] },
      system_prompt:
        "You are a leasing specialist for RPM Prestige. You draft lease renewal outreach with clear timelines, respectful tone, and market-aware rent guidance without guaranteeing specific amounts until approved.",
    },
    {
      name: "Maintenance Triage Agent",
      slug: "maintenance-triage",
      category: "maintenance",
      icon: "🔧",
      color: "#C5960C",
      trigger_type: "event",
      trigger_config: { event: "new_work_order", description: "When new work order is synced" },
      description:
        "Analyzes incoming work orders, classifies urgency, recommends the best vendor, and drafts a dispatch notification for Amanda's approval.",
      data_sources: ["appfolio"],
      confidence_threshold: 75,
      daily_action_limit: 30,
      guardrails: { never: [], always: [], escalate: [] },
      system_prompt:
        "You are a maintenance coordinator AI for RPM Prestige. Classify work order urgency, suggest vendor fit from historical context, and draft dispatch notes for human approval. Never dispatch without explicit approval.",
    },
    {
      name: "Auto-Response Agent",
      slug: "auto-response",
      category: "communications",
      icon: "📧",
      color: "#1B2856",
      trigger_type: "event",
      trigger_config: { event: "new_email_ticket", description: "When new email ticket is classified" },
      description:
        "For routine emails (showing confirmations, payment receipts, maintenance acknowledgments), automatically drafts and sends responses. Complex emails are queued for human review.",
      data_sources: ["appfolio", "rentengine", "boom", "leadsimple"],
      confidence_threshold: 90,
      daily_action_limit: 50,
      guardrails: { never: [], always: [], escalate: [] },
      system_prompt:
        "You are a communications assistant for RPM Prestige. Draft concise, professional email replies for routine tenant and prospect messages. When in doubt, queue for human review instead of sending.",
    },
    {
      name: "Owner Retention Agent",
      slug: "owner-retention",
      category: "client-success",
      icon: "🤝",
      color: "#2D8B4E",
      trigger_type: "schedule",
      trigger_config: { cron: "0 8 * * 1", description: "Every Monday at 8:00 AM" },
      description:
        "Weekly scan of all owner accounts to score retention risk based on work order frequency, delinquent tenants, communication gaps, and other signals. Flags high-risk owners for proactive outreach.",
      data_sources: ["appfolio", "leadsimple"],
      confidence_threshold: 70,
      daily_action_limit: 20,
      guardrails: { never: [], always: [], escalate: [] },
      system_prompt:
        "You are a client success analyst for RPM Prestige. Score owner retention risk from operational signals and recommend proactive outreach plans for human execution.",
    },
    {
      name: "Weekly Intelligence Report Agent",
      slug: "weekly-report",
      category: "reporting",
      icon: "📊",
      color: "#0098D0",
      trigger_type: "schedule",
      trigger_config: { cron: "0 6 * * 1", description: "Every Monday at 6:00 AM" },
      description:
        "Compiles a comprehensive weekly business intelligence report: new leads, leasing activity, work orders, delinquency changes, revenue trends, upcoming expirations, and SLA compliance.",
      data_sources: ["appfolio", "rentengine", "boom", "leadsimple"],
      confidence_threshold: 95,
      daily_action_limit: 5,
      guardrails: { never: [], always: [], escalate: [] },
      system_prompt:
        "You are a business intelligence analyst for RPM Prestige. Summarize weekly KPIs across leasing, maintenance, finance, and CRM sources in an executive-ready narrative with clear sections.",
    },
  ];

  for (const t of templates) {
    await p.query(
      `INSERT INTO agents (
        name, slug, description, category, status, trigger_type, trigger_config,
        system_prompt, system_prompt_version, guardrails, confidence_threshold,
        daily_action_limit, data_sources, icon, color
      ) VALUES ($1,$2,$3,$4,'inactive',$5,$6::jsonb,$7,1,$8::jsonb,$9,$10,$11,$12,$13)`,
      [
        t.name,
        t.slug,
        t.description,
        t.category,
        t.trigger_type,
        JSON.stringify(t.trigger_config),
        t.system_prompt,
        JSON.stringify(t.guardrails),
        t.confidence_threshold,
        t.daily_action_limit,
        t.data_sources,
        t.icon,
        t.color,
      ]
    );
  }
}
