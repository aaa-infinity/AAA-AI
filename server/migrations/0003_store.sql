-- Ari AI App Store tables (shared by both workers via the same D1 database).
CREATE TABLE IF NOT EXISTS store_users (
  uid TEXT PRIMARY KEY,
  tg_username TEXT,
  display_name TEXT,
  photo_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  apps_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS store_apps (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  name TEXT NOT NULL,
  package_name TEXT,
  version TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  short_desc TEXT,
  long_desc TEXT,
  icon_url TEXT,
  apk_url TEXT,
  apk_r2_key TEXT,
  apk_size INTEGER,
  min_android TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  moderation TEXT,
  reject_reason TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER NOT NULL,
  approved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_store_apps_status ON store_apps(status);
CREATE INDEX IF NOT EXISTS idx_store_apps_pkg ON store_apps(package_name);
CREATE INDEX IF NOT EXISTS idx_store_apps_owner ON store_apps(owner_uid);
