#!/bin/bash
# scripts/run-discover-us.sh
# US専用新商品検知（毎日、fetch-onlyで30秒完了）
# launchd-compatible: explicit PATH for NVM Node.js

set -euo pipefail

export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

mkdir -p logs
find "$PROJECT_DIR/logs" -name "discover-us-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/discover-us-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting US product discovery..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/discover-products.ts --region us 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] US discovery finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"
exit $EXIT_CODE
