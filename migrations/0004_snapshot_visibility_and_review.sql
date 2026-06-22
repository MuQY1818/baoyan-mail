ALTER TABLE item_snapshots
  ADD COLUMN last_seen_at TEXT;

ALTER TABLE item_snapshots
  ADD COLUMN missing_since TEXT;

UPDATE item_snapshots
SET last_seen_at = COALESCE(last_seen_at, updated_at, first_seen_at)
WHERE last_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_item_snapshots_source_group
  ON item_snapshots(source_group);

CREATE INDEX IF NOT EXISTS idx_item_snapshots_missing_since
  ON item_snapshots(missing_since);

CREATE TABLE IF NOT EXISTS source_review_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_url TEXT NOT NULL,
  source_group TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT,
  UNIQUE(normalized_url, source_group)
);

CREATE INDEX IF NOT EXISTS idx_source_review_candidates_status
  ON source_review_candidates(status, updated_at);

CREATE TABLE IF NOT EXISTS source_review_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('allow', 'reject')),
  normalized_url TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(rule_type, normalized_url)
);

CREATE TABLE IF NOT EXISTS manual_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  source_group TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_items_source_group
  ON manual_items(source_group);
