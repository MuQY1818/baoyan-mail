CREATE TABLE IF NOT EXISTS classification_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_url TEXT NOT NULL,
  classification_kind TEXT NOT NULL
    CHECK (classification_kind IN ('relevance', 'activity_type')),
  model_value TEXT NOT NULL,
  corrected_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('model', 'rule_guard', 'manual')),
  classifier TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classification_feedback_url
  ON classification_feedback(normalized_url, classification_kind, created_at);

CREATE INDEX IF NOT EXISTS idx_classification_feedback_source
  ON classification_feedback(source, created_at);
