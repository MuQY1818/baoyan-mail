CREATE TABLE IF NOT EXISTS visit_daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_date TEXT NOT NULL,
  country_code TEXT NOT NULL,
  region_code TEXT NOT NULL DEFAULT '',
  country_name TEXT NOT NULL DEFAULT '',
  region_name TEXT NOT NULL DEFAULT '',
  visit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(visit_date, country_code, region_code)
);

CREATE INDEX IF NOT EXISTS idx_visit_daily_stats_date
  ON visit_daily_stats(visit_date);

CREATE INDEX IF NOT EXISTS idx_visit_daily_stats_country
  ON visit_daily_stats(country_code, visit_count);
