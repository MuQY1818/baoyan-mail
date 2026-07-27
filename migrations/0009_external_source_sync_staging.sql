CREATE TABLE IF NOT EXISTS external_source_sync_items (
  run_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_group TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_external_source_sync_items_created
  ON external_source_sync_items(created_at);
