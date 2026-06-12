-- 046_appfolio_webhook_events.sql
-- AppFolio mirror, Phase 3.5: raw webhook inbox.
--
-- Doorbell model: AppFolio webhooks land here verbatim (audit/debug
-- record), a 15-second processor turns them into targeted delta syncs +
-- event-bus events, and the Phase 3 polling sync remains the
-- reconciliation layer — a lost webhook costs freshness, never
-- correctness.
--
-- dedupe_key: provider event id when the payload carries one, else a
-- hash of topic+payload+minute. The partial unique index makes provider
-- retries idempotent at insert time.
--
-- Retention cleanup is future work (rows are small; revisit when the
-- table earns it).
--
-- Append-only and idempotent: applied at boot by lib/af-mirror-schema.js
-- after 043/044/045.

CREATE TABLE IF NOT EXISTS appfolio.webhook_events (
  id SERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  topic TEXT,
  raw_payload JSONB,
  processed_at TIMESTAMPTZ,
  dedupe_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_dedupe_idx
  ON appfolio.webhook_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- The processor's claim query: oldest unprocessed first.
CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx
  ON appfolio.webhook_events (received_at)
  WHERE processed_at IS NULL;
