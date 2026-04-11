-- Applied on API startup via ensureAnnouncementsSchema() in lib/db.js

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS attachment_label TEXT;
