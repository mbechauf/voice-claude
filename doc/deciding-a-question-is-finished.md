# Deciding a question is finished

Notes for issue #7, written on the branch `feat/4-free-voice-mode`.

These are now on the issue itself as a comment, which is where the record belongs.
This file is kept because the design is longer than a comment wants to be and it is
worth having beside the code it explains — but the issue is the record, not this.

(The session that wrote it could not comment on an issue: only creating, listing and
viewing were allowed. Commenting is allowed now. That gap is why this started life
as a file.)

## What was built

### Filler words

Two lists, treated differently on purpose.

The first are noises that are not words in any sentence — "um", "uh", "er", "erm",
"hmm", "mm", "eh". Those come out wherever they appear.

The second are ordinary words used as stalling — "well", "you know", "I mean",
"let's see", "sort of", "kind of", "like", "so". Those only come out at the very
start or the very end of a piece, because in the middle they carry sense: "you know
the tests fail" means something, and taking the first two words out of it changes
what was asked. Both ends are pared back repeatedly, so "well, you know, the tests"
loses both.

Stripping happens before anything else reads the piece, so a project name with an
"um" in front of it still lands as the project name.

### Finished thoughts

The issue left open where the judgement happens. It happens locally, instantly, with
no round trip — the one thing that must feel immediate cannot wait on a model.

The judgement is deliberately inverted. There is no list of sentences that count as
finished; there is a small closed set of English words whose entire job is to point
at something that has not been said yet — joining words, determiners, prepositions,
helper verbs, and bare question words. A thought is finished if it has at least two
real words and does not end on one of those.

That is what makes it general rather than a set of patterns: "check the tests and" is
unfinished because of "and", not because of anything about tests. A sentence about
anything at all gets the same treatment. Terminal punctuation from dictation settles
it early, since dictation only writes a full stop when one was actually spoken or
clearly heard.

Two real words is the floor. One word is an answer or a fragment, and guessing about
it is not worth the interruption.

### Offer, not send

The issue's second open question — whether a complete sentence sends or only offers.
It offers. Asked while driving, the answer was to ask first.

It waits about a second and a half after the pause and then says "Send that?", which
opens the bare yes/no window that already exists. A bare "yes" sends it.

The beat before asking is not politeness, it is the mechanism. It handles the second
of the two dissimilar cases named in the issue: "Look at the tests." … "Also the
migrations." No reading of the words can tell that the first sentence was still going.
Only waiting can. So anything said inside that beat calls the offer off before it is
made, and the offer is also held back while a command may still be forming, while it
is speaking, and while another question of its own is open.

Two declines on the same question stop it asking again until that question clears.
Twice told no is a person who wants to keep talking, and nagging is worse than
needing the phrase.

## A bug found while testing this live

Not part of the issue, but found by using it and fixed here.

The yes/no answer window was closing the instant a long spoken answer finished. The
clock was meant to pause while it talked — the thinking time is what is being timed —
but a long answer used the whole twenty-five seconds up before the question at the end
had even been asked, so the window shut the moment the last word landed. The driver
got no window at all.

Seen plainly in the trace: the window closed at 23:05:50, and "Yes" was heard at
23:05:54, four seconds later. It went into the next question as a word instead.

Now every moment it is still talking pushes the deadline out afresh, so the full
window always follows the last word, and the short gaps between one sentence and the
next cannot be mistaken for silence.

## Still open

Whether "finished" should consider the shape of a question built over several pauses
rather than the accumulated text. It currently judges the whole question so far, which
is the right shape, but a question deliberately built as two complete sentences will
be offered after each one — the beat catches that only if the second sentence starts
promptly.

Whether the offer should eventually become a send once it has proved itself. Taking a
send back is already free, so the argument for offering is weaker than it looks; it
was chosen because an interruption while driving is the more annoying failure.

## Checks

123 passing, including twelve for filler removal and thirteen for the finished-thought
judgement. The self-check lifts these parts straight out of the page and runs them, so
they are tested as they actually ship.

One incidental repair: the self-check used to find those parts by where they start and
let the match run on, which happened to sweep up a list of polite words sitting in a
gap between two of them. Adding anything in that gap broke it. Each part now says where
it ends as well as where it begins.
