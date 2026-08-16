// The Mac side. Serves the phone page, mints a short-lived voice credential so the
// real key never leaves this machine, and hands work to Claude.

import http from "node:http";
import https from "node:https";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { networkInterfaces } from "node:os";

import {
  ANSWERS,
  ANSWER_WINDOW_MS,
  GATE,
  LISTENER,
  MODE,
  OPEN_TIMEOUT_MS,
  PHRASES,
  PAUSE_MS,
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
import { forgetConversation, isBusy, startWork, stopWork } from "./claude-bridge.mjs";
import { isInstalled as macVoiceInstalled, speak, warmUp } from "./speech.mjs";
import {
  cleanUp,
  isInstalled as tidyUpInstalled,
  warmUp as warmUpTidyUp,
} from "./cleanup.mjs";

// ------------------------------------------------------------- what we are on
//
// One thing decides where everything happens: which files get changed, what Claude
// can see, and which repository an issue is filed against. It is said out loud and
// repeated back, because a project chosen by mistake does its damage quietly while
// you are watching the road.
let project = STARTING_PROJECT;

const nameOf = (dir) =>
  Object.entries(PROJECTS).find(([, p]) => p.at === dir)?.[0] ?? path.basename(dir);

// Claude is told, every time the project changes, that it is the whole world for
// this conversation. The folder it runs in is the real boundary; this is so it does
// not go looking for something helpful in a neighbouring project and change that.
const boundary = () =>
  `You are working on ${nameOf(project)}, at ${project}. Everything you are asked ` +
  `for is about that project and nothing else: read, change and file issues only ` +
  `there. If something you need appears to be in another project, say so and stop ` +
  `rather than reaching into it. ` +
  // Being told the boundary without being told the way through it is what makes it
  // sound broken. Asked to work on another project, it was saying "you would need
  // to start a session in that folder" — which is impossible from a car and, worse,
  // untrue: one spoken sentence does it. A limit that cannot be lifted from where
  // the person is standing is indistinguishable from a fault.
  `That limit can be lifted, and you must say how rather than leaving it as a dead ` +
  `end. The person changes project by saying it out loud — "work on ${
    Object.keys(PROJECTS).filter((n) => PROJECTS[n].at !== project)[0] ?? "the other project"
  }", or the name of any other. It takes effect at once and everything after it ` +
  `happens there. So if you are asked to work on something outside this project, do ` +
  `not say it cannot be done and never suggest starting a session somewhere else: ` +
  `say in one sentence that they should ask for it out loud, and give them the exact ` +
  `words. The projects are: ${Object.keys(PROJECTS).join(", ")}.` +
  (project === PROJECTS["the voice app"].at
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

// Ctrl-C, or being killed, means a person wants it to stop — so it leaves the way
// the script outside reads as "stay down". Without this, the loop faithfully starts
// it again and the app cannot be stopped at all, which is the obvious way to build
// something that keeps itself alive and the wrong one.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    console.log(`\nstopping.`);
    process.exit(0);
  });
}

