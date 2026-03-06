#!/bin/bash
# scripts/run-weekly-report.sh
# SEO週次PDCAレポート生成スクリプトのlaunchdラッパー
# 毎週月曜 9:00 JST (0:00 UTC Mon) に自動実行

set -euo pipefail

# === CRITICAL: launchd does not load shell profile, so NVM node is not in PATH ===
export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# ログディレクトリ確保
mkdir -p logs logs/seo-data logs/seo-reports

LOGFILE="logs/weekly-report-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting weekly SEO report..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/weekly-seo-report.ts 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Weekly SEO report finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"
exit $EXIT_CODE
