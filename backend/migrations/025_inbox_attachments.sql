-- Phase 5: inbox attachments.
-- Idempotent. Also applied at runtime by ensureInboxAttachmentsSchema().
--
-- Note on storage_path nullability: the spec calls for NOT NULL but its own
-- engine logic — "fetch if storage_path IS NULL" — implies nullable rows
-- for attachments whose binary hasn't been pulled from Graph yet (lazy
-- fetch path). We allow NULL so the metadata row can land first and the
-- bytes stream in later.

CREATE TABLE IF NOT EXISTS attachments (
  id              SERIAL PRIMARY KEY,
  message_id      INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  thread_id       TEXT REFERENCES threads(thread_id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  content_type    TEXT,
  size_bytes      BIGINT,
  storage_path    TEXT,
  storage_kind    TEXT NOT NULL DEFAULT 'disk',
  graph_id        TEXT,
  direction       TEXT NOT NULL,
  is_inline       BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (direction IN ('inbound', 'outbound')),
  CHECK (storage_kind IN ('disk', 's3'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_thread  ON attachments(thread_id);
CREATE INDEX IF NOT EXISTS idx_attachments_pending
  ON attachments(message_id) WHERE storage_path IS NULL AND direction = 'inbound';
-- A Graph attachment id is unique within a message; lets us idempotently
-- upsert when the eager fetch sees the same metadata twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attachments_graph_per_message
  ON attachments(message_id, graph_id) WHERE graph_id IS NOT NULL;
