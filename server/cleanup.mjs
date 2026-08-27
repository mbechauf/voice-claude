// The tidy-up: what the phone heard, written out properly before Claude sees it.
//
// The phone's dictation is free and it never sends your voice anywhere, and the price
// of that is what it hands over — no punctuation, hesitations left in, three sentences
// run together, and any word it had not met before replaced by whatever ordinary word
// sounded nearest. Until now all of that went straight to Claude.
//
// So a small model runs here and rewrites it first. Nothing about it depends on where
// the words came from, which is the point: we do not own the ear, and we do not need
// to. A better ear later slots in ahead of this and changes nothing here.
//
// Two things make it safe to put a model in the middle of somebody's sentence:
//
//   It never has to work. No model, a crash, or too slow, and the raw words go on to
//   Claude exactly as they did before. The tidy-up is an improvement, never a
//   dependency.
//
//   Its answer is checked before it is used. A rewrite that invents a word or loses
//   half the sentence is thrown away and the raw words are used instead. This text
//   becomes an instruction to something that edits real files, so a faithful mess is
//   worth more than a tidy invention.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { EVERY_PROJECT_NAME, WORDS_WE_USE } from "./config.mjs";

import { noteEnded, noteStarted, WITH_THE_APP } from "./running.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const PYTHON = path.join(root, ".cleanup", "bin", "python");
const WORKER = path.join(here, "cleanup", "worker.py");

// Long enough that a slow first sentence still arrives, short enough that nobody in a
// car notices. It normally takes about a third of a second.
const PATIENCE_MS = 3_000;

// The judgement is only worth having while the person is still paused, so it gets far
// less rope than the tidy-up. A late answer about whether he had finished talking is
// an answer about a moment that has gone.
const STILL_TALKING_PATIENCE_MS = 1_200;

export function isInstalled() {
  return fs.existsSync(PYTHON) && fs.existsSync(WORKER);
}

// ------------------------------------------------------------- does it sound the same
//
// The page already knows how to tell "cloud" from "Claude" — by sound rather than by
// spelling — and that same judgement is what decides here whether a word the model
// wrote is a repair of something that was said or an invention. One definition, lifted
// from the page rather than copied, because two copies drift and then the guard is
// judging by rules nobody is using.
//
// If it cannot be found, the guard simply gets stricter: only words actually spoken
// are allowed through. That fails towards the raw sentence, which is the safe side.
const soundOf = (() => {
  try {
    const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
    const found = page.match(/function howItSounds[\s\S]*?\n}/);
    if (!found) return null;
    return new Function(`${found[0]}; return howItSounds;`)();
  } catch {
    return null;
  }
})();

// --------------------------------------------------------------------- the words we use
//
// A tidy-up can only put right a word it has heard of. The generic ones are listed in
// the settings; the rest are taken from whatever project is being worked on, so this
// works the same on a project nobody has thought about yet. Its own top-level files and
// folders are the cheapest honest source of what it is about — a project full of
// changelogs and executors names them there, and so does one full of encoders.
const vocabularyByProject = new Map();

