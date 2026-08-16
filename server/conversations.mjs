// Which conversation belongs to which project, remembered on disk.
//
// The app restarts constantly — every change to its own code restarts it — and until
// now that took the conversation with it. The next question was answered by someone
// who had just walked into the room, and the only anchor left was whatever the issue
// happened to say. So the pointer to the conversation lives in a file instead of in
// the running app, and one per project rather than one in total: coming back to a
// project should find the work you left there, not a blank page.
//
// What is stored is a pointer, not the conversation. The words themselves stay where
// Claude Code already keeps them; nothing sensitive is written anywhere it was not
// already being written.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Looked up each time rather than fixed once, so the self-check can point it at a
// scratch file. A test that wrote to the real one would quietly delete what you were
// in the middle of — which is exactly the thing this file exists to prevent.
function where() {
  return process.env.VOICE_CLAUDE_MEMORY_FILE ?? path.join(here, "..", ".voice-claude", "conversations.json");
}

// A gap long enough that picking up silently would be spooky rather than helpful.
// Below this it is the same sitting and needs no announcement.
const LONG_GAP_MS = 6 * 60 * 60 * 1000;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(where(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Missing or damaged is the same thing here: no memory, start clean. A corrupt
    // file must never stop the app dead at the roadside.
    return {};
  }
}

function save(all) {
  try {
    fs.mkdirSync(path.dirname(where()), { recursive: true });
    fs.writeFileSync(where(), `${JSON.stringify(all, null, 2)}\n`);
  } catch (err) {
    console.error(`couldn't remember the conversation: ${err.message}`);
  }
}

/** The conversation last used for this project, or null. */
export function recall(project) {
  const kept = load()[project];
  if (!kept?.id) return null;
  return { id: kept.id, at: kept.at ?? null };
}

/** Tie this conversation to this project, and stamp it as used just now. */
export function remember(project, id, now = new Date()) {
  if (!id) return;
  const all = load();
  all[project] = { id, at: now.toISOString() };
  save(all);
}

/** Deliberately start over — this project only, never the others. */
export function forget(project) {
  const all = load();
  if (!(project in all)) return;
  delete all[project];
  save(all);
}

/**
 * How to describe the gap since a conversation was last used, or null when it is
 * recent enough to say nothing. Said out loud, so it is a phrase and not a date:
 * silently resuming week-old work is how you end up arguing with a ghost.
 */
export function gapPhrase(at, now = new Date()) {
  if (!at) return null;
  const then = new Date(at);
  const ms = now - then;
  if (!Number.isFinite(ms) || ms < LONG_GAP_MS) return null;

  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "from earlier today";
  if (days === 1) return "from yesterday";
  if (days < 7) return `from ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][then.getDay()]}`;
  if (days < 14) return "from last week";
  return `from ${days} days ago`;
}
