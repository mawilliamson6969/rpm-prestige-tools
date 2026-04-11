-- Applied automatically on API startup via ensureOwnerTerminationSchema() in lib/db.js
-- (kept here for reference / manual runs)

CREATE TABLE IF NOT EXISTS owner_termination_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitter_type VARCHAR(32) NOT NULL,
  staff_member_name TEXT,
  email VARCHAR(255) NOT NULL,
  owner_first_name VARCHAR(255) NOT NULL,
  owner_last_name VARCHAR(255) NOT NULL,
  street_address TEXT NOT NULL,
  street_address_2 TEXT,
  city VARCHAR(255) NOT NULL,
  state VARCHAR(64) NOT NULL,
  zip_code VARCHAR(32) NOT NULL,
  date_received_in_writing DATE NOT NULL,
  requested_termination_date DATE NOT NULL,
  termination_reason VARCHAR(128) NOT NULL,
  reason_details TEXT,
  retention_offer_accepted VARCHAR(16) NOT NULL,
  improvement_feedback TEXT,
  guarantees_acknowledged BOOLEAN,
  deposit_waiver_acknowledged BOOLEAN,
  deposit_return_acknowledged BOOLEAN,
  keys_balance_acknowledged BOOLEAN,
  signature_data TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
