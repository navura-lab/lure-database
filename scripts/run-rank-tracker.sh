#!/bin/bash
# scripts/run-rank-tracker.sh
# SEOランクトラッカーのlaunchdラッパー
# 毎日 7:30 JST (22:30 UTC) に自動実行

set -euo pipefail

# === CRITICAL: launchd does not load shell profile, so NVM node is not in PATH ===
export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# ログディレクトリ確保
mkdir -p logs logs/seo-data/rankings

# 30日以上前のログをクリーンアップ
find "$PROJECT_DIR/logs" -name "rank-tracker-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/rank-tracker-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting rank tracker..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/seo-rank-tracker.ts 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Rank tracker finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"
exit $EXIT_CODE
