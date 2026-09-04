// The Mac side. Serves the phone page, mints a short-lived voice credential so the
// real key never leaves this machine, and hands work to Claude.

import http from "node:http";
import https from "node:https";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANSWERS,
  ANSWER_WINDOW_MS,
  GATE,
  LEAST_GAP_BETWEEN_ANNOUNCEMENTS_MS,
  LISTENER,
  MODE,
  OPEN_TIMEOUT_MS,
  PHRASES,
  PAUSE_MS,
  QUIET_BEFORE_ANNOUNCING_MS,
  QUIET_BEFORE_ANNOUNCING_MID_QUESTION_MS,
  READ_OUT_PAGE,
  PORT,
  EVERY_PROJECT_NAME,
  GIVEAWAY_WORDS,
  PROJECTS,
  STARTING_PROJECT,
  SPEAKER,
  SPEAKER_RATE,
  SPEAKER_VOICE,
  VOICE_MODEL,
  VOICE_NAME,
  WHAT_EACH_DOES,
} from "./config.mjs";
import {
  forgetConversation, isBusy, itsOwnWords, startWork, stopWork, whatHasBeenGoingOn, whatHasHappened,
  whereItHadGotTo, whyItStopped,
} from "./claude-bridge.mjs";
import { nowWorkingOn, recall, whereWeWere } from "./conversations.mjs";
import { handOver, handoversRunning, sweepHandovers } from "./remote-control.mjs";
import * as ear from "./ear.mjs";
import { programsItLeftRunning, stillRunning } from "./background.mjs";
import { NUDGE, WHAT_IS_RUNNING, soundsLikeAPromise, whatItSaidIsRunning, worthWaking } from "./promises.mjs";
import * as openSessions from "./session-holder.mjs";
import {
  ACROSS_RESTARTS,
  endEverything,
  sweep,
  whatIsRunning,
  WITH_THE_APP,
} from "./running.mjs";
import { localAddresses, tailnetName, theCertificate } from "./certificate.mjs";
import { since } from "./watching.mjs";
import { isInstalled as macVoiceInstalled, speak, warmUp } from "./speech.mjs";
import {
  cleanUp,
  isInstalled as tidyUpInstalled,
  soFar,
  stillTalking,
  warmUp as warmUpTidyUp,
} from "./cleanup.mjs";

// ------------------------------------------------------------- what we are on
//
// One thing decides where everything happens: which files get changed, what Claude
// can see, and which repository an issue is filed against. It is said out loud and
// repeated back, because a project chosen by mistake does its damage quietly while
// you are watching the road.
// Remembered rather than started fresh, because this app restarts several times an
// hour and every one of those used to put you back on the project the settings begin
// with — silently, in the middle of a drive, after you had said otherwise.
let project = whereWeWere() ?? STARTING_PROJECT;

const nameOf = (dir) =>
  Object.entries(PROJECTS).find(([, p]) => p.at === dir)?.[0] ?? path.basename(dir);

// Claude is told, every time the project changes, that it is the whole world for
// this conversation. The folder it runs in is the real boundary; this is so it does
// not go looking for something helpful in a neighbouring project and change that.
// Takes the project rather than reading the one the car is on, because a question
// typed at a screen is about the project that screen is showing, which is not always
// the same one. Getting this from a variable instead of from the question is what
// sent a typed question into a project nobody was looking at.
const boundary = (at = project) =>
  `You are working on ${nameOf(at)}, at ${at}. ` +
  // Reading and changing are not the same risk, and one rule covering both was too
  // blunt. Wandering into a neighbouring project and altering it is the thing that
  // must not happen; reading a file there to answer a question costs nothing and is
  // often the whole point — these projects describe each other. So the line is drawn
  // where the danger actually is.
  `You may READ anything on this machine, including files in other projects, when it ` +
  `helps you answer. Say plainly which project you read from whenever it was not this ` +
  `one, so nobody has to guess where an answer came from. ` +
  `But everything you CHANGE — files you edit or create, issues you file, commands ` +
  `you run that alter anything — belongs to ${nameOf(at)} and nothing else. If a ` +
  `change is needed in another project, say so and stop rather than making it. ` +
  // Being told the boundary without being told the way through it is what makes it
  // sound broken. Asked to work on another project, it was saying "you would need
  // to start a session in that folder" — which is impossible from a car and, worse,
  // untrue: one spoken sentence does it. A limit that cannot be lifted from where
  // the person is standing is indistinguishable from a fault.
  `That limit can be lifted, and you must say how rather than leaving it as a dead ` +
  `end. The words that lift it are "work on" (or "switch to") followed by the ` +
  `project — "work on ${
    Object.keys(PROJECTS).filter((n) => PROJECTS[n].at !== at)[0] ?? "the other project"
  }", or the name of any other. ` +
  // Saying only "they change project by saying it out loud" is what caused the fault
  // this wording now guards against: a project merely NAMED in passing was read as a
  // switch already made, and twenty minutes of work landed across the boundary. The
  // name on its own does nothing, and the model is not the thing that performs it.
  `The name on its own is not enough — naming a project while talking about it ` +
  `changes nothing. You never perform the switch yourself, and you cannot tell from ` +
  `what was said whether one happened. The app performs it, and every question you ` +
  `are given begins by telling you which project you are on. That line is the only ` +
  `truth about where you are; believe it over anything you inferred. Never announce ` +
  `that the project has changed. ` +
  `So if you are asked to work on something outside this project, do not say it ` +
  `cannot be done and never suggest starting a session somewhere else: say in one ` +
  `sentence the exact words that move it, and carry on where you are until a later ` +
  `question tells you otherwise. The projects are: ${Object.keys(PROJECTS).join(", ")}.` +
  (at === PROJECTS["the voice app"].at
    ? ` You are working on the thing you are being spoken through, so a few things ` +
      `are true here that are not true elsewhere. ` +
      `What the phone decided, moment by moment, is in .voice-claude/trace.log — read ` +
      `it rather than guessing at why something behaved oddly. ` +
      `"npm run check" tells you whether you have broken anything and "npm run score" ` +
      `tells you whether it still understands what people say; both are allowed and ` +
      `both are worth running after a change. ` +
      `A change to this app does not take effect until it starts again. It watches ` +
      `its own files and usually restarts on its own, but do not rely on that and ` +
      `never ask the person to restart it — they are driving and cannot. When you ` +
      `have finished changing something, run "npm run restart" yourself, and say ` +
      `plainly that you have done so. It comes back within a second or two and the ` +
      `phone reloads itself, so nothing is lost.`
    : "");

