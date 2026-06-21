CREATE TABLE IF NOT EXISTS deadline_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  reminder_window_days INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(item_key, deadline_at, reminder_window_days)
);

CREATE INDEX IF NOT EXISTS idx_deadline_reminders_sent_at
  ON deadline_reminders(sent_at);

CREATE INDEX IF NOT EXISTS idx_deadline_reminders_deadline_at
  ON deadline_reminders(deadline_at);
