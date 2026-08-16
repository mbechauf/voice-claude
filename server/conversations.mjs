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

// How stale the "last used" stamp is allowed to get before it is worth writing again.
// It only decides how far back "picking up where we left off" reaches, so a minute of
// drift costs nothing, while rewriting on every scrap of streamed work costs plenty.
const STAMP_EVERY_MS = 60 * 1000;

// Missing and damaged are NOT the same thing, and treating them as the same is how a
// project loses work it left behind. Missing means there is nothing to keep. Damaged
// means there is something and we cannot read it — and the one thing never to do then
// is write a fresh store over the top, because that turns "unreadable" into "gone".
// Returns null for damaged, an object otherwise.
function load() {
  let raw;
  try {
    raw = fs.readFileSync(where(), "utf8");
  } catch {
    return {}; // genuinely nothing there yet
  }
  if (!raw.trim()) return null; // an empty file is a half-written one, not an empty store
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Written to one side and then moved into place in a single step, so a reader can
// never catch it half-written. The old way — writing straight over the top — left a
// window in which the store looked empty, and anything that read it in that window
// concluded there was nothing remembered at all.
function save(all) {
  try {
    const file = where();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const scratch = `${file}.writing`;
    fs.writeFileSync(scratch, `${JSON.stringify(all, null, 2)}\n`);
    fs.renameSync(scratch, file);
  } catch (err) {
    console.error(`couldn't remember the conversation: ${err.message}`);
  }
}

// A store we cannot read is put to one side rather than thrown away, so the ids in it
// can still be dug out by hand. Then we may start clean with a clear conscience.
function setAside() {
  try {
    fs.renameSync(where(), `${where()}.unreadable`);
  } catch {
    // Nothing to move, or nowhere to move it. Either way, carry on.
  }
}

/** The conversation last used for this project, or null. */
export function recall(project) {
  const kept = load()?.[project];
  if (!kept?.id) return null;
  return { id: kept.id, at: kept.at ?? null };
}

/** Tie this conversation to this project, and stamp it as used just now. */
export function remember(project, id, now = new Date()) {
  if (!id) return;
  let all = load();
  if (!all) {
    // Unreadable. Keep the old one where a human can still get at it, and say so out
    // loud in the log, rather than quietly writing a store with one project in it and
    // leaving every other project's work looking as though it never happened.
    console.error("the remembered conversations couldn't be read; keeping the old file aside");
    setAside();
    all = {};
  }
  const existing = all[project];
  // Nothing to write when it is already this conversation and was stamped a moment
  // ago. The work streams back in dozens of pieces and each one used to rewrite the
  // whole store, which is a lot of chances to be caught mid-write for no gain.
  if (existing?.id === id && existing.at && now - new Date(existing.at) < STAMP_EVERY_MS) return;
  all[project] = { id, at: now.toISOString() };
  save(all);
}

/** Deliberately start over — this project only, never the others. */
export function forget(project) {
  const all = load();
  if (!all) {
    // Damaged, and the ask was to start clean anyway. Put it aside and be done.
    setAside();
    return;
  }
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
