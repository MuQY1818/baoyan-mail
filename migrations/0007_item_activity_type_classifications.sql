CREATE TABLE IF NOT EXISTS item_activity_type_classifications (
  normalized_url TEXT PRIMARY KEY,
  activity_type TEXT NOT NULL
    CHECK (activity_type IN ('summer_camp', 'pre_recommendation', 'unknown')),
  reason TEXT NOT NULL,
  classifier TEXT NOT NULL,
  classified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_activity_type_classifications_type
  ON item_activity_type_classifications(activity_type, updated_at);
