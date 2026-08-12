// Everything you might want to change lives here.

import { homedir } from "node:os";
import path from "node:path";

export const PORT = Number(process.env.VOICE_CLAUDE_PORT ?? 8787);

// The project Claude works on when you talk to it.
export const PROJECT_DIR =
  process.env.VOICE_CLAUDE_PROJECT ?? path.join(homedir(), "Code", "Advisor-LLM");

// ------------------------------------------------------------ the voice layer
//
// Talking is two separate jobs: hearing you, and speaking back. Only one thing
// forces them together, and that is the realtime model, which does both inside a
// single billed audio stream. That convenience is the whole cost of this project,
// so the default keeps the two jobs apart and buys each one separately — today
// from the phone itself, for nothing.
//
//   "split"    — a listener and a speaker, chosen independently. Free by default.
//   "realtime" — OpenAI's speech-to-speech model. Billed per minute, both ways.
export const MODE = process.env.VOICE_CLAUDE_MODE ?? "split";

// Who does each half in split mode. "device" is the phone's own dictation and its
// own built-in voices: nothing billed, and only the text of your question ever
// leaves it. A paid speech service would slot in here as another name, and would
// change nothing else in the system.
export const LISTENER = process.env.VOICE_CLAUDE_LISTENER ?? "device";
export const SPEAKER = process.env.VOICE_CLAUDE_SPEAKER ?? "device";

// Which of the phone's voices to use, matched loosely against the names it offers.
// Empty means "let the phone pick its default".
export const SPEAKER_VOICE = process.env.VOICE_CLAUDE_SPEAKER_VOICE ?? "";

// How fast it reads answers out. Slightly quick suits driving; raise it once the
// phrasing is familiar.
export const SPEAKER_RATE = Number(process.env.VOICE_CLAUDE_SPEAKER_RATE ?? 1.05);

// Realtime mode only. The small model is ~1/3 the price and is only ever a
// mouthpiece — it never reasons about your code — so the quality trade is close
// to free. Swap to "gpt-realtime-2.1" if it sounds bad.
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
