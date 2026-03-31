#!/bin/bash
WEBHOOK_URL="${CASTLOG_DISCORD_WEBHOOK}"
AGENT_NAME="$1"
STATUS="$2"
MESSAGE="$3"

if [ -z "$WEBHOOK_URL" ]; then
  echo "No Discord webhook configured, skipping notification"
  exit 0
fi

if [ "$STATUS" = "success" ]; then
  COLOR="3066993"; EMOJI="✅"
elif [ "$STATUS" = "failed" ]; then
  COLOR="15158332"; EMOJI="❌"
else
  COLOR="10070709"; EMOJI="ℹ️"
fi

# メッセージを2000文字に制限（Discord制限）
SAFE_MSG=$(echo "$MESSAGE" | head -c 1900)

PAYLOAD=$(cat <<EOF
{
  "embeds": [{
    "title": "${EMOJI} ${AGENT_NAME}",
    "description": "${SAFE_MSG}",
    "color": ${COLOR},
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "footer": {"text": "CASTLOG AutoOps"}
  }]
}
EOF
)

curl -s -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK_URL" > /dev/null
