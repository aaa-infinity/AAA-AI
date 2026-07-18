#!/usr/bin/env bash
# Deploy AAA-AI backend config that requires project OWNER (not the Admin SDK SA).
# Run locally after: `npx -y firebase-tools@latest login`
#
# What this does:
#   1. Enables Email/Password + Google sign-in providers.
#   2. Deploys firestore.rules (owner-scoped security rules).
#   3. (App is already registered; google-services.json already present.)
#
# The Firebase Admin SDK service account used by CI cannot enable services or
# patch OAuth clients, so these steps require an owner-authenticated login.
set -euo pipefail

PROJECT="${1:-aaa-infinity-ai}"

echo "Using Firebase project: $PROJECT"
npx -y firebase-tools@latest use "$PROJECT"

echo "==> Enabling auth providers (email/password + Google)…"
npx -y firebase-tools@latest deploy --only auth

echo "==> Deploying Firestore security rules…"
npx -y firebase-tools@latest deploy --only firestore:rules

echo "Done. Google sign-in + Firestore rules are now live."
