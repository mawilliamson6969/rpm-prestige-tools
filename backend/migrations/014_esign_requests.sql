-- E-signature tracking. Each row mirrors a Docuseal submission so the platform can
-- list, search, and link signing requests to processes without paging Docuseal on every render.
-- Also created at runtime via ensureEsignSchema in lib/esign-schema.js.

CREATE TABLE IF NOT EXISTS esign_requests (
  id SERIAL PRIMARY KEY,
  docuseal_submission_id INTEGER,
  template_id INTEGER,
  template_name VARCHAR(255),
  process_id INTEGER REFERENCES processes(id) ON DELETE SET NULL,
  property_name VARCHAR(500),
  signers JSONB NOT NULL DEFAULT '[]',
  prefill_fields JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending',
  signed_document_url TEXT,
  completed_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_esign_requests_process ON esign_requests(process_id);
CREATE INDEX IF NOT EXISTS idx_esign_requests_status ON esign_requests(status);
CREATE INDEX IF NOT EXISTS idx_esign_requests_submission ON esign_requests(docuseal_submission_id);
CREATE INDEX IF NOT EXISTS idx_esign_requests_created ON esign_requests(created_at DESC);
