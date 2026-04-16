import { getPool } from "./db.js";

async function getUserIdByUsername(pool, username) {
  const { rows } = await pool.query(`SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1`, [
    username,
  ]);
  return rows[0]?.id ?? null;
}

export async function ensureEosSchema() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scorecard_metrics (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      frequency VARCHAR(16) NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
      goal_value NUMERIC NOT NULL,
      goal_direction VARCHAR(16) NOT NULL CHECK (goal_direction IN ('above', 'below', 'exact')),
      unit VARCHAR(32) NOT NULL CHECK (unit IN ('number', 'currency', 'percentage', 'days')),
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS scorecard_entries (
      id SERIAL PRIMARY KEY,
      metric_id INTEGER NOT NULL REFERENCES scorecard_metrics(id) ON DELETE CASCADE,
      value NUMERIC NOT NULL,
      week_of DATE,
      month_of DATE,
      notes TEXT,
      entered_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (week_of IS NOT NULL AND month_of IS NULL) OR
        (week_of IS NULL AND month_of IS NOT NULL)
      )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS scorecard_entries_metric_week_uq
      ON scorecard_entries (metric_id, week_of) WHERE week_of IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS scorecard_entries_metric_month_uq
      ON scorecard_entries (metric_id, month_of) WHERE month_of IS NOT NULL;

    CREATE INDEX IF NOT EXISTS scorecard_entries_metric_id_idx ON scorecard_entries (metric_id);

    CREATE TABLE IF NOT EXISTS rocks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(512) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      quarter VARCHAR(32) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'on_track'
        CHECK (status IN ('on_track', 'off_track', 'completed', 'dropped')),
      due_date DATE NOT NULL,
      completed_at TIMESTAMPTZ,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS rocks_quarter_idx ON rocks (quarter);

    CREATE TABLE IF NOT EXISTS rock_milestones (
      id SERIAL PRIMARY KEY,
      rock_id INTEGER NOT NULL REFERENCES rocks(id) ON DELETE CASCADE,
      title VARCHAR(512) NOT NULL,
      is_completed BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMPTZ,
      due_date DATE,
      display_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rock_updates (
      id SERIAL PRIMARY KEY,
      rock_id INTEGER NOT NULL REFERENCES rocks(id) ON DELETE CASCADE,
      update_text TEXT NOT NULL,
      status VARCHAR(24) NOT NULL CHECK (status IN ('on_track', 'off_track')),
      updated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS rock_updates_rock_id_idx ON rock_updates (rock_id);

    CREATE TABLE IF NOT EXISTS l10_meetings (
      id SERIAL PRIMARY KEY,
      meeting_date DATE NOT NULL,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      status VARCHAR(24) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'completed')),
      segue_notes TEXT,
      scorecard_notes TEXT,
      rock_review_notes TEXT,
      headlines TEXT,
      ids_notes TEXT,
      conclude_notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS l10_meetings_date_idx ON l10_meetings (meeting_date DESC);

    CREATE TABLE IF NOT EXISTS l10_meeting_ratings (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER NOT NULL REFERENCES l10_meetings(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
      UNIQUE (meeting_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS l10_todos (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER REFERENCES l10_meetings(id) ON DELETE SET NULL,
      title VARCHAR(512) NOT NULL,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      due_date DATE NOT NULL,
      is_completed BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS l10_todos_open_idx ON l10_todos (is_completed) WHERE is_completed = false;

    CREATE TABLE IF NOT EXISTS l10_issues (
      id SERIAL PRIMARY KEY,
      title VARCHAR(512) NOT NULL,
      description TEXT,
      discussion_notes TEXT,
      raised_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
      status VARCHAR(32) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_discussion', 'resolved', 'tabled')),
      resolution TEXT,
      resolved_at TIMESTAMPTZ,
      meeting_id INTEGER REFERENCES l10_meetings(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS l10_issues_status_idx ON l10_issues (status);
  `);

  const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS c FROM scorecard_metrics`);
  if (cnt[0].c > 0) return;

  const mike = await getUserIdByUsername(pool, "mike");
  const lori = await getUserIdByUsername(pool, "lori");
  const leslie = await getUserIdByUsername(pool, "leslie");
  const amanda = await getUserIdByUsername(pool, "amanda");
  const adminId = mike || lori || (await pool.query(`SELECT id FROM users ORDER BY id LIMIT 1`)).rows[0]?.id;
  if (!adminId) return;

  const O = {
    mike: mike || adminId,
    lori: lori || adminId,
    leslie: leslie || adminId,
    amanda: amanda || adminId,
  };

  const metrics = [
    ["Revenue (MTD)", "Monthly revenue to date", O.mike, "weekly", 64583, "above", "currency", 0],
    ["New Doors Added", null, O.leslie, "weekly", 3, "above", "number", 1],
    ["Occupancy Rate", null, O.lori, "weekly", 95, "above", "percentage", 2],
    ["Open Work Orders", null, O.amanda, "weekly", 15, "below", "number", 3],
    ["Delinquent Accounts", null, O.lori, "weekly", 10, "below", "number", 4],
    ["Avg Days to Complete WO", null, O.amanda, "weekly", 7, "below", "days", 5],
    ["Owner NPS Responses", null, O.lori, "weekly", 5, "above", "number", 6],
    ["Google Reviews (MTD)", null, O.mike, "weekly", 4, "above", "number", 7],
  ];

  for (const [i, row] of metrics.entries()) {
    const [name, desc, owner, freq, goal, dir, unit, order] = row;
    await pool.query(
      `INSERT INTO scorecard_metrics
        (name, description, owner_user_id, frequency, goal_value, goal_direction, unit, display_order, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
      [name, desc, owner, freq, goal, dir, unit, order, adminId]
    );
  }

  const q2 = "Q2 2026";
  const due = "2026-06-30";
  const rockSeeds = [
    {
      title: "Reach 250 doors under management",
      owner: O.mike,
      milestones: [
        "Sign 10 new PMAs",
        "Close Decker Place (12 units)",
        "Onboard 5 referral partners",
      ],
    },
    {
      title: "Achieve 95% occupancy rate",
      owner: O.leslie,
      milestones: [
        "Reduce average days on market to <21",
        "Fill 20 vacant units",
        "Launch RentEngine AI follow-ups",
      ],
    },
    {
      title: "Implement company intranet and dashboards",
      owner: O.mike,
      milestones: [
        "Deploy KPI dashboards (all 5 tabs)",
        "Launch team hub",
        "Build 3 form replacements",
        "Connect all API sources",
      ],
    },
    {
      title: "Reduce average work order completion to 5 days",
      owner: O.amanda,
      milestones: [
        "Audit current vendor response times",
        "Add 3 new vendors to approved list",
        "Implement WO priority auto-assignment",
      ],
    },
  ];

  for (const [idx, r] of rockSeeds.entries()) {
    const { rows: ins } = await pool.query(
      `INSERT INTO rocks (title, description, owner_user_id, quarter, status, due_date, display_order, created_by)
       VALUES ($1, $2, $3, $4, 'on_track', $5::date, $6, $7)
       RETURNING id`,
      [r.title, "", r.owner, q2, due, idx, adminId]
    );
    const rockId = ins[0].id;
    for (const [mi, mt] of r.milestones.entries()) {
      await pool.query(
        `INSERT INTO rock_milestones (rock_id, title, display_order) VALUES ($1, $2, $3)`,
        [rockId, mt, mi]
      );
    }
  }

  console.log("[eos] Seeded scorecard metrics and Q2 2026 rocks.");
}

export async function ensurePortfolioSnapshotsSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL UNIQUE,
      total_doors INTEGER NOT NULL,
      property_ids JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export async function ensureIndividualScorecardSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS individual_scorecards (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      owner_user_id INTEGER REFERENCES users(id) NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS individual_scorecard_metrics (
      id SERIAL PRIMARY KEY,
      scorecard_id INTEGER REFERENCES individual_scorecards(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      frequency VARCHAR(10) DEFAULT 'weekly',
      goal_value NUMERIC(12,2),
      goal_direction VARCHAR(10) DEFAULT 'above',
      unit VARCHAR(20) DEFAULT 'number',
      display_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS individual_scorecard_entries (
      id SERIAL PRIMARY KEY,
      metric_id INTEGER REFERENCES individual_scorecard_metrics(id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      value NUMERIC(12,2),
      notes TEXT,
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(metric_id, week_start)
    );

    CREATE INDEX IF NOT EXISTS individual_scorecard_metrics_sc_idx
      ON individual_scorecard_metrics (scorecard_id, display_order ASC);
    CREATE INDEX IF NOT EXISTS individual_scorecard_entries_metric_idx
      ON individual_scorecard_entries (metric_id, week_start);
  `);
}
