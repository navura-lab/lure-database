#!/bin/bash
set -euo pipefail
export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

mkdir -p logs logs/seo-data

# ログローテーション（30日）
find "$PROJECT_DIR/logs" -name "cwv-monitor-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/cwv-monitor-$(date +%Y%m%d).log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting CWV Monitor..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/cwv-monitor.ts 2>&1 | tee -a "$LOGFILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done." | tee -a "$LOGFILE"
