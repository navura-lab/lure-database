#!/bin/bash
# scripts/run-quality-score.sh
# 品質スコアリング日次実行（毎日 03:00 JST = 18:00 UTC前日）
# launchd-compatible: explicit PATH for NVM Node.js

set -euo pipefail

export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

mkdir -p logs/quality
find "$PROJECT_DIR/logs/quality" -name "quality-*.md" -mtime +60 -delete 2>/dev/null || true

LOGFILE="logs/quality/quality-run-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting quality scoring..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/quality-score.ts 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Quality scoring finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"

exit $EXIT_CODE
