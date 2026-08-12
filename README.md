# voice-claude

A spoken front end to Claude Code, for reviewing and steering code while driving—headset on,
phone in pocket, screen off.

The thinking is always Claude Code, running on this Mac against your real files, paid for by the
Claude subscription. What changes between modes is only who does the hearing and the speaking, and
what that costs.

| Mode | Hearing and speaking | Cost |
| --- | --- | --- |
| **Free voice** (default) | the phone's own dictation and voices | nothing |
| **Paid voice** | OpenAI's realtime speech-to-speech model | billed per minute, both directions |
| **ChatGPT Voice** | ChatGPT itself, delegating to Claude | ChatGPT plan allowance; unproven, see below |

## Free voice mode—the default

Hearing and speaking are two separate jobs. Only the realtime model forces them together, inside a
single billed audio stream, and that convenience was the entire cost of this project. So the default
keeps them apart and buys each half from the phone, for nothing:

```text
your voice → the phone's own dictation → this Mac → Claude Code → the phone's own voice
```

Nothing is sent to OpenAI, and no credential is needed. Only the text of your question leaves the
phone, and it goes to your own Mac.

### Running it

```bash
npm start
```

Open the printed address on the phone and press Start. The certificate is one this Mac signs itself,
so Safari warns the first time; accept it and it stays accepted.

Then just talk. It listens continuously, hands each thing you say to Claude, and reads the answer
back. Five words are handled on the phone rather than sent anywhere: **stop** (be quiet and abandon
the work), **wait** (be quiet, keep the work), **repeat**, **start over** (forget the drive so far),
and any of their obvious synonyms. They only count when said on their own, so a sentence that
happens to contain "stop" is still just a sentence. Tapping the big button while it is talking also
shuts it up without ending the session.

Because there is no longer a model in between to rewrite Claude's answer, Claude itself is told to
write speech rather than prose—short, no markdown, no code read aloud, findings one at a time. Those
rules are in `server/spoken-answer-rules.md` and are sent once at the start of a drive.

### What you give up

Natural interruption. The realtime model could be cut off mid-sentence and would start listening;
here you either wait for a pause or say "stop". That is the honest price of not paying per minute.

Also, a web page on an iPhone is suspended when the screen locks, so this does not yet deliver
"phone in pocket, screen off"—see issue #2. Real drives with the screen on come first anyway (#1).

### Changing the voice

```bash
VOICE_CLAUDE_SPEAKER_VOICE=samantha VOICE_CLAUDE_SPEAKER_RATE=1.2 npm start
```

The names are matched loosely against whatever voices the phone offers. Leave the voice empty to let
the phone choose. A paid speech service would slot into either half as another name in
`server/config.mjs` and would change nothing else.

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