// The one fact that cannot be stated once and trusted afterwards. The briefing above
// goes out only at the start of a conversation; this rides along with every question,
// so a mistaken belief about where we are can never outlive the next thing said.
const whereYouAre = (at = project) =>
  `You are on ${nameOf(at)}, at ${at}. This line is the truth about where you are, ` +
  `whatever was said before it.`;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

// Only the paid mode needs a paid credential. Demanding one in the free mode would
// be a quiet insistence that you keep an account you are trying not to spend on.
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (MODE === "realtime" && !OPENAI_KEY) {
  console.error("Realtime mode needs OPENAI_API_KEY. Set it, or leave the free mode on.");
  process.exit(1);
}

// The speaking rules only matter when nothing sits between Claude and the speaker.
// In realtime mode the voice model rewrites Claude's answer, and applies its own.
const speakingRules =
  MODE === "realtime" ? "" : fs.readFileSync(path.join(here, "spoken-answer-rules.md"), "utf8");

// Asking for a voice that isn't installed would leave someone in a car listening to
// silence, so say so here and fall back to the phone's own rather than fail later.
const speaker = SPEAKER === "mac" && !macVoiceInstalled() ? "device" : SPEAKER;
if (SPEAKER === "mac" && speaker !== "mac") {
  console.log(`The good voice isn't installed yet — run "npm run voice:install".`);
  console.log(`Falling back to the phone's own voice for now.\n`);
}

// The moment the phone's page was last written. The phone knows the one it is
// running, so the two can be compared and a stale page can say so — half of this
// system runs in the browser, and restarting the Mac side does nothing for it.
const pageStamp = () =>
  fs.statSync(path.join(root, "web", "index.html")).mtime.toISOString().slice(5, 16).replace("T", " ");

// -------------------------------------------------------------- starting again
//
// The app is changed by talking to it now, and a change to its own code means
// nothing until it starts again. There is nobody at the keyboard to do that, so it
// asks: it exits with a code the script outside understands, and that script starts
// it afresh. Exiting rather than reloading in place is the point — a process that
// replaces its own code while running keeps the old version in memory, which is
// exactly the confusion this is meant to end.
const RESTART = 75;

let restarting = false;
let goingDown = false;

/**
 * On the way out, end what this run is responsible for — and nothing more.
 *
 * The whole difference between stopping and restarting lives in this one function.
 * Restarting is this app swapping itself for a newer copy, so anything built to
 * survive that is left alone. Stopping is a person saying they are finished, and then
 * everything goes: the conversation helper too, which is what makes turning it off and
 * on again actually clear something. Until now it cleared nothing, because stopping
 * simply exited and left every process it had ever started behind it.
 *
 * See doc/cleaning-up-after-itself.md.
 */
async function leave({ code, why }) {
  if (goingDown) return;
  goingDown = true;
  const forGood = code !== RESTART;
  console.log(forGood ? `\nstopping — ${why}` : `\n== starting again: ${why}`);

  try {
    if (forGood) {
      // Asked to go rather than killed, so it can close its conversations on the way
      // out. Killing it would orphan every Claude underneath it — the same mess, one
      // level down, and harder to see.
      const went = await openSessions.stop().catch(() => false);
      if (went) console.log("  ended the conversation helper");
    }
    endEverything(forGood ? [WITH_THE_APP, ACROSS_RESTARTS] : [WITH_THE_APP], {
      say: (line) => console.log(line),
    });
  } catch (err) {
    // Never let tidying up stop it going. A stuck exit is worse than a leftover, and
    // the next startup sweeps anyway.
    console.error(`  couldn't finish tidying up: ${err.message}`);
  }
  process.exit(code);
}

// Ctrl-C, or being killed, means a person wants it to stop — so it leaves the way
// the script outside reads as "stay down". Without this, the loop faithfully starts
// it again and the app cannot be stopped at all, which is the obvious way to build
// something that keeps itself alive and the wrong one.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    leave({ code: 0, why: "asked to" });
    // A second one means somebody is impatient, and waiting for a tidy exit they have
    // now asked twice to skip is its own kind of broken.
    process.once(signal, () => process.exit(0));
  });
}

function startAgain(why) {
  if (restarting) return;
  restarting = true;
  broadcast("restarting", why);
  // Let the phone hear about it before the connection dies under it.
  setTimeout(() => leave({ code: RESTART, why }), 250);
}