function wordsFor(project) {
  if (vocabularyByProject.has(project)) return vocabularyByProject.get(project);

  const words = new Set(WORDS_WE_USE);
  for (const { said } of EVERY_PROJECT_NAME) if (said.length > 3) words.add(said);

  try {
    for (const entry of fs.readdirSync(project, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      for (const piece of entry.name.replace(/\.[a-z0-9]+$/i, "").split(/[-_. ]+/)) {
        if (piece.length > 3) words.add(piece.toLowerCase());
      }
    }
  } catch {
    // A project folder that isn't there yet is not worth a word to the driver.
  }

  const listed = [...words].slice(0, 80);
  vocabularyByProject.set(project, listed);
  return listed;
}

// -------------------------------------------------------------------------- the guard

// Words a person says while thinking, which the tidy-up is meant to remove. Losing one
// of these is the job; losing anything else is a reason to distrust the whole rewrite.
const HESITATIONS = new Set([
  "um", "umm", "uh", "uhh", "er", "erm", "hmm", "mm", "mmm", "ah", "oh", "eh",
  "like", "so", "well", "yeah", "yep", "okay", "ok", "right", "actually", "basically",
  "literally", "just", "really", "you", "know", "i", "mean", "sort", "kind", "of",
  "a", "the", "is", "was", "it", "that", "and", "to", "my", "in",
]);

const plainWords = (text) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Is this rewrite trustworthy? Returns why not, or nothing at all if it is.
 *
 * Two questions, and they are not the same one. Did it add anything nobody said —
 * which is how a tidy-up quietly changes an instruction. And did it lose anything that
 * carried meaning — which is how a tidy-up quietly drops half a request.
 */
export function whyNotToTrust(heard, repaired, words) {
  if (!repaired) return "nothing came back";

  const before = plainWords(heard);
  const after = plainWords(repaired);
  if (!after.length) return "nothing came back";
  if (after.length > before.length * 1.5 + 3) return "it grew";

  const spoken = new Set(before);
  const spokenSounds = new Set(soundOf ? before.map(soundOf) : []);
  const known = new Set(words.flatMap((entry) => plainWords(entry)));

  // Anything written that was not said has to earn its place: it is the same word
  // spelled differently, or it is a word this person uses and the phone mangled, or
  // it is a number written as a figure. Otherwise it was invented.
  // The apostrophe is written down by a person and left out by a phone, so "that's"
  // and "thats" are the same word arriving twice. A word that only grew or lost a
  // letter or two off the end of one that was said is that, not an invention — but
  // only for words long enough that the ending is the only thing in question.
  // "what" and "that" differ by as little, and they are not the same word at all.
  const anEndingAway = (word) =>
    word.length >= 4 &&
    [...spoken].some(
      (said) =>
        said.length >= 4 &&
        (word.startsWith(said) || said.startsWith(word)) &&
        Math.abs(word.length - said.length) <= 2,
    );

  for (const word of after) {
    if (spoken.has(word)) continue;
    if (/^[0-9$£€%.,:]+$/.test(word)) continue;
    if (soundOf && spokenSounds.has(soundOf(word))) continue;
    if (known.has(word)) continue;
    if (anEndingAway(word)) continue;
    return `it invented "${word}"`;
  }

  // Saying a word more often than it was said is its own kind of invention, and the
  // dangerous kind: asked whether that was a model he had created, the tidy-up wrote
  // back that it was NOT a model he had created — every word of it spoken, one of them
  // used twice. Nothing here needs to repeat a word to write a sentence out properly.
  const howOften = (words) => words.reduce((all, word) => all.set(word, (all.get(word) ?? 0) + 1), new Map());
  const saidHowOften = howOften(before);
  for (const [word, times] of howOften(after)) {
    const spokenTimes = saidHowOften.get(word);
    if (spokenTimes !== undefined && times > spokenTimes) return `it repeated "${word}"`;
  }

  // And what went missing has to be nothing, or hesitation, or a word repeated by
  // accident. A quarter of the sentence disappearing is a rewrite that stopped early.
  const kept = new Set(after);
  const keptSounds = new Set(soundOf ? after.map(soundOf) : []);
  let lost = 0;
  for (const word of new Set(before)) {
    if (kept.has(word) || HESITATIONS.has(word)) continue;
    if (soundOf && keptSounds.has(soundOf(word))) continue;
    lost += 1;
  }
  if (lost > 1 && lost > new Set(before).size * 0.2) return `it lost ${lost} words`;

  return "";
}

// ------------------------------------------------------------------------- the worker

let worker = null;
let ready = null;
let nextId = 1;
const waiting = new Map();

function start() {
  const child = spawn(PYTHON, [WORKER], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Same reason as the voice next door: a run that dies without tidying up should
  // leave something the next startup can find and clear.
  noteStarted({ what: "the dictation tidy-up", pid: child.pid, rule: WITH_THE_APP, recogniseBy: "server/cleanup/worker.py" });

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (message.ready === true) { child.settled?.(true); continue; }
      if (message.ready === false) { child.settled?.(new Error(message.error)); continue; }

      const pending = waiting.get(message.id);
      if (!pending) continue;
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text && !/warn|deprecat|fetching|it\/s/i.test(text)) console.error(`tidy-up: ${text}`);
  });

  child.on("exit", () => {
    noteEnded(child.pid);
    worker = null;
    ready = null;
    for (const pending of waiting.values()) pending.reject(new Error("the tidy-up stopped"));
    waiting.clear();
  });

  return child;
}

