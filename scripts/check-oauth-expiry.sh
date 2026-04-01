#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
source .env 2>/dev/null || true

# refresh_tokenの最終更新日を.envのタイムスタンプから推定
ENV_MTIME=$(stat -f %m .env 2>/dev/null || stat -c %Y .env 2>/dev/null)
NOW=$(date +%s)
DAYS_AGO=$(( (NOW - ENV_MTIME) / 86400 ))

echo "[$(date)] OAuth token age: ${DAYS_AGO} days"

if [ "$DAYS_AGO" -ge 6 ]; then
  echo "⚠️ OAuth token expires soon (${DAYS_AGO} days old, limit: 7)"
  # Discord通知
  bash ops/scripts/notify-discord.sh "oauth-expiry" "failed" "⚠️ Google OAuth tokenが${DAYS_AGO}日経過。あと$((7-DAYS_AGO))日で期限切れ。手動で再認証が必要: npx tsx scripts/refresh-google-token.ts" || true
elif [ "$DAYS_AGO" -ge 5 ]; then
  echo "ℹ️ OAuth token: ${DAYS_AGO} days (approaching limit)"
fi