// Its own code changing underneath it. Only while nothing is running — interrupting
// Claude mid-answer to pick up a change is a poor trade — and only after things have
// been quiet for a moment, because an edit arrives as a flurry of small writes.
function watchOwnCode() {
  if (process.env.VOICE_CLAUDE_WATCH === "off") return;

  let settle = null;
  const changed = (file) => {
    if (!file || restarting) return;
    if (!/\.(mjs|js|html|py)$/.test(file)) return;
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (isBusy()) { settle = setTimeout(() => changed(file), 5_000); return; }
      startAgain(`${file} changed`);
    }, 1_500);
  };

  for (const dir of ["server", "web", "scripts"]) {
    try {
      fs.watch(path.join(root, dir), { recursive: true }, (_, file) => changed(file));
    } catch (err) {
      console.error(`couldn't watch ${dir}: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------- listeners

const listeners = new Set();
const trace = [];

// The log of what the phone decided, written into this app's own folder as well as
// shown here. Over the network it needs a command nobody should be handing out; as
// a file, whatever is working on this app can simply read it. Ignored by version
// control, and it never leaves the machine.
//
// It is added to, never replaced. It used to start empty on every run, which was
// harmless until the app began restarting itself whenever its code changed — and
// then every real sentence anyone had said was being thrown away several times an
// hour. Those sentences are the only honest record of how people actually talk to
// this thing, and they are what any better way of understanding them will be judged
// against. They are worth more than the disk they sit on.
const TRACE_FILE = path.join(root, ".voice-claude", "trace.log");
try {
  fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true });
  fs.appendFileSync(TRACE_FILE, `\n-- started ${new Date().toISOString()}\n`);
} catch (err) {
  console.error(`couldn't open the log: ${err.message}`);
}

// One line in that log. The phone sends most of them, but the Mac decides things too
// now — what it made of a mangled sentence, and when it decided not to trust itself —
// and those belong in the same place, in order, or neither half explains the other.
function note(what, detail) {
  const line = `${new Date().toISOString().slice(11, 19)}  ${what}${detail ? `  ${detail}` : ""}`;
  trace.push(line);
  while (trace.length > 300) trace.shift();
  console.log(`   · ${line}`);
  fs.appendFile(TRACE_FILE, `${line}\n`, () => {});
}

// Everything the phone hears about carries how the question was put, because that is
// what decides whether anything is said out loud. Nothing is hidden from anyone — the
// phone is told about a typed question and simply stays quiet about it — which keeps
// one conversation rather than two channels that have to be kept in step.
function broadcast(kind, text, how = "spoken") {
  const payload = `data: ${JSON.stringify({ kind, text, how })}\n\n`;
  for (const res of listeners) res.write(payload);
}

// ------------------------------------------------- questions, however they arrive

// Typed questions waiting their turn. Only typed ones ever wait: a spoken question
// takes over, exactly as it always has, because the person saying it is in a car and
// has no way of knowing something else was already running.
//
// Waiting is per project. A question waits for the answer being written in ITS OWN
// folder and for nothing else — sitting behind a project you are not even looking at
// is the complaint this queue used to be the cause of rather than the cure for.
const waiting = [];

/**
 * One question, put to the one conversation.
 *
 * Both ways in come through here, and the only thing that differs is a word carried
 * along with everything that comes back — spoken or typed. That word is what decides
 * whether the answer is read out. Keeping it to that is deliberate: two ways of
 * asking that took two different roads would be two conversations before long, and
 * reconciling those is the mess this app has already been through once.
 */
async function put(request, how, { alreadyTidied = false, at = project } = {}) {
  console.log(`\n${how === "typed" ? "⌨" : "→"} ${nameOf(at)}: ${request}`);

  // Repaired here rather than on the phone, and after the gate rather than before
  // it. The phone has to decide what is a command the instant it is said, and it
  // does that by sound; this only has to be right about a finished question, and it
  // can afford a third of a second to be right about the whole of it.
  //
  // Unless the phone already had every piece tidied at the pauses, which is the
  // usual case and the whole point of doing it there: repairing it twice would put
  // the delay back exactly where it was taken out of. Typing is the other case that
  // needs none of it: nothing misheard what you typed.
  const tidied = alreadyTidied
    ? { text: request, changed: false, why: "" }
    : await cleanUp(request, { project: at });
  if (tidied.changed) {
    console.log(`✓ ${tidied.text}`);
    note("tidied up", `"${request}" → "${tidied.text}"`);
    // Send it back so the phone can show what was actually asked. Without this the
    // repair is invisible from the driver's seat, and a repair nobody can see reads
    // exactly like a repair that never happened.
    broadcast("tidied", tidied.text, how);
  } else if (tidied.why) {
    note("kept it as heard", tidied.why);
  }

  startWork(
    tidied.text,
    (kind, text) => {
      console.log(`  ${kind}: ${text.slice(0, 120)}`);
      broadcast(kind, text, how);
      // The moment this one is done, whatever was typed while it ran gets its turn.
      // An answer that undertakes to come back is written down, because nothing else
      // will ever make it happen — see the note on the chasing below.
      if (kind === "final" && soundsLikeAPromise(text)) rememberThePromise(at, text);
      if (kind === "final" || kind === "error") setTimeout(takeTheNextOne, 0);
    },
    {
      briefing: `${speakingRules}\n\n${boundary(at)}`,
      standing: whereYouAre(at),
      project: at,
      // So it knows whether anybody is listening to this one. Two answers can be
      // written at once; only one can be read out loud.
      spoken: how === "spoken",
    },
  );
}

function takeTheNextOne() {
  // Every project whose turn is free, not just the front of the line: one project
  // being busy is no reason for a question about another one to sit there.
  for (let i = 0; i < waiting.length; i += 1) {
    if (isBusy(waiting[i].at)) continue;
    const [next] = waiting.splice(i, 1);
    i -= 1;
    // Carries its own project, so waiting its turn never moves it somewhere else.
    put(next.request, "typed", { alreadyTidied: true, at: next.at }).catch((err) => {
      note("a queued question went wrong", err.message);
    });
  }
}

// Looked at on a clock as well as when an answer finishes, because an answer does not
// always finish. A spoken question takes over the one before it, and stopping kills it
// outright — and neither of those says anything on the way out, by design: nobody in a
// car wants to hear about the answer they just replaced. A question waiting on an
// event that will never arrive waits for ever, which is exactly what happened: typing
// while it was working, then speaking again, stranded what had been typed with nothing
// on any screen to say so.
//
// So the queue is never told when to run. It looks for itself.
setInterval(takeTheNextOne, 1_000).unref();

// A conversation can finish something while nobody is asking it anything — a job left
// running comes back, and it writes a proper report on it to nobody. Waiting for the
// next question to hand that over means somebody waiting on that very job hears
// nothing until they give up and ask, which is the wrong way round entirely.
//
// So it is asked for on a clock, and read out the moment it turns up. The asking is
// empty nearly every time and costs a message over a local socket, which is why it can
// afford to be frequent.
setInterval(async () => {
  if (!openSessions.isInstalled()) return;
  try {
    // Every project, not only the one being stood in. Something finishing where you
    // are would surface the moment you asked anything there; something finishing
    // elsewhere is the one nothing would ever tell you about.
    const everywhere = await openSessions.anythingSaidAnywhere();
    for (const [where, said] of Object.entries(everywhere)) {
      for (const words of said) {
        if (!words?.trim()) continue;
        const whose = where === project ? "" : ` on ${nameOf(where)}`;
        console.log(`  finished while waiting${whose}: ${words.slice(0, 120)}`);
        note("finished while waiting", `${nameOf(where)}: ${words}`);
        broadcast("notice", `That thing you were waiting on${whose} has finished. ${words.slice(0, 900)}`, "spoken");
      }
    }
  } catch {
    // The helper being busy or absent is not worth a word: the next question picks up
    // anything missed, exactly as it did before this existed.
  }
}, 4_000).unref();

// ------------------------------------------------- keeping a promise it cannot keep
//
// "I'll tell you when it finishes" is a promise nothing can keep. A conversation only
// runs when something arrives at it, and the only two things that arrive are a question
// and a notification about a background command it started itself. Waiting on another
// program, on a file, on a machine coming up — none of those wake anything, so the
// promise is not broken so much as never attempted, and the person is left checking by
// hand, which is the one thing the promise was meant to save.
//
// So the app goes and asks. Quietly, on a slow clock, and only about conversations that
// actually undertook something.

const promised = new Map();   // project -> { at, asked, tries }

/**
 * What is still out: things undertaken and not yet come back.
 *
 * Kept in the same place the chasing keeps it, because the two must never disagree —
 * a screen saying something is still running while nothing is chasing it is worse than
 * either on its own.
 */
// What each conversation last said was running, and when it was asked. This is the
// source now: the machine's own view is a cross-check, not the truth, because it cannot
// see another machine at all.
const running = new Map();   // project -> { line, asked }

async function askWhatIsRunning() {
  if (!openSessions.isInstalled() || isBusy()) return;
  const open = await openSessions.whatIsOpen().catch(() => null);
  for (const one of open?.open ?? []) {
    if (one.answering) continue;
    const known = running.get(one.project);
    // Slowly while nothing is known to be going on, and rather less slowly once
    // something is — this costs a real question every time it fires.
    const gap = known?.line ? 120_000 : 300_000;
    if (known && Date.now() - known.asked < gap) continue;
    running.set(one.project, { line: known?.line ?? "", asked: Date.now() });
    try {
      const said = await openSessions.ask({ project: one.project, ask: WHAT_IS_RUNNING }, () => {});
      const line = whatItSaidIsRunning(said);
      const before = running.get(one.project)?.line ?? "";
      running.set(one.project, { line, asked: Date.now() });
      // Said out loud only when it changes. Repeating the same line every couple of
      // minutes is the nagging this was careful to avoid everywhere else.
      if (line && line !== before) {
        broadcast("notice", `On ${nameOf(one.project)}: ${line}`, "spoken");
      } else if (!line && before) {
        broadcast("notice", `${nameOf(one.project)} has finished what it was running.`, "spoken");
      }
    } catch {
      // Busy or absent. Nothing said; it is asked again next time round.
    }
  }
}

setInterval(() => { askWhatIsRunning().catch(() => {}); }, 30_000).unref();

function stillWaitingOn() {
  // One entry per thing running, not one per project. A count of six above a list of
  // three is the kind of arithmetic that makes somebody stop believing the whole panel,
  // and it was caused by counting jobs while listing projects.
  const out = [];
  for (const where of Object.values(PROJECTS).map((one) => one.at)) {
    for (const job of stillRunning(where)) {
      out.push({ project: nameOf(where), what: "a background job", minutes: job.minutes });
    }
    for (const job of programsItLeftRunning(where)) {
      out.push({ project: nameOf(where), what: job.what, minutes: job.minutes });
    }
  }
  for (const [where, state] of promised) {
    const minutes = Math.max(1, Math.round((Date.now() - state.at) / 60_000));
    out.push({ project: nameOf(where), what: "something it promised to come back on", minutes });
  }
  // And what the conversation itself says is running, which is the only thing that can
  // see a machine other than this one.
  for (const [where, state] of running) {
    if (!state.line) continue;
    out.push({ project: nameOf(where), what: state.line, minutes: Math.max(1, Math.round((Date.now() - state.asked) / 60_000)) });
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}


function rememberThePromise(where, said) {
  promised.set(where, { at: Date.now(), asked: 0, tries: 0 });
  console.log(`  noted a promise to come back on ${nameOf(where)}`);
  note("a promise to come back", said.slice(0, 200));
}

// Slow on purpose. This costs a real question every time it fires — tokens, and a turn
// on that conversation — so it sits far enough apart that it can never feel like
// pestering, and gives up rather than chasing something forgotten for an hour.
const CHASE_EVERY_MS = Number(process.env.VOICE_CLAUDE_CHASE_EVERY ?? 120_000);
const GIVE_UP_AFTER = Number(process.env.VOICE_CLAUDE_CHASE_TIMES ?? 20);

async function chaseAPromise() {
  if (!openSessions.isInstalled() || !promised.size) return;
  // Never while anything is being answered. Anything that reads the same conversation
  // as a live answer can take pieces of it, and that has already happened once here —
  // it sounded exactly like the machine being slow.
  if (isBusy()) return;

  for (const [where, state] of promised) {
    if (Date.now() - (state.asked || state.at) < CHASE_EVERY_MS) continue;
    // Nothing to chase while the machine can see the job for itself. Finishing will
    // wake the conversation on its own, and it will say so without being asked — so a
    // question here would only be a question nobody needed, on a conversation that is
    // going to speak anyway. Chasing is for work nothing tracks.
    if (stillRunning(where).length) continue;
    if (state.tries >= GIVE_UP_AFTER) {
      promised.delete(where);
      console.log(`  gave up chasing ${nameOf(where)}`);
      continue;
    }
    state.asked = Date.now();
    state.tries += 1;
    try {
      const said = await openSessions.ask({ project: where, ask: NUDGE }, () => {});
      if (!worthWaking(said)) continue;
      promised.delete(where);
      const whose = where === project ? "" : ` on ${nameOf(where)}`;
      console.log(`  a promise kept${whose}: ${String(said).slice(0, 120)}`);
      note("came back as promised", `${nameOf(where)}: ${said}`);
      broadcast("notice", `${String(said).trim().slice(0, 900)}`, "spoken");
    } catch {
      // Busy, missing, or it would not answer. Nothing is said about any of those: the
      // whole point is that this happens without anybody noticing until there is news.
    }
  }
}

setInterval(() => { chaseAPromise().catch(() => {}); }, 20_000).unref();

// And said out loud now and again, because the whole risk with something running out of
// sight is forgetting it is running. Short — the count and where, nothing else — and
// never over an answer or while anything is being worked out. It is a reminder, not a
// report: what actually happened arrives on its own when it happens.
// Every three minutes, not every one. A reminder about something nobody can hurry is
// worth hearing occasionally and is nagging the moment it is more often than that —
// and the thing it is reminding about now announces itself the moment it finishes.
const REMIND_EVERY_MS = Number(process.env.VOICE_CLAUDE_REMIND_EVERY ?? 180_000);
let remindedAt = 0;

setInterval(() => {
  const out = stillWaitingOn();
  if (!out.length || isBusy()) return;
  if (Date.now() - remindedAt < REMIND_EVERY_MS) return;
  remindedAt = Date.now();
  const where = out.map((one) => {
    const jobs = one.jobs ? `${one.jobs} job${one.jobs === 1 ? "" : "s"} on ` : "";
    return `${jobs}${one.project}, ${one.minutes} minute${one.minutes === 1 ? "" : "s"} now`;
  });
  broadcast(
    "notice",
    out.length === 1
      ? `Still waiting on ${where[0]}.`
      : `Still waiting on ${out.length} things: ${where.join("; and ")}.`,
    "spoken",
  );
}, 15_000).unref();

// ------------------------------------------------------------------ helpers

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * The body as it arrived, unread. Sound, not words — every browser compresses
 * differently, so the page sends plain samples and nothing here interprets them.
 *
 * Capped, because a body with no end to it is the one request that can take a server
 * down without anybody meaning any harm. Ten minutes of speech is far past anything a
 * pause could ever produce.
 */
function readSound(req, most = 20 * 1024 * 1024) {
  return new Promise((resolve) => {
    const pieces = [];
    let size = 0;
    req.on("data", (piece) => {
      size += piece.length;
      if (size > most) { pieces.length = 0; req.destroy(); resolve(null); return; }
      pieces.push(piece);
    });
    req.on("end", () => resolve(pieces.length ? Buffer.concat(pieces) : null));
    req.on("error", () => resolve(null));
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

// A short-lived credential for the browser, so the real key stays here.
async function mintVoiceToken() {
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: VOICE_MODEL,
        audio: { output: { voice: VOICE_NAME } },
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`voice token refused: ${response.status} ${text}`);

  const data = JSON.parse(text);
  // The field has moved around between versions; accept either shape.
  const secret = data.value ?? data.client_secret?.value ?? data.client_secret;
  if (!secret) throw new Error(`no credential in response: ${text}`);
  return secret;
}

// --------------------------------------------------------------- the routes

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");

  // The smallest page that can fail: one button, no app around it. When something is
  // refused in the app and works here, the app is at fault; when it is refused here
  // too, nothing the app does could ever have helped. Guessing between those two from
  // the passenger seat has cost most of a night.
  if (url.pathname === "/microphone") {
    const file = path.join(root, "web", "microphone.html");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(fs.readFileSync(file));
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const file = path.join(root, "web", "index.html");
    const html = fs.readFileSync(file, "utf8");
    // A phone holding on to yesterday's page and a genuine bug look identical from
    // the driver's seat, and one of them wastes an afternoon. So it is never cached,
    // and the page carries the moment it was written so both ends can see which it is.
    const stamp = pageStamp();
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, must-revalidate",
      pragma: "no-cache",
      expires: "0",
    });
    return res.end(html.replace("__VERSION__", stamp));
  }

  if (url.pathname === "/instructions") {
    const text = fs.readFileSync(path.join(here, "voice-instructions.md"), "utf8");
    return send(res, 200, text, "text/plain; charset=utf-8");
  }

  // A screen, watching. Deliberately its own page rather than a corner of the other
  // one: every decision in the driving page follows from being unable to look at it,
  // and a thing built for watching should be built for watching. Nothing here can
  // affect the drive — it only ever reads.
  if (url.pathname === "/watching") {
    const html = fs.readFileSync(path.join(root, "web", "watching.html"), "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, must-revalidate",
    });
    return res.end(html);
  }

  // What has happened since the screen last looked. It says where it had got to and
  // is told everything after that, so two screens and the car never take anything
  // from each other, and one opened halfway through a drive still sees the lot.
  if (url.pathname === "/watching/since") {
    const named = url.searchParams.get("project");
    const where = named ? (PROJECTS[named]?.at ?? named) : project;
    const seen = since(where, url.searchParams.get("place"));
    return send(res, 200, {
      ...seen,
      project: nameOf(where),
      projects: Object.keys(PROJECTS),
      // Which project the car is on, so a screen looking at another one can say so
      // rather than leaving somebody to wonder why nothing is arriving.
      driving: nameOf(project),
      working: isBusy(where),
      // Said so a screen can show a typed question as waiting its turn rather than
      // as ignored. Silence between typing something and it starting reads as broken.
      // Named apart from the "nothing has been said here yet" note above it, because
      // one of them quietly overwriting the other is exactly the kind of fault that
      // shows up as a blank screen and no reason.
      queued: waiting.filter((one) => one.at === where).length,
      // Everything undertaken and not yet come back, whichever project it is on. A
      // screen showing only what is happening here would go quiet while something it
      // started elsewhere was still running, which is exactly how a long job gets
      // forgotten about.
      stillWaiting: stillWaitingOn(),
      // Why the last question here stopped with nothing to show, if it did. Said once
      // and then gone, so it is news rather than a permanent complaint.
      interrupted: whyItStopped(where),
    });
  }

  // The phone asks what it is meant to be before it does anything, so that changing
  // the voice layer is a setting on the Mac and never an edit to the page.
  if (url.pathname === "/setup") {
    return send(res, 200, {
      mode: MODE,
      // The one address with a real certificate on it, so the page can tell whether it
      // was opened by that name or by a number. A phone will not give a page a
      // microphone when it had to be warned about the certificate, and it does not say
      // that is why — it complains about something else entirely.
      trustedName: creds.warns ? "" : (tailnetName() ?? ""),
      listener: LISTENER,
      speaker,
      speakerVoice: SPEAKER_VOICE,
      speakerRate: SPEAKER_RATE,
      page: pageStamp(),
      gate: GATE,
      pause: PAUSE_MS,
      // When it is allowed to say something nobody asked for. The phone is the only
      // thing that knows whether somebody is mid-sentence, so the judgement is made
      // there; these are the numbers it makes it with.
      quietBeforeAnnouncing: QUIET_BEFORE_ANNOUNCING_MS,
      quietBeforeAnnouncingMidQuestion: QUIET_BEFORE_ANNOUNCING_MID_QUESTION_MS,
      leastGapBetweenAnnouncements: LEAST_GAP_BETWEEN_ANNOUNCEMENTS_MS,
      phrases: PHRASES,
      // Who does the hearing. Decided here rather than on the phone, because this is
      // the machine that knows whether the ear is installed at all — and it can change
      // between one drive and the next without the phone being told anything new.
      //
      // Off unless asked for, and that is not caution for its own sake. A half-working
      // ear is worse than the old one in a specific way: it announces its failure on
      // every page load, in red, to somebody driving who cannot do anything about it.
      // Until it starts reliably it stays behind a switch, so trying it is a decision
      // somebody makes while parked rather than something that happens to them.
      earOnTheMac: ear.isInstalled() && process.env.VOICE_CLAUDE_EAR === "on",
      whatEachDoes: WHAT_EACH_DOES,
      answers: ANSWERS,
      answerWindow: ANSWER_WINDOW_MS,
      readOutPage: READ_OUT_PAGE,
      openTimeout: OPEN_TIMEOUT_MS,
      project: nameOf(project),
      projects: Object.keys(PROJECTS),
      // Every name each answers to, longest first, so the phone can pick a project
      // out of the front of a sentence and leave the rest as the question.
      projectNames: EVERY_PROJECT_NAME,
      // The word that gives each project away, for when the spoken name comes back
      // mangled — "the clot voice app" is still plainly the voice one.
      giveaways: GIVEAWAY_WORDS,
    });
  }

  // One sentence in, the sound of it out. The phone asks for these one at a time as
  // it reads an answer, so that "stop" lands within a breath.
  if (url.pathname === "/say" && req.method === "POST") {
    const { text } = await readBody(req);
    if (!text) return send(res, 400, { error: "nothing to say" });
    try {
      const audio = await speak(text);
      res.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": audio.length,
        "cache-control": "no-store",
      });
      return res.end(audio);
    } catch (err) {
      console.error(`voice: ${err.message}`);
      return send(res, 503, { error: String(err.message ?? err) });
    }
  }

  if (url.pathname === "/token" && req.method === "POST") {
    if (MODE !== "realtime") {
      return send(res, 409, { error: "this server is running the free voice mode" });
    }
    try {
      // A fresh start wipes the slate; a reconnect after a dropped signal must not,
      // or a tunnel would cost you everything Claude had established.
      if (url.searchParams.get("resume") !== "1") forgetConversation(project);
      return send(res, 200, { secret: await mintVoiceToken(), model: VOICE_MODEL });
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: String(err.message ?? err) });
    }
  }

  // One piece of a sentence, tidied while the person is still talking. The phone asks
  // for this at every pause, so by the time it is sent almost everything has already
  // been through here and the only wait left is the tail end of the last breath.
  if (url.pathname === "/tidy" && req.method === "POST") {
    const { heard } = await readBody(req);
    if (!heard) return send(res, 400, { error: "nothing to tidy" });
    const tidied = await cleanUp(heard, { project });
    if (tidied.changed) note("tidied up a piece", `"${heard}" → "${tidied.text}"`);
    else if (tidied.why) note("kept a piece as heard", tidied.why);
    return send(res, 200, { text: tidied.text, changed: tidied.changed, why: tidied.why ?? "" });
  }

  // A piece of speech, heard here rather than on the phone. The sound arrives as plain
  // samples and leaves as words; nothing is kept.
  //
  // The phone cannot reach the ear itself, and that is deliberate: the ear listens only
  // to this machine, and the app is the one door that is already locked and already
  // knows who is on the other side of it.
  if (url.pathname === "/heard" && req.method === "POST") {
    const sound = await readSound(req);
    if (!sound) return send(res, 400, { error: "no sound" });
    const words = await ear.hear(sound);
    // Nothing heard is not a failure. A cough, a lorry going past, or a false start
    // all come to this, and the page treats it as nothing said.
    if (words) note("heard", words);
    return send(res, 200, { text: words });
  }

  // Asked at a pause: has he stopped, or is he mid-thought? The phone can already see
  // whether the words end in a whole sentence; what it cannot see is a whole sentence
  // that is the third item of a list still being built. This is the only thing here
  // that reads the question so far rather than the piece just said.
  if (url.pathname === "/still-talking" && req.method === "POST") {
    const { said } = await readBody(req);
    if (!said) return send(res, 400, { error: "nothing said" });
    const more = await stillTalking(said);
    if (more !== null) note("the pause", more ? "sounds like more is coming" : "sounds finished");
    return send(res, 200, { more });
  }

  // What has been going on, asked for while the answer is still being worked out. The
  // account is emptied by the asking, so nothing is announced twice and each summary
  // covers exactly the stretch since the last one.
  if (url.pathname === "/so-far" && req.method === "POST") {
    let notes = whatHasHappened(project);
    // Nothing new since last time does not mean nothing is happening — it usually means
    // something long is running and there has been nothing to report for a while. Saying
    // where it had got to beats saying nothing, and nothing is what somebody in a car
    // hears as the app having died.
    if (!notes.length) notes = whereItHadGotTo(project);
    if (!notes.length) return send(res, 200, { summary: "" });
    // Its own words when they carry their own context, and a summary when they do not.
    //
    // Several plain sentences about what has just been worked out explain themselves
    // and are the best thing said on a whole drive — those go out as written. A single
    // line does not: "eleven records still closing together" is true, and from the
    // driver's seat it is a riddle, because everything that would make sense of it —
    // what was being looked at, what came back, what it means — is in the work around
    // it rather than in the line.
    //
    // So a lone remark is handed to the summary along with everything else that has
    // happened since the last one, and what comes back is used if it is any good. The
    // remark itself is the fallback, which is no worse than today.
    const own = itsOwnWords(notes);
    const explainsItself = own.split(/(?<=[.?!])\s+/).filter(Boolean).length > 1;
    // The steps as they happened, which is what the screen shows and what reads best.
    // A written summary is only reached for when there are no steps to tell — a small
    // model asked to make sense of the machinery gets it wrong, confidently, and a
    // wrong account of what is going on is worse than a plain one.
    const asItHappened = whatHasBeenGoingOn(notes);
    const summary = explainsItself
      ? own
      : (asItHappened
          ? (own ? `${own} ${asItHappened}` : asItHappened)
          : ((await soFar(notes.join("\n"), own)) || own));
    if (summary) note("what has been going on", summary);
    return send(res, 200, { summary, steps: notes.length });
  }

  // Carry this on somewhere with a screen. Answered here rather than by Claude,
  // because Claude is the thing being handed over.
  if (url.pathname === "/remote-control" && req.method === "POST") {
    const result = handOver(project);
    note("remote control", result.say);
    console.log(`  remote control: ${result.say}`);
    return send(res, 200, result);
  }

  if (url.pathname === "/ask" && req.method === "POST") {
    const { request, alreadyTidied } = await readBody(req);
    if (!request) return send(res, 400, { error: "no request" });
    await put(request, "spoken", { alreadyTidied });
    return send(res, 202, { started: true });
  }

  // A question typed at a screen. The same conversation, the same everything — the
  // only difference is that nothing is said out loud, because somebody typing is
  // looking at a screen and a voice starting up at whoever else is in the room is
  // simply wrong.
  if (url.pathname === "/typed" && req.method === "POST") {
    const { request, project: named } = await readBody(req);
    if (!request?.trim()) return send(res, 400, { error: "nothing to ask" });

    // The screen says which project it is showing, and the question goes there — not
    // to wherever the car happens to be. Reading it from the car instead is what sent
    // a typed question into a project nobody was looking at: it ran, it answered, and
    // it did all of it somewhere the person typing could not see. A screen that shows
    // one project and types into another is worse than one that cannot type at all.
    const at = named && PROJECTS[named] ? PROJECTS[named].at : project;

    // Never over the top of an answer somebody is waiting on. Interrupting already
    // has a way to be asked for, out loud; a sentence typed in another room killing
    // a drive's answer would be a nasty surprise with no explanation attached.
    if (isBusy(at)) {
      waiting.push({ request: request.trim(), at });
      note("typed, queued", `${nameOf(at)}: ${request.trim().slice(0, 70)}`);
      return send(res, 202, {
        queued: waiting.filter((one) => one.at === at).length,
        project: nameOf(at),
      });
    }

    await put(request.trim(), "typed", { alreadyTidied: true, at });
    return send(res, 202, { started: true, project: nameOf(at) });
  }

  if (url.pathname === "/never-mind" && req.method === "POST") {
    const dropped = waiting.length;
    waiting.length = 0;
    return send(res, 200, { dropped });
  }

  // What the phone is actually doing, said out loud on the Mac. Dictation goes wrong
  // in ways you cannot see from the driver's seat, and guessing from a description
  // of the symptom wastes drives.
  if (url.pathname === "/trace" && req.method === "POST") {
    const { what, detail } = await readBody(req);
    note(what, detail);
    return send(res, 204, "");
  }

  if (url.pathname === "/trace") {
    return send(res, 200, trace.join("\n") || "nothing yet", "text/plain; charset=utf-8");
  }

  // Change what we are working on. Everything after this happens there.
  if (url.pathname === "/project" && req.method === "POST") {
    const { name } = await readBody(req);
    const known = Object.keys(PROJECTS);
    const wanted = String(name ?? "").toLowerCase().trim().replace(/^(the|my)\s+/, "");

    // Longest name first, so "the voice claude app" is not read as "the voice".
    const match =
      EVERY_PROJECT_NAME.find(({ said }) => said.replace(/^(the|my)\s+/, "") === wanted)?.name ??
      // Failing that, the giveaway word: whatever dictation did to the rest of it,
      // "voice" belongs to exactly one project.
      Object.entries(GIVEAWAY_WORDS).find(([, words]) =>
        words.some((word) => wanted.split(/\s+/).includes(word)),
      )?.[0];

    if (!match) {
      return send(res, 404, { error: `I don't know ${name}`, projects: known });
    }

    project = PROJECTS[match].at;
    nowWorkingOn(project);
    // Each project keeps its own conversation, so switching neither carries the old
    // one across — which would answer about the wrong code with total confidence —
    // nor throws it away. Come back later and the work you left here is still here.
    const waiting = recall(project);
    note("now working on", `${match}${waiting ? " — picking its conversation back up" : ""}`);
    console.log(`\n== now working on ${match} — ${project}`);
    return send(res, 200, { project: match, at: project });
  }

  if (url.pathname === "/project") {
    return send(res, 200, { project: nameOf(project), at: project, projects: Object.keys(PROJECTS) });
  }

  // One honest answer to "what have you got running, and why".
  //
  // This exists because none of it was discoverable. The only way to find out was to
  // read the machine's process list by hand, which is precisely why a handed-over
  // session sat orphaned for six hours and an abandoned conversation for two, with
  // nobody any the wiser. Anything long-lived should be answerable for.
  if (url.pathname === "/running") {
    const open = await openSessions.whatIsOpen().catch(() => null);
    return send(res, 200, {
      started: whatIsRunning(),
      // Asked of the helper rather than assumed, because the conversations live inside
      // it and this app genuinely does not know them otherwise.
      conversations: open?.open ?? [],
      handedOver: handoversRunning(),
      // Which projects, rather than whether: there can be more than one now, and a
      // bare yes never said where.
      answering: Object.values(PROJECTS).filter((one) => isBusy(one.at)).map((one) => nameOf(one.at)),
      queued: waiting.length,
    });
  }

  // Asked for out loud, or by whatever just changed the code.
  if (url.pathname === "/restart" && req.method === "POST") {
    const { why } = await readBody(req);
    send(res, 200, { restarting: true });
    startAgain(why || "asked to");
    return;
  }

  // Start the drive over. In realtime mode this happens as a side effect of asking
  // for a fresh credential; in split mode there is no credential, so it is its own
  // request.
  if (url.pathname === "/new" && req.method === "POST") {
    forgetConversation(project);
    console.log("  starting a fresh conversation");
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/stop" && req.method === "POST") {
    const stopped = stopWork(project);
    console.log(stopped ? "  stopped" : "  nothing to stop");
    return send(res, 200, { stopped });
  }

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    res.write("retry: 2000\n\n");
    listeners.add(res);
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(keepAlive);
      listeners.delete(res);
    });
    return;
  }

  return send(res, 404, { error: "not found" });
}

