-- Real users, roles, and permissions.
-- Replaces the hardcoded admin/viewer dichotomy with a role-permission table
-- so adding/removing team members is a config change, not a code deploy.
--
-- Idempotent: this migration is also applied at runtime by ensureUsersSchema()
-- in lib/db.js. The runtime path runs every cold start.

-- 1. Extend the users table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- The pre-existing role column had CHECK (role IN ('admin', 'viewer')).
-- Drop the constraint so we can store the new role values.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

-- Widen role column from VARCHAR(16) to TEXT.
ALTER TABLE users ALTER COLUMN role TYPE TEXT;

-- Migrate legacy role values for the seeded team. Idempotent.
UPDATE users SET role = 'owner'       WHERE LOWER(username) = 'mike'    AND role IN ('admin');
UPDATE users SET role = 'csm'         WHERE LOWER(username) = 'lori'    AND role IN ('admin', 'viewer');
UPDATE users SET role = 'csm'         WHERE LOWER(username) = 'leslie'  AND role IN ('viewer');
UPDATE users SET role = 'maintenance' WHERE LOWER(username) = 'amanda'  AND role IN ('viewer');
UPDATE users SET role = 'operations'  WHERE LOWER(username) = 'amelia'  AND role IN ('viewer');

-- Anyone still on 'viewer' becomes 'staff'.
UPDATE users SET role = 'staff' WHERE role = 'viewer';

CREATE INDEX IF NOT EXISTS idx_users_active ON users(active) WHERE active = TRUE;

-- 2. role_permissions table.
CREATE TABLE IF NOT EXISTS role_permissions (
  role        TEXT NOT NULL,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

-- Seed permissions. ON CONFLICT DO NOTHING keeps this idempotent — operators
-- can add/remove permissions in this table without worrying about reseeding.
INSERT INTO role_permissions (role, permission) VALUES
  ('owner',       'all'),
  ('admin',       'all'),
  ('csm',         'inbox.read'),
  ('csm',         'inbox.reply'),
  ('csm',         'inbox.assign'),
  ('csm',         'leasing.manage'),
  ('csm',         'reports.view'),
  ('maintenance', 'inbox.read'),
  ('maintenance', 'inbox.reply'),
  ('maintenance', 'workorders.manage'),
  ('operations',  'inbox.read'),
  ('operations',  'inbox.reply'),
  ('operations',  'process.manage'),
  ('staff',       'inbox.read')
ON CONFLICT DO NOTHING;

-- 3. Permission check function.
CREATE OR REPLACE FUNCTION user_has_permission(p_user_id INTEGER, p_permission TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    JOIN role_permissions rp ON rp.role = u.role
    WHERE u.id = p_user_id
      AND u.active = TRUE
      AND (rp.permission = p_permission OR rp.permission = 'all')
  );
$$ LANGUAGE SQL STABLE;
