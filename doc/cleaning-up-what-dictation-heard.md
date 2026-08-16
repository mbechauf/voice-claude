# Cleaning up what dictation heard, before Claude sees it

Written 2026-08-15, and built the same day. Issue #9.

## What was wrong

Everything the phone misheard went to Claude exactly as mangled. There was no step
between the two. The gate in the page repairs a small hand-listed set of things by
sound — the app's own name, the command phrases, the project names — and everything
outside that list arrived broken: hesitations left in, no punctuation, three sentences
run together with no boundary, and any word ordinary dictation has never met replaced
by whatever everyday word sounded nearest.

That is not a defect in the phone. It is the price of the free half of this system:
the phone's dictation costs nothing and never sends your voice anywhere, and what it
hands back is what it hands back. We do not own that step.

## Where the idea came from

Mrinal Wadhwa's Unramble (github.com/mrinalwadhwa/unramble) — a Mac dictation tool
that presses a hotkey, listens, and puts polished text wherever your cursor is. He
owns both halves: his own local speech recogniser and, behind it, a second stage that
rewrites the raw transcript.

The useful realisation is that those two halves come apart. **You do not need to own
the listening to own the tidying.** His second stage works on a transcript, and it
does not care where the transcript came from. So we keep the phone's free ear, and add
his second stage on the Mac.

Four things borrowed, near enough unchanged:

- Recogniser first, rewrite second, as separate steps.
- The behaviour lives in a written instruction sheet, in plain English, not in
  training. Changing its manners is editing sentences.
- A guard on the rewrite: check the result, and if it looks wrong, throw it away and
  keep the raw transcript.
- A tiny model is enough. Qwen 3, the smallest one, squeezed to a quarter size,
  running through Apple's own machine-learning framework. He republished a copy rather
  than building one; so do we.

## How it works here

The phone dictates as before. The finished question arrives on the Mac. Before it goes
to Claude, a small model running here rewrites it, and the rewrite is checked. Median
time is under three tenths of a second, which nobody in a car notices.

**At the pauses, not at the end.** The phone hands back a piece every time you stop
for breath, so a piece is roughly a sentence. Each piece is tidied the moment it
lands, while you are still talking, instead of the whole ramble being tidied when you
say send. Everything but the last breath is therefore already done before you ask for
it, and the wait you can actually feel is a fraction of one sentence rather than the
length of what you said. Whatever is still out when you send is waited on for at most
one and a fifth seconds, and then given up on — a late tidy-up is not worth a pause in
front of someone who has just said "send it".

This only works because the raw words and the tidied words are kept apart. Everything
that decides something by sound — is that a command, is that my own voice off the
windscreen, does that sound like a finished sentence — reads the words exactly as
heard. The tidied version is only what goes on the screen and what finally goes to
Claude. A piece whose tidy-up has not come back, or came back untrustworthy, shows and
sends as heard, which is what happened before any of this existed. And because the
pieces are already done, the whole question is not put through a second time on the
way out; doing that would put the delay straight back.

**After the gate, not before it.** The phone has to decide what is a command the
instant it is said, and it does that by sound, in the page, with no model. This only
has to be right about a finished question, and it can afford a third of a second to be
right about the whole of it. Putting a model in front of the gate would have made
every command wait for it.

**The instruction sheet carries worked examples, and they are most of the
instruction.** Told the rules alone, a model this small hands the sentence straight
back unchanged, or shouts it back in capital letters. Shown three sentences repaired
the way we want them, it does the job. That was the single biggest difference in
getting it to work at all, and it is why the examples live beside the rules where
anyone can edit them.

**It knows what this person talks about.** A tidy-up can only repair a word it has
heard of. The generic terms are listed in the settings; the rest are taken from the
project being worked on — its own top-level files and folders — so a project nobody
has thought about yet still gets a vocabulary without anyone adding a line.

## The guard, which is the part that matters

This text becomes an instruction to something that edits real files. A rewrite that
quietly changes what was asked for is worse than any amount of mess, so the rewrite has
to earn its place. It is refused, and the raw words used instead, if:

- Any word appears that was not spoken — unless it sounds like a word that was spoken,
  or is one of the words this person uses, or is a figure, or is the same word an
  ending away ("that's" for "thats").
- Any spoken word is used more often than it was said. This is the dangerous one and
  it was caught in testing: asked *"is that a model that he has created"*, the tidy-up
  wrote back *"that's **not** a model he has created"* — every word of it spoken, one
  of them used twice, and the meaning inverted.
- More than a fifth of the meaningful words go missing, which is a rewrite that
  stopped early.
- Nothing came back at all.

The guard is checked in `npm run check`, without the model, on purpose: the cases that
matter are the ones a model produces rarely, and waiting for one to happen is not a
test.

## What it does not fix, and cannot

A tidy-up can only repair what is there. When a name comes through as mush the sounds
are already lost, and nothing brings them back — the fix for that is a better ear, not
a better rewrite. On twenty-five real sentences from the log it improved fifteen and
refused ten. The refusals cost nothing: those sentences go on exactly as they did
before this existed.

One known imperfection: a rewrite that reshuffles a clause using only words that were
spoken can pass the guard while changing the emphasis. "Response stays empty but the
prompt stays empty" came back as "(Empty response) but the prompt stays empty". No
word was invented and none was repeated, so nothing catches it. It is a smaller class
of harm than the ones the guard does catch, and worth watching in the log rather than
guessing at another rule for.

## If it is not installed

Nothing happens. The raw words go to Claude exactly as they did before. The tidy-up is
an improvement, never a dependency — no model, a crash, or anything slower than three
seconds, and the sentence goes on untouched. It needs an Apple-silicon Mac; install it
with `npm run cleanup:install`, once.
