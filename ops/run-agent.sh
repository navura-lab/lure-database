#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="$SCRIPT_DIR/db/agents.db"
NOTIFY="$SCRIPT_DIR/scripts/notify-discord.sh"
LOCK_DIR="$SCRIPT_DIR/locks"

export PATH="/Users/user/.nvm/versions/node/v22.22.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME="/Users/user"

AGENT_NAME="$1"
AGENT_FILE="$PROJECT_ROOT/.claude/agents/${AGENT_NAME}.md"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR" "$LOCK_DIR"
LOG_FILE="$LOG_DIR/${AGENT_NAME}-$(date +%Y-%m-%d-%H%M%S).log"

if [ ! -f "$AGENT_FILE" ]; then
  echo "Agent not found: $AGENT_FILE"
  exit 1
fi

# ─── 排他制御: git操作のコンフリクト防止 ───
# 同一エージェントの多重実行を防止
AGENT_LOCK="$LOCK_DIR/${AGENT_NAME}.lock"
if [ -f "$AGENT_LOCK" ]; then
  LOCK_PID=$(cat "$AGENT_LOCK" 2>/dev/null || echo "")
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "[$(date)] SKIPPED: ${AGENT_NAME} is already running (PID: ${LOCK_PID})" | tee "$LOG_FILE"
    # DB記録（skipped）
    if [ -f "$DB_PATH" ]; then
      sqlite3 "$DB_PATH" "INSERT INTO agent_runs (agent_name, status, summary) VALUES ('${AGENT_NAME}', 'skipped', 'Already running PID ${LOCK_PID}');"
    fi
    exit 0
  fi
fi
echo $$ > "$AGENT_LOCK"
trap "rm -f '$AGENT_LOCK'" EXIT

# git操作の排他ロック（全エージェント共通）
GIT_LOCK="$LOCK_DIR/git-push.lock"

# DB初期化（未作成の場合）
if [ ! -f "$DB_PATH" ]; then
  bash "$SCRIPT_DIR/scripts/init-db.sh"
fi

# 実行記録開始
RUN_ID=$(sqlite3 "$DB_PATH" "INSERT INTO agent_runs (agent_name, status) VALUES ('${AGENT_NAME}', 'running'); SELECT last_insert_rowid();")
START_TIME=$(date +%s)

echo "[$(date)] Starting agent: ${AGENT_NAME} (run_id: ${RUN_ID})" | tee "$LOG_FILE"

# ─── Claude Code ヘッドレス実行 ───
cd "$PROJECT_ROOT"

# git pull（最新状態に同期、コンフリクト回避）
git pull --rebase origin main 2>/dev/null || true

OUTPUT=$(cat "$AGENT_FILE" | claude -p --output-format text --allowedTools "Edit,Write,Bash" 2>&1) || true

echo "$OUTPUT" >> "$LOG_FILE"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# 結果判定（JSONステータスを優先、なければヒューリスティック）
if echo "$OUTPUT" | grep -q '"status".*"success"'; then
  STATUS="success"
elif echo "$OUTPUT" | grep -qi '"status".*"failed"'; then
  STATUS="failed"
elif echo "$OUTPUT" | grep -qi 'fatal\|build failed\|error:'; then
  STATUS="failed"
else
  STATUS="success"
fi

# summaryを抽出（最後の500文字）
SUMMARY=$(echo "$OUTPUT" | tail -c 500 | sed "s/'/''/g")

# DB更新
sqlite3 "$DB_PATH" "UPDATE agent_runs SET finished_at = datetime('now','localtime'), status = '${STATUS}', summary = '${SUMMARY}', duration_seconds = ${DURATION} WHERE id = ${RUN_ID};"

# Discord通知
bash "$NOTIFY" "$AGENT_NAME" "$STATUS" "実行時間: ${DURATION}秒 | $(echo "$OUTPUT" | tail -c 200 | sed "s/'/''/g")" || true

# 古いログの自動クリーンアップ（7日以上前）
find "$LOG_DIR" -name "${AGENT_NAME}-*.log" -mtime +7 -delete 2>/dev/null || true

echo "[$(date)] Finished: ${AGENT_NAME} (${STATUS}, ${DURATION}s)" | tee -a "$LOG_FILE"
