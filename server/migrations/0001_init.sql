-- AAA-AI D1 schema: per-user points wallet + history.
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 100,
  email TEXT,
  display_name TEXT,
  lifetime_earned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  endpoint_id TEXT,
  text TEXT,
  is_user INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_uid ON history(uid);
CREATE INDEX IF NOT EXISTS idx_tx_uid ON transactions(uid);
