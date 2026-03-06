#!/bin/bash
# scripts/run-daily-indexing.sh
# Indexing API自動送信スクリプトのlaunchdラッパー
# 毎日 8:00 JST (23:00 UTC) に自動実行
# 200件/日ずつ全ページのインデックス登録を送信

set -euo pipefail

# === CRITICAL: launchd does not load shell profile, so NVM node is not in PATH ===
export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# ログディレクトリ確保
mkdir -p logs logs/seo-data

# 30日以上前のログをクリーンアップ
find "$PROJECT_DIR/logs" -name "daily-indexing-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/daily-indexing-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting daily indexing..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/daily-indexing.ts 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Daily indexing finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"
exit $EXIT_CODE
