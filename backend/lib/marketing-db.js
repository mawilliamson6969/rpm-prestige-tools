import { getPool } from "./db.js";

const DEFAULT_CHANNELS = [
  ["Google Business Profile", "gbp", "📍", "#4285F4"],
  ["Facebook", "facebook", "📘", "#1877F2"],
  ["Instagram", "instagram", "📷", "#E4405F"],
  ["Email Newsletter", "email", "📧", "#0098D0"],
  ["Blog / Website", "blog", "📝", "#1B2856"],
  ["Video Content", "video", "🎬", "#B32317"],
  ["LinkedIn", "linkedin", "💼", "#0A66C2"],
  ["SMS Campaign", "sms", "💬", "#2D8B4E"],
  ["Print / Flyer", "print", "🖨️", "#6A737B"],
  ["Community Event", "event", "🎉", "#C5960C"],
];

export async function ensureMarketingSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS marketing_channels (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      icon VARCHAR(10) DEFAULT '📢',
      color VARCHAR(7) DEFAULT '#0098D0',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketing_content (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      content_body TEXT,
      channel_id INTEGER REFERENCES marketing_channels(id),
      status VARCHAR(20) DEFAULT 'idea',
      scheduled_date DATE,
      scheduled_time TIME,
      published_at TIMESTAMP,
      due_date DATE,
      assigned_to INTEGER REFERENCES users(id),
      content_type VARCHAR(50) DEFAULT 'post',
      tags TEXT[] DEFAULT '{}',
      attachments JSONB DEFAULT '[]'::jsonb,
      ai_generated BOOLEAN DEFAULT false,
      recurring VARCHAR(20),
      recurring_end_date DATE,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      start_date DATE,
      end_date DATE,
      status VARCHAR(20) DEFAULT 'planning',
      color VARCHAR(7) DEFAULT '#0098D0',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketing_content_campaigns (
      content_id INTEGER REFERENCES marketing_content(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
      PRIMARY KEY (content_id, campaign_id)
    );
  `);

  await p.query(
    `CREATE INDEX IF NOT EXISTS marketing_content_scheduled_idx ON marketing_content (scheduled_date)`
  );
  await p.query(`CREATE INDEX IF NOT EXISTS marketing_content_status_idx ON marketing_content (status)`);
  await p.query(`CREATE INDEX IF NOT EXISTS marketing_content_channel_idx ON marketing_content (channel_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS marketing_content_assigned_idx ON marketing_content (assigned_to)`);

  const { rows } = await p.query(`SELECT COUNT(*)::int AS c FROM marketing_channels`);
  if (rows[0].c === 0) {
    for (const [name, slug, icon, color] of DEFAULT_CHANNELS) {
      await p.query(
        `INSERT INTO marketing_channels (name, slug, icon, color, is_active) VALUES ($1, $2, $3, $4, true)`,
        [name, slug, icon, color]
      );
    }
  }
}
