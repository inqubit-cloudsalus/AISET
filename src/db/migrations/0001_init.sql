CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE runs (
  id            TEXT PRIMARY KEY,          -- ULID, displayed as r_<ulid>
  task_id       TEXT,                      -- e.g. T-001
  task_title    TEXT NOT NULL,
  engine        TEXT NOT NULL,             -- 'opencode' | 'mock'
  model         TEXT,
  status        TEXT NOT NULL,             -- pending|running|succeeded|failed|timeout|killed
  verdict       TEXT,                      -- GREEN|AMBER|RED
  started_at    TEXT NOT NULL,             -- ISO-8601 UTC
  ended_at      TEXT,
  exit_code     INTEGER,
  workdir       TEXT,
  parent_run_id TEXT REFERENCES runs(id),  -- recovery re-runs link to the original
  schema_version TEXT NOT NULL DEFAULT '1',
  meta          TEXT                       -- JSON
);

CREATE TABLE run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  ts      TEXT NOT NULL,
  type    TEXT NOT NULL,   -- start|stdout|stderr|tool|artifact|timeout|recover|end
  level   TEXT NOT NULL DEFAULT 'info',
  message TEXT,
  data    TEXT,            -- JSON
  UNIQUE (run_id, seq)
);

CREATE TABLE run_artifacts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,  -- spec|patch|test-report|review-package|log
  path     TEXT NOT NULL,
  sha256   TEXT,
  bytes    INTEGER,
  schema_version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE run_usage (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  provider TEXT, model TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  cost_usd REAL, recorded_at TEXT NOT NULL
);

CREATE INDEX idx_runs_started    ON runs(started_at DESC);
CREATE INDEX idx_runs_status     ON runs(status);
CREATE INDEX idx_events_run_seq  ON run_events(run_id, seq);
