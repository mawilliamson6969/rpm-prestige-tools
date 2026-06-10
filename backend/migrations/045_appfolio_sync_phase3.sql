-- 045_appfolio_sync_phase3.sql
-- AppFolio mirror, Phase 3: deletion detection + failure tracking.
--
-- Append-only relative to 043/044 and idempotent: safe to re-run on
-- every boot (applied by lib/af-mirror-schema.js after 043 and 044).
--
--   missing_since         Set by the nightly full pass on rows its
--                         successful fetch did not touch; cleared by any
--                         upsert that sees the record again. Rows are
--                         NEVER hard-deleted. NULL = present in AppFolio
--                         as of the last successful full pass.
--   consecutive_failures  Per-resource failure streak. At exactly 2 the
--                         sync emits appfolio.sync.failed; any success
--                         resets to 0 (emitting appfolio.sync.recovered
--                         when the streak was >= 2).
--   last_success_at       Timestamp of the last successful run; gives
--                         the failure/recovery events their last-success
--                         and downtime fields.

ALTER TABLE appfolio.properties ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE appfolio.units ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE appfolio.tenants ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE appfolio.leases ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;

ALTER TABLE appfolio.sync_state ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appfolio.sync_state ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- current_tenancies, recreated with missing_since awareness: rows flagged
-- missing by the nightly sweep drop out of the unit set, the tenant join,
-- and the lease pick. (Property activeness is already governed by
-- management_end_date / hidden_at; per spec, properties are not
-- additionally filtered on missing_since here.)
-- Same output columns as 044's version — CREATE OR REPLACE is safe.
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
 AND t.missing_since IS NULL
LEFT JOIN LATERAL (
  SELECT l2.id, l2.start_on, l2.end_on, l2.is_mtm
    FROM appfolio.leases l2
   WHERE l2.occupancy_id = u.current_occupancy_id
     AND l2.start_on <= CURRENT_DATE
     AND (l2.is_mtm OR l2.end_on >= CURRENT_DATE)
     AND l2.missing_since IS NULL
   ORDER BY l2.start_on DESC
   LIMIT 1
) l ON TRUE
WHERE u.hidden_at IS NULL
  AND u.missing_since IS NULL;
