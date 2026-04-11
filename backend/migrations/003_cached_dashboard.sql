-- Applied on API startup via ensureCachedDashboardSchema() in lib/db.js

CREATE TABLE IF NOT EXISTS cached_units (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_properties (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_rent_roll (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_income_statement (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  period VARCHAR(16) NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_work_orders (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_delinquency (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_owners (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_guest_cards (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_rental_applications (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_lease_expirations (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cached_vendors (
  id SERIAL PRIMARY KEY,
  appfolio_data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL,
  endpoints_synced INTEGER NOT NULL DEFAULT 0,
  total_rows_synced INTEGER NOT NULL DEFAULT 0,
  errors JSONB,
  triggered_by VARCHAR(64) NOT NULL
);
