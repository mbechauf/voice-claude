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

`npm run voice:install` needs Homebrew, and installs an older Python and some pronunciation data
alongside the voice itself. If the voice is missing when the server starts, it says so and falls
back to the phone's own rather than leaving you with silence in a car.

Open the printed address on the phone and press Start. The certificate is one this Mac signs itself,
so Safari warns the first time; accept it and it stays accepted.

Then just talk. It listens continuously—including while it is talking to you—hands each thing you
say to Claude, and reads the answer back.

**You can interrupt it.** Start talking over an answer and it stops mid-sentence and listens, and
what you said becomes the next question. The microphone also hears the answer coming back off the
windscreen, so anything heard while it speaks is compared against what it has just said and ignored
if it is mostly the same words. That check is the difference between being able to interrupt and it
arguing with itself all the way down the motorway, so `npm run check` exercises it directly.

Four words are handled on the phone rather than sent anywhere: **stop** (be quiet and abandon the
work), **wait** (be quiet, keep the work), **repeat**, and **start over** (forget the drive so far),
plus their obvious synonyms. They only count when said on their own, so a sentence that happens to
contain "stop" is still just a sentence. Tapping the big button while it is talking also shuts it
up without ending the session.

Because there is no longer a model in between to rewrite Claude's answer, Claude itself is told to
write speech rather than prose—short, no markdown, no code read aloud, findings one at a time. Those
rules are in `server/spoken-answer-rules.md` and are sent once at the start of a drive.

### What you give up

Less than it first appeared. Interruption works. What is missing is the realtime model's sense of
timing—it knew when you had finished a thought; here a pause is what ends your turn, so thinking out
loud mid-sentence can send the question early.

A web page on an iPhone is also suspended when the screen locks, so this does not yet deliver "phone
in pocket, screen off"—see issue #2. Real drives with the screen on come first anyway (#1).

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

```bash
export VOICE_CLAUDE_PROJECT=/absolute/path/to/project
```

Defaults to `~/Code/Advisor-LLM`.

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

## Safety default

Claude is read-only by default through `ALLOWED_TOOLS` in `server/config.mjs`. A session that stalls
for approval is not useful while driving, so widen that list deliberately, not by accident.
