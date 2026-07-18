# AAA-AI Bot Server (Cloudflare Workers, free tier)

Server-side Telegram bot relay. Bot tokens stay here (server-side) — never in the Android app.

## What it does
- **@AAA_Free_Ai_bot** — relays a chat message to the free-AI endpoints and replies.
- **@AAA_Login_bot** — issues a 10-minute link code the app can verify via `/api/verify`.

## Automated setup / deploy

One-time: `wrangler login` (uses YOUR free Cloudflare account), then copy
`.env.example` -> `.env` and fill in tokens/keys.

```bash
cd server
cp .env.example .env      # then edit .env
npm run setup             # check + deploy + migrate + secrets + webhooks
```

Individual automation scripts:

| Command | What it does |
|---------|--------------|
| `npm run deploy`   | Syntax-check then `wrangler deploy` |
| `npm run migrate`  | Apply D1 migrations (`--remote`) |
| `npm run secrets`  | Push all secrets from `.env` (`scripts/setup-secrets.sh`) |
| `npm run webhooks` | Register all 3 Telegram webhooks + command menus (`scripts/set-webhooks.sh`) |
| `npm run release`  | Build signed APK, upload to R2, bump version in KV (`scripts/release-apk.sh`) |
| `npm run tail`     | Live-tail Worker logs |

CI: `.github/workflows/deploy-worker.yml` auto-deploys on push to `main` when
`server/**` changes (needs repo secrets `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`).

## Secrets
Set via `npm run secrets` (from `.env`). See `.env.example` for the full list:
bot tokens, `ADMIN_CHAT_ID`, AI provider keys, Supabase, and `APP_SHARED_SECRET`.

## Notes
- Free tier: Workers + KV (1 GB) is enough. No cron/queues needed (webhooks).
- The Android app calls `https://<your-subdomain>.workers.dev/api/verify?code=XXXX`
  to confirm a Telegram link. Full Firebase custom-token account linking would add a
  Workers-compatible Firebase Admin step (optional, documented separately).
