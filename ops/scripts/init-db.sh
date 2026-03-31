#!/bin/bash
DB_PATH="$(dirname "$0")/../db/agents.db"
mkdir -p "$(dirname "$DB_PATH")"

sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  finished_at TEXT,
  status TEXT CHECK(status IN ('running','success','failed','skipped')),
  summary TEXT,
  error_message TEXT,
  duration_seconds INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dialogue_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  speaker TEXT CHECK(speaker IN ('trainer','agent')),
  agent_name TEXT,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_name);
CREATE INDEX IF NOT EXISTS idx_runs_started ON agent_runs(started_at);
SQL

echo "DB initialized: $DB_PATH"
