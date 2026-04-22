import { getPool } from "./db.js";

export async function ensureLayoutPreferencesSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_layout_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      hub_layout JSONB DEFAULT '[]'::jsonb,
      sidebar_order JSONB DEFAULT '[]'::jsonb,
      sidebar_collapsed JSONB DEFAULT '[]'::jsonb,
      sidebar_pinned JSONB DEFAULT '[]'::jsonb,
      sidebar_hidden JSONB DEFAULT '[]'::jsonb,
      hub_widgets JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
