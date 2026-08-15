# What project this is, and why it has to be one value

Written from the car on 2026-08-15, in the advisor app's notes folder — because the
voice session was locked to that folder and could not reach this repo to write it
here. Moved to where it belongs the same day. That detour is not a footnote; it is
the clearest possible statement of the problem, and it is why this note exists.

## What happened

Mid-drive, asked to switch the session over to the voice app. It could not be done,
for two reasons that are easy to confuse and were fixed separately.

**The wording.** The session is handed an instruction saying which project it is on
and that it must read, change and file issues only there, stopping rather than
reaching into another. So it was *told* to stay put, and said so politely.

**The lock.** Independently of the wording, it genuinely could not reach out: even
listing the sibling folders was refused. So lifting the instruction verbally would
have changed nothing. Saying "I authorise it" from inside the car does not reach a
permission layer.

The circular part: the fix lived in the voice app, and the voice app was precisely
the folder the session was shut out of. It could only be done from a session started
in the voice app's own folder — which, from a car, you cannot do.

## What was built in response

Both halves now come from one value: which project you said you were working on.
That value sets the folder the work runs in, and the instruction is written from the
same value. Say "work on the voice app" and both move together.

Switching also forgets the conversation, deliberately. Its memory is of the other
project, and carrying that across would have it answering about the wrong code with
complete confidence — and the guidance each project loads is its own, so starting
clean is the right behaviour rather than a compromise.

## The lesson, worth keeping after the fix

**The instruction and the enforced limit are two mechanisms saying the same thing,
and they were set from different places.** That is the whole bug. When one becomes
changeable, the other has to be derived from the same source, or they drift and you
get one of two confusing states: forbidden but able, or permitted but blocked. The
second is what happened here, and from the driver's seat it is indistinguishable
from the thing being broken.

It generalises past this app. Any pair of "what it is told" and "what it is allowed"
has this failure mode. Derive both from one value, always.

## The thing that is still true

Being confined to one project is correct, and it has a cost worth knowing: a thought
about project B, had while working on project A, has nowhere to go. That is how this
note ended up in the wrong repository.

There is no clean fix from inside the confinement, and loosening it would give back
the problem it solves. The workable answer is to switch projects, say the thing, and
switch back — which now takes one spoken sentence, and did not exist when this was
written.
