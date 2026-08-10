# voice-claude

A spoken front end to Claude Code, for reviewing and steering code while driving —
headset on, phone in pocket, screen off.

## What this is

Three parts, deliberately separated:

- **The ears and mouth** — OpenAI's realtime voice model. It holds the conversation:
  continuous listening, natural turn-taking, and it can be interrupted mid-sentence.
  It never sees your code and knows nothing about it.
- **The brain** — Claude Code, running on this Mac against your real files. It does
  all the reading, reasoning, and (later) editing.
- **The manners** — how spoken answers are shaped, and the fixed command words.
  This is in `server/voice-instructions.md` and is the part that actually decides
  whether a drive is pleasant. It is portable: it survives any change of transport.

The voice model is given exactly one capability: hand a request to Claude and, later,
speak back what Claude says. Anything about the codebase goes to Claude, always.

## Why the work is handed over asynchronously

Claude takes anywhere from ten seconds to several minutes on real work. A voice
conversation cannot tolerate that as dead air. So handing over work returns
immediately ("on it"), and Claude's progress and final answer arrive afterwards and
get spoken when they're ready — the way a colleague on the phone says "still looking,
hang on".

## What "done" looks like

1. A driveway test: headset on, phone on the local network, ask for a review of a
   real change, hear findings one at a time, say "next" / "explain that" / "stop"
   and have it behave. **(this is the current target)**
2. A commute test: phone in pocket, screen off, over a private network link rather
   than local wifi.
3. A decision point: if the web page dies when the screen locks (it will), and the
   idea has proved itself, build a small native iPhone app. Everything except the
   page is reused unchanged.

## Running it

    export OPENAI_API_KEY=...          # already set in this shell, most likely
    node server/index.mjs

Then open the printed address on the phone, on the same wifi as the Mac, and press
Start.

## Cost

The voice side is billed per minute of audio in both directions, and long
conversations resend their history, so **caching is on by default and must stay on**
— it is the difference between roughly $10–20 a month and roughly $150+. The default
voice model here is the smaller, cheaper one; it is only ever a mouthpiece, so the
quality trade is close to free. See `server/config.mjs`.

The Claude side is billed separately, and how depends on your authentication: with
`ANTHROPIC_API_KEY` set in the environment, Claude Code bills per token through the
API rather than through a Claude subscription.

## Safety default

Claude runs read-only here (`ALLOWED_TOOLS` in `server/config.mjs`) and never stops
to ask permission, because a session that stalls waiting for approval is useless when
you're driving. Widen that list deliberately, not by accident.
