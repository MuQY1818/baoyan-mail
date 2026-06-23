CREATE TABLE IF NOT EXISTS item_relevance_classifications (
  normalized_url TEXT PRIMARY KEY,
  relevance TEXT NOT NULL CHECK (relevance IN ('strong', 'possible', 'unrelated')),
  areas TEXT NOT NULL,
  reason TEXT NOT NULL,
  classifier TEXT NOT NULL,
  classified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_relevance_classifications_relevance
  ON item_relevance_classifications(relevance, updated_at);
