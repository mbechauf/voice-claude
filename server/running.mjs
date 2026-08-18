// What this app has started, and what is allowed to end it.
//
// Nothing here used to be written down. Things were started — a voice, a tidy-up, a
// conversation helper, a session handed to a screen — and nothing was responsible for
// ending any of them. A live machine was found carrying a handover six hours old,
// holding a conversation no longer on record, and an idle conversation from a
// question that had been cut off. Neither was visible without searching the machine
// by hand, and neither would ever have gone away.
//
// So every long-lived thing gets written down here when it starts, with the one fact
// that decides its fate: which of three kinds it is. See doc/cleaning-up-after-itself.md.
//
//   WITH_THE_APP        serves the running app and ends whenever it does — a stop or
//                       a restart, no difference.
//   ACROSS_RESTARTS     deliberately survives a restart, because the app restarts
//                       several times an hour and a conversation that died with it
//                       would be worse than none. A deliberate stop still ends it,
//                       which is what makes stopping mean something.
//   OUTLIVES_ON_PURPOSE survives both, because the whole point of it is that you walk
//                       away from the car and it is still there. Ended by its own
//                       condition — the work coming back, its reason going, or age.
//
// The record is a file rather than a list in memory, because the interesting case is
// exactly the one where this app did not get to run any tidy-up code at all.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const WITH_THE_APP = "with-the-app";
export const ACROSS_RESTARTS = "across-restarts";
export const OUTLIVES_ON_PURPOSE = "outlives-on-purpose";

const RULES = new Set([WITH_THE_APP, ACROSS_RESTARTS, OUTLIVES_ON_PURPOSE]);

// Looked up each time rather than fixed once, so the self-check can point it at a
// scratch file. A test that wrote to the real one would have this app end processes
// belonging to a real drive, which is the exact accident the whole file guards against.
function where() {
  return process.env.VOICE_CLAUDE_RUNNING_FILE ?? path.join(here, "..", ".voice-claude", "running.json");
}

// ------------------------------------------------------------------ the file
//
// Same shape of care as the remembered conversations next door: written to one side
// and moved into place, so a reader never catches it half-written, and an unreadable
// file is left alone rather than written over. Losing this one is worse than losing
// most files — it is the only record of what is out there to be ended.

function load() {
  let raw;
  try {
    raw = fs.readFileSync(where(), "utf8");
  } catch {
    return []; // genuinely nothing started yet
  }
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e === "object") : [];
  } catch {
    // Damaged. An empty list is the safe reading: it means nothing gets ended on the
    // strength of something we cannot actually read, and the worst case is a leftover
    // that has to be cleared by hand rather than a stranger's process being killed.
    return [];
  }
}

function save(all) {
  try {
    const file = where();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const scratch = `${file}.writing`;
    fs.writeFileSync(scratch, `${JSON.stringify(all, null, 2)}\n`);
    fs.renameSync(scratch, file);
  } catch (err) {
    console.error(`couldn't write down what is running: ${err.message}`);
  }
}

// --------------------------------------------------------------- who is that
//
// The most dangerous thing in this file is a stored process number. Numbers get
// reused. A record written an hour ago, naming something that has since died and had
// its number handed on to a browser or an editor, would have this app kill a
// stranger's work — and it would look like the machine misbehaving rather than like
// us. So a number is never enough on its own.

