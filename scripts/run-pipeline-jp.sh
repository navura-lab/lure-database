#!/bin/bash
# scripts/run-pipeline-jp.sh
# JP専用パイプライン（毎時1件、夜間8回）
# launchd-compatible: explicit PATH for NVM Node.js

set -euo pipefail

export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

mkdir -p logs
find "$PROJECT_DIR/logs" -name "pipeline-jp-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/pipeline-jp-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting JP pipeline..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/pipeline.ts --region jp --limit 1 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] JP pipeline finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"

# パイプライン成功時のみキャッシュ更新（ビルド時のSupabase egress削減）
if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Updating lures cache..." | tee -a "$LOGFILE"
  "$PROJECT_DIR/node_modules/.bin/tsx" scripts/dump-lures-cache.ts 2>&1 | tee -a "$LOGFILE" || true

  # ランキング説明文の不足チェック（新カテゴリ発生時にログ記録）
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Checking ranking description gaps..." | tee -a "$LOGFILE"
  "$PROJECT_DIR/node_modules/.bin/tsx" scripts/generate-ranking-descriptions.ts 2>&1 | tee -a "$LOGFILE" || true
fi

exit $EXIT_CODE
