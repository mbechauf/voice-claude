// Handing the conversation over to a screen.
//
// Everything else here is built for someone who cannot look at anything. This is the
// one thing that is not: the moment the drive ends, the work is mid-flight and the
// only way to carry on with it is to be able to see it. Starting again from nothing
// at a desk is how a drive's worth of context gets thrown away.
//
// Remote Control is Claude Code's own way of making a session reachable from
// elsewhere, and it is only available on an interactive session — which is exactly
// what this app does not run. Its questions are one-shot, answered and finished. So
// nothing here converts anything: it starts a fresh interactive session, points it at
// the conversation this project has been using, and turns Remote Control on. What was
// said in the car is what it opens with.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

import { PROJECTS } from "./config.mjs";
import { handedOver, outstandingHandover, pickedBackUp, recall } from "./conversations.mjs";

// A detached terminal to live in. An interactive session needs one — run without it,
// Claude Code has nothing to draw on and exits — and there is nobody at the keyboard
// here to provide it. Screen ships with macOS, which is the whole reason it is this
// rather than something nicer.
const TERMINAL = "/usr/bin/screen";

const nameFor = (project) => `voice-${project.split("/").filter(Boolean).pop() ?? "session"}`;

// Everything this app hands to a screen is named this way, which is what makes one
// recognisable later as ours and not somebody else's terminal. Nothing outside this
// prefix is ever touched.
const OURS = /^\d+\.(voice-[^\s\t]+)/;

// How long a handed-over session may sit before it stops being anybody's live work.
// It is meant to outlive the app — you stop driving and walk to your desk — but
// "outlives" is not "forever", and one was found still holding a conversation twelve
// hours after the drive that started it had ended.
const TOO_OLD_MS = Number(process.env.VOICE_CLAUDE_HANDOVER_HOURS ?? 12) * 60 * 60 * 1000;

/** Is one already running for this project? */
export function alreadyRunning(project) {
  return handoversRunning().includes(nameFor(project));
}

/**
 * Every session this app has handed over that is still running, by name.
 *
 * Asked of the machine rather than remembered, because a remembered process number is
 * the wrong identity for these: the thing that survives is not the process this app
 * started, it is the one that process forked before exiting. The name is what lasts,
 * so the name is what is tracked.
 */
export function handoversRunning() {
  try {
    const listed = execFileSync(TERMINAL, ["-ls"], { encoding: "utf8" });
    return listed
      .split("\n")
      .map((line) => line.trim().match(OURS)?.[1])
      .filter(Boolean);
  } catch {
    // Screen exits non-zero when there are none at all, which is not an error.
    return [];
  }
}

function quit(name) {
  try {
    execFileSync(TERMINAL, ["-S", name, "-X", "quit"]);
    return true;
  } catch {
    return false; // already gone, which is the state we wanted it in
  }
}

/**
 * Close any handed-over session that is no longer anybody's live work.
 *
 * Two ways one stops counting. It has no handover on record — meaning this app has
 * already taken the work back, or the record was lost, and either way nothing is
 * coming for it. Or it is simply too old to be live.
 *
 * Both were needed. The one that prompted this was six hours old AND unrecorded,
 * holding a conversation that had long since been replaced, and the only reason it
 * was ever found was somebody reading a process list by hand.
 *
 * Nothing outside this app's own naming is looked at, let alone closed.
 */
export function sweepHandovers({ now = Date.now(), say = () => {} } = {}) {
  const closed = [];
  // The self-check boots a real server, and a test that closed the session somebody
  // had walked away from would be doing the exact harm this is meant to prevent.
  if (process.env.VOICE_CLAUDE_LEAVE_HANDOVERS === "1") return closed;
  for (const name of handoversRunning()) {
    const project = Object.values(PROJECTS).find((p) => nameFor(p.at) === name)?.at;
    const handover = project ? outstandingHandover(project) : null;

    let why = null;
    if (!handover) why = "nothing was waiting for it";
    else if (now - new Date(handover.at).getTime() > TOO_OLD_MS) why = "it was too old to be live work";
    if (!why) continue;

    if (quit(name)) {
      if (project) pickedBackUp(project);
      closed.push({ name, why });
      say(`  closed a handed-over session — ${why}`);
    }
  }
  return closed;
}

/**
 * Press return in the waiting session, once, if it is asking whether the folder is
 * trusted — and never otherwise.
 *
 * Deliberately looks before it types. Sending a blind keypress into a session would
 * eventually send one into a session asking something else entirely, and answering an
 * unread question is how something quietly does the wrong thing on somebody's behalf.
 * It tries for a few seconds because the question takes a moment to appear, and gives
 * up quietly if it never does: the session is still there, still answerable by hand.
 */
