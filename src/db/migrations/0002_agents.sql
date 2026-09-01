-- Multi-agent identity for OpenCode runs.
-- An OpenCode run is one root session plus a child session per subagent; every
-- event is attributed to the agent that produced it, and the run remembers the
-- root session id so a re-attach after a restart can find its way back.

ALTER TABLE run_events ADD COLUMN agent TEXT;
ALTER TABLE runs ADD COLUMN opencode_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_run_agent ON run_events(run_id, agent);
