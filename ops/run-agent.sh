#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="$SCRIPT_DIR/db/agents.db"
NOTIFY="$SCRIPT_DIR/scripts/notify-discord.sh"

export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

AGENT_NAME="$1"
AGENT_FILE="$PROJECT_ROOT/.claude/agents/${AGENT_NAME}.md"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${AGENT_NAME}-$(date +%Y-%m-%d-%H%M%S).log"

if [ ! -f "$AGENT_FILE" ]; then
  echo "Agent not found: $AGENT_FILE"
  exit 1
fi

# DB初期化（未作成の場合）
if [ ! -f "$DB_PATH" ]; then
  bash "$SCRIPT_DIR/scripts/init-db.sh"
fi

# 実行記録開始
RUN_ID=$(sqlite3 "$DB_PATH" "INSERT INTO agent_runs (agent_name, status) VALUES ('${AGENT_NAME}', 'running'); SELECT last_insert_rowid();")
START_TIME=$(date +%s)

echo "[$(date)] Starting agent: ${AGENT_NAME} (run_id: ${RUN_ID})" | tee "$LOG_FILE"

# Claude Code ヘッドレス実行
cd "$PROJECT_ROOT"
OUTPUT=$(cat "$AGENT_FILE" | claude -p --output-format text 2>&1) || true

echo "$OUTPUT" >> "$LOG_FILE"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# 結果判定
if echo "$OUTPUT" | grep -qi 'error\|failed\|fatal'; then
  STATUS="failed"
else
  STATUS="success"
fi

# summaryを抽出（最後の500文字）
SUMMARY=$(echo "$OUTPUT" | tail -c 500 | tr "'" "''")

# DB更新
sqlite3 "$DB_PATH" "UPDATE agent_runs SET finished_at = datetime('now','localtime'), status = '${STATUS}', summary = '${SUMMARY}', duration_seconds = ${DURATION} WHERE id = ${RUN_ID};"

# Discord通知
bash "$NOTIFY" "$AGENT_NAME" "$STATUS" "実行時間: ${DURATION}秒 | $(echo "$OUTPUT" | tail -c 200)" || true

echo "[$(date)] Finished: ${AGENT_NAME} (${STATUS}, ${DURATION}s)" | tee -a "$LOG_FILE"
