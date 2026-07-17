# AAA-AI Bot Server (Cloudflare Workers, free tier)

Server-side Telegram bot relay. Bot tokens stay here (server-side) — never in the Android app.

## What it does
- **@AAA_Free_Ai_bot** — relays a chat message to the free-AI endpoints and replies.
- **@AAA_Login_bot** — issues a 10-minute link code the app can verify via `/api/verify`.

## Deploy (you, with your Cloudflare login)
```bash
cd server
npm install -g wrangler
wrangler login                 # opens browser; uses YOUR account (free)

# Create KV namespace, then paste its id into wrangler.toml -> kv_namespaces
wrangler kv namespace create aaa_kv

# Set secrets (do NOT commit tokens)
wrangler secret put FREE_AI_BOT_TOKEN
wrangler secret put LOGIN_BOT_TOKEN

wrangler deploy

# Register Telegram webhooks (replace URLs with your Worker URL)
curl -F "url=https://<your-subdomain>.workers.dev/telegram/free"  https://api.telegram.org/bot<FREE_AI_BOT_TOKEN>/setWebhook
curl -F "url=https://<your-subdomain>.workers.dev/telegram/login" https://api.telegram.org/bot<LOGIN_BOT_TOKEN>/setWebhook
```

## Secrets
| Name | Value |
|------|-------|
| `FREE_AI_BOT_TOKEN` | token for @AAA_Free_Ai_bot |
| `LOGIN_BOT_TOKEN`  | token for @AAA_Login_bot |

## Notes
- Free tier: Workers + KV (1 GB) is enough. No cron/queues needed (webhooks).
- The Android app calls `https://<your-subdomain>.workers.dev/api/verify?code=XXXX`
  to confirm a Telegram link. Full Firebase custom-token account linking would add a
  Workers-compatible Firebase Admin step (optional, documented separately).
