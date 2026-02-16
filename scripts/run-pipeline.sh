#!/bin/bash
# scripts/run-pipeline.sh
# Run the lure database scraping pipeline with logging
# launchd-compatible: uses absolute paths, no PATH dependency

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Default --limit 1 for cron (override with: run-pipeline.sh --limit 0 for all)
LIMIT="${1:---limit}"
LIMIT_VAL="${2:-1}"

# Ensure logs directory exists
mkdir -p logs

LOGFILE="logs/pipeline-$(date +%Y%m%d).log"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting pipeline..." | tee -a "$LOGFILE"
"$PROJECT_DIR/node_modules/.bin/tsx" scripts/pipeline.ts "$LIMIT" "$LIMIT_VAL" 2>&1 | tee -a "$LOGFILE"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Pipeline finished." | tee -a "$LOGFILE"
