# Cleaning up after itself

Everything this app starts should end. Until now nothing did.

A live machine was found running a handover session six hours old, still holding a
conversation that was no longer in the records at all, and an open conversation on
another project idle for nearly two hours — the ghost of a typed question that got
cut off. Neither was visible without going hunting through the machine's process
list. Neither would ever have gone away on its own.

The cause is not any one of those. It is that things were started and nobody was
responsible for ending them. So the fix is not a tidy-up pass for those two; it is
giving every process an owner and a stated end.

## Three ways a thing is allowed to end

Every long-lived process this app starts is one of exactly three kinds. The kind is
declared when it is started, not guessed at afterwards.

**Goes with the app.** The voice, the dictation tidy-up, any one-off Claude launched
the old way. These exist only to serve the running app, so they end whenever it
does — whether that is a deliberate stop or a restart because the code changed.

**Lasts across restarts.** The helper that holds conversations open. This one is
deliberately cut loose, because the app restarts several times an hour while it is
being worked on and a conversation that died with it would be worse than none. So a
restart leaves it alone — but a deliberate stop ends it. That distinction is the
whole point: "turn it off and on again" has to actually clear something, and until
now it cleared nothing.

**Outlives on purpose.** A session handed over to a screen. You stop driving, you
walk to your desk, and the thing you were working on is still there. It must survive
both a restart and a stop. But "survives" is not "forever": it ends when the work
comes back to the car, when the conversation it was holding is no longer on record,
or when it is simply too old to be anybody's live work.

The app already knew the difference between stopping and restarting — it says so on
the way out, and the loop around it obeys. This hangs the lifetime rules on that
existing distinction rather than inventing a second one.

## A written record, because crashes do not run tidy-up code

The rules above only help if something knows what is running. A list held in memory
dies with the app, and the interesting case is exactly the one where the app did not
exit cleanly. So the record is a file: each thing written down when it starts,
removed when it ends.

Starting up begins by reading that file and reconciling it with what is actually on
the machine. Anything on the list that has gone is dropped. Anything still running is
judged by its kind: a goes-with-the-app process that survived is an orphan from a
crash and is ended; the other two kinds are adopted back and carry on. That is what
makes a restart genuinely a clean slate rather than a fresh layer on top of the old
one.

## Never kill by number alone

The single most dangerous thing here is a stored process number. Numbers get reused.
A record written an hour ago naming a process that has since died and had its number
handed to something else — a browser, an editor, someone else's work — would have
this app kill a stranger, and it would look like the machine misbehaving rather than
like us.

So nothing is ended on the strength of its number. Each record also stores enough to
recognise the thing: what it was started as, and when. Before anything is ended, the
process wearing that number now is checked against what was written down, and a
mismatch means the original is gone and the record is simply dropped. Refusing to act
is always the safe direction here — a leftover process costs some memory, and killing
the wrong one costs somebody their work.

## Conversations are bounded, not unlimited

Inside the helper, one conversation is held open per project. Nothing ever closed
them: switch projects and the old one stayed, with no idle limit and no ceiling, each
holding real memory until the helper was killed by hand.

Two limits, both deliberately generous, because closing one that is about to be used
again costs a slow question and a lost thread. A conversation untouched for long
enough is closed. And when there are more open than the ceiling allows, the one
unused for longest goes first. A drive that touches five projects ends with the
number that were actually being used, not five.

## It has to be answerable

None of this was discoverable. The only way to know what was running was to search
the machine's process list by hand, which is how a six-hour-old orphan goes
unnoticed. So there is one place to ask what is running and why, naming each thing,
what it belongs to, how long it has been there, and which of the three rules governs
it — from a screen or from a command line, without hunting.

## What this is tested against

The tests hold the general rule rather than the two leftovers that prompted it: that
a record naming a process which is gone is dropped rather than acted on; that a
record whose process number now belongs to something else is refused; that the three
kinds are ended on the right occasions and not the wrong ones; that conversations
past the idle limit and past the ceiling are closed; and that asking what is running
gives a truthful answer.

The measure to hold it to is that any future helper this app learns to start is
covered by declaring which of the three kinds it is — rather than needing its own
tidy-up that somebody has to remember to write.
