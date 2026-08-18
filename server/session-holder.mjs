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

    return waitUntilUp();
  });
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
