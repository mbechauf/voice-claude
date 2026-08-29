// Talking to the session that stays open.
//
// The conversation lives in a separate process that this app does not own — see the
// note at the top of the Python beside this file. What is here is only the way to
// reach it: start it if it is not running, put a question to it, and read back the
// same small messages the app has always read.
//
// Everything here fails towards the old way. A holder that is missing, wedged, or
// too slow to start means the question goes to a freshly launched Claude exactly as
// it did before, a second or two slower and no worse. That is the whole safety
// argument for putting a second process in the middle of somebody's drive.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ACROSS_RESTARTS, end, isStillItself, noteEnded, noteStarted, written } from "./running.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const PYTHON = path.join(root, ".session", "bin", "python");
const HOLDER = path.join(here, "session", "holder.py");
const SOCKET = process.env.VOICE_CLAUDE_SESSION_SOCKET ?? path.join(os.tmpdir(), "voice-claude-session.sock");

// Long enough for a cold start on a busy machine, short enough that nobody in a car
// sits through it twice. If it is not up by then the question goes the old way.
const STARTUP_MS = 25_000;

export function isInstalled() {
  return fs.existsSync(PYTHON) && fs.existsSync(HOLDER);
}

/** Is something listening? The only honest test is to connect to it. */
export function isRunning() {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCKET)) return resolve(false);
    const sock = net.connect(SOCKET);
    const give = (answer) => { try { sock.destroy(); } catch {} resolve(answer); };
    sock.on("connect", () => give(true));
    sock.on("error", () => give(false));
    setTimeout(() => give(false), 1_000);
  });
}

/**
 * Start it, detached, owned by the system rather than by this app.
 *
 * This is the part that matters. This app restarts whenever its own code changes —
 * several times an hour while it is being worked on — and a conversation that died
 * with it would be worse than no conversation at all, because there would be
 * something to lose. So the holder is cut loose the moment it is spawned, and this
 * app coming and going means nothing to it.
 */
export function startIfNeeded() {
  if (!isInstalled()) return Promise.resolve(false);

  return isRunning().then((up) => {
    if (up) return true;

    // A socket file left behind by a process that has gone would stop a new one
    // binding, and the failure reads as "cannot start" rather than "tidy up first".
    try { fs.rmSync(SOCKET, { force: true }); } catch {}

    const env = { ...process.env, VOICE_CLAUDE_SESSION_SOCKET: SOCKET };
    // Same reason the app strips it everywhere else: with a key present, Claude bills
    // per token instead of using the subscription that is already paid for.
    delete env.ANTHROPIC_API_KEY;

    const log = fs.openSync(path.join(root, ".voice-claude", "session-holder.log"), "a");
    const child = spawn(PYTHON, ["-u", HOLDER], {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();

    // Written down as something that survives a restart on purpose, which is the
    // whole reason it was cut loose. It being unowned was right; it being unrecorded
    // was not — nothing could then find it, report it, or ever end it, so "turn it
    // off and on again" cleared nothing at all.
    noteStarted({
      what: "the conversation helper",
      pid: child.pid,
      rule: ACROSS_RESTARTS,
      recogniseBy: "session/holder.py",
      note: "holds one live conversation per project",
    });

    return waitUntilUp();
  });
}

/**
 * Is the helper that is running older than the code it runs?
 *
 * Being cut loose is what makes it survive this app restarting, and that is right. The
 * price is that changing its code changes nothing: the app restarts itself the moment
 * any file changes, announces that it has, and the one thing that did not restart is
 * the one thing the change was in. Everything looks fixed and nothing is.
 *
 * That is not hypothetical. A fault that had been costing whole conversations was found
 * and fixed, the app restarted itself, and the fault carried on happening for hours,
 * because the part it was fixed in had been running since the morning.
 *
 * Told by the socket rather than by asking the process: the file is made when the
 * helper starts listening, so its own timestamp is the moment the running one began.
 */
export function runningOldCode() {
  try {
    return fs.statSync(HOLDER).mtimeMs > fs.statSync(SOCKET).mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Put that right, by ending it and starting it again on the code that is there now.
 *
 * Safe to do, and only because of something decided earlier: the app writes down which
 * conversation belongs to which project and hands that back when it asks, so a helper
 * that goes away and comes back picks up the same conversations rather than losing
 * them. Restarting it costs a second and nothing else.
 *
 * Meant for startup, when nobody is waiting on an answer — never in the middle of a
 * question, where it would be the thing that lost one.
 */
export async function freshenIfStale() {
  if (!isInstalled()) return false;
  if (!(await isRunning())) return false;
  if (!runningOldCode()) return false;

  const went = await stop().catch(() => false);
  if (!went) {
    // Asked politely and it stayed. Ended outright rather than left, because the
    // alternative is what was happening before: everything reports that it restarted,
    // nothing did, and the code being run is whatever was there this morning.
    const mine = written().find((e) => e.rule === ACROSS_RESTARTS && isStillItself(e));
    if (mine) end(mine);
    try { fs.rmSync(SOCKET, { force: true }); } catch {}
  }

  await startIfNeeded().catch(() => false);
  // Said only if it is true. A restart that quietly did not happen is worse than one
  // that failed loudly — that is the whole of what went wrong here.
  return !runningOldCode();
}

function waitUntilUp(until = Date.now() + STARTUP_MS) {
  return isRunning().then((up) => {
    if (up) return true;
    if (Date.now() > until) return false;
    return new Promise((r) => setTimeout(r, 300)).then(() => waitUntilUp(until));
  });
}

/**
 * Put a question to the open session and report what comes back.
 *
 * `onMessage` is given the same small messages the app reads today — what Claude says
 * it is about to do, each step and what it was for, what came back, and the answer.
 * Resolves with the answer, or rejects, and a rejection means "go the old way".
 */
export function ask({ project, ask: question, resume = null }, onMessage) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET);
    let buffer = "";
    let answered = false;

    sock.on("connect", () => {
      sock.write(`${JSON.stringify({ project, ask: question, resume })}\n`);
    });

    sock.on("data", (chunk) => {
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
        if (message.kind === "trouble") {
          answered = true;
          reject(new Error(message.text ?? "the session had trouble"));
          return;
        }
        onMessage(message);
        if (message.kind === "done") {
          answered = true;
          resolve(message.text ?? "");
        }
      }
    });

    sock.on("error", (err) => { if (!answered) reject(err); });
    sock.on("close", () => {
      // Closed with nothing said is a holder that died mid-answer. Saying so lets the
      // caller start over the old way rather than leaving somebody in silence.
      if (!answered) reject(new Error("the session closed without answering"));
    });
  });
}

