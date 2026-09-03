// Everything that happened, for a screen to read.
//
// The car hears one summarised sentence every half minute, which is right for
// driving and hopeless for anything else. What the Mac actually sees — every step,
// what it was for, what came back — was thrown away as soon as it had been spoken
// over. Wanting all of it is a real want, but not in the car: it belongs on a screen.
//
// The obvious way to do that was to build a record inside this app. It is not built
// here, because one already exists and is better than anything we would have written:
// Claude Code writes every conversation down as it happens, one entry per line, only
// ever adding to the end. That file is already the thing the record had to be —
// written once and read as often as you like, with a natural place to be up to, and
// nothing a reader does takes anything away from anyone else. So this reads that.
//
// Three consequences worth knowing, because they are the reason this is short:
//
//   Nobody fights over it. The account the car reads is a buffer that empties as it
//   is read; pointing a second viewer at that would have given each of them half and
//   told neither. Here every reader has its own place in the file and they cannot
//   affect each other.
//
//   It survives everything. The app restarts several times an hour while it is being
//   worked on, and the conversation itself can die and be picked up again. Neither
//   touches what is already written down, so a screen goes blank for a moment and
//   then carries on from exactly where it was.
//
//   It is honest when it cannot help. A reader that asks for a place that no longer
//   exists is told so, rather than being handed whatever is there now and left to
//   believe it saw everything.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { recall } from "./conversations.mjs";

// Where Claude Code keeps conversations. One folder per project, one file per
// conversation inside it.
const KEPT_IN = process.env.VOICE_CLAUDE_TRANSCRIPTS ?? path.join(os.homedir(), ".claude", "projects");

// How much of what came back to keep. The car's account is trimmed hard at both ends
// because a sentence is being made of it; a screen can take far more. It is still
// bounded, because a single command can return a megabyte and nobody reads that on a
// screen either — but what was dropped is said out loud rather than silently cut.
const RESULT_LIMIT = 4_000;

/**
 * The folder name Claude Code gives a project.
 *
 * Derived rather than looked up, because the folder is named after the path with
 * everything that is not a letter or a number turned into a dash. Derivation can be
 * wrong when that rule changes under us, so it is only ever the first guess and the
 * caller falls back to looking.
 */
const folderFor = (project) => project.replace(/[^a-zA-Z0-9]/g, "-");

/** The file holding one conversation, or null when there is no such file. */
export function fileFor(project, conversation) {
  if (!conversation) return null;

  const guess = path.join(KEPT_IN, folderFor(project), `${conversation}.jsonl`);
  if (fs.existsSync(guess)) return guess;

  // The guess missed. Rather than concluding there is nothing, look for the file by
  // name — a conversation belongs to exactly one folder, so finding it anywhere is
  // finding the right one.
  let folders;
  try {
    folders = fs.readdirSync(KEPT_IN);
  } catch {
    return null;
  }
  for (const folder of folders) {
    const maybe = path.join(KEPT_IN, folder, `${conversation}.jsonl`);
    if (fs.existsSync(maybe)) return maybe;
  }
  return null;
}

// Where a reader has got to: which conversation, and how far into it. Both halves
// matter. A conversation can be replaced — a fresh start, or one that died and was
// begun again — and a reader holding only a number would carry on counting into a
// different file and show nonsense with total confidence.
// The place a reader has got to, and — since it is the only thing that travels there
// and back — whether it stopped in the middle of an exchange it is leaving out.
//
// Without that second part the leaving-out could never work across more than one look:
// each look starts afresh, so a question hidden in one and its answer arriving in the
// next meant the answer was shown. Which is exactly what happened, twice.
export const placeOf = (conversation, at, skipping = false) =>
  `${conversation}@${at}${skipping ? "!skip" : ""}`;

export function readPlace(place) {
  const whole = String(place ?? "");
  const skipping = whole.endsWith("!skip");
  const trimmed = skipping ? whole.slice(0, -"!skip".length) : whole;
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return { conversation: null, at: 0, skipping: false };
  return {
    skipping,
    conversation: trimmed.slice(0, at) || null,
    at: Number(trimmed.slice(at + 1)) || 0,
  };
}

/**
 * One line of the file, as something worth showing — or null for the lines that are
 * bookkeeping rather than events.
 *
 * The file carries more than the conversation: what is queued, what the conversation
 * has been named, which mode it is in. All of that is real and none of it is what
 * somebody watching the work wants to see.
 */
