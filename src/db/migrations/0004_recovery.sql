-- Ownership and liveness, so a restarted AISET can tell a run that is still
-- working from one whose process died under it.
-- A run records who is driving it and beats a heartbeat while it pumps; a stale
-- beat with no live owner is what makes a run recoverable. `server_url` is the
-- engine's address, kept so recovery can re-attach to a session rather than
-- guess at an outcome.

ALTER TABLE runs ADD COLUMN owner_pid INTEGER;
ALTER TABLE runs ADD COLUMN owner_host TEXT;
ALTER TABLE runs ADD COLUMN owner_nonce TEXT;
ALTER TABLE runs ADD COLUMN heartbeat_at TEXT;
ALTER TABLE runs ADD COLUMN server_url TEXT;

-- The assistant message a usage row came from. Recovery reads it back to know
-- what it has already counted, so a session that replays its history on
-- reconnect cannot double the run's reported spend.
ALTER TABLE run_usage ADD COLUMN message_id TEXT;
