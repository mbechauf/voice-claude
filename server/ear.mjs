// The ear: the hearing done here, instead of on the phone.
//
// Until now the phone heard for itself and only the words crossed to this Mac. That
// costs nothing and keeps the sound on the phone, and it is also the ceiling: the
// tidy-up next door can only repair what reached it, and a name that arrived as mush
// lost its sounds before anybody here saw it.
//
// So the sound itself comes over now, and a speech model on this machine's own
// graphics chip turns it into words. It was built and driven with on the advisor's
// speech branch and brought over rather than written again.
//
// It fails the same way everything else here fails: towards what worked before. No
// ear, a crash, or too slow, and the page falls back to the phone's own dictation.
// The tidy-up still runs after it, because a better ear mangles fewer names but the
// ones it does mangle are still worth repairing.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { noteEnded, noteStarted, WITH_THE_APP } from "./running.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const PYTHON = path.join(root, ".ear", "bin", "python");
const LISTENER = path.join(here, "ear", "listen.py");
const PORT = Number(process.env.VOICE_CLAUDE_EAR_PORT ?? 8123);
const WHERE = `http://127.0.0.1:${PORT}`;

// A few seconds of speech comes back in a third of a second. This is the point at
// which something is wrong rather than slow, and waiting longer would only mean
// somebody in a car sitting in silence wondering.
const PATIENCE_MS = Number(process.env.VOICE_CLAUDE_EAR_PATIENCE ?? 8_000);

// Loading the model takes a few seconds. Paid once, at startup, never mid-drive.
const STARTUP_MS = 90_000;

export function isInstalled() {
  return fs.existsSync(PYTHON) && fs.existsSync(LISTENER);
}

let child = null;
let ready = null;

/** Is it up and holding the model? Null when it is not there at all. */
export async function itsState() {
  try {
    const answer = await fetch(`${WHERE}/healthz`, { signal: AbortSignal.timeout(1_000) });
    return answer.ok ? await answer.json() : null;
  } catch {
    return null;
  }
}

function start() {
  const spawned = spawn(PYTHON, ["-u", LISTENER, "--warm"], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: "1", VOICE_CLAUDE_EAR_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Written down for the same reason as everything else started here: a run that dies
  // without tidying up leaves something the next startup can find and clear.
  noteStarted({
    what: "the ear",
    pid: spawned.pid,
    rule: WITH_THE_APP,
    recogniseBy: "server/ear/listen.py",
    note: "hears the sound the phone sends",
  });

  spawned.stdout.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.log(`  ${line}`);
  });
  spawned.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text && !/warn|deprecat|fetching|it\/s|%\|/i.test(text)) console.error(`ear: ${text}`);
  });
  spawned.on("exit", () => {
    noteEnded(spawned.pid);
    child = null;
    ready = null;
  });

  return spawned;
}

/**
 * Up and ready to hear, starting it if it is not.
 *
 * One that is already listening — started by hand, or left by a previous run — is used
 * as it is rather than fought with. Two of these would each hold their own copy of the
 * model in memory for no gain.
 */
export function startIfNeeded() {
  if (ready) return ready;
  if (!isInstalled()) return Promise.resolve(false);

  ready = itsState().then((already) => {
    if (already) return true;
    child = start();
    const until = Date.now() + STARTUP_MS;
    const lookAgain = () =>
      itsState().then((up) => {
        if (up) return true;
        if (Date.now() > until) return false;
        return new Promise((r) => setTimeout(r, 500)).then(lookAgain);
      });
    return lookAgain();
  });

  ready.catch(() => { ready = null; });
  return ready;
}

/**
 * What was said in this sound. Plain uncompressed samples, as they left the page.
 *
 * Empty when it cannot be heard, and empty is not an error: the page treats nothing
 * heard as nothing said, which is what a cough or a passing lorry should come to.
 */
export async function hear(sound) {
  if (!isInstalled() || !sound?.length) return "";
  if (!(await startIfNeeded())) return "";
  try {
    const answer = await fetch(`${WHERE}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: sound,
      signal: AbortSignal.timeout(PATIENCE_MS),
    });
    if (!answer.ok) return "";
    const heard = await answer.json();
    return String(heard?.text ?? "").trim();
  } catch {
    // Not installed, not running, too slow, or a clip it could not make sense of. All
    // of them mean the same thing here, and none of them is worth a word to the driver.
    return "";
  }
}

/** Wake it before the first question, so nobody waits for the model to load mid-drive. */
export function warmUp() {
  if (!isInstalled()) return;
  startIfNeeded().catch(() => {});
}

export function stop() {
  try { child?.kill(); } catch {}
  child = null;
  ready = null;
}