function readable(entry) {
  const when = entry.timestamp ?? null;
  const message = entry.message && typeof entry.message === "object" ? entry.message : null;
  if (!message) return [];

  // A question, as it was put. This is the only place the spoken question appears,
  // and it arrives carrying the standing briefing in front of it, which is noise on a
  // screen — so it is marked as background rather than hidden, because hiding it is
  // how a screen quietly stops matching what actually happened.
  if (entry.type === "user" && typeof message.content === "string") {
    return [{ kind: "asked", when, text: message.content, background: Boolean(entry.isMeta) }];
  }

  const blocks = Array.isArray(message.content) ? message.content : [];
  const out = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "text") {
      const text = String(block.text ?? "").trim();
      if (!text) continue;
      // Text on the way in is something put to Claude that nobody said out loud —
      // a skill being loaded, a reminder. Same treatment as the briefing.
      out.push(
        entry.type === "assistant"
          ? { kind: "said", when, text }
          : { kind: "asked", when, text, background: true },
      );
    } else if (block.type === "thinking") {
      const text = String(block.thinking ?? "").trim();
      // Usually empty: reasoning is not handed back unless it is asked for. An empty
      // one is not worth a line on a screen, but the fact it was thinking is, so it
      // becomes a marker with nothing in it rather than nothing at all.
      out.push({ kind: "thought", when, text });
    } else if (block.type === "tool_use") {
      out.push({
        kind: "step",
        when,
        name: String(block.name ?? "something"),
        // Tools say in their own words what a step was for. That sentence is the
        // single most useful thing on the screen, so it is lifted out of the rest.
        why: typeof block.input?.description === "string" ? block.input.description : null,
        detail: block.input ?? {},
        id: block.id ?? null,
      });
    } else if (block.type === "tool_result") {
      const full = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
      const kept = full.slice(0, RESULT_LIMIT);
      out.push({
        kind: "result",
        when,
        text: kept,
        dropped: Math.max(0, full.length - kept.length),
        failed: Boolean(block.is_error),
        forStep: block.tool_use_id ?? null,
      });
    }
  }

  return out;
}

/**
 * Everything that has happened since a given place.
 *
 * Never advances past a half-written line: the file is being appended to while this
 * reads it, so the last line can be a fragment, and treating a fragment as an entry
 * is how a viewer shows something that was never true. The place returned is always
 * the end of the last complete line.
 */
export function since(project, place = null) {
  const conversation = recall(project)?.id ?? null;
  if (!conversation) return { conversation: null, happenings: [], place: null, waiting: "nothing has been said here yet" };

  const asked = readPlace(place);
  const file = fileFor(project, conversation);
  if (!file) {
    return { conversation, happenings: [], place: placeOf(conversation, 0), waiting: "the conversation has not been written down yet" };
  }

  // A different conversation than the reader was in means starting again from the
  // top of the new one, and saying so. Silently continuing would be the same lie as
  // counting bytes into the wrong file.
  const changed = asked.conversation !== null && asked.conversation !== conversation;
  let from = changed || asked.conversation === null ? 0 : asked.at;

  const size = fs.statSync(file).size;
  // Shorter than where the reader was is a file that has been rewritten underneath
  // them. There is no honest way to carry on, so it starts again and says so.
  const rewound = from > size;
  if (rewound) from = 0;

  const handle = fs.openSync(file, "r");
  let raw = "";
  try {
    const buffer = Buffer.alloc(Math.max(0, size - from));
    if (buffer.length) fs.readSync(handle, buffer, 0, buffer.length, from);
    raw = buffer.toString("utf8");
  } finally {
    fs.closeSync(handle);
  }

  const lastBreak = raw.lastIndexOf("\n");
  const complete = lastBreak < 0 ? "" : raw.slice(0, lastBreak + 1);
  const now = from + Buffer.byteLength(complete, "utf8");

  const happenings = [];
  // The app's own checking, and everything it caused, left out of what a person reads.
  //
  // It asks each conversation now and again whether anything is still running, which is
  // the only way to know about work on another machine. But it is a question nobody
  // asked, and on the screen it looked exactly like one somebody had — so the record of
  // a real conversation was broken up every couple of minutes by a question the person
  // never put and an answer they did not want. The result belongs on the panel that
  // shows what is running, and nowhere else.
  // Looked for anywhere in the question, not at the start of it. Every question carries
  // a line in front saying which project it is on, so anchoring this to the beginning
  // matched nothing — the question itself was hidden for another reason entirely, and
  // everything it caused went on showing.
  const OURS = /This is the app checking/;
  // Carried in from where the reader had got to, so an exchange being left out survives
  // the gap between one look and the next.
  let skipping = Boolean(asked.skipping) && !changed && asked.conversation === conversation;
  for (const line of complete.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // one unreadable line is not worth ending the stream over
    }
    for (const happening of readable(entry)) {
      // Skipping starts at our own question and ends at the next real one — everything
      // between belongs to it: what it looked at, and what it said back.
      if (happening.kind === "asked") skipping = OURS.test(String(happening.text ?? ""));
      if (skipping) continue;
      happenings.push(happening);
    }
  }

  return {
    conversation,
    happenings,
    place: placeOf(conversation, now, skipping),
    startedAgain: changed || rewound,
    // Said plainly so a screen can show it rather than pretending the gap was not there.
    note: changed
      ? "this is a new conversation — showing it from the beginning"
      : rewound
        ? "the conversation was rewritten — showing it from the beginning"
        : null,
  };
}
