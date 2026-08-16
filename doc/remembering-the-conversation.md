# Remembering the conversation, per project, across restarts

Issue #10.

## The problem it solves

The conversation with Claude used to be a single variable inside the running app. Two
consequences, both bad, both invisible until you are moving:

**Restarting wiped it.** This app restarts itself whenever its own code changes, which
during any real working drive is several times an hour. Every restart, the next
question was answered by someone who had just walked into the room — no idea what we
had tried, decided, or were part-way through. The only anchor left was whatever the
issue text happened to say, which is better than nothing and nowhere near enough.

**Switching projects threw it away on purpose.** That half was right: a memory of the
wrong code is worse than no memory, because it answers confidently about files it has
never seen. But coming back gave you nothing either. The work you left in the first
project was not waiting for you.

## The shape of the fix

One remembered conversation *per project*, kept in a file rather than in memory.

The file holds a pointer — which conversation belongs to which project folder, and
when it was last used — not the conversation itself. The words stay where Claude Code
already keeps them, so nothing sensitive is written anywhere it was not already. It
lives in this app's own ignored folder, alongside the trace log, and never leaves the
machine.

Because it is a file, restarting changes nothing: the app comes back up, looks up the
project it is on, and carries on. Because it is keyed by project, switching neither
carries the old conversation across nor destroys it. Starting fresh is still possible
and still deliberate — it clears the project you are on, and only that one.

## The three things that had to be got right

**Resuming must never be worse than not resuming.** A stored pointer can go stale:
cleared away by Claude Code itself, or the machine reinstalled. If picking it up fails
for that reason, the app forgets the pointer, starts a clean conversation, asks the
same question again, and says out loud that it is starting fresh. A failure for any
*other* reason is reported as a failure — retrying a genuinely broken thing just
breaks it twice.

**A long gap gets announced, not hidden.** Resuming work from last Thursday without
saying so is spooky, and worse, the work may since have landed. Below about six hours
it is the same sitting and nothing is said. Above it, the answer opens with where it
is picking up from.

**Written down as it happens, not at the end.** The conversation pointer is saved the
moment it is known, mid-work, not when the work finishes — because the thing being
defended against is the app dying halfway through.

## What it does not do

It does not expire old conversations on a timer. Announcing the gap was judged the
better answer: the person can say "start fresh" in two words, and a silent expiry
would take work away without asking. If long-gap resumes turn out to be a nuisance in
practice, that is the setting to add.

It also does not decide *when* a conversation has drifted far enough from the code to
be misleading. Nothing here reads the change history. That is a harder question and it
belongs with the work on understanding meaning, not here.