/**
 * What a conversation said while nobody was asking it anything.
 *
 * A job finishing writes a real report, and until something asks for it, it sits
 * unread. This is the asking. Empty nearly every time, and cheap enough to do on a
 * clock for that reason.
 */
export function anythingSaidMeanwhile(project) {
  return askQuietly({ what: "mail", project }).then((said) =>
    Array.isArray(said?.said) ? said.said : [],
  );
}

/** A small question to the holder that expects one line back. Null if it is not there. */
function askQuietly(request, patience = 2_000) {
  return new Promise((resolve) => {
    const sock = net.connect(SOCKET);
    let done = false;
    const give = (answer) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve(answer);
    };
    sock.on("connect", () => sock.write(`${JSON.stringify(request)}\n`));
    sock.on("data", (chunk) => {
      try { give(JSON.parse(chunk.toString().split("\n")[0])); } catch { give(null); }
    });
    sock.on("error", () => give(null));
    setTimeout(() => give(null), patience);
  });
}

/**
 * What conversations it is holding open, so somebody asking what is running gets the
 * truth rather than only the process it lives in. Null when it is not running.
 */
export function whatIsOpen() {
  return askQuietly({ what: "ping" }).then((said) => (said?.kind === "alive" ? said : null));
}

/**
 * Stop it, properly.
 *
 * Asked first rather than killed, so it can close its conversations on the way out
 * instead of leaving Claude processes orphaned underneath it — killing the parent of
 * something is not the same as ending the something. Killed only if it will not go,
 * and never on the strength of a stored number alone: that check lives in the file
 * that keeps the record.
 */
export async function stop({ patience = 6_000 } = {}) {
  if (!(await isRunning())) return false;

  // Which process it is, so this can wait for the process rather than only for the
  // socket. The socket goes first and the process takes a moment longer to finish
  // closing its conversations — long enough that whatever tidies up next found it
  // still alive and killed it a second time, mid-goodbye.
  const mine = written().find((e) => e.rule === ACROSS_RESTARTS && isStillItself(e));

  await askQuietly({ what: "stop" });

  const until = Date.now() + patience;
  while (Date.now() < until) {
    const socketGone = !(await isRunning());
    const processGone = !mine || !isStillItself(mine);
    if (socketGone && processGone) {
      if (mine) noteEnded(mine.pid);
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Let go of a project's conversation, so the next question starts a fresh one. */
export function forget(project) {
  return new Promise((resolve) => {
    const sock = net.connect(SOCKET);
    sock.on("connect", () => sock.write(`${JSON.stringify({ what: "forget", project })}\n`));
    sock.on("data", () => { try { sock.destroy(); } catch {} resolve(true); });
    sock.on("error", () => resolve(false));
    setTimeout(() => { try { sock.destroy(); } catch {} resolve(false); }, 2_000);
  });
}
