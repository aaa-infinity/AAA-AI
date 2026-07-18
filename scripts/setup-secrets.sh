#!/usr/bin/env bash
# Bulk-set all Cloudflare Worker secrets for AAA-AI in one command.
#
# Reads values from environment variables (or a local .env file if present) and
# pushes each as a Worker secret via `wrangler secret put`. Uses printf so no
# trailing newline is baked into the secret value (a subtle bug that breaks
# token comparisons like the Telegram Login Widget HMAC).
#
# Usage:
#   cd server
#   FREE_AI_BOT_TOKEN=... LOGIN_BOT_TOKEN=... bash ../scripts/setup-secrets.sh
# or put the values in server/.env and just run: npm run secrets
set -euo pipefail

cd "$(dirname "$0")/../server"

# Load .env if present (never commit this file).
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

put_secret() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    echo "-- skip $name (unset)"
    return 0
  fi
  echo "==> setting $name"
  printf '%s' "$value" | npx -y wrangler secret put "$name" >/dev/null 2>&1 && \
    echo "   ok" || echo "   FAILED"
}

# Telegram bot tokens
put_secret FREE_AI_BOT_TOKEN
put_secret LOGIN_BOT_TOKEN
put_secret ADMIN_BOT_TOKEN
put_secret ADMIN_CHAT_ID

# AI provider keys (server-side only)
put_secret GEMINI_KEY
put_secret GROQ_KEY
put_secret HF_KEY

# Supabase mirror
put_secret SUPABASE_URL
put_secret SUPABASE_ANON
put_secret SUPABASE_SERVICE_ROLE

# App shared secret (guards privileged app->server routes)
put_secret APP_SHARED_SECRET

# Telegram channel + Google/YouTube OAuth
put_secret CHANNEL_ID
put_secret GOOGLE_CLIENT_ID
put_secret GOOGLE_CLIENT_SECRET
put_secret PUBLIC_ORIGIN

echo "Secret sync complete."
