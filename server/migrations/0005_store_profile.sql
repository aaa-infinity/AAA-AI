-- Enrich store_users with full Telegram profile details so the store can
-- show the connected account's identity (username, full name, premium, language).
ALTER TABLE store_users ADD COLUMN first_name TEXT;
ALTER TABLE store_users ADD COLUMN last_name TEXT;
ALTER TABLE store_users ADD COLUMN is_premium INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_users ADD COLUMN language_code TEXT;
ALTER TABLE store_users ADD COLUMN phone TEXT;
ALTER TABLE store_users ADD COLUMN telegram_id TEXT;
ALTER TABLE store_users ADD COLUMN updated_at INTEGER;
