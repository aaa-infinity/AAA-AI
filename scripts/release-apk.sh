#!/usr/bin/env bash
# One-command release: build the signed APK, publish it to Cloudflare R2, and
# announce the new version so existing installs auto-update.
#
# Steps:
#   1. Build a signed release APK (:app:assembleRelease).
#   2. Upload it to R2 bucket aaa-assets at key app/aaa-ai.apk (overwrites old).
#   3. Push app_version_code / app_version_name / app_changelog into KV so the
#      Worker's /api/app-version and /download reflect the new build instantly.
#
# Usage:
#   CHANGELOG="What's new..." bash scripts/release-apk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-/home/codespace/java/21.0.10-ms}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"

APK_KEY="app/aaa-ai.apk"
BUCKET="aaa-assets"
CHANGELOG="${CHANGELOG:-Bug fixes and improvements.}"

# --- read versionCode / versionName from build.gradle.kts ---
VERSION_CODE="$(grep -oE 'versionCode *= *[0-9]+' app/build.gradle.kts | grep -oE '[0-9]+' | head -1)"
VERSION_NAME="$(grep -oE 'versionName *= *"[^"]+"' app/build.gradle.kts | sed -E 's/.*"([^"]+)".*/\1/' | head -1)"
echo "==> Releasing versionCode=$VERSION_CODE versionName=$VERSION_NAME"

# --- 1. build signed release APK ---
echo "==> Building signed release APK…"
./gradlew :app:assembleRelease

APK_PATH="$(ls -1 app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)"
if [ -z "$APK_PATH" ] || [ ! -f "$APK_PATH" ]; then
  echo "!! Release APK not found. Check signing config in local.properties." >&2
  exit 1
fi
SIZE_MB="$(du -m "$APK_PATH" | cut -f1)"
echo "   Built: $APK_PATH (${SIZE_MB} MB)"

# --- 2. upload to R2 (overwrites old build) ---
echo "==> Uploading to R2 $BUCKET/$APK_KEY…"
cd server
npx -y wrangler r2 object put "$BUCKET/$APK_KEY" \
  --file="$ROOT/$APK_PATH" \
  --content-type="application/vnd.android.package-archive"

# --- 3. announce new version via KV ---
echo "==> Announcing version in KV…"
npx -y wrangler kv key put --binding=AAA_KV --remote app_version_code "$VERSION_CODE"
npx -y wrangler kv key put --binding=AAA_KV --remote app_version_name "$VERSION_NAME"
npx -y wrangler kv key put --binding=AAA_KV --remote app_changelog "$CHANGELOG"

echo "Release complete."
echo "Download page: https://aaa-ai-bot.aaateam.workers.dev/download"
echo "Existing installs will be prompted to update to $VERSION_NAME (code $VERSION_CODE)."
