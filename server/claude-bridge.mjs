// Runs Claude Code against the real project and reports what it is doing as it
// goes, so the voice has something honest to say during the long pauses.

import { spawn } from "node:child_process";
import { NEVER, ONLY_THESE, STARTING_PROJECT, WORK_TIMEOUT_MS } from "./config.mjs";
import { forget, gapPhrase, recall, remember } from "./conversations.mjs";
import { takeBackOver, whereItGotTo } from "./remote-control.mjs";
import * as openSessions from "./session-holder.mjs";

/**
 * The plain-English name of a file, from its path. "the tidy-up worker" out of a
 * folder-and-extension mouthful, or nothing at all if it will not read aloud.
 *
 * A path said out loud is noise, but the name at the end of it is usually the most
 * informative word available — the difference between "changing the code" and
 * "changing the conversations file", which is the whole point of saying anything.
 */
function plainFileName(where) {
  const last = String(where ?? "").split("/").pop() ?? "";
  const withoutKind = last.replace(/\.[a-z0-9]+$/i, "");
  const words = withoutKind.replace(/[-_.]+/g, " ").trim();
  // Anything still carrying punctuation, or a bare letter, is not worth saying.
  if (!words || words.length > 40 || /[^a-z0-9 ]/i.test(words)) return "";
  return words;
}

/**
 * What it is doing, said the way you would say it to someone in the passenger seat.
 *
 * The name of the step on its own — "reading the code", over and over — tells you
 * only that something is happening, which is what the silence already told you. But
 * every step arrives with its own details attached: which file, what it searched
 * for, and for anything run at the command line a plain sentence describing the
 * point of it. That is what gets said.
 *
 * Details are used only when they will read aloud cleanly. A path, a pattern full of
 * punctuation, a name that is really a jumble of letters — those fall back to the
 * vague phrase, because vague is better than gibberish at seventy miles an hour.
 */
export function describeTool(name, input = {}) {
  const named = (verb, where, otherwise) => {
    const what = plainFileName(where);
    return what ? `${verb} ${what}` : otherwise;
  };

  switch (name) {
    case "Read":
      return named("reading", input.file_path, "reading the code");
    case "Edit":
    case "Write":
    case "NotebookEdit":
      // The file, but never what changed: what it actually did belongs in the answer
      // at the end, where it can be said properly rather than in fragments.
      return named("changing", input.file_path, "changing the code");
    case "Grep": {
      const looking = String(input.pattern ?? "").trim();
      // A search is only worth naming when it is a word rather than a thicket of
      // symbols, which is most of the time and never when it is not.
      if (looking && looking.length < 30 && /^[a-z0-9 _-]+$/i.test(looking)) {
        return `searching for ${looking}`;
      }
      return "searching through the project";
    }
    case "Glob":
      return "looking for the right files";
    case "Bash":
      // Every command comes with a plain sentence saying what it is for, written for
      // exactly this — so it is said instead of a guess about what the command does.
      return String(input.description ?? "").trim() || "running a command";
    case "WebSearch":
      return input.query ? `looking up ${String(input.query).slice(0, 60)}` : "looking something up";
    case "WebFetch":
      return "reading something on the web";
    case "Task":
      return String(input.description ?? "").trim()
        ? `handing over: ${String(input.description).trim()}`
        : "handing part of this to a helper";
    case "TodoWrite":
      return "sorting out what to do next";
    default:
      return "working";
  }
}

// A running account of the job, kept for whoever asks next. Held to a sane length
// because a driver is told about the last half minute, not the last half hour, and a
// list that only grows would eventually be too big to summarise at all.
const MOST_NOTES = 60;

// The head and the tail of what a step came back with: a command says what it is
// doing at the top and how it went at the bottom, and the middle is almost always the
// boring part. Shared, because both roads to Claude write the same record.
export function trimmedResult(body) {
  const lines = String(body ?? "").trim().split("\n").filter((l) => l.trim());
  if (!lines.length) return "";
  const worth = lines.length > 6
    ? [...lines.slice(0, 3), `… ${lines.length - 6} more lines …`, ...lines.slice(-3)]
    : lines;
  return worth.join(" / ").slice(0, 500);
}

function noteDown(job, line) {
  if (!job) return;
  job.notes.push(line);
  if (job.notes.length > MOST_NOTES) job.notes.splice(0, job.notes.length - MOST_NOTES);
}

/**
 * Everything that has happened since the last time anybody asked, and emptied by the
 * asking. Whoever is going to say it out loud takes it, so two askers cannot both be
 * told the same thing and the same news cannot be announced twice.
 */
