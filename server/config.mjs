// Everything you might want to change lives here.

import { homedir } from "node:os";
import path from "node:path";

export const PORT = Number(process.env.VOICE_CLAUDE_PORT ?? 8787);

// The project Claude works on when you talk to it.
export const PROJECT_DIR =
  process.env.VOICE_CLAUDE_PROJECT ?? path.join(homedir(), "Code", "Advisor-LLM");

// The voice. The small model is ~1/3 the price and is only ever a mouthpiece —
// it never reasons about your code — so the quality trade is close to free.
// Swap to "gpt-realtime-2.1" if it sounds bad.
export const VOICE_MODEL = process.env.VOICE_CLAUDE_MODEL ?? "gpt-realtime-2.1-mini";
export const VOICE_NAME = process.env.VOICE_CLAUDE_VOICE ?? "marin";

// Read-only by default. A session that stops to ask permission is useless while
// driving, so Claude is told never to ask — which makes it important that it can
// only do harmless things. Widen this deliberately.
export const ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(ls:*)",
];

// How long to let a single piece of work run before giving up on it.
export const WORK_TIMEOUT_MS = Number(process.env.VOICE_CLAUDE_TIMEOUT ?? 10 * 60_000);

// Don't interrupt with a progress update more often than this.
export const PROGRESS_MIN_GAP_MS = 25_000;