function ensureRunning() {
  if (ready) return ready;
  if (!isInstalled()) return Promise.reject(new Error("the tidy-up is not installed"));

  worker = start();
  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the tidy-up took too long to start")), 120_000);
    worker.settled = (result) => {
      clearTimeout(timer);
      if (result === true) resolve(true);
      else reject(result);
    };
    worker.on("error", (err) => { clearTimeout(timer); reject(err); });
  });

  ready.catch(() => { try { worker?.kill(); } catch {} });
  return ready;
}

/** Wake it before the first question, so nobody waits for it mid-drive. */
export function warmUp() {
  if (!isInstalled()) return;
  ensureRunning().catch((err) => console.error(`tidy-up: ${err.message}`));
}

// One question to the model and back, or an honest failure. Everything either job
// needs is here, because the difference between them is which sheet of instructions
// the worker reads — not how the asking works.
function askTheModel(payload, patience, { startAgainIfSlow = true } = {}) {
  const id = nextId++;
  const answer = new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    setTimeout(() => {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      // A wedged worker would cost every later sentence as well, so it goes and a
      // fresh one starts on the next question. But only when the thing that ran out
      // of patience was the tidy-up: the judgement gives up after barely a second and
      // queues behind whatever is already running, so its giving up says nothing about
      // the worker's health and killing on it would take the tidy-up down repeatedly.
      if (startAgainIfSlow) { try { worker?.kill(); } catch {} }
      reject(new Error("too slow"));
    }, patience);
  });

  worker.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
  return answer;
}

/**
 * Has the person stopped, or are they mid-thought? True for still talking, false for
 * finished, and null for no opinion — which is most of the time, and is the answer
 * that changes nothing.
 *
 * The whole question so far goes in, not the last breath, because that is the only
 * thing that can tell a finished sentence in the middle of a list from a finished
 * thought. Said out loud one at a time, "look at the tests" and "also the migrations"
 * are both whole sentences and neither is the end of what he wanted.
 *
 * It is not asked to write an answer. Asked to write one, a model this small says
 * "more" to everything, carried along by the shape of the examples rather than the
 * meaning of the sentence. So it is asked which of the two allowed answers it leant
 * towards and by how much, and only a lean far past the middle counts as an opinion.
 */
// Where the lines are drawn through the model's leaning, and they are nowhere near the
// middle on purpose. Measured on real sentences from the drive log, this model is good
// at recognising a finished thought and poor at recognising an unfinished one: plain
// questions and instructions land near nought, while a list still being built lands
// anywhere between a quarter and three quarters, mixed in with things that were
// perfectly finished. So the middle band means nothing and is treated as no opinion.
//
// The lines are far apart because the two mistakes cost differently. Holding back a
// finished question costs a beat and the send phrase. Waving through half a question
// takes an action against something nobody finished saying.
const SURELY_MORE = 0.9;
const SURELY_DONE = 0.15;

export function whatItMeant(leaning) {
  if (typeof leaning !== "number" || !Number.isFinite(leaning)) return null;
  if (leaning >= SURELY_MORE) return true;
  if (leaning <= SURELY_DONE) return false;
  return null;
}

export async function stillTalking(said) {
  if (!isInstalled() || !said?.trim()) return null;
  try {
    await ensureRunning();
    const { text } = await askTheModel(
      { text: said, job: "still-talking" },
      STILL_TALKING_PATIENCE_MS,
      { startAgainIfSlow: false },
    );
    return whatItMeant(text);
  } catch {
    // Not installed, too slow, crashed. All of them mean the same thing here: decide
    // it the way it was decided before any of this existed.
    return null;
  }
}

// A summary is slower than everything else here and that is fine — it is said once
// every half a minute, not on the way to an answer. But it still has to give up
// eventually, or a wedged summary would keep the driver in silence indefinitely.
const SO_FAR_PATIENCE_MS = 12_000;

/**
 * The account of what happened, with the written-down furniture taken out of it.
 *
 * Told a path, this model reads the path out. Told a line number, it reads that out
 * too. The fix is not to ask it more nicely — it is a small model and it will keep
 * doing it — but to hand it something that has no paths in it at all. What is left is
 * the plain name of the file, which is the only part worth hearing anyway.
 */
