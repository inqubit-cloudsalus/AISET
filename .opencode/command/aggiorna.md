---
description: Update the project memory (CLAUDE.md §7 "Current state") to reflect this session, then commit and push. Use when the human says "aggiorna" or "aggiorna memoria".
---

Update the project memory, then commit and push.

Do all of the following:

1. Read `CLAUDE.md` section 7 "Current state" (and, if needed, `PROJECT_MANAGEMENT_PLAN.md` §12 and the WP plan files to recall the open items).
2. Update section 7 to reflect what changed this session:
   - Set **Last updated** to today's date.
   - Update **Active WP** state if it moved.
   - Update the **Hours** line if any hours were spent.
   - Add to **Decided this session** any new decision/confirmed fact (append, don't rewrite history), and remove the corresponding item from the **Open** list if it is now resolved.
   - Keep the **Open** list and the **Proposed** list current.
3. Use the existing style: English, bullet format, relative links, one line per fact. Do not edit sections 1-6 unless something there is now factually wrong. Never edit `PROJECT_CHARTER.md`.
4. If the human typed extra context after the command, fold it into the state update.

Then commit and push:

5. `git status --short` and `git diff --stat` to see what changed.
6. Stage only the files changed by this memory update (`CLAUDE.md` plus any doc the session legitimately modified). Never stage secrets or unrelated files.
7. Commit with a concise message matching the repo style (e.g. `Record <decision>, <decision>`), then `git push`.

If there is nothing new to record, say so and do not create an empty commit.