export function whatHasHappened(project) {
  const job = answering.get(project);
  if (!job) return [];
  const taken = job.notes;
  job.notes = [];
  return taken;
}

/**
 * The one sentence of what Claude just said that is worth saying out loud mid-job,
 * or nothing at all.
 *
 * What comes through here is a mix: a line about what it is off to do next, which is
 * gold, and stretches of the answer itself being written out, which is not — the
 * answer gets spoken properly when it is finished, and hearing half of it early is
 * confusing rather than early.
 *
 * So: the first sentence only, and only when it is short. A long block is the answer
 * being written, not a word about what is happening. Anything with the furniture of
 * written work in it — a path, a bracket, a heading — is skipped rather than cleaned
 * up, because at a pause it is better to say nothing than to read punctuation aloud.
 */
/**
 * The last thing it said in its own words, out of the account of what has happened.
 *
 * This is where the good ones always came from. Everything readable that has ever been
 * announced mid-job was a sentence Claude had already written in plain English — "the
 * smoke test works, but about a fifth of replacements still slip, so I'll loop". The
 * gibberish came from the other half of the account: tool names, arguments, and raw
 * results, handed to a small model with instructions not to mention any of it. Told to
 * describe machinery without naming machinery, it stitched unrelated numbers into
 * confident sentences that were not true of anything.
 *
 * So its own words are used when there are any, and nothing is asked of any model. The
 * summariser is now only for the case it is actually needed for: a long stretch of
 * silent work with nothing said during it.
 */
export function itsOwnWords(notes) {
  for (const line of [...(notes ?? [])].reverse()) {
    if (!String(line).startsWith("Said: ")) continue;
    const whole = String(line).slice("Said: ".length).trim();
    // Only something that was a remark in the first place. A long passage is an answer
    // being written, not a note about progress, and taking one sentence out of the
    // middle of an answer and reading it aloud is worse than saying nothing at all:
    // out of its paragraph it means something else, or nothing.
    //
    // That is exactly what went wrong. A careful correction was written, several
    // sentences long, and what was read out was its last line — "bringing a box up and
    // asking it properly now" — with none of the correction it belonged to. The answer
    // itself arrived later and read fine on the screen. From the driver's seat it
    // sounded like the machine talking nonsense to itself between questions.
    if (whole.split(/(?<=[.?!])\s+/).filter(Boolean).length > 1) continue;
    const said = anUpdateWorthHearing(whole);
    if (said) return said;
  }
  return "";
}

