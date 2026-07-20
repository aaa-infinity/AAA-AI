-- Per-user AI keys for the Telegram companion bot.
-- Users paste their OWN free Gemini/Groq key to enable AI chat in Telegram.
CREATE TABLE IF NOT EXISTS user_ai_keys (
  uid text PRIMARY KEY,
  provider text,
  api_key text,
  created_at bigint
);