// ------------------------------------------------- certificate (for the mic)

// Phones will not give a web page the microphone unless the connection is secure, so
// we serve over HTTPS. Which certificate that is — a real one Tailscale issued, or one
// this machine signs for itself — is decided next door, along with the reason. All that
// matters here is that it covers every name and address this Mac answers to, because
// the one it is opened by is not this end's choice to make.
//
// What it has to say is kept rather than printed, so it lands with the rest of the
// banner instead of ahead of the line that says what this even is.
const aboutTheCertificate = [];
const creds = theCertificate({ dir: path.join(root, ".cert"), say: (line) => aboutTheCertificate.push(line) });

// ------------------------------------------------------------------- listen

const secureServer = https.createServer(creds, (req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    send(res, 500, { error: String(err.message ?? err) });
  });
});

// Phones only grant the microphone over a secure connection, so this is HTTPS
// only — which means typing the address without the "https://" prefix fails with
// a bare "can't reach it". Rather than leave that trap, we watch the first byte
// of each connection: a secure one starts with 0x16, anything else is someone
// typing the plain address, and gets pointed at the secure one instead.
const plainRedirect = http.createServer((req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  res.writeHead(301, { location: `https://${host}:${PORT}${req.url}` });
  res.end();
});

const server = net.createServer((socket) => {
  socket.once("readable", () => {
    const first = socket.read(1);
    if (!first) return socket.destroy();
    socket.unshift(first); // put it back so the real server sees the whole thing
    (first[0] === 0x16 ? secureServer : plainRedirect).emit("connection", socket);
  });
  socket.on("error", () => socket.destroy());
});

