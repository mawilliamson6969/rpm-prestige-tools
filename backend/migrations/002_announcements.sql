-- Applied automatically on API startup via ensureAnnouncementsSchema() in lib/db.js
-- (kept here for reference / manual runs)

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Seed starter announcements when the table is empty (matches ensureAnnouncementsSchema logic)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM announcements LIMIT 1) THEN
    INSERT INTO announcements (title, content, is_active) VALUES
      ('April 10, 2026', 'Company intranet is live! All internal tools will be consolidated here.', true),
      ('April 10, 2026', 'Owner Termination form is now digital. Use the link in Our Tools.', true),
      ('April 10, 2026', 'KPI Dashboard is pulling live data from AppFolio.', true);
  END IF;
END $$;
