# One channel for everything spoken

Issue #20.

## The problem it solves

You cannot drive this without a headset. On speaker the phone hears itself, decides
its own voice is you asking something new, and answers itself. Three separate faults
combine to cause it, and no one of them is the cause.

## What the ground actually looks like

Two things found while mapping it that change the shape of the fix.

**Browser echo cancellation cannot help us.** Every phone offers to cancel echo on a
microphone the page opens. But in the free mode the page never opens a microphone: the
phone's own dictation listens through its own audio input, inside the operating system,
and hands back only words. There is no stream to attach cancelling to, and no reference
signal to cancel against, because the answer is played through an ordinary sound player
rather than anything the page can route. Whatever the phone does about echo internally
is a black box. So the only levers we actually hold are *when the ear is open* and *what
we do with what it hears*. This rules out the tidy answer and is why the rest of this
is necessary.

**It can already command itself.** When an answer has taken a while, it says "Over to
you." — and "over to you" is one of the phrases that means *send my question now*. Heard
back off the windscreen after it believes it has stopped talking, that is not noise, it
is an instruction. The same door is open to the stop phrase: while it is speaking, "all
done" is reduced to one word and thrown away as echo, so the one thing you say to make
it shut up is the thing most likely to be swallowed.

## The three faults

**The ear is never closed.** Recognition is started once when the drive begins and
stopped once when it ends. Nothing in between pauses it. It even restarts itself, on a
timer, with no notion of whether the app is mid-sentence. Every word it speaks goes
straight back in.

**The one defence is switched off exactly when it is needed.** What comes in is compared
against the last few sentences it said and dropped if half the words match — but only
while it believes it is still speaking. Dictation lags the audio by anything from a few
hundred milliseconds to a couple of seconds, so the tail of its own sentence almost
always arrives *after* it thinks it has finished, when no check runs at all. There is no
quiet window. The same guess misfires both ways: a short reply of yours made only of
small words is discarded as echo, and one misheard word from its own audio is read as
you interrupting, so it cuts its own answer off.

**Speaking is not one channel.** Roughly two dozen places ask it to talk. Each new
request throws away what was left of the last instead of waiting behind it. The
Mac-generated voice has no queue at all, so two overlapping requests run two readers
through one player at once, and whichever finishes first announces that talking has
stopped while sound is still coming out. That announcement is what the echo check
depends on, so an unreliable mouth makes the ear unreliable too. Cancelling and
immediately speaking again advances the queue twice and cuts the first sentence off, and
an interruption announces the end twice, which is how a queued "Over to you." lands in
the middle of the sentence you are saying.

## The fix: one thing that owns the voice

A single gate that everything spoken goes through — the answer, "Thinking", every
confirmation, every error, every announcement. Nothing gets to speak around it. It is
not merely a shared function; it holds four things nobody currently holds:

**A queue that is a queue.** Requests wait behind each other. Asking to speak while it
is speaking adds to the end rather than destroying what is playing. Cutting it off is a
separate, deliberate act with its own name, not a side effect of asking for something
new.

**The truth about when sound stopped.** Not when the queue emptied, not when a reader
loop unwound — when the audio genuinely ended. One reader at a time, so there is nobody
to race, and the end is announced exactly once.

**The words that are actually in the air, with times attached.** What was said and when,
kept long enough to cover the lag and no longer. Today the record has no clock on it at
all, which is why a word from a sentence that rolled off the end reads as you talking.

**When it is worth listening at all.** A settling period after the last sound genuinely
stops, during which what arrives is its own tail rather than anybody's instruction. The
next section is about why that is a window in time rather than a shut door.

## Interrupting on purpose still has to work

The first plan here was to hold the ear shut while it speaks and open it in the gaps
between sentences. Mapping the ground showed that to be wrong, and the reason is worth
keeping: to give you room to cut in, the gap has to be long enough to say something
into, and a pause of that length after every sentence turns a flowing answer into a
stilted one. Worse, it does not even work — you and its own echo arrive at the same
moment, so a door that is open to you is open to the echo too. Timing alone cannot tell
us apart while sound is in the air.

So the ear stays open, and the rules split by *when*:

**While sound is actually in the air**, what comes in is judged on content, as it is
today — but that judgement is now worth trusting, because the record it compares against
is accurate, single-sourced and time-bounded rather than a rolling list of three that
never expires. And cutting an answer off now takes more evidence than one half-heard
word, because one word is exactly what its own voice produces when misheard.

**Once the sound has genuinely stopped**, it stays deaf for a settling period sized to
the lag. This is the whole of the original bug: the tail of its own sentence lands after
it believes it has finished, when nothing was checking at all. Nothing you say in that
window is lost that you would not also have lost by talking over the last half-second of
its sentence.

**After that**, it listens normally.

## Giving up rather than getting stuck

Sound that never reports finishing must not leave it believing it is talking forever —
that would leave it deaf for the rest of the drive, which is worse than any echo. Every wait has a ceiling, sized to how long the words should have taken,
after which it declares the sentence over and carries on. Being wrong in that direction
costs a little echo. Being wrong in the other direction costs the drive.

## Built for the next voice, not just this one

The gate sits above the mouth rather than inside either of them, so it works the same
whether the voice is the phone's own or generated on the Mac, and the paid mode can be
brought behind it without the rules being written twice. What each mouth owes the gate is
narrow: start these words, tell me when the sound really stopped, stop now if I say so.
Any future voice that can do those three things is covered without new rules.

## What this is tested against

The tests hold the general rule rather than the one drive that prompted it: that two
things asked for at once are both said, in order, and neither is lost; that asking to
speak does not destroy what is playing; that the end of sound is announced exactly once,
including when it is cut off; that its own words coming back late are refused while a
short genuine reply is not; that the phrase which stops it is never mistaken for its own
echo; that a sentence whose audio never finishes is given up on rather than waited for
forever; and that nothing it says to itself can be read back as an instruction.

The measure to hold it to is that a future thing which speaks is covered by going
through the gate, rather than needing its own echo rule that somebody has to remember to
write.
