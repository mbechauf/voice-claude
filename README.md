# voice-claude

A spoken front end to Claude Code, for reviewing and steering code while driving—headset on,
phone in pocket, screen off.

The thinking is always Claude Code, running on this Mac against your real files, paid for by the
Claude subscription. What changes between modes is only who does the hearing and the speaking, and
what that costs.

| Mode | Hearing | Speaking | Cost |
| --- | --- | --- | --- |
| **Free voice** (default) | the phone's dictation | a proper voice on this Mac | nothing |
| **Paid voice** | OpenAI's realtime speech-to-speech model | | billed per minute, both directions |
| **ChatGPT Voice** | ChatGPT itself, delegating to Claude | | plan allowance; unproven, see below |

## Free voice mode—the default

Hearing and speaking are two separate jobs. Only the realtime model forces them together, inside a
single billed audio stream, and that convenience was the entire cost of this project. So the default
keeps them apart and buys each half where it is free:

```text
your voice → the phone's own dictation → this Mac → Claude Code → a voice on this Mac → your ears
```

Nothing is sent to OpenAI, and no credential is needed. Only the text of your question leaves the
phone, and it goes to your own Mac.

The phone can do the speaking too, and did at first, but its built-in voice is genuinely unpleasant
to listen to for an hour. So the answer is spoken by a neural voice running here instead and sent
down a sentence at a time. It generates about ten seconds of speech per second of work, so only the
first sentence of an answer has any wait in front of it—about half a second.

### Running it

```bash
npm run voice:install   # once: sets up the voice. Free to install, free to use.
npm start
```

`npm start` keeps it up. That is not about crashes: the app is changed by talking to it now, and a
change to its own code means nothing until it starts again—with nobody at the keyboard to do it. So
it says on the way out how it wants to be treated, and the loop obeys. Leaving with nothing to say
means stay down, which is what Ctrl-C and being killed do; asking to be started again means the code
underneath changed; falling over means start again, more slowly each time, because a crash loop that
restarts instantly hides the crash.

Half of this system runs in the browser, and restarting the Mac does nothing for that half. So the
Mac says which page it now has, and the phone notices when it is running an older one. When the Mac restarts, the phone reloads with it. If the page notices a newer version some other
way, say **"load the new page"** to take it. Either way the question in progress is carried across.

It restarts itself when its own code changes, but never while Claude is working—interrupting an
answer to pick up an edit is a poor trade. Say **"start yourself again"**, or run `npm run restart`,
to force it. Claude is told to run that itself after changing this app, and told never to ask you to
restart it: you are driving and cannot. Set `VOICE_CLAUDE_WATCH=off` to only ever restart when asked.

**It clears up after itself, and can be asked what it is running.** Run `npm run running` to see
everything it has started, what each belongs to, how long it has been there, and why it is still
alive. Restarting ends only the things that serve the running app; stopping ends the conversation
helper too, so turning it off and on again genuinely clears the slate. A session handed to a screen
outlives both on purpose, and is closed when the work comes back, when nothing is waiting for it, or
after `VOICE_CLAUDE_HANDOVER_HOURS` (12 by default). Conversations held open are closed after 30
minutes untouched and capped at three, never while one is mid-answer. Starting up begins by clearing
what a previous run left behind. Why it works this way: `doc/cleaning-up-after-itself.md`.

**The phone reloads with it.** Half of this runs in the browser, so a page left on the old code after
the Mac has moved on is the genuinely confusing state—the two halves disagree and nothing says so. It
waits for the Mac to come back, then loads itself again, carrying the question in progress across.
The one thing that cannot survive a reload is permission to make sound, so it comes back saying that
a single tap brings the voice back. That tap is unavoidable: an iPhone only lets a page make sound
through a channel a tap opened, and reloading closes it.

`npm run voice:install` needs Homebrew, and installs an older Python and some pronunciation data
alongside the voice itself. If the voice is missing when the server starts, it says so and falls
back to the phone's own rather than leaving you with silence in a car.

Open the printed address on the phone and press Start. The certificate is one this Mac signs itself,
so Safari warns the first time; accept it and it stays accepted.

