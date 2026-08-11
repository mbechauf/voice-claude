---
name: delegate-to-claude
description: Delegate codebase questions, reviews, explanations, and follow-up requests to the locally signed-in Claude Code CLI, then return a concise spoken answer. Use when the user asks for the Claude backend, invokes voice-claude from ChatGPT Voice, or wants Claude—not ChatGPT/Codex—to inspect the configured project. Do not use for small talk, ChatGPT setup questions, or requests that should be answered without inspecting code.
---

# Delegate to Claude

Treat ChatGPT Voice as the ears and mouth and Claude Code as the code-reading backend. Never call
the OpenAI API from this workflow.

## Workflow

1. From the `voice-claude` repository, run `npm run subscription:check`.
2. If the check fails, report the exact remediation it prints. Do not fall back to an inherited
   `ANTHROPIC_API_KEY`; subscription mode requires an explicit Claude.ai subscription type.
3. Turn the user's request into one self-contained engineering instruction. Preserve references to
   the current finding or prior answer; the CLI maintains a Claude session for the configured
   project.
4. Run `npm run claude:subscription -- --request "<request>"`.
5. Treat stdout as Claude's answer. Do not independently invent codebase details or silently replace
   Claude's answer with your own analysis.
6. Speak the outcome first. Keep it short, avoid code and file paths unless requested, and offer
   detail rather than reading a long report aloud.

## Follow-ups

- Pass “next,” “explain,” or a contextual follow-up through the same command; the saved Claude
  session supplies prior context.
- For “repeat,” repeat the last spoken answer without invoking Claude.
- If the user asks to start over, run `npm run claude:new`, then submit the new request.
- If the user interrupts or says “stop,” interrupt the running command and confirm briefly.

## Boundaries

- The CLI removes `ANTHROPIC_API_KEY` and requires Claude to report `claude.ai` authentication plus
  a subscription type.
- Claude receives only the read-only tools declared in `server/config.mjs`.
- A failed subscription check is a blocker. Never switch to API billing automatically.
- `VOICE_CLAUDE_PROJECT` selects the project Claude inspects; do not assume it is this adapter repo.
