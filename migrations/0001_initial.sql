CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'unsubscribed')),
  confirm_token_hash TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  unsubscribed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscribers_status
  ON subscribers(status);

CREATE INDEX IF NOT EXISTS idx_subscribers_confirm_token_hash
  ON subscribers(confirm_token_hash);

CREATE INDEX IF NOT EXISTS idx_subscribers_unsubscribe_token
  ON subscribers(unsubscribe_token);

CREATE TABLE IF NOT EXISTS item_snapshots (
  item_key TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_group TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('added', 'changed')),
  content_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(item_key, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_notifications_sent_at
  ON notifications(sent_at);

CREATE TABLE IF NOT EXISTS mail_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_ids TEXT NOT NULL,
  subscriber_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_message_ids TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