server.listen(PORT, () => {
  console.log(`\nvoice-claude is up.`);

  // Before anything new is started, clear what the last run left behind. A run that
  // crashed never got to tidy up, and without this its leftovers simply stack up under
  // the new ones — which is how a machine ends up carrying hours-old processes nobody
  // remembers starting. Startup is the only moment where "everything still running was
  // left by somebody else" is reliably true, so it is the right place to look.
  // And the one leftover that is not a process at all: a conversation helper still
  // running yesterday's copy of its own code. It outlives this app on purpose, so it
  // is the one thing a restart does not put right, and it has to be asked about
  // rather than assumed.
  openSessions.freshenIfStale()
    .then((did) => {
      if (did) console.log("  restarted the conversation helper — it was running older code");
      else if (openSessions.runningOldCode()) console.log("  the conversation helper is running OLDER CODE and would not restart");
    })
    .catch(() => {});

  const cleared = sweep({ say: (line) => console.log(line) });
  const handovers = sweepHandovers({ say: (line) => console.log(line) });
  if (cleared.swept.length || handovers.length) console.log("");

  console.log(`Working on:  ${nameOf(project)} — ${project}`);
  if (MODE === "realtime") {
    console.log(`Voice:       ${VOICE_MODEL} (${VOICE_NAME})`);
    console.log(`Cost:        billed per minute of audio, both directions.`);
  } else {
    const mouth = speaker === "mac" ? `this Mac, ${SPEAKER_VOICE}` : "the phone's own voice";
    const tidying = tidyUpInstalled()
      ? "a small model on this Mac"
      : `not installed — run "npm run cleanup:install"`;
    console.log(`Hearing:     ${ear.isInstalled() ? "this Mac's own ear, with the phone's dictation to fall back on" : "the phone's own dictation"}`);
    console.log(`Tidying up:  ${tidying}`);
    console.log(`Speaking:    ${mouth}`);
    console.log(`Cost:        nothing beyond the Claude subscription.`);
    // Loading these takes a few seconds. Do it now, not when someone is waiting.
    if (speaker === "mac") warmUp();
    warmUpTidyUp();
    // The model takes a few seconds to load. Paid now, while nobody is waiting, rather
    // than by the first thing said on the first drive.
    ear.warmUp();
  }
  for (const line of aboutTheCertificate) console.log(line);

  // The full Tailscale name goes first when there is one, and not out of neatness: it
  // is the only address here that survives changing network, and — when the
  // certificate came from Tailscale — the only one the phone accepts without a word.
  // An IP address is never in a real certificate and never can be, so offering both
  // with nothing to choose between them is how somebody ends up on the warning again.
  const full = tailnetName();
  console.log(`\nOpen this on the phone:`);
  if (full) console.log(`   https://${full}:${PORT}${creds.warns ? "" : "   ← no warning"}`);
  for (const address of localAddresses()) {
    console.log(`   https://${address}:${PORT}${full && !creds.warns ? "   (warns — the certificate is for the name)" : ""}`);
  }
  // Said here rather than linked from the driving page, because the driving page is
  // used by somebody who cannot look at it, and a link nobody can press is clutter.
  console.log(`\nTo watch the work on a screen, add /watching to that address.`);
  if (creds.warns) {
    console.log(`\nSafari will warn about the certificate the first time. Accept it.`);
    // Only said to somebody who is being warned, and only once there is a tailnet to
    // say it about: it is the whole of the fix, and it is a switch in a web console
    // rather than anything to change here.
    if (full) {
      console.log(`To stop it for good: switch HTTPS on for your tailnet in the admin`);
      console.log(`console, then start this again — it fetches a real certificate itself.`);
    }
  }
  console.log("");
  watchOwnCode();
});
