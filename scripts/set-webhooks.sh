#!/usr/bin/env bash
# Register all Telegram webhooks + bot command menus for AAA-AI, automatically.
#
# Usage:
#   FREE_AI_BOT_TOKEN=... LOGIN_BOT_TOKEN=... ADMIN_BOT_TOKEN=... \
#   WORKER_URL=https://aaa-ai-bot.aaateam.workers.dev bash scripts/set-webhooks.sh
#
# Defaults are filled in from the known project values if env vars are unset.
set -euo pipefail

WORKER_URL="${WORKER_URL:-https://aaa-ai-bot.aaateam.workers.dev}"
FREE_AI_BOT_TOKEN="${FREE_AI_BOT_TOKEN:-}"
LOGIN_BOT_TOKEN="${LOGIN_BOT_TOKEN:-}"
ADMIN_BOT_TOKEN="${ADMIN_BOT_TOKEN:-}"

API="https://api.telegram.org/bot"

require() {
  if [ -z "$2" ]; then
    echo "!! Skipping $1 (token not set)"; return 1
  fi; return 0
}

set_webhook() {
  local name="$1" token="$2" path="$3"
  require "$name" "$token" || return 0
  echo "==> $name webhook -> $WORKER_URL$path"
  curl -s -X POST "$API$token/setWebhook" \
    -H "content-type: application/json" \
    -d "{\"url\":\"$WORKER_URL$path\",\"drop_pending_updates\":true,\"allowed_updates\":[\"message\",\"callback_query\"]}" \
    | grep -o '"ok":[a-z]*' || true
  echo
}

set_commands() {
  local name="$1" token="$2" json="$3"
  require "$name" "$token" || return 0
  echo "==> $name command menu"
  curl -s -X POST "$API$token/setMyCommands" \
    -H "content-type: application/json" -d "$json" \
    | grep -o '"ok":[a-z]*' || true
  echo
}

# Webhooks
set_webhook "Free AI bot" "$FREE_AI_BOT_TOKEN" "/telegram/free"
set_webhook "Login bot"   "$LOGIN_BOT_TOKEN"   "/telegram/login"
set_webhook "Admin bot"   "$ADMIN_BOT_TOKEN"   "/telegram/admin"

# Command menus (shown in Telegram's "/" menu)
set_commands "Free AI bot" "$FREE_AI_BOT_TOKEN" \
  '{"commands":[{"command":"start","description":"Start chatting with free AI"}]}'
set_commands "Login bot" "$LOGIN_BOT_TOKEN" \
  '{"commands":[{"command":"start","description":"Sign in to the AAA-AI app"}]}'
set_commands "Admin bot" "$ADMIN_BOT_TOKEN" \
  '{"commands":[
     {"command":"help","description":"Show admin commands"},
     {"command":"keys","description":"List API key submissions"},
     {"command":"key","description":"Submissions for one provider"},
     {"command":"stats","description":"Users, points, pending codes"},
     {"command":"setpoints","description":"Adjust a user balance"},
     {"command":"broadcast","description":"Message all users"}
   ]}'

echo "All webhooks + command menus configured."
