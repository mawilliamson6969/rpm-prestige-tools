-- 044_appfolio_curated_columns.sql
-- AppFolio mirror, Phase 2.1: PII scrub of existing rows, curated STORED
-- generated columns over `data`, join-key indexes, and the
-- appfolio.current_tenancies view.
--
-- Append-only relative to 043 (no existing column/table is altered or
-- dropped) and idempotent: safe to re-run on every boot (applied by
-- lib/af-mirror-schema.js after 043).
--
-- Column-to-JSON-key mapping: columns are snake_case of AppFolio's
-- PascalCase record keys (name ← 'Name', move_in_on ← 'MoveInOn', ...).
-- A generated column that is NULL for every row signals a key-name
-- mismatch, not an error — check with:
--   SELECT count(*), count(<column>) FROM appfolio.<table>;
-- and fix the expression here.

CREATE SCHEMA IF NOT EXISTS appfolio;

-- ---------------------------------------------------------------------------
-- 1. One-time PII scrub of rows mirrored before the sync engine scrubbed.
--    (services/appfolio-db-sync.js now deletes SCRUB_KEYS pre-upsert.)
--    The WHERE guard makes the re-run a cheap no-op scan instead of a
--    full-table rewrite on every boot.
-- ---------------------------------------------------------------------------

UPDATE appfolio.tenants
   SET data = data - 'SocialSecurityNumber' - 'BirthDate'
 WHERE data ?| ARRAY['SocialSecurityNumber', 'BirthDate'];

-- ---------------------------------------------------------------------------
-- 2. Immutable cast helpers.
--    Generated columns require IMMUTABLE expressions, but text::date and
--    text::timestamptz are only STABLE (they depend on the DateStyle /
--    TimeZone GUCs). AppFolio emits unambiguous ISO-8601 ('YYYY-MM-DD',
--    'YYYY-MM-DDTHH:MM:SSZ'), which parses identically under any GUC, so
--    declaring these IMMUTABLE is sound for this data. NULLIF guards the
--    empty string; NULL passes through.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION appfolio.iso_date(t text)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT NULLIF(t, '')::date $$;

CREATE OR REPLACE FUNCTION appfolio.iso_timestamptz(t text)
RETURNS timestamptz LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT NULLIF(t, '')::timestamptz $$;

-- ---------------------------------------------------------------------------
-- 3. Curated generated columns. STORED so they index and read like real
--    columns; the JSONB `data` stays the source of truth.
-- ---------------------------------------------------------------------------

-- properties
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS name TEXT GENERATED ALWAYS AS (data->>'Name') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS address1 TEXT GENERATED ALWAYS AS (data->>'Address1') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS address2 TEXT GENERATED ALWAYS AS (data->>'Address2') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS city TEXT GENERATED ALWAYS AS (data->>'City') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS state TEXT GENERATED ALWAYS AS (data->>'State') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS zip TEXT GENERATED ALWAYS AS (data->>'Zip') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS property_type TEXT GENERATED ALWAYS AS (data->>'PropertyType') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS class TEXT GENERATED ALWAYS AS (data->>'Class') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS portfolio_id TEXT GENERATED ALWAYS AS (data->>'PortfolioId') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS management_start_date DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'ManagementStartDate')) STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS management_end_date DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'ManagementEndDate')) STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS management_end_reason TEXT GENERATED ALWAYS AS (data->>'ManagementEndReason') STORED;
ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ GENERATED ALWAYS AS (appfolio.iso_timestamptz(data->>'HiddenAt')) STORED;

-- units
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS property_id TEXT GENERATED ALWAYS AS (data->>'PropertyId') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS current_occupancy_id TEXT GENERATED ALWAYS AS (data->>'CurrentOccupancyId') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS name TEXT GENERATED ALWAYS AS (data->>'Name') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS address1 TEXT GENERATED ALWAYS AS (data->>'Address1') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS city TEXT GENERATED ALWAYS AS (data->>'City') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS state TEXT GENERATED ALWAYS AS (data->>'State') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS zip TEXT GENERATED ALWAYS AS (data->>'Zip') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS bedrooms NUMERIC GENERATED ALWAYS AS ((NULLIF(data->>'Bedrooms',''))::numeric) STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS bathrooms NUMERIC GENERATED ALWAYS AS ((NULLIF(data->>'Bathrooms',''))::numeric) STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS square_feet NUMERIC GENERATED ALWAYS AS ((NULLIF(data->>'SquareFeet',''))::numeric) STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS market_rent NUMERIC GENERATED ALWAYS AS ((NULLIF(data->>'MarketRent',''))::numeric) STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS status TEXT GENERATED ALWAYS AS (data->>'Status') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS rent_status TEXT GENERATED ALWAYS AS (data->>'RentStatus') STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS rent_ready BOOLEAN GENERATED ALWAYS AS ((NULLIF(data->>'RentReady',''))::boolean) STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS available_on DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'AvailableOn')) STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS non_revenue BOOLEAN GENERATED ALWAYS AS ((NULLIF(data->>'NonRevenue',''))::boolean) STORED;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ GENERATED ALWAYS AS (appfolio.iso_timestamptz(data->>'HiddenAt')) STORED;

