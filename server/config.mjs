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

// Who does each half in split mode. A paid speech service would slot in here as
// another name, and would change nothing else in the system.
//
//   listener "device" — the phone's own dictation. Only the words leave the phone.
//   speaker  "mac"    — a proper voice generated here and sent down to the phone.
//   speaker  "device" — the phone's own built-in voice. Free, and rough to listen to
//                       for any length of time; kept as the fallback for when the
//                       Mac voice isn't installed.
export const LISTENER = process.env.VOICE_CLAUDE_LISTENER ?? "device";
export const SPEAKER = process.env.VOICE_CLAUDE_SPEAKER ?? "mac";

// Which voice. For the Mac voice these are its own names — the American women are
// af_heart and af_bella, the American men am_michael and am_adam, and the British
// pair are bf_emma and bm_george. For the phone's voice it is matched loosely
// against whatever that phone happens to offer, and empty means "let it choose".
export const SPEAKER_VOICE =
  process.env.VOICE_CLAUDE_SPEAKER_VOICE ?? (SPEAKER === "mac" ? "af_heart" : "");

// How fast it reads answers out. Slightly quick suits driving; raise it once the
// phrasing is familiar.
export const SPEAKER_RATE = Number(process.env.VOICE_CLAUDE_SPEAKER_RATE ?? 1.05);

// How it decides that something was meant for it.
//
//   "phrases" — nothing counts unless it is said between the two phrases below, and
//               a silence never sends anything. You decide when a question is
//               finished, because a pause in a car means you are thinking, not done.
//   "always"  — everything you say is the question, sent once you stop talking.
//               Only sane somewhere quiet with nobody else talking.
export const GATE = process.env.VOICE_CLAUDE_GATE ?? "phrases";

// The things you can say that are instructions rather than part of the question.
//
// Deliberately not names. A phone's dictation is trained on ordinary speech, so a
// proper noun it has never met comes back as whatever ordinary word sounds nearest —
// "Claude" arrived as cloud, clod, cold, clawed, and "Claude go" as "Claude girl".
// These are plain words it cannot get wrong, in an order nobody says by accident,
// and none of them turns up inside a question about code.
//
// Adding another is one line here and one line in the page. Two or more everyday
// words each: one word fires by accident all day, and an invented word never gets
// transcribed as itself.
// Each has several wordings, for two reasons. You will not remember one exact
// phrase while driving, and dictation mishears — "read prompt" comes back as "rep
// prompt" often enough to matter. Any of them does the same thing, so the one that
// comes to mind is the right one.
//
// Add to these freely. The cost of another wording is that it can no longer appear
// inside a question, so keep them to things nobody says while describing code.
export const PHRASES = {
  // That is the question — go.
  send: ["all done", "that's it", "over to you", "off you go"],

  // Read back what has been recorded so far.
  // "read the prompt" is deliberately absent: "can it read the prompt file" is a
  // real question about this project, and a wording that can appear inside a
  // question is worse than one fewer way of saying it.
  read: ["read prompt", "read it back", "read that back", "read back", "say it back", "rep prompt"],

  // Drop the last thing said, keep the rest.
  undo: ["take that back", "delete last", "delete the last", "scratch last"],

  // Throw the whole question away and start it again.
  wipe: ["scratch that", "start again", "wipe that"],

  // Forget the whole drive, not just this question.
  forget: ["fresh start", "forget everything"],
};

// Only used when there is no gate. How long a silence means you have finished.
export const PAUSE_MS = Number(process.env.VOICE_CLAUDE_PAUSE ?? 3_500);

// How long the gate waits before giving up on a question you started and forgot
// about. Zero means never, which is the default: nothing you did not finish
// yourself is ever sent, and nothing you were still thinking about is ever thrown
// away. Set it to a number of milliseconds if you would rather it tidied up.
export const OPEN_TIMEOUT_MS = Number(process.env.VOICE_CLAUDE_OPEN_TIMEOUT ?? 0);

// Realtime mode only. The small model is ~1/3 the price and is only ever a
// mouthpiece — it never reasons about your code — so the quality trade is close
// to free. Swap to "gpt-realtime-2.1" if it sounds bad.
export const VOICE_MODEL = process.env.VOICE_CLAUDE_MODEL ?? "gpt-realtime-2.1-mini";
export const VOICE_NAME = process.env.VOICE_CLAUDE_VOICE ?? "marin";

// Claude cannot stop to ask permission — you are driving — so this list is the only
// thing standing between it and your files, and it is deliberately explicit.
//
// It may now write. That was asked for knowingly, and it is worth being clear about
// what it means: work happens while you cannot see it. What protects you is not
// this list any more but version control — everything it does shows up as changes
// you can read and undo when you get out of the car. It may not commit, push, or
// run anything destructive, so nothing it does while you drive is hard to reverse.
export const ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
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
