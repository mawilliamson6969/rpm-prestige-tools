-- Per-user pinned forms on the Forms list (sidebar + sort)
CREATE TABLE IF NOT EXISTS form_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, form_id)
);

CREATE INDEX IF NOT EXISTS idx_form_favorites_user ON form_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_form_favorites_form ON form_favorites(form_id);
