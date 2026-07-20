#!/usr/bin/env bash
# Publish (or update) Super AI into the AAA App Store worker and delete old versions.
set -e
cd "$(dirname "$0")/.."
set -a; source .credentials.local; set +a
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

APK="${1:-app/build/outputs/apk/release/app-release.apk}"
VERSION_NAME="${2:-2.2.11}"
VERSION_CODE="${3:-19}"
PKG="com.aaa.ai"
ICON="https://aaa-store.aaateam.workers.dev/api/asset/store/icons/superai.png"
D1="aaa_db"
SIZE=$(stat -c%s "$APK")

# Stable id so the R2 key (store/apks/<id>.apk) matches the DB row's download
# route, which looks up the app by the key basename.
ID="app_superai"
R2_KEY="store/apks/${ID}.apk"

echo "==> Superseding any previous Super AI store entries"
npx -y wrangler d1 execute "$D1" --remote --command \
  "UPDATE store_apps SET status='superseded' WHERE package_name='$PKG' AND status='approved';" || true

echo "==> Uploading APK to R2 ($R2_KEY, ${SIZE} bytes)"
npx -y wrangler r2 object put "aaa-assets/$R2_KEY" --file "$APK" --content-type "application/vnd.android-package-archive" --remote

echo "==> Upserting approved Super AI app row"
npx -y wrangler d1 execute "$D1" --remote --command \
  "INSERT INTO store_apps (id, owner_uid, name, package_name, version, category, short_desc, long_desc, icon_url, apk_url, apk_r2_key, apk_size, min_android, status, downloads, submitted_at, approved_at) VALUES ('$ID','aaa_store_bot','Super AI','$PKG','$VERSION_NAME','Tools','Unlimited free AI chat, image generation, downloaders & creative studio for Android.','The all-in-one free AI super app: chat with top models, generate images, download media, and use dozens of creative tools. Sign in with Telegram.','$ICON',NULL,'$R2_KEY',$SIZE,'7.0', 'approved', 0, $(date +%s)000, $(date +%s)000) ON CONFLICT(id) DO UPDATE SET version='$VERSION_NAME', apk_r2_key='$R2_KEY', apk_size=$SIZE, status='approved', approved_at=$(date +%s)000;"

echo "==> Store now lists Super AI (latest only)."
npx -y wrangler d1 execute "$D1" --remote --command \
  "SELECT id,name,version,status,apk_r2_key FROM store_apps WHERE package_name='$PKG';" 2>&1 | tail -20