export function inPlainWords(account) {
  return String(account ?? "")
    // A path becomes the name at the end of it, without the folders or the kind.
    .replace(/\/?(?:[\w.@-]+\/)+([\w.@-]+)/g, (whole, last) => last.replace(/\.[a-z0-9]+$/i, "").replace(/[-_.]+/g, " "))
    // A bare file name still carries its kind on the end, and that is said aloud too.
    .replace(/\b([\w-]{2,})\.(mjs|js|ts|json|md|py|html|css|sh|yml|yaml|txt)\b/gi, (whole, name) => name.replace(/[-_]+/g, " "))
    // Line numbers hanging off the end of a name are noise wherever they appear.
    .replace(/:\d+(?::\d+)?\b/g, "")
    .trim();
}

/**
 * One spoken sentence about what has been going on, or nothing at all.
 *
 * This is the only place a model is asked to understand rather than to rewrite, and
 * it is asked because nothing else can: the account is forty lines of half-finished
 * evidence and what is wanted is the one thing a passenger would say about it. Where
 * it fails, the caller still has the plain count of steps it had before.
 */
export async function soFar(account, remark = "") {
  // The remark it made, put in front of everything else, because that is the thing
  // most worth explaining — and explaining it is the job. A line like "eleven records
  // still closing together" is true and useless on its own; what makes it mean
  // anything is the work either side of it.
  const together = remark ? `It has just said: ${remark}\n\nWhat it did:\n${account}` : account;
  const plain = inPlainWords(together);
  if (!isInstalled() || !plain) return "";
  try {
    await ensureRunning();
    const { text } = await askTheModel(
      { text: plain, job: "so-far" },
      SO_FAR_PATIENCE_MS,
      { startAgainIfSlow: false },
    );
    return worthSaying(text, plain);
  } catch {
    return "";
  }
}

/**
 * Is this summary fit to be spoken? Returns it tidied, or nothing.
 *
 * A summary that has gone wrong has gone wrong in one of two ways: it has started
 * writing a document, or it has started reading out symbols. Both are worse than the
 * plain count of steps the phone can always fall back on.
 */
// Words that give away a summary about the machinery rather than about the work. The
// account is full of them, so a model with nothing real to say reaches for them.
const MACHINERY = /\b(assistant|the model|agent|bash|grep|command|tool|stdout|exit code|render|node|parameter|argument)\b/i;

// Somebody else's voice. The account is written about "the assistant", and a small
// model copies that framing rather than speaking as itself — "the assistant found
// that…", "the model has decided to…". Whatever follows it may even be true, but it
// is being narrated by a bystander who does not exist, and in a car that is the first
// thing that sounds wrong.
const NARRATED = /^(?:the\s+)?(?:assistant|model|agent|ai)\b/i;

/**
 * Is this worth saying out loud, and is it about anything?
 *
 * `account` is what it was written from. Given it, every number in the sentence has to
 * appear there too — the failure this exists for was a small model stitching together
 * figures from unrelated steps into a confident sentence that was not true of
 * anything: "51 students are the second riskiest, and 52 is the only one that passed".
 * Both numbers were real; the sentence was invented. Anything it says about counts now
 * has to be traceable to something that actually came back.
 */
export function worthSaying(summary, account = null) {
  const first = String(summary ?? "").trim().replace(/^["']|["']$/g, "");
  if (!first) return "";
  // The honest answer when there was nothing to report, and it is asked for on purpose.
  if (/^nothing\b/i.test(first)) return "";
  if (/[`{}<>[\]|#*_]|https?:/.test(first)) return "";
  if (NARRATED.test(first) || MACHINERY.test(first)) return "";
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 40) return "";

  if (account !== null) {
    const digits = (text) => String(text).replace(/[,\s]/g, "");
    const there = digits(account);
    for (const number of first.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
      if (!there.includes(digits(number))) return "";
    }
  }
  return first;
}

/**
 * What they actually said. Always returns something usable, whatever went wrong.
 *
 * The raw words come back untouched if the tidy-up is not installed, fails, takes too
 * long, or hands back something the guard will not have.
 */
export async function cleanUp(heard, { project } = {}) {
  const nothingDoing = { text: heard, changed: false, why: "" };
  if (!isInstalled() || !heard?.trim()) return nothingDoing;

  try {
    await ensureRunning();

    const words = wordsFor(project ?? root);
    const { text, took } = await askTheModel({ text: heard, words }, PATIENCE_MS);

    const why = whyNotToTrust(heard, text, words);
    if (why) return { text: heard, changed: false, why, took };
    if (text.trim() === heard.trim()) return { ...nothingDoing, took };
    return { text: text.trim(), changed: true, why: "", took };
  } catch (err) {
    return { ...nothingDoing, why: err.message };
  }
}
