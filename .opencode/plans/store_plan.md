# Plan: Fix Telegram login FIRST, then build the 2-Worker App Store (clean, from scratch)

## Priority order (user instruction: fix the app/telegram login problem FIRST,
## "create from start, don't change things randomly" — so the login fix is the
## foundation, and the store is built cleanly on top of a working login.)

---

# PART A — FIX TELEGRAM LOGIN (do this first, it's currently broken)

## Diagnosis (from reading the code)
The login flow is: app generates 8-char token → opens
`t.me/AAA_Login_bot?start=verify_<token>` → login bot's `/start verify_...`
handler stores `verify:<TOKEN>` in KV → app polls `GET /api/verify?code=...`
→ returns `{chatId, profile}`.

**Root cause of "telegram login has problem": webhooks are NEVER registered
on deploy.** Evidence:
- `setupWebhooks(origin)` exists and is correct (uses `url.origin` at call site
  line 2017).
- BUT nothing calls it automatically: `.github/workflows/deploy-worker.yml`
  deploys then only runs D1 migrations — it does NOT call `setupWebhooks`.
- No `scheduled`/startup hook registers webhooks either.
- So after any `wrangler deploy`, the login bot has NO webhook → Telegram
  never delivers `/start` → `verify:<TOKEN>` is never written → app polls
  forever / gets "invalid or expired code". Login is dead until someone manually
  hits `POST /api/setup-webhooks` with the app secret.

## Also broken on the APP side (matches "I hit Start, send /start in the bot,
## come back to the app, but it doesn't log in"):
- `AuthViewModel.startTelegramLogin()` sets `Polling` and starts
  `TelegramVerifyPoller.poll()` **immediately**, then launches the Telegram
  deep link. Opening Telegram **backgrounds/kills** the app process. The poll
  runs in `viewModelScope` (tied to the app process) → it is **cancelled
  when you leave**, and when you return the Composable re-composes at `Idle`
  with a dead poll. Even if the bot processed `/start` correctly, nothing
  picks up the `verify:<TOKEN>` result. So: webhook fixes login delivery,
  but the app ALSO needs to **resume polling on return**.
- `MAX_DURATION_MS = 5*60*1000` (5 min) is also too short if the user
  is slow to send `/start`.

## Fixes
 0. **App-side: persist the token + resume polling on return** (the actual
    "doesn't log in" fix):
    - In `AuthViewModel`, store the active login `token` in a persisted
      field (e.g. `DataStore`/`SharedPreferences`) when `startTelegramLogin()`
      is called; clear it on success/failure/timeout.
    - On app foreground (`MainActivity.onNewIntent` / `onResume` +
      `LaunchedEffect` keyed on the persisted token), if state is `Idle`/`Opening`
      but a persisted token exists and is <10 min old, **re-start**
      `TelegramVerifyPoller.poll()` automatically. This way, coming back from
      Telegram resumes verification instead of sitting dead.
    - Move the poll off `viewModelScope` into a scope that survives
      backgrounding (or just rely on resume-by-`onNewIntent`; simplest and
      robust). Raise `MAX_DURATION_MS` to ~10 min.
    - Keep the "Verifying… return to app" UI, but also show a "Tap to refresh"
      affordance if state is `Idle` with a live persisted token.
 1. **Register webhooks on every deploy (and on cold start).** Two changes:
   - In `deploy-worker.yml`, after `wrangler deploy`, add a step that calls
     `setupWebhooks` via a one-off `wrangler deploy` post-step or a small
     `wrangler action`/`curl` to `POST /api/setup-webhooks` (authed with
     `APP_SHARED_SECRET`). Simplest: a Node one-liner in CI that fetches the
     worker URL with the secret header. Also add it to `scripts/release-apk.sh`
     and a new `scripts/setup-webhooks.sh` for local use.
   - (Optional hardening) register webhooks lazily on first request: in `fetch()`,
     if a KV flag `webhooks_ok` is missing/stale (>24h), call
     `setupWebhooks(url.origin)` once and set the flag. Guarantees login works
     even if a deploy forgets the explicit step.
