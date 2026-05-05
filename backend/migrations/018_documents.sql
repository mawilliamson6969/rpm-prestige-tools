-- Documents module: standalone rich-text documents with folders, tags, pinning, archive.
-- Also created at runtime via ensureDocumentsSchema in backend/lib/db.js.

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled Document',
  content TEXT DEFAULT '',
  folder TEXT DEFAULT 'General',
  tags TEXT[] DEFAULT '{}',
  owner TEXT DEFAULT 'Mike',
  pinned BOOLEAN DEFAULT false,
  archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_folder_idx ON documents (folder);
CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents (owner);
CREATE INDEX IF NOT EXISTS documents_archived_idx ON documents (archived);
CREATE INDEX IF NOT EXISTS documents_updated_idx ON documents (updated_at DESC);

CREATE OR REPLACE FUNCTION documents_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_updated_at_trigger ON documents;
CREATE TRIGGER documents_updated_at_trigger
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION documents_set_updated_at();

SELECT 'Migration 018 — documents ready' AS status;
