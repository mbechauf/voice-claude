# Voice Claude project guidance

- When the user asks to use Claude as the backend for a code or project question, use the
  `delegate-to-claude` skill.
- Subscription mode must not call the OpenAI API. ChatGPT Voice is the speech surface; the local
  skill invokes the signed-in Claude Code CLI.
- Preserve the standalone OpenAI Realtime API web client as a separate, explicitly API-billed mode.
- Keep Claude read-only unless the user deliberately changes the allowlist in `server/config.mjs`.
