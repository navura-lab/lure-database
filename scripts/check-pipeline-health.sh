#!/bin/bash
# scripts/check-pipeline-health.sh
# Quick health check for the lure-db pipeline
# Usage: ./scripts/check-pipeline-health.sh

set -euo pipefail

export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env for AIRTABLE_PAT
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

echo "========================================"
echo "  Lure DB Pipeline Health Check"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================"
echo ""

# --- 1. launchd status ---
echo "--- launchd Job ---"
LAUNCHD_STATUS=$(launchctl list 2>/dev/null | grep "com.fablus.lure-pipeline" || echo "NOT LOADED")
if echo "$LAUNCHD_STATUS" | grep -q "NOT LOADED"; then
  echo "  Status: NOT LOADED"
  echo "  Fix: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.fablus.lure-pipeline.plist"
else
  PID=$(echo "$LAUNCHD_STATUS" | awk '{print $1}')
  EXIT_CODE=$(echo "$LAUNCHD_STATUS" | awk '{print $2}')
  if [ "$PID" = "-" ]; then
    echo "  Status: Loaded (not running, last exit: $EXIT_CODE)"
  else
    echo "  Status: Running (PID: $PID)"
  fi
fi
echo ""

# --- 2. Latest log ---
echo "--- Latest Pipeline Log ---"
TODAY_LOG="$PROJECT_DIR/logs/pipeline-$(date +%Y%m%d).log"
YESTERDAY_LOG="$PROJECT_DIR/logs/pipeline-$(date -v-1d +%Y%m%d 2>/dev/null || date -d 'yesterday' +%Y%m%d 2>/dev/null).log"

if [ -f "$TODAY_LOG" ]; then
  echo "  Log: $TODAY_LOG"
  echo "  Last 5 lines:"
  tail -5 "$TODAY_LOG" | sed 's/^/    /'
elif [ -f "$YESTERDAY_LOG" ]; then
  echo "  No log for today. Yesterday's log:"
  echo "  Log: $YESTERDAY_LOG"
  tail -5 "$YESTERDAY_LOG" | sed 's/^/    /'
else
  LATEST_LOG=$(ls -t "$PROJECT_DIR/logs/pipeline-"*.log 2>/dev/null | head -1)
  if [ -n "$LATEST_LOG" ]; then
    echo "  Latest log: $LATEST_LOG"
    tail -5 "$LATEST_LOG" | sed 's/^/    /'
  else
    echo "  No pipeline logs found"
  fi
fi
echo ""

# --- 3. launchd stdout/stderr logs ---
echo "--- launchd Output Logs ---"
LAUNCHD_LOG="/Users/user/clawd/logs/lure-pipeline.log"
LAUNCHD_ERR="/Users/user/clawd/logs/lure-pipeline-error.log"

if [ -f "$LAUNCHD_LOG" ]; then
  echo "  stdout (last 3 lines):"
  tail -3 "$LAUNCHD_LOG" | sed 's/^/    /'
else
  echo "  stdout: (no file)"
fi

if [ -f "$LAUNCHD_ERR" ] && [ -s "$LAUNCHD_ERR" ]; then
  echo "  stderr (last 3 lines):"
  tail -3 "$LAUNCHD_ERR" | sed 's/^/    /'
else
  echo "  stderr: (empty or no file)"
fi
echo ""

# --- 4. Airtable pending count ---
echo "--- Airtable Pending Records ---"
if [ -n "${AIRTABLE_PAT:-}" ] && [ -n "${AIRTABLE_BASE_ID:-}" ] && [ -n "${AIRTABLE_LURE_URL_TABLE_ID:-}" ]; then
  FILTER=$(python3 -c "import urllib.parse; print(urllib.parse.quote(\"{ステータス}='未処理'\"))" 2>/dev/null || echo "%7B%E3%82%B9%E3%83%86%E3%83%BC%E3%82%BF%E3%82%B9%7D%3D%27%E6%9C%AA%E5%87%A6%E7%90%86%27")
  RESPONSE=$(curl -s "https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_LURE_URL_TABLE_ID}?filterByFormula=${FILTER}&fields%5B%5D=%E3%83%AB%E3%82%A2%E3%83%BC%E5%90%8D" \
    -H "Authorization: Bearer ${AIRTABLE_PAT}" 2>/dev/null || echo '{"records":[]}')
  COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('records',[])))" 2>/dev/null || echo "?")
  echo "  Pending (未処理): $COUNT record(s)"
else
  echo "  (Airtable credentials not loaded — skipped)"
fi
echo ""

# --- 5. Node.js / tsx availability ---
echo "--- Runtime ---"
echo "  Node: $(node --version 2>/dev/null || echo 'NOT FOUND')"
echo "  tsx:  $(which tsx 2>/dev/null || echo 'NOT FOUND')"
echo ""

# --- 6. Registered scrapers ---
echo "--- Registered Scrapers ---"
SCRAPERS=$(grep -oE "^  [a-z]+:" "$PROJECT_DIR/scripts/scrapers/index.ts" 2>/dev/null | tr -d " :" || true)
if [ -n "$SCRAPERS" ]; then
  for s in $SCRAPERS; do
    echo "  - $s"
  done
else
  echo "  (could not parse registry)"
fi
echo ""

echo "========================================"
echo "  Health check complete"
echo "========================================"