Then talk. Everything you say builds up in one box on the screen, in full, and stays there. Six
things you can say are instructions rather than part of the question:

- **"all done"** — that is the question, send it. Also "that's it", "over to you", "off you go".
- **"read prompt"** — read back what has been recorded so far, for when you cannot look. Also "read
  it back", "read that back", "say it back", and "rep prompt", which is what dictation makes of it.
- **"take that back"** — drop the last thing you said, keep the rest. Also "delete last". Said when
  the question is already empty, it puts back whatever was last sent or wiped: nothing here is ever
  destroyed, because a misheard command will happen and the fix is to make being wrong cost nothing.
- **"scratch that"** — throw the whole question away and start it again. Also "start again".
- **"fresh start"** — forget the whole drive, not just this question.
- **"work on the voice app"** — change what you are working on. Also "switch to". Everything after
  it happens there: what gets read, what gets changed, and which repository an issue is filed
  against. Ask **"what project"** to hear where you are.
- **"what can i say"** — the phone reads this list back to you. Also "help me out", "say the
  commands". Answered by the phone itself, never sent to Claude: the moment you cannot remember a
  command is the worst moment to wait a minute, and asking Claude would mean saying the send phrase,
  which is one of the things you have just forgotten.

Several wordings each, because you will not remember one exact phrase while driving and dictation
mishears. The cost of a wording is that it can no longer appear inside a question, so they are kept
to things nobody says while describing code—"read the prompt" is deliberately not one of them,
because "can it read the prompt file" is a real question.

**Nothing long is read out in one go.** A list said straight through is lost by the third item, so
it reads a couple and asks whether you want the rest. While it is waiting on a question of its own,
a bare **"yes"** or **"no"** is enough—no send phrase. Single words are safe here and nowhere else:
they are deaf until it has asked you something, and go deaf again the instant you say anything at
all, an answer or not. Anything other than yes or no is treated as speech, exactly as before.

A phrase only counts as a command at the start or the end of what you said. In the middle of a
sentence the same words are just words—"does it send it to the server", "can you work on the login
bug". That rule is worth more than any amount of cleverness about which words to listen for, because
it does not depend on the words at all.

You also hear where things are without looking: two rising blips when a question has gone, a quiet
low note every fifteen seconds while Claude is still working, and a falling note when an answer is
about to be read.

Nothing else does anything. There is no clock: a pause is a person thinking, not a person finished,
so no length of silence ever sends a question or throws one away. That was the whole failure of the
version before this one.

- **Everything is on the screen, in full, always.** The question builds up in front of you and stays
  there until it is sent. The phone stops listening on its own after a couple of seconds of quiet
  and discards whatever it had half-heard when it does, so those words are caught and kept before it
  is started again—otherwise pausing mid-question loses the end of your sentence.
- **Talking over an answer stops it.** It knows its own voice coming back off the windscreen from
  yours, so it will not interrupt itself.
- **"all done" with nothing said means be quiet and drop it**—it shuts up and abandons whatever
  Claude is working on.
- **A rising note means the question was wiped, a falling note means it has gone.** You cannot look
  at the phone, so it says so out loud.
- Say **"start over"** as the whole question to forget the drive so far.
- The big button does the same as "all done", for when the road is too loud to be heard over. It is
  a backstop, not the way in—nobody should be aiming at a phone at seventy miles an hour.

The phrases are deliberately not a name. Dictation is trained on ordinary speech, so a proper noun
it has never met comes back as whatever ordinary word sounds nearest: "Claude" arrived as cloud,
clod, cold and clawed, and "Claude go" as "Claude girl". These are plain words it cannot get wrong,
in an order nobody says by accident, and neither turns up inside a question about code.

Two things underneath make them reliable, and both are exercised by `npm run check` rather than left
for a drive to discover. Phrases are matched by how they sound rather than how they are spelled. And
they are read across a running stream rather than inside each piece of speech on its own—because the
phone hands over whatever it had when you paused, so "all" pause "done" arrives as two separate
pieces, and looking inside each one found nothing while the words fell through into the question.

Because there is no longer a model in between to rewrite Claude's answer, Claude itself is told to
write speech rather than prose—short, no markdown, no code read aloud, findings one at a time. Those
rules are in `server/spoken-answer-rules.md` and are sent once at the start of a drive.

