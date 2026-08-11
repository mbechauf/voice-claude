# voice-claude

A spoken front end to Claude Code, for reviewing and steering code while driving—headset on,
phone in pocket, screen off.

There are two front ends:

1. **Subscription mode:** ChatGPT Voice in the ChatGPT desktop app supplies speech and uses the
   ChatGPT plan allowance; a repo skill delegates code questions to the signed-in Claude Code
   subscription. This mode makes no OpenAI API calls.
2. **Standalone web mode:** the original phone web page uses the OpenAI Realtime API and is billed
   through `OPENAI_API_KEY`.

## Subscription mode—no OpenAI API billing

This is the supported way to use both subscriptions. A ChatGPT subscription does not provide an API
credential that the standalone web page can use, so subscription mode uses ChatGPT Voice itself as
the front end:

```text
ChatGPT Voice (desktop or paired phone)
        → Codex project task
        → repo skill
        → local Claude Code CLI
        → Claude subscription
```

### Prerequisites

- A ChatGPT plan with ChatGPT Voice and Codex access.
- The ChatGPT desktop app on the Mac.
- Claude Code installed and signed into the Claude subscription without relying on
  `ANTHROPIC_API_KEY`.

The bridge deliberately removes `ANTHROPIC_API_KEY` and requires `claude auth status` to report both
`authMethod: claude.ai` and a non-empty `subscriptionType`. Sign in once and choose the Claude.ai
subscription option—not Claude Console/API billing:

```bash
env -u ANTHROPIC_API_KEY claude auth login
npm run subscription:check
```

### Start a voice session

1. Add this repository as a local project in the ChatGPT desktop app.
2. Open a new, empty Codex task and start it in voice mode. Voice must be enabled before the first
   message; a task that starts as text offers dictation instead.
3. Say, “Use delegate to Claude to review the current change,” or select the
   `delegate-to-claude` skill explicitly.

The skill runs:

```bash
npm run claude:subscription -- --request "the complete request"
```

Claude's session id is retained per configured project under the ignored `.voice-claude/`
directory, so “next” and “explain that” keep their context. Reset it with `npm run claude:new`.

By default Claude inspects `~/Code/Advisor-LLM`. Point it at another project when starting ChatGPT
or before invoking the skill:

```bash
export VOICE_CLAUDE_PROJECT=/absolute/path/to/project
```

For phone access, pair the ChatGPT mobile app with this Mac using **Settings → Connections →
Control this Mac or PC** in the desktop app, then open **Remote** on the phone. The Mac must remain
awake, online, and running the desktop app. Permissions and approval prompts still apply remotely,
so keep Claude's read-only tool allowlist narrow.

ChatGPT Voice has plan-dependent limits, and tasks it starts also consume the plan's Codex usage
budget. This avoids per-call OpenAI API billing; it does not make either subscription unlimited.

## Standalone web mode—OpenAI API billed

The original architecture remains available when the custom web interface and direct WebRTC audio
path are required.

### What this mode is

Three parts, deliberately separated:

- **The ears and mouth** — OpenAI's Realtime voice model. It holds the conversation: continuous
  listening, natural turn-taking, and interruption. It never sees your code.
- **The brain** — Claude Code, running on this Mac against your real files.
- **The manners** — the spoken-answer rules and fixed command words in
  `server/voice-instructions.md`.

The voice model has one capability: hand a request to Claude and later speak back what Claude says.

### Why work is handed over asynchronously

Claude can take seconds or minutes on real work. Handoff returns immediately, and Claude's progress
and final answer arrive later and are spoken when ready.

### Running it

```bash
export OPENAI_API_KEY=...
node server/index.mjs
```

Then open the printed address on the phone, on the same Wi-Fi, and press Start.

### Cost

The Realtime voice side is API-billed for audio in both directions. Long conversations resend
history, so the web client keeps only the last few turns. The default voice model is the smaller,
cheaper one; see `server/config.mjs`.

The Claude bridge removes `ANTHROPIC_API_KEY` from the child process. Run
`npm run subscription:check` before driving to confirm that Claude Code has a separate subscription
login; otherwise the bridge fails instead of silently using API billing.

## Safety default

Claude is read-only by default through `ALLOWED_TOOLS` in `server/config.mjs`. A session that stalls
for approval is not useful while driving, so widen that list deliberately, not by accident.
