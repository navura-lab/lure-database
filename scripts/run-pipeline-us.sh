#!/bin/bash
# scripts/run-pipeline-us.sh
# US専用パイプライン（毎日1回、全件処理）
# launchd-compatible: explicit PATH for NVM Node.js

set -euo pipefail

export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

mkdir -p logs
find "$PROJECT_DIR/logs" -name "pipeline-us-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/pipeline-us-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting US pipeline..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/pipeline.ts --region us --limit 0 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] US pipeline finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"

# パイプライン成功時のみキャッシュ更新（ビルド時のSupabase egress削減）
if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Updating lures cache..." | tee -a "$LOGFILE"
  "$PROJECT_DIR/node_modules/.bin/tsx" scripts/dump-lures-cache.ts 2>&1 | tee -a "$LOGFILE" || true
fi

exit $EXIT_CODE