function startAgain(why) {
  if (restarting) return;
  restarting = true;
  console.log(`\n== starting again: ${why}`);
  broadcast("restarting", why);
  // Let the phone hear about it before the connection dies under it.
  setTimeout(() => process.exit(RESTART), 250);
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

function broadcast(kind, text) {
  const payload = `data: ${JSON.stringify({ kind, text })}\n\n`;
  for (const res of listeners) res.write(payload);
}

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

  // The phone asks what it is meant to be before it does anything, so that changing
  // the voice layer is a setting on the Mac and never an edit to the page.
  if (url.pathname === "/setup") {
    return send(res, 200, {
      mode: MODE,
      listener: LISTENER,
      speaker,
      speakerVoice: SPEAKER_VOICE,
      speakerRate: SPEAKER_RATE,
      page: pageStamp(),
      gate: GATE,
      pause: PAUSE_MS,
      phrases: PHRASES,
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
      if (url.searchParams.get("resume") !== "1") forgetConversation();
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

  if (url.pathname === "/ask" && req.method === "POST") {
    const { request, alreadyTidied } = await readBody(req);
    if (!request) return send(res, 400, { error: "no request" });
    console.log(`\n→ ${request}`);

    // Repaired here rather than on the phone, and after the gate rather than before
    // it. The phone has to decide what is a command the instant it is said, and it
    // does that by sound; this only has to be right about a finished question, and it
    // can afford a third of a second to be right about the whole of it.
    //
    // Unless the phone already had every piece tidied at the pauses, which is the
    // usual case and the whole point of doing it there: repairing it twice would put
    // the delay back exactly where it was taken out of.
    const tidied = alreadyTidied
      ? { text: request, changed: false, why: "" }
      : await cleanUp(request, { project });
    if (tidied.changed) {
      console.log(`✓ ${tidied.text}`);
      note("tidied up", `"${request}" → "${tidied.text}"`);
      // Send it back so the phone can show what was actually asked. Without this the
      // repair is invisible from the driver's seat, and a repair nobody can see reads
      // exactly like a repair that never happened.
      broadcast("tidied", tidied.text);
    } else if (tidied.why) {
      note("kept it as heard", tidied.why);
    }

    startWork(
      tidied.text,
      (kind, text) => {
        console.log(`  ${kind}: ${text.slice(0, 120)}`);
        broadcast(kind, text);
      },
      { briefing: `${speakingRules}\n\n${boundary()}`, project },
    );
    return send(res, 202, { started: true });
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
    // Its memory is of the other project, and carrying that across would be worse
    // than useless — it would answer about the wrong code with total confidence.
    forgetConversation();
    console.log(`\n== now working on ${match} — ${project}`);
    return send(res, 200, { project: match, at: project });
  }

  if (url.pathname === "/project") {
    return send(res, 200, { project: nameOf(project), at: project, projects: Object.keys(PROJECTS) });
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
    forgetConversation();
    console.log("  starting a fresh conversation");
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/stop" && req.method === "POST") {
    const stopped = stopWork();
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

// Phones will not give a web page the microphone unless the connection is secure,
// so we serve over HTTPS with a certificate this machine signs itself. Safari will
// warn once on the phone; accept it and it stays accepted.
function ensureCertificate() {
  const dir = path.join(root, ".cert");
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  fs.mkdirSync(dir, { recursive: true });
  const addresses = localAddresses();
  const alt = ["IP:127.0.0.1", "DNS:localhost", ...addresses.map((a) => `IP:${a}`)].join(",");

  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath,
    "-days", "825", "-subj", "/CN=voice-claude",
    "-addext", `subjectAltName=${alt}`,
  ]);

  console.log("Made a self-signed certificate for this machine.");
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

function localAddresses() {
  const out = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

// ------------------------------------------------------------------- listen

const creds = ensureCertificate();
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
  console.log(`Working on:  ${nameOf(project)} — ${project}`);
  if (MODE === "realtime") {
    console.log(`Voice:       ${VOICE_MODEL} (${VOICE_NAME})`);
    console.log(`Cost:        billed per minute of audio, both directions.`);
  } else {
    const mouth = speaker === "mac" ? `this Mac, ${SPEAKER_VOICE}` : "the phone's own voice";
    const tidying = tidyUpInstalled()
      ? "a small model on this Mac"
      : `not installed — run "npm run cleanup:install"`;
    console.log(`Hearing:     the phone's own dictation`);
    console.log(`Tidying up:  ${tidying}`);
    console.log(`Speaking:    ${mouth}`);
    console.log(`Cost:        nothing beyond the Claude subscription.`);
    // Loading these takes a few seconds. Do it now, not when someone is waiting.
    if (speaker === "mac") warmUp();
    warmUpTidyUp();
  }
  console.log(`\nOpen this on the phone:`);
  for (const address of localAddresses()) console.log(`   https://${address}:${PORT}`);
  console.log(`\nSafari will warn about the certificate the first time. Accept it.\n`);
  watchOwnCode();
});
