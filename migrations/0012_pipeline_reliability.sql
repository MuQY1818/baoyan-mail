-- 添加式迁移：不删除快照、审核历史或本地申请数据。
CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT,
  workflow_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_recent ON pipeline_runs(updated_at DESC);

CREATE TABLE IF NOT EXISTS external_source_sync_reviews (
  run_id TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  source_group TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, normalized_url, source_group)
);

CREATE TABLE IF NOT EXISTS classification_submissions (
  submission_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  snapshot_version TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classification_submissions_run ON classification_submissions(run_id);

CREATE TABLE IF NOT EXISTS classification_candidate_pages (
  run_id TEXT NOT NULL,
  snapshot_version TEXT NOT NULL,
  cursor TEXT NOT NULL,
  next_cursor TEXT,
  candidate_keys TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, cursor)
);

-- 在 D1 batch 事务内执行 CHECK，检查失败使整批回滚，避免检查和写入间竞态。
CREATE TABLE IF NOT EXISTS pipeline_assertions (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
ALTER TABLE classification_feedback ADD COLUMN feedback_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_classification_feedback_key ON classification_feedback(feedback_key)
  WHERE feedback_key IS NOT NULL;
