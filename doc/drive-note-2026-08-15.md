# Drive note, evening of 2026-08-15

A deliberate marker. Michael is testing whether picking up a conversation again
actually works: if it does, the next session on this project should already know
what is written below without having to read this file. If it has to read the
file, it did not work.

## Where this drive got to

Michael switched to the voice app and asked what I remembered. The answer was
nothing — the session had come up cold on the advisor app with no earlier
conversation attached. That is the failure in issue #11 happening live, not a
description of it.

He then corrected an assumption worth writing down: he expects the remembering
to work by **resuming the earlier Claude session**, not by the app storing a
transcript of its own. That is exactly what the design does — a pointer per
project, one line saying which conversation belongs to which project folder,
with the words left where Claude Code already keeps them.

## The state of issue #11

The fix is committed on the branch named after the issue, and that branch is
what is checked out and running. It is **not merged into the main line**.

All 147 checks pass. But I put the old code back for a moment and re-ran them,
and only one of the two new guards actually failed on it: the one that keeps an
unreadable store aside instead of writing over it. The check named for the real
symptom — heavy use of one project losing another — passes on the broken code
too, so as of tonight it proves nothing. That half is the timing-dependent one
and is genuinely harder to pin down.

Open question left on the table: strengthen that check first, or merge as-is and
take the improvement now. Michael has not answered it yet.

## One thing I got wrong

I said the running app still had the broken version. It does not — the fix
branch is checked out. Corrected in the same conversation.