/** What the machine says is wearing this number now, or null if nothing is. */
export function whatIsWearing(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const line = execFileSync("ps", ["-o", "lstart=,command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!line) return null;
    // "Mon Aug 17 17:31:02 2026 /path/to/thing --flags" — the start time first,
    // because that is the part a reused number will not match.
    const match = line.match(/^(\w{3}\s+\w{3}\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s+(.*)$/);
    if (!match) return { startedAt: "", command: line };
    return { startedAt: match[1], command: match[2] };
  } catch {
    return null; // no such process, which is the answer we wanted
  }
}

/**
 * Is the thing wearing this number still the thing we wrote down?
 *
 * Both halves must agree: when it started, and what it was started as. The start time
 * alone would be enough nearly always, but "nearly always" is not the standard for
 * something that ends processes. Refusing is always the safe direction — a leftover
 * costs some memory, and ending the wrong thing costs somebody their work.
 */
export function isStillItself(entry, now = whatIsWearing(entry?.pid)) {
  if (!entry || !now) return false;

  // When it started is the strong half. Two different processes sharing a number AND
  // a start time to the second is not a thing that happens on one machine.
  if (!entry.startedAt || !now.startedAt) return false;
  if (entry.startedAt !== now.startedAt) return false;

  // And something stable about what it is, as a second opinion. Deliberately not the
  // whole command line: a Python helper is launched through one path and then re-runs
  // itself under another, so the line it was started with is not the line it is wearing
  // a second later. Comparing the whole thing made every helper unrecognisable, which
  // failed safe but would have meant nothing was ever swept up — the fault this is
  // supposed to fix, quietly reintroduced. So each thing says how to recognise it, and
  // that marker is a part nobody rewrites.
  const marker = entry.recogniseBy || entry.command;
  if (!marker) return false;
  return now.command.includes(marker);
}

// -------------------------------------------------------- writing things down

/**
 * Note that something long-lived has been started.
 *
 * `what` is said out loud to a person asking what is running, so it is a phrase and
 * not a name: "the voice", not the file it lives in.
 */
export function noteStarted({ what, pid, rule, project = null, note = "", recogniseBy = "" }) {
  if (!RULES.has(rule)) throw new Error(`no such rule: ${rule}`);
  if (!Number.isInteger(pid) || pid <= 1) return null;

  const seen = whatIsWearing(pid);
  const entry = {
    what,
    pid,
    rule,
    project,
    note,
    // The part of what it is running that nobody rewrites — the script's own path,
    // typically. Without one this falls back to the whole command line, which is only
    // right for something that will not be re-launched under another name.
    recogniseBy,
    // Taken from the machine rather than from us, so it is the same string we will
    // compare against later. Ours would be a different clock and a different format.
    startedAt: seen?.startedAt ?? "",
    command: seen?.command ?? "",
    since: new Date().toISOString(),
  };

  const all = load().filter((e) => e.pid !== pid);
  all.push(entry);
  save(all);
  return entry;
}

/** Note that something has ended, so it stops being something to sweep up. */
export function noteEnded(pid) {
  const all = load();
  const left = all.filter((e) => e.pid !== pid);
  if (left.length !== all.length) save(left);
}

/** Everything written down, whether or not it is still alive. */
export function written() {
  return load();
}

// ------------------------------------------------------------------- ending

/**
 * End one thing, but only if it is still the thing we wrote down.
 *
 * Returns what happened, in words, because every one of these outcomes is worth
 * saying out loud to somebody asking why their machine is or is not tidy.
 */
export function end(entry, { signal = "SIGTERM" } = {}) {
  const now = whatIsWearing(entry.pid);
  if (!now) {
    noteEnded(entry.pid);
    return { ended: false, why: "already gone" };
  }
  if (!isStillItself(entry, now)) {
    // The number belongs to something else now. Dropping the record is the whole of
    // the right response: there is nothing of ours left to end, and the thing wearing
    // the number is a stranger.
    noteEnded(entry.pid);
    return { ended: false, why: "that number belongs to something else now" };
  }
  try {
    process.kill(entry.pid, signal);
    noteEnded(entry.pid);
    return { ended: true, why: "ended" };
  } catch (err) {
    noteEnded(entry.pid);
    return { ended: false, why: `couldn't end it: ${err.message}` };
  }
}

/**
 * End everything governed by these rules. Used on the way out, where which rules are
 * named is the whole difference between stopping and restarting.
 */
export function endEverything(rules, { say = () => {} } = {}) {
  const wanted = new Set([].concat(rules));
  const done = [];
  for (const entry of load()) {
    if (!wanted.has(entry.rule)) continue;
    const outcome = end(entry);
    done.push({ ...entry, ...outcome });
    if (outcome.ended) say(`  ended ${entry.what}${entry.project ? ` (${entry.project})` : ""}`);
  }
  return done;
}

/**
 * Reconcile what was written down with what is actually on the machine.
 *
 * Run at startup, before anything new is started. Anything that has gone is dropped.
 * Anything still alive is judged by its kind: something that was meant to go with the
 * app but is still here was left by a crash and is ended; the other two kinds are
 * meant to be here and are kept.
 *
 * This is what makes starting up a clean slate rather than a fresh layer on top of
 * whatever the last run left.
 */
export function sweep({ say = () => {} } = {}) {
  const all = load();
  const kept = [];
  const swept = [];
  const dropped = [];

  for (const entry of all) {
    const now = whatIsWearing(entry.pid);
    if (!now || !isStillItself(entry, now)) {
      dropped.push(entry);
      continue;
    }
    if (entry.rule === WITH_THE_APP) {
      try {
        process.kill(entry.pid, "SIGTERM");
        swept.push(entry);
        say(`  cleared ${entry.what} left behind by an earlier run`);
      } catch {
        dropped.push(entry);
      }
      continue;
    }
    kept.push(entry);
  }

  save(kept);
  return { kept, swept, dropped };
}

// -------------------------------------------------------------- being asked

/** How long ago, in words. Said to a person, so it is a phrase and not a number. */
export function howLong(since, now = new Date()) {
  const ms = now - new Date(since);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

const IN_PLAIN_WORDS = {
  [WITH_THE_APP]: "goes when the app goes",
  [ACROSS_RESTARTS]: "survives a restart, ends on a deliberate stop",
  [OUTLIVES_ON_PURPOSE]: "outlives the app on purpose",
};

/**
 * One honest answer to "what have you got running, and why".
 *
 * This exists because none of it was discoverable. The only way to find the six-hour
 * orphan was to search the machine's process list by hand, which is exactly why
 * nobody found it for six hours.
 */
export function whatIsRunning(now = new Date()) {
  return load().map((entry) => {
    const alive = Boolean(whatIsWearing(entry.pid)) && isStillItself(entry);
    return {
      what: entry.what,
      project: entry.project,
      pid: entry.pid,
      running: alive,
      forHowLong: howLong(entry.since, now),
      rule: entry.rule,
      whyItIsStillHere: IN_PLAIN_WORDS[entry.rule] ?? entry.rule,
      note: entry.note || null,
    };
  });
}
