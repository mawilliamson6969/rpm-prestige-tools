import { getPool } from "./db.js";

export async function ensureReviewsSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS google_reviews (
      id SERIAL PRIMARY KEY,
      google_review_id VARCHAR(255) UNIQUE NOT NULL,
      reviewer_name VARCHAR(255),
      reviewer_photo_url TEXT,
      star_rating INTEGER NOT NULL,
      comment TEXT,
      create_time TIMESTAMPTZ,
      update_time TIMESTAMPTZ,
      reply_comment TEXT,
      reply_update_time TIMESTAMPTZ,
      replied_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_read BOOLEAN DEFAULT false,
      is_flagged BOOLEAN DEFAULT false,
      tags TEXT[] DEFAULT '{}',
      internal_notes TEXT,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_request_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      channel VARCHAR(20) NOT NULL,
      subject VARCHAR(500),
      body TEXT NOT NULL,
      is_default BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      recipient_type VARCHAR(20) DEFAULT 'tenant',
      send_count INTEGER DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_requests (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES review_request_templates(id) ON DELETE SET NULL,
      recipient_name VARCHAR(255) NOT NULL,
      recipient_email VARCHAR(255),
      recipient_phone VARCHAR(50),
      recipient_type VARCHAR(20) DEFAULT 'tenant',
      channel VARCHAR(20) NOT NULL,
      property_name VARCHAR(500),
      property_id INTEGER,
      message_content TEXT,
      status VARCHAR(20) DEFAULT 'sent',
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      scheduled_send_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,
      review_received BOOLEAN DEFAULT false,
      review_received_at TIMESTAMPTZ,
      review_id INTEGER REFERENCES google_reviews(id) ON DELETE SET NULL,
      review_rating INTEGER,
      triggered_by VARCHAR(50),
      triggered_by_id INTEGER,
      team_member_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      automation_id INTEGER,
      tracking_token VARCHAR(64) UNIQUE,
      error_message TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_automations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      trigger_type VARCHAR(50) NOT NULL,
      trigger_config JSONB NOT NULL,
      template_id INTEGER REFERENCES review_request_templates(id) ON DELETE SET NULL,
      channel VARCHAR(20) DEFAULT 'email',
      delay_hours INTEGER DEFAULT 72,
      recipient_type VARCHAR(20) DEFAULT 'tenant',
      is_active BOOLEAN DEFAULT true,
      conditions JSONB,
      send_count INTEGER DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_automation_log (
      id SERIAL PRIMARY KEY,
      automation_id INTEGER REFERENCES review_automations(id) ON DELETE CASCADE,
      request_id INTEGER REFERENCES review_requests(id) ON DELETE SET NULL,
      trigger_event VARCHAR(50),
      trigger_details JSONB,
      result VARCHAR(20),
      error_message TEXT,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_leaderboard (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      period VARCHAR(20) NOT NULL,
      period_start DATE NOT NULL,
      requests_sent INTEGER DEFAULT 0,
      reviews_received INTEGER DEFAULT 0,
      five_star_count INTEGER DEFAULT 0,
      four_star_count INTEGER DEFAULT 0,
      three_star_count INTEGER DEFAULT 0,
      two_star_count INTEGER DEFAULT 0,
      one_star_count INTEGER DEFAULT 0,
      avg_rating NUMERIC(3,2) DEFAULT 0,
      conversion_rate NUMERIC(5,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, period, period_start)
    );

    CREATE TABLE IF NOT EXISTS review_optouts (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255),
      phone VARCHAR(50),
      opted_out_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_settings (
      id SERIAL PRIMARY KEY,
      key VARCHAR(64) UNIQUE NOT NULL,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS google_auth_tokens (
      id SERIAL PRIMARY KEY,
      account_id VARCHAR(255),
      location_id VARCHAR(255),
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMPTZ,
      scope TEXT,
      connected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      connected_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_google_reviews_rating ON google_reviews(star_rating);
    CREATE INDEX IF NOT EXISTS idx_google_reviews_time ON google_reviews(create_time DESC);
    CREATE INDEX IF NOT EXISTS idx_review_requests_status ON review_requests(status);
    CREATE INDEX IF NOT EXISTS idx_review_requests_template ON review_requests(template_id);
    CREATE INDEX IF NOT EXISTS idx_review_requests_team ON review_requests(team_member_id);
    CREATE INDEX IF NOT EXISTS idx_review_requests_scheduled ON review_requests(scheduled_send_at)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_review_automations_trigger ON review_automations(trigger_type);
    CREATE INDEX IF NOT EXISTS idx_review_leaderboard_period ON review_leaderboard(period, period_start);
    CREATE INDEX IF NOT EXISTS idx_review_optouts_email ON review_optouts(lower(email));
    CREATE INDEX IF NOT EXISTS idx_review_optouts_phone ON review_optouts(phone);
  `);

  await seedStarterTemplates(p);
  await seedStarterAutomations(p);
}

async function seedStarterTemplates(p) {
  const { rows } = await p.query(`SELECT COUNT(*)::int AS c FROM review_request_templates`);
  if (rows[0].c > 0) return;

  const templates = [
    {
      name: "Post-Maintenance Email",
      channel: "email",
      recipient_type: "tenant",
      subject: "How did we do? We'd love your feedback!",
      body: `Hi {{first_name}},

We recently completed a maintenance request at your home. We hope everything was taken care of to your satisfaction!

If you had a positive experience, we'd really appreciate a quick Google review. It only takes 30 seconds and helps us continue providing great service.

👉 Leave a Review: {{review_url}}

Thank you for being a valued resident!

Best,
{{team_member_name}}
Real Property Management Prestige`,
      is_default: true,
    },
    {
      name: "Post-Maintenance SMS",
      channel: "sms",
      recipient_type: "tenant",
      subject: null,
      body: `Hi {{first_name}}! Thanks for letting us take care of your maintenance request. If you're happy with the service, we'd love a quick review: {{review_url}} - RPM Prestige`,
    },
    {
      name: "Owner Thank You",
      channel: "email",
      recipient_type: "owner",
      subject: "Thank you for trusting RPM Prestige!",
      body: `Hi {{name}},

Thank you for choosing Real Property Management Prestige to manage your property at {{property_address}}. We truly value our partnership.

If you've had a positive experience with our team, a Google review would mean the world to us:

👉 {{review_url}}

We look forward to continuing to serve you!

Best regards,
{{team_member_name}}
Real Property Management Prestige`,
    },
    {
      name: "Move-In Follow Up",
      channel: "both",
      recipient_type: "tenant",
      subject: "How's your new home? Quick favor to ask!",
      body: `Hi {{first_name}},

You've been in your new home at {{property_address}} for about a month now — we hope you're settling in well!

We strive to make the move-in experience as smooth as possible. If we've delivered on that, a quick Google review would really help us out:

👉 {{review_url}}

And if there's anything you need, don't hesitate to reach out!

Warm regards,
{{team_member_name}}
Real Property Management Prestige`,
    },
    {
      name: "Vendor Appreciation",
      channel: "email",
      recipient_type: "vendor",
      subject: "You're a valued partner — share your experience!",
      body: `Hi {{name}},

We appreciate the excellent work you've done for RPM Prestige and our property owners. Your reliability and quality are what make our partnerships work.

If you enjoy working with us, we'd love for you to share your experience:

👉 {{review_url}}

Thank you for being part of our team!

Best,
{{team_member_name}}
Real Property Management Prestige`,
    },
    {
      name: "Lease Renewal Celebration",
      channel: "sms",
      recipient_type: "tenant",
      subject: null,
      body: `Hi {{first_name}}! 🎉 Congrats on renewing your lease at {{property_address}}! We love having you as a resident. If you have a moment, a quick review would mean a lot: {{review_url}} - RPM Prestige`,
    },
  ];

  for (const t of templates) {
    await p.query(
      `INSERT INTO review_request_templates (name, channel, subject, body, recipient_type, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [t.name, t.channel, t.subject, t.body, t.recipient_type, !!t.is_default]
    );
  }
}

async function seedStarterAutomations(p) {
  const { rows } = await p.query(`SELECT COUNT(*)::int AS c FROM review_automations`);
  if (rows[0].c > 0) return;

  const { rows: tmpl } = await p.query(
    `SELECT id, name FROM review_request_templates WHERE is_active = true`
  );
  const byName = new Map(tmpl.map((r) => [r.name, r.id]));

  const automations = [
    {
      name: "Post-WO Review Request",
      description: "Send review request to tenant 72 hours after a work order is marked Completed",
      trigger_type: "work_order_completed",
      trigger_config: {
        delay_hours: 72,
        exclude_statuses: ["Canceled", "Completed No Need To Bill"],
        min_wo_amount: 0,
      },
      template_name: "Post-Maintenance Email",
      channel: "email",
      delay_hours: 72,
      recipient_type: "tenant",
    },
    {
      name: "Lease Renewal Review",
      description: "Send a celebratory review request 7 days after a lease is renewed",
      trigger_type: "lease_renewal_completed",
      trigger_config: { delay_hours: 168 },
      template_name: "Lease Renewal Celebration",
      channel: "sms",
      delay_hours: 168,
      recipient_type: "tenant",
    },
    {
      name: "Monthly Owner Check-in",
      description: "On the 1st of each month, send a review request to owners",
      trigger_type: "scheduled",
      trigger_config: {
        frequency: "monthly",
        day_of_month: 1,
        source: "owners",
        max_per_batch: 20,
      },
      template_name: "Owner Thank You",
      channel: "email",
      delay_hours: 0,
      recipient_type: "owner",
    },
  ];

  for (const a of automations) {
    const tid = byName.get(a.template_name);
    if (!tid) continue;
    await p.query(
      `INSERT INTO review_automations
        (name, description, trigger_type, trigger_config, template_id, channel, delay_hours,
         recipient_type, is_active, conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)`,
      [
        a.name,
        a.description,
        a.trigger_type,
        JSON.stringify(a.trigger_config),
        tid,
        a.channel,
        a.delay_hours,
        a.recipient_type,
        JSON.stringify({ dedupe_days: 30, max_per_day: 50 }),
      ]
    );
  }
}

export async function getReviewSetting(key) {
  const p = getPool();
  const { rows } = await p.query(`SELECT value FROM review_settings WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setReviewSetting(key, value) {
  const p = getPool();
  await p.query(
    `INSERT INTO review_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}