### What you give up

Saying two words at the end of a question. That is genuinely it: the realtime model's advantage was
knowing when you had finished a thought, and saying so yourself turns out to be both cheaper and
more reliable than a machine inferring it over road noise.

A web page on an iPhone is suspended when the screen locks, so this does not yet deliver "phone in
pocket, screen off"—see issue #2. Real drives with the screen on come first anyway (#1).

### Changing the phrases

```bash
VOICE_CLAUDE_CLOSE="over to you" VOICE_CLAUDE_READ="say it back" npm start
```

Two or more words each, made of words dictation meets every day. A single word fires by accident all
day long, and a rare or invented word never gets transcribed as itself. There is nothing special
about how many there are—they are a list in `server/config.mjs`, and adding another is a line there
and a line in the page.

Every sound the page makes—the notes and the voice—goes down a single channel opened by the Start
button, because an iPhone only lets a page make sound through one that a real tap opened. Opening it
lazily, the first time something wants to be heard, gets it silently refused, and a phone that
believes it is talking while making no sound is impossible to diagnose from the driver's seat.

### Changing the voice

```bash
VOICE_CLAUDE_SPEAKER_VOICE=bf_emma VOICE_CLAUDE_SPEAKER_RATE=1.2 npm start
```

Six to choose from: the American women are `af_heart` (the default) and `af_bella`, the American men
are `am_michael` and `am_adam`, and the British pair are `bf_emma` and `bm_george`.

To hand the speaking back to the phone—rougher, but it works with the Mac's voice uninstalled:

```bash
VOICE_CLAUDE_SPEAKER=device npm start
```

A paid speech service would slot into either half as another name in `server/config.mjs`, and would
change nothing else in the system.

### Which project it talks about

Say **"work on the voice app"**, or whichever of them you mean. The projects and the names you say
out loud are a list in `server/config.mjs`; add as many as you like. A drive starts on the advisor
app unless you say otherwise:

```bash
export VOICE_CLAUDE_PROJECT=/absolute/path/to/project
```

This is the setting everything else hangs off, which is why it is spoken and repeated back. The
folder decides which files are changed, what Claude can see, and—easy to miss—which repository an
issue gets filed against, so the wrong project quietly files your ideas onto somebody else's list.

Changing it forgets the conversation so far, deliberately: Claude's memory is of the other project,
and carrying that across would have it answering about the wrong code with complete confidence.
Claude is also told, each time, that the chosen project is the whole world for that conversation and
that it should stop and say so rather than reach into a neighbouring one.

"work on" is a thing people say inside ordinary questions—"can you work on the login bug"—so it only
counts as changing project if what follows actually names one of yours. If it does not, both halves
go back into the question exactly as spoken.

### Watching the work on a screen

Add `/watching` to the address you opened on the phone, on any screen you like—the Mac, an iPad, the
phone itself. It shows what the car cannot: every step, what each one was for, what came back, and
the answers in full, following along as they happen.

It is deliberately its own page rather than a corner of the driving one, because every decision in
the driving page follows from the person being unable to look at it. It only ever reads: there is no
way to type into the conversation from there, and closing it changes nothing about the drive.

Open it halfway through a drive and it shows you everything from the beginning, then keeps up. Open
two of them and neither takes anything from the other or from the car—each keeps its own place. What
it is reading is the conversation Claude Code already writes down as it goes, so it survives the app
restarting, which happens whenever its own code changes.

It never quietly cuts. A conversation replaced underneath it, a place that no longer exists, a result
too long to show in full: each of those is said on the screen rather than papered over, because a
viewer that silently skips is worse than one that admits a gap.

There is a box at the bottom of it to type into, and what you type goes to the same conversation the
car has been using—not a second one. **Either you are talking or you are typing:** a typed question
is never read out loud, because you are looking at a screen and a voice starting up at whoever else
is in the room, or at a driver who did not ask anything, is simply wrong. Talking behaves exactly as
it always has. Nothing has to be switched: it is decided by how the question arrived, so it cannot be
left set the wrong way.

