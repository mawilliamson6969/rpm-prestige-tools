import { getPool } from "./db.js";

const DEFAULT_CATEGORIES = [
  { name: "Onboarding", icon: "🏠", color: "#0098D0", sort_order: 0 },
  { name: "Leasing", icon: "📝", color: "#10b981", sort_order: 1 },
  { name: "Maintenance", icon: "🔧", color: "#f59e0b", sort_order: 2 },
  { name: "Operations", icon: "🗂️", color: "#1B2856", sort_order: 3 },
  { name: "Marketing", icon: "📣", color: "#8b5cf6", sort_order: 4 },
  { name: "Owner Relations", icon: "🤝", color: "#0098D0", sort_order: 5 },
  { name: "Tenant", icon: "👥", color: "#2E7D6B", sort_order: 6 },
  { name: "Compliance", icon: "⚖️", color: "#B32317", sort_order: 7 },
  { name: "Surveys", icon: "📊", color: "#6A737B", sort_order: 8 },
];

export async function ensureFormsPhase3Schema() {
  const pool = getPool();

  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS template_category VARCHAR(100)`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS template_description TEXT`);
  await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS template_icon VARCHAR(10)`);

  await pool.query(`ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS pdf_path VARCHAR(500)`);
  await pool.query(`ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMP`);

  await pool.query(`ALTER TABLE form_analytics ADD COLUMN IF NOT EXISTS duration_ms INTEGER`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_form_analytics_session ON form_analytics(form_id, session_id, created_at)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      icon VARCHAR(10),
      color VARCHAR(7),
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const { rows: catCount } = await pool.query(`SELECT COUNT(*)::int AS c FROM form_categories`);
  if (catCount[0].c === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await pool.query(
        `INSERT INTO form_categories (name, icon, color, sort_order) VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO NOTHING`,
        [c.name, c.icon, c.color, c.sort_order]
      );
    }
  }

  // Automation execution log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_automation_log (
      id SERIAL PRIMARY KEY,
      automation_id INTEGER REFERENCES form_automations(id) ON DELETE SET NULL,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      submission_id INTEGER REFERENCES form_submissions(id) ON DELETE SET NULL,
      action_type VARCHAR(50),
      result VARCHAR(20),
      details JSONB,
      executed_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_form_automation_log_form ON form_automation_log(form_id, executed_at DESC);
  `);
}
