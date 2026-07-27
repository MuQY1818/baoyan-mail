CREATE TABLE IF NOT EXISTS item_official_verifications (
  normalized_url TEXT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_item_official_verifications_updated
  ON item_official_verifications(updated_at);
