-- Applied on API startup via ensureAnnouncementsSchema() in lib/db.js (reference / manual runs)

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
