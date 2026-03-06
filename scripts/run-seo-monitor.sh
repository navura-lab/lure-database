#!/bin/bash
# scripts/run-seo-monitor.sh
# SEO日次監視スクリプトのlaunchdラッパー
# 毎日 7:00 JST (22:00 UTC) に自動実行

set -euo pipefail

# === CRITICAL: launchd does not load shell profile, so NVM node is not in PATH ===
export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# ログディレクトリ確保
mkdir -p logs logs/seo-data

# 30日以上前のログをクリーンアップ
find "$PROJECT_DIR/logs" -name "seo-monitor-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/seo-monitor-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting SEO monitor..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/seo-monitor.ts 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SEO monitor finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"
exit $EXIT_CODE
