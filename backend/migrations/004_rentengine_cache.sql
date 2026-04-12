-- RentEngine cache + sync_log.source (also applied via ensureCachedDashboardSchema in lib/db.js)

CREATE TABLE IF NOT EXISTS cached_rentengine_leads (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_rentengine_units (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'appfolio';
