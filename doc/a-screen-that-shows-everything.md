# A screen that shows everything, while the car hears summaries

Issue #15.

## The problem it solves

The Mac sees everything Claude does — every step, what each one was for, and what came
back from it. Almost all of it is thrown away. What survives is one summarised sentence
every half minute, which is exactly right for driving and hopeless for anything else.

Wanting the full commentary is a real want. It is just not a want you can serve in a
car, and not one the driving page should try to serve, because every decision in that
page follows from the person being unable to look at it.

## The blocker, and why it turned out not to exist

The issue said a proper record had to be built first, and it was right about the
requirements. What exists inside the app is not a record. It is a buffer, and it is
consumed by being read: the phone asks what has been going on, and the asking empties
it. It also only keeps the last sixty entries. Point a second viewer at that and the
two fight over the same data — each sees roughly half, neither can tell it is missing
anything, and a viewer that connects late sees nothing that came before.

So a real record had to be written once and read many times, had to let every reader
keep its own place, and had to be honest with a reader that has fallen behind rather
than handing it a gap.

All three were already true of something we did not write. Claude Code keeps every
conversation on disk as it happens: one entry per line, only ever appended to, never
rewritten. That file *is* the record. Nothing a reader does to it affects anyone else,
a byte offset is a natural place to be up to, and it outlives everything — the app
restarting several times an hour, the held-open conversation dying, the Mac rebooting.

Building a second record beside it would have been a worse copy of a better thing.

## The shape of it

A screen says where it had got to and is told everything since. Its place is two
things, not one: which conversation, and how far into it. Both halves are load-bearing
— a conversation can be replaced (a fresh start, or one that died and was begun again)
and a reader holding only a number would carry on counting into a different file and
show nonsense with total confidence. When the conversation changes underneath a screen,
it starts again from the top of the new one and says so.

Three refusals worth naming, because each one is a way this could quietly lie:

- **A half-written line is never shown.** The file is being appended to while it is
  read, so the last line is regularly a fragment. The place only ever advances to the
  end of the last complete line.
- **A place that no longer exists is admitted.** If the file has been rewritten shorter
  than where a reader was, there is no honest way to carry on. It starts again and says
  that is what happened.
- **What is cut is said out loud.** A single command can return a megabyte, and nobody
  reads that on a screen either. Results are bounded — far more generously than the
  car's account, which is trimmed hard because a sentence is being made of it — and the
  number of characters left out is shown.

## Why a web page rather than a Mac or iPad app

The issue imagined a native app. A page served by the Mac does the same job for a
fraction of the work: the Mac is already running a web server, the certificate is
already accepted, and a browser is already on every screen in the house — Mac, iPad and
phone alike. It is still deliberately its own thing, on its own address, and not a
panel bolted into the driving page.

If it ever genuinely needs to be native, nothing here is wasted. The hard part is the
record and the following, and that part is identical either way.

## What it does not do

It only ever reads. There is no way to type into the conversation from this page, and
closing it changes nothing about the drive. Typing from a screen is a separate want and
belongs in its own issue.

It also does not replace handing the conversation over to a screen when a drive ends
mid-thought. That is a different thing — it moves the turn — and it stays as it is.

## Where it lives

`server/watching.mjs` turns the conversation file into things worth showing.
`web/watching.html` is the page. The address is the phone's address with `/watching` on
the end, and the Mac prints it on the way up.