export function anUpdateWorthHearing(text) {
  const whole = String(text ?? "").trim();
  if (!whole) return "";
  // Written-down things, not spoken ones. A driver gets nothing from any of them.
  if (/[`{}<>[\]|#*]|\/\w|\.\w{2,4}\b/.test(whole)) return "";

  const first = whole.split(/(?<=[.?!])\s+/)[0]?.trim() ?? "";
  if (!first) return "";
  const words = first.split(/\s+/).length;
  // Under three words is not a sentence about anything. Over about twenty and it has
  // stopped reporting and started explaining, which is what the answer is for.
  if (words < 3 || words > 20) return "";
  // A question mid-job would open the yes-or-no window against a thing that is still
  // running, and the answer would land nowhere.
  if (first.endsWith("?")) return "";
  return first;
}

// Did it fail because the conversation we asked to continue is gone, or because
// something else went wrong? Only the first is worth quietly retrying — retrying the
// second would just do the same broken thing twice.
export function lostTheConversation(stderr = "") {
  const said = stderr.toLowerCase();
  return (
    said.includes("no conversation found") ||
    said.includes("session not found") ||
    said.includes("no such session") ||
    (said.includes("resume") && (said.includes("not found") || said.includes("could not")))
  );
}

// What is being answered right now — one job per project, never one for the whole
// machine.
//
// It used to be a single slot with nothing written on it: no note of whose question
// it was. That is the whole of why a question about one project stood in the way of
// every other one. A typed question waited behind an answer it had nothing to do
// with, and a spoken question took the slot from whatever was running even when that
// was a different folder. The conversations themselves were never shared — the helper
// has kept one per project all along — so being busy was the only thing that ever was.
//
// Two questions on the SAME project still take turns. That is not decided here but
// where the conversation actually lives, in the helper, because that is the only
// place that can see both of them at once.
const answering = new Map();          // project folder -> the job answering there

function nowAnswering(project, job, spoken) {
  job.project = project;
  job.spoken = spoken;
  answering.set(project, job);
}

/**
 * End anything being answered OUT LOUD somewhere else.
 *
 * Two answers can now be written at the same time, but only one can be read out:
 * there is one car and one person in it. So asking out loud ends any spoken answer
 * still running on another project — which is what switching project mid-answer used
 * to do to absolutely everything, and is right for exactly this one case. Typed work
 * elsewhere is left alone, because nobody is listening to it.
 */
// Why a question stopped without an answer, kept until whoever was waiting has been
// told. A screen that simply goes quiet is indistinguishable from one that is broken,
// and the person who typed the question is not in the car and cannot hear what
// happened instead.
const interrupted = new Map();        // project folder -> one sentence

/** Said once, then forgotten: told twice, it reads as it happening twice. */
export function whyItStopped(project) {
  const said = interrupted.get(project) ?? "";
  interrupted.delete(project);
  return said;
}

function stopSpeakingElsewhere(project) {
  for (const [where, job] of answering) {
    if (where !== project && job.spoken) stopWork(where);
  }
}

// Cleared only if it is still the job that is there. One that was replaced must not
// wipe the record belonging to the one that replaced it — that is how a project ends
// up looking idle while it is still working.
function noLonger(job) {
  if (job && answering.get(job.project) === job) answering.delete(job.project);
}

// The conversation Claude is having with us, carried across questions so that
// "explain that" and "next" mean something, and so the project context is loaded
// once rather than paid for again on every single question.
//
// It is kept on disk, one per project, rather than in a variable here — see the note
// in the file that keeps it. A variable dies with the app, and this app restarts
// several times an hour.

/**
 * Is a question being answered? On one project when told which, anywhere at all when
 * not — and "anywhere" is only ever the right question for something that affects the
 * whole machine, such as restarting the app out from under somebody mid-answer.
 */
export function isBusy(project) {
  return project === undefined ? answering.size > 0 : answering.has(project);
}

/** Start over on purpose. This project only; the others keep what they had. */
export function forgetConversation(project = STARTING_PROJECT) {
  forget(project);
  // The open session is holding the old conversation in memory, and would go on
  // holding it after being told to forget. Letting go there too is what makes a fresh
  // start actually fresh.
  openSessions.forget(project).catch(() => {});
}

export function stopWork(project) {
  return Boolean(endWork(project));
}

// The same thing, but handing back what it stopped, so a caller that needs to know
// whether anybody was waiting on it can find out. Not exported: what it hands back
// holds a running process, and that is nobody else's to hold.
function endWork(project) {
  const job = answering.get(project);
  if (!job) return null;
  // Two roads, two ways to stop. The old one is a process of its own and killing it
  // is the whole of it. The open session is a conversation we mean to keep, so
  // stopping means letting go of this answer rather than taking the session down with
  // it — killing that would cost the drive to save a sentence.
  if (job.open) job.open.stopped = true;
  else job.child.kill("SIGTERM");
  noLonger(job);
  return job;
}

/**
 * Hand a request to Claude. Returns immediately; results arrive through `emit`.
 * emit(kind, text) where kind is "progress" | "final" | "error".
 *
 * `briefing` is how Claude is told to answer — plain spoken sentences rather than a
 * written report. It only goes out on the first request of a conversation, because
 * every later one continues that same conversation and Claude still has it.
 *
 * `standing` is the one thing that cannot be said once: which project we are on. It
 * rides along with every later question instead.
 */
export function startWork(
  request,
  emit,
  { briefing = "", standing = "", project = STARTING_PROJECT, spoken = false } = {},
) {
  // Only this project's. Taking over the answer somebody is waiting on in a different
  // folder is exactly the fault this is here to prevent.
  const replaced = endWork(project);
  if (spoken && replaced && !replaced.spoken) {
    interrupted.set(project, "A question asked out loud took over, so this one stopped without an answer.");
  }
  if (spoken) stopSpeakingElsewhere(project);

  let kept = recall(project);

  // The turn may have been away on a screen since the last question here. If it was,
  // and anything came of it, that is the conversation to carry on — not the one this
  // app was in the middle of before it was handed over. Two threads from one past was
  // the thing to avoid; this is where they are brought back to one.
  const fromTheScreen = whereItGotTo(project);
  if (fromTheScreen) {
    kept = { id: fromTheScreen, at: new Date().toISOString() };
    remember(project, fromTheScreen);
    emit("progress", "picking up where you got to on the screen");
  }
  // Said either way, because the session on the screen has to go whether or not it
  // was used: left open on the same past, the next thing typed into it forks the
  // thread again, which is the whole complaint.
  takeBackOver(project);

  // A conversation resumed after a long gap is about work that may since have landed.
  // Saying where we are picking up from is the difference between helpful and spooky,
  // and it costs one short sentence.
  const gap = fromTheScreen ? null : (kept ? gapPhrase(kept.at) : null);
  if (gap) emit("progress", `picking up where we left off ${gap}`);

  const opening = openingFor({ request, briefing, standing, resume: kept?.id ?? null });

  // The open session first, and the old way if it will not have it. Everything about
  // the old way stays exactly where it was: this is a faster road to the same place,
  // not a replacement, and a road that is out has to put you back on the old one
  // rather than leave you standing.
  askTheOpenSession({ project, opening, resume: kept?.id ?? null, emit, spoken })
    .then((handled) => {
      if (handled) return;
      launch({
        request, emit, briefing, standing, project, spoken,
        resume: kept?.id ?? null, alreadyRetried: false,
      });
    });
}

/**
 * Put the question to the conversation that is already open, if there is one to put
 * it to. Resolves true when it was answered there, false when the caller should go
 * the old way — never rejects, because a failure here is not the driver's problem.
 */
async function askTheOpenSession({ project, opening, resume, emit, spoken = false }) {
  if (!openSessions.isInstalled() || process.env.VOICE_CLAUDE_OPEN_SESSION === "off") return false;

  const job = { stopped: false };
  const mine = { child: null, lastPhrase: null, notes: [], open: job };
  nowAnswering(project, mine, spoken);

  try {
    if (!(await openSessions.startIfNeeded())) return giveUp(job);

    let finalText = "";
    await openSessions.ask({ project, ask: opening, resume }, (message) => {
      if (job.stopped) return;
      const job_ = mine;

      if (message.kind === "notice") {
        // The holder telling the person something was done to their conversation.
        // Passed straight through, in its own words: this is not a step in answering
        // the question and must not be rationed like one. It can also arrive after the
        // answer is finished — the rebuild happens once nobody is waiting — which is
        // why nothing here leans on the job that has by then been let go of.
        emit("notice", String(message.text ?? ""));
        return;
      }

      if (message.kind === "conversation") {
        remember(project, message.id);
      } else if (message.kind === "said") {
        noteDown(job_, `Said: ${String(message.text).trim().slice(0, 400)}`);
        const said = anUpdateWorthHearing(message.text);
        if (said && said !== job_.lastPhrase) {
          job_.lastPhrase = said;
          emit("progress", said);
        }
      } else if (message.kind === "step") {
        noteDown(job_, `Did: ${message.name} ${JSON.stringify(message.input ?? {}).slice(0, 300)}`);
        const phrase = describeTool(message.name, message.input ?? {});
        if (phrase !== job_.lastPhrase) {
          job_.lastPhrase = phrase;
          emit("progress", phrase);
        }
      } else if (message.kind === "result") {
        noteDown(job_, `Got back: ${trimmedResult(message.text)}`);
      } else if (message.kind === "done") {
        finalText = message.text ?? finalText;
      }
    });

    if (job.stopped) return true;                 // stopped on purpose; nothing to say
    noLonger(mine);
    if (!finalText.trim()) {
      emit("error", "It finished but didn't come back with anything.");
      return true;
    }
    emit("final", finalText.trim());
    return true;
  } catch (err) {
    if (job.stopped) return true;
    console.error(`open session: ${err.message}`);
    return giveUp(job, mine);
  }
}

// Hand the question back to the old way, and leave nothing of this attempt behind.
function giveUp(job, mine) {
  if (job.stopped) return true;
  noLonger(mine);
  return false;
}

// One attempt. Split out from the above because a stored conversation can turn out to
// be unusable — cleared away, too old, a machine reinstalled — and the honest answer
// to that is to start a clean one and say so, not to fail at the roadside.
// Which project we are on goes out with every single question, not just the first. It
// used to be said once, inside the briefing, and never again — so a wrong belief about
// where we were could survive the entire conversation with nothing able to contradict
// it. That is not hypothetical: Claude announced a project switch that had not
// happened and then worked in the wrong folder for twenty minutes. Repeating it costs
// one line, and means a wrong belief cannot outlive the next question.
export function openingFor({ request, briefing = "", standing = "", resume = null }) {
  return [briefing && !resume ? `${briefing}\n\n---` : standing, request]
    .filter(Boolean)
    .join("\n\n");
}

function launch({ request, emit, briefing, standing, project, resume, alreadyRetried, spoken = false }) {
  const opening = openingFor({ request, briefing, standing, resume });

  const args = [
    "-p",
    opening,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // Two ways of deciding what it may do, and only one of them is on.
  //
  // By default it may act, and asks first — a spoken question, a spoken yes. Stopping
  // to ask through a permission prompt is useless here because there is no screen to
  // answer it on, so the asking happens in the conversation instead, where the person
  // already is. A short list is still refused outright: things that cannot be undone
  // are not things to consent to at seventy miles an hour.
  //
  // The old way — a fixed list of permitted actions, everything else refused without
  // asking — is one setting away, in case this proves to have been a bad idea.
  if (ONLY_THESE) {
    args.push("--permission-mode", "dontAsk", "--allowedTools", ...ONLY_THESE);
  } else {
    args.push("--permission-mode", "bypassPermissions", "--disallowedTools", ...NEVER);
  }

  // Continue the same conversation rather than starting cold every time.
  if (resume) args.push("--resume", resume);

  // Deliberately drop the Anthropic API key so Claude falls back to the signed-in
  // subscription. Leaving it in place means every question is billed per token,
  // including reloading the whole project context each time. Other projects on
  // this machine keep their key — this only affects what we spawn.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  // The folder it runs in is the project you said you were working on. Everything
  // follows from that: which files it sees, and which repository an issue lands on.
  const child = spawn("claude", args, {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const job = { child, lastPhrase: null, notes: [] };
  nowAnswering(project, job, spoken);

  const timer = setTimeout(() => {
    if (answering.get(project) === job) {
      child.kill("SIGTERM");
      emit("error", "That took too long and I stopped it.");
      noLonger(job);
    }
  }, WORK_TIMEOUT_MS);

  let buffer = "";
  let finalText = "";

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue; // not JSON; ignore rather than crash mid-drive
      }

      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          // Claude says what it is about to do before it does it — "let me look at how
          // the sending works" — and that sentence is worth ten of "reading the code".
          // It is the difference between knowing something is happening and knowing
          // what is happening, which is the whole complaint about long silences.
          if (block.type === "text") {
            noteDown(job, `Said: ${String(block.text).trim().slice(0, 400)}`);
            const said = anUpdateWorthHearing(block.text);
            if (said && said !== job.lastPhrase) {
              job.lastPhrase = said;
              emit("progress", said);
            }
            continue;
          }
          if (block.type === "tool_use") {
            noteDown(job, `Did: ${block.name} ${JSON.stringify(block.input ?? {}).slice(0, 300)}`);
            const phrase = describeTool(block.name, block.input ?? {});
            if (phrase !== job.lastPhrase) {
              job.lastPhrase = phrase;
              emit("progress", phrase);
            }
          }
        }
      }

      // What each step came back with. This is the part that was being thrown away
      // wholesale, and it is where the substance is: what the search found, whether
      // the checks passed, what the command printed. Kept short, because the whole
      // point is to hand something readable to a summary rather than a transcript.
      if (event.type === "user" && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type !== "tool_result") continue;
          const body = typeof block.content === "string"
            ? block.content
            : (Array.isArray(block.content) ? block.content.map((p) => p.text ?? "").join(" ") : "");
          noteDown(job, `Got back: ${trimmedResult(body)}`);
        }
      }

      // Written down as soon as it is known, not at the end: the app can be restarted
      // out from under a long piece of work, and what it was doing should survive that.
      if (event.session_id) remember(project, event.session_id);

      if (event.type === "result") {
        finalText = event.result ?? finalText;
      }
    }
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("close", (code) => {
    clearTimeout(timer);
    if (answering.get(project) !== job) return; // superseded or stopped on purpose
    noLonger(job);

    if (code === 0 && finalText.trim()) {
      emit("final", finalText.trim());
    } else if (code === 0) {
      emit("error", "It finished but didn't come back with anything.");
    } else if (resume && !alreadyRetried && lostTheConversation(stderr)) {
      // The memory pointed at something that is no longer there. Throw the pointer
      // away and ask again from a clean start — the question is still worth answering,
      // and the person should hear why the answer arrives without any history behind it.
      forget(project);
      emit("progress", "I couldn't pick up our old conversation, so I'm starting fresh");
      launch({ request, emit, briefing, standing, project, spoken, resume: null, alreadyRetried: true });
    } else {
      const hint = stderr.trim().split("\n").pop() ?? "";
      emit("error", `Something went wrong on my machine. ${hint}`.trim());
    }
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    noLonger(job);
    emit("error", `I couldn't start the work. ${err.message}`);
  });
}
