# Typing into the same conversation, when you are at a screen

Issue #18.

## The problem it solves

This stopped being only a car app a while ago — it is how the coding actually gets done
now, drive or no drive. The gap that left was simple: the moment you are sitting at a
screen, the fastest way you have of saying something goes unused, and you are still
dictating sentences at a phone.

Both halves of the thing to type into already existed. There is one conversation held
open per project, and a screen showing the whole of it. All that was missing was a box.

## Two modes, never a mixture

The decision this rests on, made deliberately rather than left to fall out of the code:
**either you are talking or you are typing.**

- A typed question is never read out loud. Somebody typing is looking at a screen, and
  a voice starting up at whoever else is in the room — or worse, at a driver who did
  not ask anything — is simply wrong.
- Talking behaves exactly as it did. Spoken answer, spoken progress, all of it.

The mode is not a state anybody has to enter or remember. It is decided by how the
question arrived, which means it cannot be left switched the wrong way — the failure
that a remembered mode would eventually produce.

## One road in, with a word attached

Both ways in go through the same place, and the only difference between them is a word
carried along with everything that comes back: spoken, or typed. That word is what
decides whether anything is said out loud.

The phone is *told* about a typed question and stays quiet about it, rather than being
kept in the dark. That is deliberate. Two ways of asking that took two different roads
would be two conversations before long, and reconciling those is a mess this app has
already been through once.

## Waiting rather than barging in

A typed question never starts over the top of an answer somebody is waiting on. It
waits its turn, and the screen says so while it waits — silence between typing
something and it starting reads exactly like being ignored.

Interrupting is still possible, and still has its own way of being asked for: the stop
phrase, said out loud. A sentence typed in another room killing a drive's answer would
be a nasty surprise with no explanation attached.

Spoken questions do not wait. That asymmetry is on purpose: the person speaking is in a
car and has no way of knowing something else was already running.

## The answer needs no delivery of its own

Nothing was built to get a typed answer back to the screen. The screen already shows
the conversation by reading what Claude Code writes down as it happens, and a typed
question goes into that same conversation — so the answer arrives the same way
everything else does.

## Where it lives

The box is at the bottom of the watching page, `web/watching.html`. Both ways of asking
meet in one function in `server/index.mjs`, which is also where a typed question waits
its turn.
