#!/bin/bash
# scripts/run-rewrite-detector.sh
# SEO Rewrite Detector v2 のlaunchdラッパー
# 毎日 7:45 JST (22:45 UTC) に自動実行
# rank-tracker (7:30) の後、daily-indexing (8:00) の前

set -euo pipefail

# === CRITICAL: launchd does not load shell profile, so NVM node is not in PATH ===
export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# ログディレクトリ確保
mkdir -p logs logs/seo-data

# 30日以上前のログをクリーンアップ
find "$PROJECT_DIR/logs" -name "rewrite-detector-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/rewrite-detector-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting rewrite detector v2..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/seo-rewrite-detector.ts 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Rewrite detector finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"
exit $EXIT_CODE
