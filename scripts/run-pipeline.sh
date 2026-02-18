#!/bin/bash
# scripts/run-pipeline.sh
# Run the lure database scraping pipeline with logging
# launchd-compatible: explicit PATH for NVM Node.js

set -euo pipefail

# === CRITICAL: launchd does not load shell profile, so NVM node is not in PATH ===
export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Default --limit 1 for cron (override with: run-pipeline.sh --limit 0 for all)
LIMIT="${1:---limit}"
LIMIT_VAL="${2:-1}"

# Ensure logs directory exists
mkdir -p logs

# Clean up logs older than 30 days
find "$PROJECT_DIR/logs" -name "pipeline-*.log" -mtime +30 -delete 2>/dev/null || true

LOGFILE="logs/pipeline-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting pipeline..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/pipeline.ts "$LIMIT" "$LIMIT_VAL" 2>&1 | tee -a "$LOGFILE"
EXIT_CODE=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Pipeline finished (exit code: $EXIT_CODE)." | tee -a "$LOGFILE"
exit $EXIT_CODE
