-- Boom Screening cache (also applied via ensureCachedDashboardSchema in lib/db.js)

CREATE TABLE IF NOT EXISTS cached_boom_applications (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_boom_properties (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_boom_units (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
