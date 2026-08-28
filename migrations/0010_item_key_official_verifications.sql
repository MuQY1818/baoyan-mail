CREATE TABLE IF NOT EXISTS item_official_item_verifications (
  item_key TEXT PRIMARY KEY,
  normalized_url TEXT NOT NULL,
  title TEXT NOT NULL,
  deadline TEXT NOT NULL,
  deadline_precision TEXT NOT NULL
    CHECK (deadline_precision IN ('exact', 'date', 'unknown')),
  reason TEXT NOT NULL,
  verifier TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_official_item_verifications_url
  ON item_official_item_verifications(normalized_url);

CREATE INDEX IF NOT EXISTS idx_item_official_item_verifications_updated
  ON item_official_item_verifications(updated_at);
