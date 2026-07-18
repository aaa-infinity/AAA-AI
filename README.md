# AAA-AI

A native **Android (Kotlin + Jetpack Compose)** app built around a **points-based economy**
that drives API routing and a **compliant in-app ad integration**.

> Verified: `./gradlew assembleDebug` builds `app-debug.apk`, all unit tests pass,
> and `./gradlew lintDebug` is clean.

## Features (per spec)
- **Persistent points wallet** via Jetpack **DataStore** (default balance **100**).
  - `addPoints(amount)`, `deductPoints(amount): Boolean` (atomic, insufficient-balance safe).
- **Point economy** — cost is deducted *before* any network call:
  | Tier | Cost | Endpoints |
  |------|------|-----------|
  | Standard AI | -10 | gemini, qwen, gpt3, cohere, bible-ai |
  | Advanced AI | -30 | deepseek-r1, deepseek-v3, gpt-5, copilot, gptlogic, deep-ai, llama-meta |
  | Media Downloaders | -40 | ytdl, ytv, ytau, ytplay, yts, ytvi, tiktok2, facebook, igdl, xdl, applemusic, gitclone |
  | Standard Tools & Search | -10 | npmsearch, pinterest, lyrics, lyrics2, spotifysearch, tiktoksearch, anisearch, animesearch, tiktokstalk, facts, randomquotes |
  | VIP Studio Tools | -50 | ocr, enhance, removebg, tinyurl, ssweb, txt2img, translate |
  | Super VIP Galleries | -100 | waifu, cosplay, nsfw/* |
- **API networking** — `ApiRepository` performs asynchronous GET requests to
  `https://felix-rdx-unlimited-free-apis.vercel.app/api/v1/api/[endpoint]`. Query params
  (`q`, `query`, `text`, `url`) are appended per tool; raw response body (text or image URL)
  is captured for display / image loading.
- **Compliant in-app ad WebView** (`AdWebView`):
  - Loads the Adsterra smart link full-screen.
  - Normal **http(s)** links navigate naturally inside the view.
  - Custom platform intents (`intent://`, `market://`, `play.google.com`, `whatsapp://`, …)
    are routed to the **system** via an implicit Intent (no crash, no trapping).
  - Prominent red **X** button (top corner): dismisses the view, resets to `about:blank`
    to stop scripts, calls `addPoints(200)`, and shows **"+200 Points added!"** toast.
- **UI (Jetpack Compose)**:
  - Sticky header: `Points Balance: X 🪙` (reactive via `StateFlow`).
  - Category tabs: **AI Chat**, **Downloaders**, **Utilities**, **VIP Galleries**.
  - "Earn Tokens" button launches the compliant ad overlay.
  - Insufficient balance → UI shows: *"Insufficient point balance. Please click 'Earn Points' above."*

## Tech stack
Kotlin, Gradle KTS, minSdk 24 / targetSdk 34, Jetpack Compose (Material3), ViewModel +
`collectAsStateWithLifecycle`, DataStore, OkHttp (suspend), Coil.

## Build & verify
```bash
export ANDROID_HOME=/path/to/android-sdk
./gradlew assembleDebug      # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest  # 15 unit tests (ApiCost, EndpointCatalog, PointsManager)
./gradlew lintDebug          # clean
```
Install on a device/emulator:
```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

## File tree
```
AAA-AI/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── gradle/libs.versions.toml
├── local.properties                 # (gitignored) sdk.dir if needed
├── app/
│   ├── build.gradle.kts
│   ├── proguard-rules.pro
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml
│       │   ├── java/com/aaa/ai/
│       │   │   ├── MainActivity.kt
│       │   │   ├── MainViewModel.kt
│       │   │   ├── data/
│       │   │   │   ├── ApiEndpoint.kt
│       │   │   │   ├── ApiCost.kt
│       │   │   │   ├── ApiRepository.kt
│       │   │   │   ├── EndpointCatalog.kt
│       │   │   │   ├── PointsManager.kt
│       │   │   │   └── model/ApiResponse.kt
│       │   │   └── ui/
│       │   │       ├── AaaAiApp.kt          # Compose UI (header, tabs, dashboard, earn, result)
│       │   │       ├── AdWebView.kt         # compliant non-trapping ad browser
│       │   │       └── MainViewModelFactory.kt
│       │   └── res/
│       │       ├── values/{attrs,colors,strings,themes}.xml
│       │       ├── xml/network_security_config.xml
│       │       └── drawable|mipmap (launcher icon)
│       ├── test/      # unit tests (ApiCostTest, EndpointCatalogTest, PointsManagerTest)
│       └── androidTest/ # Compose UI test (MainActivityTest)
└── README.md
```

## Notes
- NSFW endpoints are listed in the cost table for completeness but are **not wired into the
  dashboard UI** (kept out of the shipped gallery by default).
- The ad WebView is a standard in-app browser with a working close button and external-intent
  routing — it does **not** trap navigation or block the system browser.

## Security model
- **Points are server-authoritative.** All earn/spend mutations go through the Cloudflare
  Worker (`/api/points/add`, D1 authoritative). The Android app never writes `points` to
  Firestore — `firestore.rules` deny client `points`/`premium_until` writes; the client may
  only update its own profile fields. Telegram free-bot chat also deducts points server-side.
- **`APP_SHARED_SECRET`** is a Cloudflare Worker secret (rotated) and injected into the app via
  `BuildConfig` from `local.properties` (gitignored). It is never hardcoded in source.
- **Provider keys (Gemini/Groq/HF/…)** live as Worker secrets and are swappable live via the
  admin bot `/setkey <name> <value>`. Quota/429 errors are auto-detected, the dead key is marked
  exhausted (visible in `/credits`), the router falls back to the next healthy provider, and the
  owner is alerted on Telegram.
- **Supabase** is a disabled read-only mirror of D1. If ever enabled, set **Row Level Security**
  policies on the `users` table so the anon key cannot read rows, and never expose
  `SUPABASE_ANON` in the app — only the service-role key (server-side) may write.
- **Ad WebView** is locked down: no file/content access, mixed-content blocked, and only
  `https://` navigation is permitted; external intents are scheme-validated.
- `android:allowBackup="false"` prevents `adb backup` extraction of locally stored user API keys.