A typed question never starts over the top of an answer somebody is waiting on—it waits its turn, and
says on the screen that it is waiting. Interrupting is still a thing you ask for out loud. Spoken
questions do not wait, because the person speaking is driving and has no way of knowing something
else was already running.

### How well does it understand you?

```bash
npm run score
```

Runs the matching against every sentence anyone has really said to it, plus the awkward cases, and
says what it gets right and wrong. Today: **84%**, with two sentences firing when they should not and
ten it does not understand. That is the ceiling of matching on words—adding wordings for the ten
makes the two worse—and it is the number #8 has to beat.

The sentences live in `data/what-was-meant.jsonl`, with the ones really said out loud marked. The
negatives are the valuable half: anything can recognise "all done", and the whole difficulty is not
firing on a sentence that merely sounds like it. `.voice-claude/trace.log` keeps every sentence the
phone hears, which is where more of them come from.

### Checking it still works

```bash
npm run check
```

Boots the server with no OpenAI credential in the environment at all and checks the parts that are
easy to break and hard to notice until you are already moving.

## Paid voice mode—billed per minute

The original architecture. One premium model does the hearing and the speaking inside a single audio
stream, which buys genuinely natural turn-taking and interruption.

```bash
export OPENAI_API_KEY=...
npm run start:paid
```

Three parts, deliberately separated:

- **The ears and mouth** — OpenAI's Realtime voice model. It holds the conversation and never sees
  your code.
- **The brain** — Claude Code, running on this Mac against your real files.
- **The manners** — the spoken-answer rules and fixed command words in
  `server/voice-instructions.md`.

### Cost

Audio is billed in both directions for as long as the line is open: roughly two to five cents a
minute at best on the smaller voice, and several times that once the conversation is long, because
history is resent. A one-hour drive is a dollar or three. The web client throws away older turns to
keep that flat. This is the mode the free one exists to replace.

## ChatGPT Voice mode—unproven

The idea: ChatGPT Voice supplies the speech from your ChatGPT plan, and a skill in this repo hands
code questions to the local Claude Code subscription, so neither side is billed per call.

```text
ChatGPT Voice → a coding task on this Mac → repo skill → local Claude Code → Claude subscription
```

**It does not work from an ordinary ChatGPT conversation**, and that is not a bug to fix. A plain
chat has no way to run anything on this machine, so there is nothing for it to reach Claude through;
asked directly, it will tell you truthfully that it is not connected to your Mac. The delegation can
only happen in the coding-task surface of the ChatGPT desktop app, with this folder added there as a
project.

Whether such a task can be *started* by voice is the untested part. Try it in text first: start a
task on this folder and type "have Claude review the current change." If Claude genuinely answers
about your real files, the machinery is sound and only the voice trigger is in question.

The local half is verifiable on its own:

```bash
env -u ANTHROPIC_API_KEY claude auth login   # choose the Claude.ai subscription, not API billing
npm run subscription:check
npm run claude:subscription -- --request "the complete request"
npm run claude:new                            # forget the saved conversation
```

The bridge deliberately removes `ANTHROPIC_API_KEY` and requires `claude auth status` to report both
`authMethod: claude.ai` and a non-empty `subscriptionType`, so it fails loudly rather than quietly
falling back to per-token billing.

## Reaching the Mac from the road

The phone does not have to be on the same wifi. Any private network of your own between phone and
Mac works, and the server prints every address it can be reached on, including those. Do not expose
the page to the public internet: it has no password, and anyone who found it could read your code
through Claude.

## What it is allowed to do

Claude cannot stop to ask permission—you are driving—so the list in `server/config.mjs` is the only
thing standing between it and your files.

It may read, search, and **change** files. That was enabled deliberately. Be clear-eyed about what
it means: work happens while you cannot see it, cannot read a diff, and cannot stop it halfway. What
protects you is not the list any more but version control—everything it does shows up as changes you
can read and undo when you get out of the car. It may not commit, push, or run anything destructive,
so nothing done while you drive is hard to reverse.

Claude is also told not to read files or its own changes aloud, and to describe what a change now
does differently rather than what it wrote. Hearing a path recited at seventy miles an hour is
worthless, and hearing the same file described five times is worse than silence.
