CREATE TABLE IF NOT EXISTS pill_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac TEXT NOT NULL,
  temp_c REAL,
  gravity_sg REAL,
  battery_pct INTEGER,
  rssi INTEGER,
  recorded_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_unsynced ON pill_readings(synced, recorded_at);
CREATE INDEX IF NOT EXISTS idx_mac_time ON pill_readings(mac, recorded_at);