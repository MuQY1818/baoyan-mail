-- 暂存完整 JSON 批次，避免逐项目写入和逐项目清理；旧表保留供回滚。
CREATE TABLE IF NOT EXISTS external_source_sync_batches (
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('items', 'reviews')),
  batch_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, kind, batch_key)
) WITHOUT ROWID;

CREATE VIEW IF NOT EXISTS external_source_sync_item_rows AS
SELECT b.run_id, json_extract(j.value, '$.key') AS item_key,
  json_extract(j.value, '$.contentHash') AS content_hash, j.value AS payload,
  json_extract(j.value, '$.sourceGroup') AS source_group, b.created_at
FROM external_source_sync_batches b, json_each(b.payload) j WHERE b.kind = 'items'
UNION ALL SELECT * FROM external_source_sync_items;

CREATE VIEW IF NOT EXISTS external_source_sync_review_rows AS
SELECT b.run_id, json_extract(j.value, '$.normalizedUrl') AS normalized_url,
  json_extract(j.value, '$.sourceGroup') AS source_group,
  json_extract(j.value, '$.reason') AS reason,
  json_extract(j.value, '$.payload') AS payload, b.created_at
FROM external_source_sync_batches b, json_each(b.payload) j WHERE b.kind = 'reviews'
UNION ALL SELECT * FROM external_source_sync_reviews;

-- 本项目采集/分类事务的保守预算，不等同于 Cloudflare 账户总用量。
CREATE TABLE IF NOT EXISTS pipeline_write_budget (
  utc_day TEXT PRIMARY KEY,
  reserved INTEGER NOT NULL,
  daily_limit INTEGER NOT NULL,
  CONSTRAINT pipeline_daily_write_limit CHECK (reserved <= daily_limit)
) WITHOUT ROWID;
