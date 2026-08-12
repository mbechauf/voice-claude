// The Mac's side of the voice: keeps the speaking process alive between sentences,
// hands it text, and gives back a piece of audio.
//
// It is deliberately a thin pipe. Everything about how the voice sounds lives in the
// worker, so a different engine — or a paid service — replaces one file and nothing
// else changes.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { SPEAKER_RATE, SPEAKER_VOICE } from "./config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const PYTHON = path.join(root, ".voice", "bin", "python");
const WORKER = path.join(here, "speech", "worker.py");

// The pronunciation data ships with the system copy, not the Python one, and the
// bundled default points somewhere that does not exist on a Mac.
const ESPEAK_HOMES = ["/opt/homebrew", "/usr/local"];

function espeakEnvironment() {
  for (const home of ESPEAK_HOMES) {
    const data = path.join(home, "share", "espeak-ng-data");
    const library = path.join(home, "lib", "libespeak-ng.dylib");
    if (fs.existsSync(data) && fs.existsSync(library)) {
      return { ESPEAK_DATA_PATH: data, PHONEMIZER_ESPEAK_LIBRARY: library };
    }
  }
  return {};
}

export function isInstalled() {
  return fs.existsSync(PYTHON) && fs.existsSync(WORKER);
}

let worker = null;
let ready = null;
let nextId = 1;
const waiting = new Map();

function start() {
  const child = spawn(PYTHON, [WORKER], {
    cwd: root,
    env: { ...process.env, ...espeakEnvironment(), PYTHONUNBUFFERED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

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
      else pending.resolve(message.path);
    }
  });

  // The worker's own complaints are worth seeing on the Mac, but they are noisy on
  // startup and none of them belong in the driver's ear.
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text && !/warn|deprecat|weightnorm|lstm/i.test(text)) console.error(`voice: ${text}`);
  });

  child.on("exit", () => {
    worker = null;
    ready = null;
    for (const pending of waiting.values()) pending.reject(new Error("the voice stopped"));
    waiting.clear();
  });

  return child;
}

function ensureRunning() {
  if (ready) return ready;
  if (!isInstalled()) return Promise.reject(new Error("the Mac voice is not installed"));

  worker = start();
  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the voice took too long to start")), 120_000);
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

/** Turn one sentence into audio. Returns the finished sound, ready to play. */
export async function speak(text, { voice = SPEAKER_VOICE, speed = SPEAKER_RATE } = {}) {
  await ensureRunning();

  const id = nextId++;
  const answer = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  worker.stdin.write(`${JSON.stringify({ id, text, voice, speed })}\n`);

  const file = await answer;
  try {
    return fs.readFileSync(file);
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

/** Wake the voice up before the first question, so nobody waits for it mid-drive. */
export function warmUp() {
  if (!isInstalled()) return;
  ensureRunning().catch((err) => console.error(`voice: ${err.message}`));
}