-- tenants (one row per person; PrimaryTenant marks the primary on an occupancy)
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS occupancy_id TEXT GENERATED ALWAYS AS (data->>'OccupancyId') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS property_id TEXT GENERATED ALWAYS AS (data->>'PropertyId') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS unit_id TEXT GENERATED ALWAYS AS (data->>'UnitId') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS first_name TEXT GENERATED ALWAYS AS (data->>'FirstName') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS last_name TEXT GENERATED ALWAYS AS (data->>'LastName') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS email TEXT GENERATED ALWAYS AS (data->>'Email') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS phone_number TEXT GENERATED ALWAYS AS (data->>'PhoneNumber') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS status TEXT GENERATED ALWAYS AS (data->>'Status') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS tenant_type TEXT GENERATED ALWAYS AS (data->>'TenantType') STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS primary_tenant BOOLEAN GENERATED ALWAYS AS ((NULLIF(data->>'PrimaryTenant',''))::boolean) STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS move_in_on DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'MoveInOn')) STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS move_out_on DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'MoveOutOn')) STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS lease_start_date DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'LeaseStartDate')) STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS lease_end_date DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'LeaseEndDate')) STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS current_rent NUMERIC GENERATED ALWAYS AS ((NULLIF(data->>'CurrentRent',''))::numeric) STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS is_monthly_lease BOOLEAN GENERATED ALWAYS AS ((NULLIF(data->>'IsMonthlyLease',''))::boolean) STORED;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ GENERATED ALWAYS AS (appfolio.iso_timestamptz(data->>'HiddenAt')) STORED;

-- leases (Status here is the e-signature workflow state, NOT lease currency;
-- "the current lease" is the lease covering today for an occupancy)
ALTER TABLE appfolio.leases ADD COLUMN IF NOT EXISTS occupancy_id TEXT GENERATED ALWAYS AS (data->>'OccupancyId') STORED;
ALTER TABLE appfolio.leases ADD COLUMN IF NOT EXISTS start_on DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'StartOn')) STORED;
ALTER TABLE appfolio.leases ADD COLUMN IF NOT EXISTS end_on DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'EndOn')) STORED;
ALTER TABLE appfolio.leases ADD COLUMN IF NOT EXISTS signed_on DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'SignedOn')) STORED;
ALTER TABLE appfolio.leases ADD COLUMN IF NOT EXISTS renewed_on DATE GENERATED ALWAYS AS (appfolio.iso_date(data->>'RenewedOn')) STORED;
ALTER TABLE appfolio.leases ADD COLUMN IF NOT EXISTS is_mtm BOOLEAN GENERATED ALWAYS AS ((NULLIF(data->>'IsMtm',''))::boolean) STORED;
ALTER TABLE appfolio.leases ADD COLUMN IF NOT EXISTS status TEXT GENERATED ALWAYS AS (data->>'Status') STORED;

-- ---------------------------------------------------------------------------
-- 4. Indexes: every *_id join key, the view's filter columns, and partial
--    indexes for the hot "active rows" predicate.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS properties_portfolio_id_idx ON appfolio.properties (portfolio_id);
CREATE INDEX IF NOT EXISTS properties_active_idx ON appfolio.properties (id) WHERE hidden_at IS NULL AND management_end_date IS NULL;

CREATE INDEX IF NOT EXISTS units_property_id_idx ON appfolio.units (property_id);
CREATE INDEX IF NOT EXISTS units_current_occupancy_id_idx ON appfolio.units (current_occupancy_id);
CREATE INDEX IF NOT EXISTS units_active_idx ON appfolio.units (property_id) WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS tenants_occupancy_id_idx ON appfolio.tenants (occupancy_id);
CREATE INDEX IF NOT EXISTS tenants_property_id_idx ON appfolio.tenants (property_id);
CREATE INDEX IF NOT EXISTS tenants_unit_id_idx ON appfolio.tenants (unit_id);
CREATE INDEX IF NOT EXISTS tenants_status_idx ON appfolio.tenants (status);

CREATE INDEX IF NOT EXISTS leases_occupancy_id_idx ON appfolio.leases (occupancy_id);
CREATE INDEX IF NOT EXISTS leases_end_on_idx ON appfolio.leases (end_on);

-- ---------------------------------------------------------------------------
-- 5. appfolio.current_tenancies — one row per active unit on an actively
--    managed property, with its primary current tenant (if any) and the
--    lease covering today for that occupancy (if any). LEFT JOINs keep
--    vacant units visible with NULL tenant/lease columns.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW appfolio.current_tenancies AS
SELECT
  p.id            AS property_id,
  p.name          AS property_name,
  u.id            AS unit_id,
  u.name          AS unit_name,
  u.address1,
  u.city,
  u.state,
  u.zip,
  t.id            AS tenant_id,
  t.first_name,
  t.last_name,
  t.email,
  t.phone_number,
  t.status        AS tenant_status,
  t.current_rent,
  l.id            AS lease_id,
  l.start_on      AS lease_start_on,
  l.end_on        AS lease_end_on,
  l.is_mtm
FROM appfolio.units u
JOIN appfolio.properties p
  ON p.id = u.property_id
 AND p.hidden_at IS NULL
 AND p.management_end_date IS NULL
LEFT JOIN appfolio.tenants t
  ON t.occupancy_id = u.current_occupancy_id
 AND t.status IN ('Current', 'Notice', 'Evict')
 AND t.primary_tenant
LEFT JOIN LATERAL (
  SELECT l2.id, l2.start_on, l2.end_on, l2.is_mtm
    FROM appfolio.leases l2
   WHERE l2.occupancy_id = u.current_occupancy_id
     AND l2.start_on <= CURRENT_DATE
     AND (l2.is_mtm OR l2.end_on >= CURRENT_DATE)
   ORDER BY l2.start_on DESC
   LIMIT 1
) l ON TRUE
WHERE u.hidden_at IS NULL;
