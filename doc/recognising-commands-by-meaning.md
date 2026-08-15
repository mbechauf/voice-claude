# Recognising a command by what it meant, not what it sounded like

Proposal, written 2026-08-14 from the driver's seat. Nothing here is built yet.

## What happened

Mid-drive, Michael said "can you read the commands to me". He wanted the command
list. He got Claude — because that sentence is not one of the wordings, so it fell
through the gate as an ordinary question, went to the Mac, and came back as all six
commands spoken in one breath.

Two separate things went wrong, and only one of them is interesting.

The dull one: the "read a couple, then ask if you want the rest" rule is real and it
works, but it only covers lists the phone builds itself. Anything Claude says is
spoken whole. Stopping after two is only an instruction in Claude's notes, and an
instruction is a wish, not a mechanism.

The interesting one, and the subject of this note: **you cannot remember the exact
wordings while driving, and the gate only recognises the exact wordings.** Right now
a command is found by comparing how words sound — a rough spelling of the sound, a
tolerance for a word arriving with an extra ending, and a count of single-letter
changes — against a fixed list. That catches dictation mishearing the words you
did say. It cannot catch you saying different words entirely.

Adding more wordings does not fix this. Every wording added is a phrase that can no
longer appear inside an ordinary question about code, and the list of things you
might plausibly say is open-ended while the list of things nobody says while
describing code is not.

## What must not get worse

A missed command costs you a repeat. A command that fires when you did not mean it
can throw away a question you spent two minutes composing at seventy miles an hour,
or forget the whole drive. Those costs are nowhere near equal, and any change here
has to keep it that way.

So: **be more forgiving about what you might have meant, and less willing to act on
it alone.**

## The proposal

Three layers, in order. The first is what exists today, unchanged.

**One — sounds like a command.** Exactly as now: the running stream of speech is
scanned for the known wordings, sound-alike tolerant. It is fast, it is certain, it
works with no network, and it fires immediately. Nothing about this changes, and it
stays first, so nothing that works today gets slower or less reliable.

**Two — means a command.** If nothing matched, and the thing you just said looks
like it could be standalone rather than part of a question, ask a small
meaning-matcher: is this close to any of the six commands? It compares meaning, not
sound, so "read me the commands" lands near the help command even though it shares
almost no words with any listed wording.

The trigger matters as much as the model. The proposed rule is: **only consider it
when you have not already got a question going.** If there are words banked, a
command-shaped burst is far more likely to be part of what you are dictating. If
there are none, you are almost certainly talking to the app. This is a deliberate
choice to be deaf to commands mid-question, which is the safe direction to be deaf
in.

**Three — ask before doing.** A meaning-match does not act. It says "did you mean
the command list?" and waits. The phone already has exactly this: a narrow window in
which a bare yes or no counts on its own, opened whenever it asks something. So this
costs one word from you and no new machinery.

The exception worth arguing about: the harmless commands. Hearing the command list
or hearing your question read back destroys nothing, so those two could fire
directly on a confident meaning-match. Sending, dropping the last thing, wiping the
question and forgetting the drive should always need the yes. That split is a
judgement call, not a finding — but it is the split I would ship.

## The same machinery already covers Claude asking for confirmation

Noticed on the same drive, and it is the other half of layer three.

When Claude wants a yes before doing something, it should not invent a way of
asking. The narrow yes-or-no window already opens by itself whenever something just
spoken ends in a question — and that is read off the words themselves rather than
being a thing Claude marks, precisely so it cannot be forgotten. A question mark is
there or it is not.

So the rule is entirely on the speaking side: **if you want a yes, end with an
actual question.** It failed on this drive because Claude said "say the word and
I'll file both" with a full stop, which meant a bare "yes" was just a word, and the
answer had to be sent the long way round. Nothing needs building here. It needs
Claude's own notes to say it, so that every confirmation — a loose command match, a
change it is unsure about, anything — goes through the one window rather than each
inventing its own.

## Where the model runs, and what to borrow

The sibling advisor project already does this exact job: it matches a freshly-asked
question against a store of questions it has seen before, to decide whether it can
reuse an existing answer. Three things are worth taking from it.

**The machinery is cheap and portable.** Its matcher runs as ordinary code on an
ordinary machine — no graphics card, no cloud service, no separate server. So this
belongs on the Mac, alongside everything else it already does, and the phone simply
asks. Putting the model in the phone page instead would mean a large download over
mobile data and would make the page slower to start, for a gain that only matters
when the Mac is unreachable — and when the Mac is unreachable there is nothing to
send a question to anyway. The sound-alike layer keeps working regardless, so
nothing gets worse offline.

**Abstaining is the default.** Its governing rule is that a wrong reuse is worse
than doing the work fresh. The same rule reads here as: a wrong command is worse
than a missed one. When the match is not clear, do nothing and let the words be
part of the question.

**And the warning.** That kind of matcher is built for the same thing said
differently, and it is genuinely weak at the same words meaning the opposite — the
advisor project measured this and wrote it down as a ceiling, not a bug to fix. The
danger cases here are exactly that shape: "scratch that" versus "don't scratch
that", or a question that contains the word "forget". This is the strongest argument
for layer three. The model proposes; the yes decides.

One more borrowed detail, which may turn out to be the whole ballgame: over there,
the off-the-shelf matcher scored casual, colloquial phrasings too low to reach the
verifier at all, and only a version tuned on real casual phrasings worked. Speech in
a car is about as colloquial as language gets. So expect the off-the-shelf model to
be disappointing at first, and expect the fix to be a handful of real phrasings per
command rather than a bigger model.

## What "done" looks like

Saying "read me the commands", "what were those commands again", or "I've forgotten
the commands" gets you the command list. Saying "can it read the prompt file" or
"remind me to scratch that build step later" still goes to Claude untouched, and
nothing in an ordinary question about code ever wipes anything without being asked
first.

## Open questions

Whether "you have not already got a question going" is the right trigger, or whether
it should also fire on a short standalone burst mid-question. Whether the harmless
commands really should skip the confirmation. How many example phrasings per command
are needed before the matching is worth having. And how the phone should behave when
the Mac does not answer quickly — the current thinking is that it simply does not
happen, silently, because layer one already had its chance.
