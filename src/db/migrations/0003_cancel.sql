-- Cross-process cancellation for OpenCode runs.
-- Only the process that started a run can talk to its OpenCode server, so a
-- cancel issued from anywhere else records intent here and the owning pump
-- picks it up and aborts the session. A stamp rather than a flag, so the
-- timeline can show when the stop was asked for.

ALTER TABLE runs ADD COLUMN cancel_requested_at TEXT;
