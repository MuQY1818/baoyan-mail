CREATE TABLE IF NOT EXISTS new_deadline_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(item_key)
);

CREATE INDEX IF NOT EXISTS idx_new_deadline_notifications_sent_at
  ON new_deadline_notifications(sent_at);

CREATE INDEX IF NOT EXISTS idx_new_deadline_notifications_deadline_at
  ON new_deadline_notifications(deadline_at);
