-- Phase 3: Renewals board seed.
--
-- Creates the "Renewals" mb_ board, its columns, one stored group ("All
-- Renewals" — countdown buckets are computed view-only in the frontend),
-- and 8-12 SAMPLE renewal items spread across the lease-end countdown
-- ranges so a reviewer can see all the buckets populate without real data.
--
-- Idempotency:
--   * Board is keyed by slug = 'renewals'. Re-running picks up the same id.
--   * Columns are keyed by (board_id, key) — uq_mb_board_columns_board_key.
--   * Groups are keyed by (board_id, name) using a partial unique index
--     added here (the base schema doesn't enforce it, but we want to).
--   * Items use a synthetic appfolio_id = 'SEED-<n>' tagged with
--     appfolio_resource_type = 'seed' so we can ON CONFLICT against them
--     without colliding with real AppFolio rows.
--
-- Lease dates are stored as ISO date strings in mb_items.values keyed by
-- the column key ("lease_end_date"). The frontend computes the countdown
-- bucket dynamically. To keep the seed visually useful as time passes, we
-- write lease_end_date relative to NOW() at seed time — re-running the
-- migration after several weeks will refresh the dates so the buckets
-- still demonstrate the spread (idempotent UPDATE on conflict).

-- ------------------------------------------------------------
-- 1. Board
-- ------------------------------------------------------------

INSERT INTO mb_boards (name, slug, description, icon, color, default_view)
VALUES (
  'Renewals',
  'renewals',
  'Lease renewal pipeline. Items group automatically by lease-end countdown bucket.',
  '📅',
  '#0098d0',
  'table'
)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      color = EXCLUDED.color,
      updated_at = NOW();

-- ------------------------------------------------------------
-- 2. Columns
-- ------------------------------------------------------------
--
-- Column types match frontend/types/mb.ts ColumnType. The "score" column
-- handles renewal_score with thresholds for color coding. Read-only
-- columns (sourced from AppFolio) are marked via config.readOnly = true;
-- the frontend gates editing on that flag.

WITH b AS (SELECT id FROM mb_boards WHERE slug = 'renewals')
INSERT INTO mb_board_columns (board_id, name, key, column_type, config, position, width, is_required, appfolio_field)
VALUES
  ((SELECT id FROM b), 'Renewal Score',     'renewal_score',     'score',    '{"min":0,"max":100,"thresholds":[{"at":40,"color":"#ef4444","label":"Low"},{"at":70,"color":"#f59e0b","label":"Medium"},{"at":100,"color":"#10b981","label":"High"}]}'::jsonb, 10, 130, FALSE, NULL),
  ((SELECT id FROM b), 'Tenant Name',       'tenant_name',       'text',     '{"readOnly":true}'::jsonb,                                                                                                                                                          20, 200, FALSE, 'tenant_name'),
  ((SELECT id FROM b), 'Property',          'property',          'text',     '{"readOnly":true}'::jsonb,                                                                                                                                                          30, 240, FALSE, 'property_address'),
  ((SELECT id FROM b), 'Lease End Date',    'lease_end_date',    'date',     '{"readOnly":true}'::jsonb,                                                                                                                                                          40, 140, FALSE, 'lease_to_date'),
  ((SELECT id FROM b), 'Status',            'status',            'status',   '{"options":[{"label":"New","value":"new","color":"#6a737b"},{"label":"In Outreach","value":"in_outreach","color":"#0098d0"},{"label":"Awaiting Response","value":"awaiting_response","color":"#f59e0b"},{"label":"Renewed","value":"renewed","color":"#10b981"},{"label":"Not Renewing","value":"not_renewing","color":"#b32317"},{"label":"Lost","value":"lost","color":"#374151"}],"defaultValue":"new"}'::jsonb, 50, 160, FALSE, NULL),
  ((SELECT id FROM b), 'Owner',             'owner',             'person',   '{}'::jsonb,                                                                                                                                                                         60, 160, FALSE, NULL),
  ((SELECT id FROM b), 'Last Contact Date', 'last_contact_date', 'date',     '{}'::jsonb,                                                                                                                                                                         70, 140, FALSE, NULL),
  ((SELECT id FROM b), 'Renewal Offer Sent','renewal_offer_sent','date',     '{}'::jsonb,                                                                                                                                                                         80, 140, FALSE, NULL),
  ((SELECT id FROM b), 'Notes',             'notes',             'longtext', '{}'::jsonb,                                                                                                                                                                         90, 280, FALSE, NULL)
ON CONFLICT (board_id, key) DO UPDATE
  SET name = EXCLUDED.name,
      column_type = EXCLUDED.column_type,
      config = EXCLUDED.config,
      position = EXCLUDED.position,
      width = EXCLUDED.width,
      is_required = EXCLUDED.is_required,
      appfolio_field = EXCLUDED.appfolio_field;

-- ------------------------------------------------------------
-- 3. Group
-- ------------------------------------------------------------
--
-- The renewal board needs exactly one stored group; countdown buckets
-- ("Overdue", "0-30 days", etc.) are computed view-only in the frontend
-- based on each item's lease_end_date value. mb_groups has no uniqueness
-- enforced on (board_id, name) in the base schema, so we add a partial
-- unique index here to make the seed ON CONFLICT-safe.

CREATE UNIQUE INDEX IF NOT EXISTS uq_mb_groups_board_name
  ON mb_groups (board_id, name);

WITH b AS (SELECT id FROM mb_boards WHERE slug = 'renewals')
INSERT INTO mb_groups (board_id, name, color, position, is_collapsed)
VALUES
  ((SELECT id FROM b), 'All Renewals', '#0098d0', 0, FALSE)
ON CONFLICT (board_id, name) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Sample items
-- ------------------------------------------------------------
--
-- 10 items spread across the five countdown buckets:
--   * 1 overdue (lease ended 7 days ago)
--   * 2 in 0-30 days
--   * 2 in 31-60 days
--   * 2 in 61-90 days
--   * 3 in 91+ days
--
-- All items use the "All Renewals" stored group. The frontend computes
-- the bucket from lease_end_date for display only.
--
-- appfolio_id is set to 'SAMPLE-<n>' with appfolio_resource_type = 'seed'
-- so the partial unique index on (appfolio_resource_type, appfolio_id)
-- gives us a clean ON CONFLICT target without colliding with real
-- AppFolio-sourced rows in later phases.

CREATE UNIQUE INDEX IF NOT EXISTS uq_mb_items_seed_appfolio
  ON mb_items (appfolio_resource_type, appfolio_id)
  WHERE appfolio_resource_type = 'seed';

DO $$
DECLARE
  v_board_id INTEGER;
  v_group_id INTEGER;
  v_seed JSONB;
BEGIN
  SELECT id INTO v_board_id FROM mb_boards WHERE slug = 'renewals';
  SELECT id INTO v_group_id FROM mb_groups WHERE board_id = v_board_id AND name = 'All Renewals';

  IF v_board_id IS NULL OR v_group_id IS NULL THEN
    RAISE NOTICE 'Renewals board or group missing — skipping item seed.';
    RETURN;
  END IF;

  -- Item template: each row is (appfolio_id, title, position, days_until_lease_end, renewal_score, status, tenant_name, property, notes)
  FOR v_seed IN
    SELECT * FROM jsonb_array_elements('[
      {"sid":"SAMPLE-1","title":"SAMPLE — Smith Family",        "pos":1024,  "days":-7,  "score":35, "status":"in_outreach",      "tenant":"SAMPLE — Smith Family",        "prop":"SAMPLE — 1234 Oak St, Houston TX",        "notes":"Lease ended a week ago. Tenant not responding to calls."},
      {"sid":"SAMPLE-2","title":"SAMPLE — Garcia Family",       "pos":2048,  "days":12,  "score":62, "status":"awaiting_response","tenant":"SAMPLE — Garcia Family",       "prop":"SAMPLE — 5678 Maple Ln, Houston TX",      "notes":"Offer sent 11/01. Following up Wednesday."},
      {"sid":"SAMPLE-3","title":"SAMPLE — Thompson Family",     "pos":3072,  "days":25,  "score":81, "status":"renewed",          "tenant":"SAMPLE — Thompson Family",     "prop":"SAMPLE — 910 Pine Dr, Houston TX",        "notes":"Renewed for 12 months at +4% rent."},
      {"sid":"SAMPLE-4","title":"SAMPLE — Patel Family",        "pos":4096,  "days":42,  "score":74, "status":"in_outreach",      "tenant":"SAMPLE — Patel Family",        "prop":"SAMPLE — 246 Cedar Ave, Houston TX",      "notes":"Initial outreach sent. Awaiting reply."},
      {"sid":"SAMPLE-5","title":"SAMPLE — Williams Family",     "pos":5120,  "days":55,  "score":48, "status":"new",              "tenant":"SAMPLE — Williams Family",     "prop":"SAMPLE — 802 Birch Rd, Houston TX",       "notes":"History of late payments — review before sending offer."},
      {"sid":"SAMPLE-6","title":"SAMPLE — Nguyen Family",       "pos":6144,  "days":72,  "score":88, "status":"new",              "tenant":"SAMPLE — Nguyen Family",       "prop":"SAMPLE — 415 Spruce Ct, Houston TX",      "notes":"High score — auto-renew eligible."},
      {"sid":"SAMPLE-7","title":"SAMPLE — Brown Family",        "pos":7168,  "days":85,  "score":58, "status":"new",              "tenant":"SAMPLE — Brown Family",        "prop":"SAMPLE — 1100 Elm St, Houston TX",        "notes":""},
      {"sid":"SAMPLE-8","title":"SAMPLE — Rodriguez Family",    "pos":8192,  "days":110, "score":91, "status":"new",              "tenant":"SAMPLE — Rodriguez Family",    "prop":"SAMPLE — 78 Magnolia Way, Houston TX",    "notes":"Long-term tenant. Strong renewal candidate."},
      {"sid":"SAMPLE-9","title":"SAMPLE — Lee Family",          "pos":9216,  "days":135, "score":67, "status":"new",              "tenant":"SAMPLE — Lee Family",          "prop":"SAMPLE — 33 Sycamore Ln, Houston TX",     "notes":""},
      {"sid":"SAMPLE-10","title":"SAMPLE — Anderson Family",    "pos":10240, "days":175, "score":29, "status":"not_renewing",     "tenant":"SAMPLE — Anderson Family",     "prop":"SAMPLE — 2200 Willow Pkwy, Houston TX",   "notes":"Tenant gave notice; not renewing. Mark unit ready for relisting."}
    ]'::jsonb)
  LOOP
    INSERT INTO mb_items (
      board_id, title, position, group_id, values,
      appfolio_id, appfolio_resource_type, created_by, assigned_to
    )
    VALUES (
      v_board_id,
      v_seed->>'title',
      (v_seed->>'pos')::numeric,
      v_group_id,
      jsonb_build_object(
        'renewal_score',     (v_seed->>'score')::int,
        'tenant_name',       v_seed->>'tenant',
        'property',          v_seed->>'prop',
        'lease_end_date',    to_char((NOW() + ((v_seed->>'days')::int * INTERVAL '1 day'))::date, 'YYYY-MM-DD'),
        'status',            v_seed->>'status',
        'owner',             NULL,
        'last_contact_date', NULL,
        'renewal_offer_sent',NULL,
        'notes',             v_seed->>'notes'
      ),
      v_seed->>'sid',
      'seed',
      NULL,
      NULL
    )
    ON CONFLICT (appfolio_resource_type, appfolio_id)
      WHERE appfolio_resource_type = 'seed'
      DO UPDATE
        SET title = EXCLUDED.title,
            position = EXCLUDED.position,
            group_id = EXCLUDED.group_id,
            -- Refresh read-only/derived fields on re-run, but preserve any
            -- user edits to the editable columns (status, owner, last_contact_date,
            -- renewal_offer_sent, notes).
            values = mb_items.values
                     || jsonb_build_object(
                          'renewal_score',  EXCLUDED.values->'renewal_score',
                          'tenant_name',    EXCLUDED.values->>'tenant_name',
                          'property',       EXCLUDED.values->>'property',
                          'lease_end_date', EXCLUDED.values->>'lease_end_date'
                        ),
            updated_at = NOW();
  END LOOP;
END $$;