function answerTheSafetyQuestion(name, tries = 10) {
  const look = path.join(os.tmpdir(), `voice-remote-${name}.txt`);
  const again = () => {
    if (tries <= 0) return;
    tries -= 1;
    try {
      execFileSync(TERMINAL, ["-S", name, "-p", "0", "-X", "hardcopy", look]);
      const showing = fs.readFileSync(look, "utf8");
      if (/trust this folder/i.test(showing)) {
        execFileSync(TERMINAL, ["-S", name, "-p", "0", "-X", "stuff", "\r"]);
        fs.rmSync(look, { force: true });
        console.log("  remote control: answered the folder question");
        return;
      }
    } catch {
      // The session may not have finished starting. That is what the retries are for.
    }
    setTimeout(again, 1_000);
  };
  setTimeout(again, 1_000);
}

/**
 * Start a Remote Control session on this project's conversation.
 *
 * Returns a sentence to say out loud, because the person asking cannot look at
 * anything to find out whether it worked.
 */
export function handOver(project) {
  const kept = recall(project);

  if (alreadyRunning(project)) {
    return { started: false, say: "There's already one running for this project — it should still be there." };
  }

  const name = nameFor(project);
  const args = ["-dmS", name, "claude"];
  // Without a conversation to resume this is still worth doing — it is a session on
  // the right project, which is most of the value — but it opens on a blank page and
  // the person should be told that rather than discovering it later.
  if (kept?.id) args.push("--resume", kept.id);
  args.push("--remote-control", name);

  // A brand new interactive session stops on a safety question before it will do
  // anything: do you trust this folder? Nobody is at the keyboard, so it sat there
  // unanswered and never reached the point of being reachable at all — which looks
  // exactly like the handover having silently failed.
  //
  // It is answered here, but only for a folder that is already one of this app's own
  // projects. That is the whole safety argument: these are folders already named in
  // this app's settings and already being read and changed by every question asked in
  // the car. A folder that is not on that list gets the question and no answer, which
  // is the right way round.
  const known = Object.values(PROJECTS).some((p) => p.at === project);

  try {
    const child = spawn(TERMINAL, args, {
      cwd: project,
      // The point is that it outlives this app. A restart here — and this app restarts
      // whenever its own code changes — must not take the session down with it.
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (err) {
    return { started: false, say: `I couldn't start it: ${err.message}` };
  }

  if (known) answerTheSafetyQuestion(name);

  handedOver(project, name);

  return {
    started: true,
    say: kept?.id
      ? "Done. This conversation is now in remote control, so you can pick it up on a screen."
      : "Done, but it starts on a blank page — there was no conversation saved for this project yet.",
  };
}

// Where Claude Code keeps what was said, one folder per project, one file per
// conversation. Read rather than asked for, because there is nothing to ask: the
// screen session is a separate process that reports to nobody here.
const transcriptsFor = (project) =>
  path.join(os.homedir(), ".claude", "projects", project.replace(/[/.]/g, "-"));

/**
 * Where the screen carried the conversation on to, if it did.
 *
 * The handover starts two threads from one past, and having two is exactly what was
 * not wanted. So on the way back the newest thread this project has — as long as it
 * was written after the handover, which is what makes it the screen's and not an old
 * one lying about — becomes the thread the car carries on with.
 *
 * Returns null when nothing was handed over, or when the screen session was opened
 * and never used. Then there is nothing to come back to and nothing changes.
 */
export function whereItGotTo(project) {
  const handover = outstandingHandover(project);
  if (!handover) return null;

  const startedAt = new Date(handover.at).getTime();
  let newest = null;
  try {
    for (const file of fs.readdirSync(transcriptsFor(project))) {
      if (!file.endsWith(".jsonl")) continue;
      const full = path.join(transcriptsFor(project), file);
      const touched = fs.statSync(full).mtimeMs;
      // A second of slack: the file is created as the session starts, which is the
      // same moment by any clock a person would recognise.
      if (touched < startedAt - 1_000) continue;
      if (!newest || touched > newest.touched) newest = { id: file.replace(/\.jsonl$/, ""), touched };
    }
  } catch {
    // No folder yet means nothing was said. Not a failure — just nothing to fetch.
  }

  return newest?.id ?? null;
}

/**
 * The turn is back in the car. Close the session that was holding it, so there are
 * not two of them, and forget the handover.
 *
 * Closing it is the point rather than tidiness: a screen session left open on the
 * same past is the second conversation this was meant to avoid, and the next thing
 * typed into it would fork the thread all over again.
 */
export function takeBackOver(project) {
  const handover = outstandingHandover(project);
  pickedBackUp(project);
  if (!handover?.name) return;
  quit(handover.name);
}