2. **Verify the token contract matches** (already consistent, just confirm in fix):
   - App `TelegramDeepLinkAuth` → 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`,
     opens `verify_<UPPER>`.
   - Server `/start verify_` → `.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8)`,
     requires `length>=6`, stores `verify:<token>`.
   - `/api/verify` → uppercases input, looks up `verify:<token>` then `login:<token>`,
     consumes the one-time `verify:` key. ✅ consistent (no code change needed, but
     add a unit-style log check during testing).
3. **Harden the login bot handler** so a failed/expired deep-link gives a clear,
   recoverable message (currently a bare `verify_` with <6 chars just falls through
   to the manual `/start` code path, which is fine, but add an explicit hint:
   "Link expired — tap Login again in the app to get a fresh code").
 4. **Make webhook registration idempotent + observable**: `setupWebhooks` already
    uses `setWebhook` (idempotent) + `setMyCommands`. After fix, hitting it
    returns per-bot `ok`/`err`. Surface that in `/api/setup-webhooks` response
    (already does via `result`).

## On the "login bot client id / client secret" you pointed at
- The **Telegram login bot** authenticates with `LOGIN_BOT_TOKEN` (a bot *token*,
  not an OAuth client id/secret) — already wired (`handleLogin`, webhook
  `/telegram/login`). Nothing missing there.
- The **Google client id** (`default_web_client_id`) IS present — auto-generated
  by the `google-services` plugin from `app/google-services.json` (which exists).
  Google Sign-In compiles & the id resolves.
- The **Google client secret** (`GOOGLE_CLIENT_SECRET`) is a SERVER-ONLY secret,
  read at `server/src/index.js` (lines ~1661/1677/2093) from `env.GOOGLE_CLIENT_SECRET`
  for YouTube OAuth. It is correctly NOT in the app. No code change needed;
  just ensure the secret is set in the Worker (it is referenced; confirm in deploy).
- **Separate bug found (breaks Email/Google login, not Telegram):** `FirebaseApplication`
  `onCreate()` initializes Crashlytics/AdMob/RemoteConfig but **never calls
  `Firebase.initializeApp(this)`**. Firebase Auth (email + Google) needs explicit
  init; without it auth calls can fail/no-op. ADD `Firebase.initializeApp(this)`
  (wrap in runCatching) as the first line of `onCreate()`.


## PART A verification (must pass before PART B)
- `curl -X POST <worker>/api/setup-webhooks -H "x-app-secret: $APP_SHARED_SECRET"`
  returns `{"ok":true,"result":["ok","ok","ok"]}` (free, login, admin bots).
- In the app: tap Link Telegram → Telegram opens bot → `/start verify_XXXX` auto-
  sends → within ~10s the app's poll of `/api/verify` returns `{ok:true,chatId}`
  and the profile syncs. NO manual intervention required.
- Redeploy the worker and confirm login STILL works without re-running anything.

## PART A2 — NATIVE TELEGRAM LOGIN (primary method, using creds you gave)
You supplied the **@AAA_Login_bot** credentials + a Telegram **Login Widget**
domain/secret. This is the robust, embeddable login (no /start dance, no poll
death). The server already has `verifyTelegramWidget()` (signs HMAC with
`LOGIN_BOT_TOKEN`) + `POST /api/telegram-widget-verify`. We just wire the
creds as secrets + add a widget-login page.

### Creds (set as WORKER SECRETS — never committed; rotate after this session)
- `LOGIN_BOT_TOKEN` = the bot token you gave (this IS the widget HMAC key).
- `LOGIN_BOT_ID`  = `8821017836` (bot id for the widget `bot_id` field).
- `LOGIN_DOMAIN`  = `app2629244753-login.tg.dev` (BotFather → Login widget
  domain; must match exactly or Telegram rejects the widget).
- (The `8C:12:6C:…` colon string is the same key BotFather shows — derived
  from the bot token; no separate secret needed once `LOGIN_BOT_TOKEN` is set.)

### Changes
1. **Secrets**: add `LOGIN_BOT_ID` + `LOGIN_DOMAIN` as Worker secrets (the
   token is already the existing `LOGIN_BOT_TOKEN` secret — set it to the new
   value). Update `scripts/setup-secrets.sh` to include `LOGIN_BOT_ID`,
   `LOGIN_DOMAIN`. (Do NOT put any of these in source or git.)
2. **Server**: in `verifyTelegramWidget()`, also accept the widget `id` field and
   optionally assert `bot_id`/`domain` if you want strictness. Confirm it signs
   with `ENV.LOGIN_BOT_TOKEN` (already does). Add a `GET /store/login` (and
   `/login`) HTML page that embeds the official Telegram widget:
   ```
   https://telegram.org/js/telegram-widget.js?22
   <script async src="https://telegram.org/js/telegram-widget.js?22"
     data-telegram-login="AAA_Login_bot"
     data-size="large" data-userpic="false"
     data-auth-url="<worker>/api/telegram-widget-verify"
     data-request-access="write"></script>
   ```
   On success the widget POSTs fields → `/api/telegram-widget-verify` → returns
   `{ok:true}`; the page then calls back into the app (deep link / postMessage)
   with the verified `id`/`username`, and the app stores the session.
3. **App**: add a `LoginWebScreen` (or reuse `/store/login`) — a `WebView` (or
   Chrome Custom Tab) loading `<worker>/login`, listening for the verified result,
   then calling the existing session-create path. Replaces/backs the deep-link flow.
4. **BotFather**: you must add `app2629244753-login.tg.dev` as the Login
   widget domain for @AAA_Login_bot (one-time manual step — can't be done via API).
5. **Keep** the deep-link `/start verify_` flow as a fallback (PART A fixes 0-4
   still apply), but native widget becomes the default button.

### Security
- All three values are live secrets → Worker secrets only, `.gitignore`d, rotate
  after this session. The `8C:12:…` HMAC and the token are equivalent; treat
  the token as the source of truth.

---

# PART B — Build the App Store (clean, on top of fixed login)

(Detailed store design from earlier planning, now built AFTER login works and
 sharing the SAME login/bot infra.)

## Architecture: 2 Cloudflare Workers, SHARED D1/R2/KV
- **Worker 1 — `aaa-ai-bot`** (existing): Telegram bots, AI backend, points/
  referrals/promo/yt, cron, AND store **approval** (`/review`, `/apps`).
- **Worker 2 — `aaa-store`** (NEW): public storefront + downloads +
  store API + Ari AI `/download` + `/app.apk`.
- BOTH bind the SAME `AAA_DB` (D1), `aaa_assets` (R2), `AAA_KV` (KV).
  No new Cloudflare resources, no cross-worker sync needed.

## Code org (build from start, no scattershot edits)
- `server/src/shared.js` (NEW): D1 helpers, R2 helpers, `askAi`/`adminAi`,
  `htmlEscape`, session helpers, store page builders, AI listing/moderation
  helpers, store approval command handlers — imported by BOTH workers.
- `server/src/index.js` (Worker 1): keep bot/AI routes; import shared store-
  approval commands so `/review` + `/apps` keep working.
- `server/src/store.js` (NEW, Worker 2 entry): storefront + download + store API.
- `server/wrangler-store.toml` (NEW): `name="aaa-store"`, same bindings.
- `server/migrations/store.sql` (NEW): `store_users`, `store_apps` tables.
- `scripts/deploy-store.sh` (NEW).

## Store features (all previously agreed)
1. **Open uploads + accounts**: anyone Telegram-logs-in (reuses PART A's now-
   working login via `/api/store/login`), uploads an app — host APK on R2 OR
   paste external link. Goes to admin-approval queue.
2. **Single current version / delete old on release**: uploading same `package_name`
   supersedes old row + **deletes its R2 blob** at approve time. Ari AI's
   `app/aaa-ai.apk` also explicitly `delete`d before each new `put`.
3. **AI automation** (reuses `askAi`/`adminAi`):
   - `aiGenerateListing` — enriches/cleans listing copy (fail-soft to user text).
   - `aiModerate` — pre-checks `{flag: ok|review|spam}`; spam auto-rejected,
     review flagged to front of admin `/review`. Human admin always decides.
4. **Safety**: text escaped, APK type/size guards (100MB Worker limit), external
   links http(s)-only, per-user upload rate-limit, approval gate.

## Build/deploy steps (end-to-end)
1. PART A: add webhook registration to `deploy-worker.yml` + startup lazy
   register; verify login end-to-end (see PART A verification).
2. PART B: write `shared.js`, `store.js`, `store.sql`; `node --check` both entries.
3. Apply D1 migration once: `wrangler d1 execute aaa_db --remote --file=server/migrations/store.sql`.
4. Deploy W1: `wrangler deploy --config server/wrangler.toml`.
5. Deploy W2: `wrangler deploy --config server/wrangler-store.toml`.
6. Verify store on W2 subdomain: login, upload (external link, minimal text) →
   AI enriches listing → approve via W1 bot `/review` (moderation flag shown) →
   appears on W2 `/store` + downloads. Test spammy submit → auto-reject.
7. Verify single-version: v2 same package → approve → v1 R2 blob deleted.
8. Regression: Ari AI `/download`+`/app.apk` now on W2; login still works on
   both; old `app/aaa-ai.apk` blob deleted on next release.

## Out of scope (later)
- In-app store browsing, paid apps, auto virus-scan, owner edit/delete.

---

## STATUS (updated 2026-07-18)
- PART A (login) — COMPLETE. Webhook self-heal in `handle()` + CI registers
  webhooks post-deploy. Native Telegram Login Widget added (`/login`,
  `/store/login`), in-app WebView bridge (`TelegramLoginWebView.kt`), poll-resume
  on `MainActivity.onResume()`.
- PART B (store) — COMPLETE & VERIFIED LIVE.
  - Files: `server/src/storeShared.js`, `server/src/store-worker.js`,
    `server/wrangler-store.toml`, `server/migrations/0003_store.sql`.
  - Both workers deployed (CI does W1 + W2 + D1 migration + webhook reg).
  - Admin review wired: bot `/review` lists pending with ✅/❌ inline buttons
    (Worker 1 `handleAdmin` + `approveApp`/`rejectApp`); store API also has
    `/api/store/apps/<id>/approve|reject` (admin session). Status vocab unified
    to `pending` → `approved` → `superseded`/`rejected`.
  - End-to-end tested: homepage/list/detail render; Telegram widget login creates
    a real session token; upload→pending→approve→appears publicly; R2 APK
    streaming download with correct content-type + disposition; supersede deletes
    old R2 blob. All verified against live `aaa-store.aaateam.workers.dev`.
  - Secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set as repo Actions
    secrets (via PAT from `.credentials.local`) so CI can deploy.
- NOTE: D1 migration tracker marked `0003` applied but `store_apps` didn't
  persist first run; re-running the SQL file directly created it. Live DB now
  has both `store_users` and `store_apps`. Test rows cleaned up.
