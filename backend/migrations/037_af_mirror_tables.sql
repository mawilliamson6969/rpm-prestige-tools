-- 037_af_mirror_tables.sql
-- AppFolio Database API, Phase 2: local mirror tables + sync bookkeeping.
--
-- Design: JSONB-first. We do not yet know the Database API's exact field
-- inventory (no live credentials at build time), and AppFolio may add
-- fields without notice. Each mirror row stores the complete API record
-- in `data` and promotes only what the sync engine itself needs:
--
--   id              AppFolio record id (TEXT — safe whether AppFolio
--                   sends integers or string ids)
--   data            the full API record, verbatim
--   last_updated_at extracted from the record's LastUpdatedAt/UpdatedAt
--                   when present; drives delta syncs
--   synced_at       when WE last wrote this row
--
-- Feature phases that need real columns can promote them later with
-- generated columns or plain ALTERs — the JSONB stays the source of truth.
--
-- Idempotent: safe to re-run on every boot (applied by
-- lib/af-mirror-schema.js, same pattern as agentHubSchema).

CREATE TABLE IF NOT EXISTS af_properties (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  last_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS af_properties_last_updated_idx ON af_properties (last_updated_at);
CREATE INDEX IF NOT EXISTS af_properties_data_gin ON af_properties USING GIN (data jsonb_path_ops);

CREATE TABLE IF NOT EXISTS af_units (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  last_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS af_units_last_updated_idx ON af_units (last_updated_at);
CREATE INDEX IF NOT EXISTS af_units_data_gin ON af_units USING GIN (data jsonb_path_ops);

CREATE TABLE IF NOT EXISTS af_tenants (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  last_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS af_tenants_last_updated_idx ON af_tenants (last_updated_at);
CREATE INDEX IF NOT EXISTS af_tenants_data_gin ON af_tenants USING GIN (data jsonb_path_ops);

CREATE TABLE IF NOT EXISTS af_leases (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  last_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS af_leases_last_updated_idx ON af_leases (last_updated_at);
CREATE INDEX IF NOT EXISTS af_leases_data_gin ON af_leases USING GIN (data jsonb_path_ops);

-- One row per mirrored resource. `high_water_mark` is the max
-- last_updated_at observed across all successful runs; delta syncs start
-- from it (minus a small overlap) so nothing is missed between runs.
-- NULL high-water mark = the API records carried no usable timestamp, in
-- which case a "delta" run silently degrades to a full pass.
CREATE TABLE IF NOT EXISTS af_sync_state (
  resource TEXT PRIMARY KEY,
  high_water_mark TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status VARCHAR(32),
  last_error TEXT,
  last_row_count INTEGER
);
