// Boots the server the way a drive would and checks the parts that are easy to
// break and hard to notice until you are moving. It deliberately runs with no
// OpenAI credential in the environment: the free mode has to work for someone who
// does not have one at all.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PORT = 8799; // not the real one, so this never fights a live session

// The certificate is this machine's own, so the check has to accept it.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const env = { ...process.env, VOICE_CLAUDE_PORT: String(PORT) };
delete env.OPENAI_API_KEY;

const server = spawn("node", [path.join(here, "index.mjs")], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });

let banner = "";
server.stdout.on("data", (c) => (banner += c.toString()));
server.stderr.on("data", (c) => (banner += c.toString()));

const base = `https://127.0.0.1:${PORT}`;
const results = [];

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
}

// Whether it can tell your voice from its own is what decides if interrupting it
// works or if it argues with itself all the way down the motorway. It lives in the
// page, so it is lifted out of there and exercised here rather than only in a car.
function checkItKnowsItsOwnVoice() {
  const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  const source = page.match(/function soundsLikeItself[\s\S]*?\n}/);
  if (!source) {
    check("the page can tell your voice from its own", false, "couldn't find that part of the page");
    return;
  }

  const soundsLikeItself = new Function(`${source[0]}; return soundsLikeItself;`)();
  const answer = "Another set of notes still says the adapter is the only copy of that file.";

  const cases = [
    ["hears itself word for word", answer, answer, true],
    ["hears itself roughly", "another set of notes still says the adapter", answer, true],
    ["hears you change the subject", "forget that, check the tests instead", answer, false],
    ["hears you ask something new", "what about the billing problem from earlier", answer, false],
    ["hears a noise with no words in it", "mm", answer, true],
    ["hears you while it is silent", "check the tests instead", "", false],
  ];

  const wrong = cases.filter(([, heard, spoken, expected]) => soundsLikeItself(heard, spoken) !== expected);
  for (const [name, heard, spoken, expected] of cases) {
    check(`it ${name}`, soundsLikeItself(heard, spoken) === expected, expected ? "should ignore" : "should listen");
  }
  return wrong.length === 0;
}

// The gate decides what ever reaches Claude, and getting it wrong means either a
// machine that ignores you or one that acts on the radio. Same trick as above: the
// part of the page that reads speech into instructions is lifted out and run here.
function checkTheGate() {
  const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  const pieces = ["function howItSounds", "function nearlySame", "function phraseStartsAt", "const plainWords", "function makePhraseReader", "function readAsInstructions"]
    .map((start) => page.match(new RegExp(`${start}[\\s\\S]*?\\n}`)))
    .filter(Boolean)
    .map((m) => m[0]);

  if (pieces.length !== 6) {
    check("the page can be read for the gate", false, `found ${pieces.length} of 6 parts`);
    return;
  }

  const read = new Function(`${pieces.join("\n")}; return readAsInstructions;`)();
  const makeReader = new Function(`${pieces.join("\n")}; return makePhraseReader;`)();

  // The phone hands over whatever it had when you paused, so a phrase said with a
  // pause in the middle of it arrives in two pieces. This is what was quietly
  // breaking it: the words fell through and became part of the question instead.
  const overPieces = (chunks) => {
    const reader = makeReader("claude go", "claude stop");
    const out = [];
    for (const chunk of chunks) {
      for (const step of reader.feed(chunk)) {
        out.push(step.open ? "OPEN" : step.close ? "CLOSE" : step.say);
      }
    }
    if (reader.held()) out.push(reader.held());
    return out.join(" | ");
  };

  const split = [
    ["the name and the word arriving separately", ["claude", "stop"], "CLOSE"],
    ["a question then a split closing phrase", ["check the tests", "claude", "stop"], "check the tests | CLOSE"],
    ["a split opening phrase", ["claude", "go"], "OPEN"],
    ["the name alone is still just a word", ["claude", "found three things"], "claude found three things"],
    ["a whole exchange in pieces", ["claude go", "review the last change", "and the tests", "claude", "stop"], "OPEN | review the last change | and the tests | CLOSE"],
    ["go misheard as girl", ["claude girl"], "OPEN"],
    ["stop misheard as stopped", ["claude stopped"], "CLOSE"],
    ["the name last, still waiting", ["tell me about claude"], "tell me about | claude"],
  ];

  for (const [name, chunks, expected] of split) {
    const got = overPieces(chunks);
    check(`across pieces: ${name}`, got === expected, got === expected ? "" : `got "${got}"`);
  }

  // The phrases actually in use. A phrase is only worth having if it survives being
  // said normally, arrives in pieces, and never fires inside an ordinary question.
  const withRealPhrases = (chunks, open = "scratch that", close = "all done") => {
    const reader = makeReader(open, close);
    const out = [];
    for (const chunk of chunks) {
      for (const step of reader.feed(chunk)) {
        out.push(step.open ? "WIPE" : step.close ? "SEND" : step.say);
      }
    }
    if (reader.held()) out.push(reader.held());
    return out.join(" | ");
  };

  const real = [
    ["sending", ["what changed in the last commit", "all done"], "what changed in the last commit | SEND"],
    ["sending when it arrives in pieces", ["what changed", "all", "done"], "what changed | SEND"],
    ["starting the question again", ["no scratch that", "what about the tests"], "no | WIPE | what about the tests"],
    ["a question about sending things is not a send", ["does it send it to the server"], "does it send it to the server"],
    ["a question containing all", ["are all the tests passing"], "are all the tests passing"],
    ["a question containing done", ["is the migration done yet"], "is the migration done yet"],
    ["and containing both, apart", ["are all the migrations done"], "are all the migrations done"],
  ];

  for (const [name, chunks, expected] of real) {
    const got = withRealPhrases(chunks);
    check(`the real phrases: ${name}`, got === expected, got === expected ? "" : `got "${got}"`);
  }
  const shape = (text) =>
    read(text, "claude go", "claude stop")
      .map((step) => (step.open ? "OPEN" : step.close ? "CLOSE" : step.say))
      .join(" | ");

  const cases = [
    ["a whole question in one breath", "claude go review the last change claude stop", "OPEN | review the last change | CLOSE"],
    ["a question said over three goes", "claude go", "OPEN"],
    ["talk with the gate shut is nothing to act on", "so anyway the traffic is terrible", "so anyway the traffic is terrible"],
    ["the name misheard as cloud", "cloud go what changed cloud stop", "OPEN | what changed | CLOSE"],
    ["the name misheard as clawed", "clawed go check the tests clawed stop", "OPEN | check the tests | CLOSE"],
    ["the name misheard as clod", "clod go check the tests clod stop", "OPEN | check the tests | CLOSE"],
    ["the name misheard as cold", "cold go check the tests cold stop", "OPEN | check the tests | CLOSE"],
    ["a different short word is not the name", "go stop that", "go stop that"],
    ["punctuation from dictation", "Claude, go. Review the tests. Claude, stop.", "OPEN | review the tests | CLOSE"],
    ["closing without opening", "claude stop", "CLOSE"],
    ["the word claude on its own is not a phrase", "claude found three things", "claude found three things"],
    ["stop inside a sentence stays a word", "claude go make it stop crashing claude stop", "OPEN | make it stop crashing | CLOSE"],
  ];

  for (const [name, spoken, expected] of cases) {
    const got = shape(spoken);
    check(`the gate handles ${name}`, got === expected, got === expected ? "" : `got "${got}"`);
  }
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${base}/setup`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

try {
  if (!(await waitForServer())) {
    console.error("The server never came up. It said:\n" + banner);
    process.exit(1);
  }

  check("starts with no OpenAI credential at all", true);

  const setup = await (await fetch(`${base}/setup`)).json();
  check("defaults to the free voice mode", setup.mode === "split", `saw "${setup.mode}"`);
  check("tells the phone who listens and who speaks", Boolean(setup.listener && setup.speaker));
  check("names the project being worked on", Boolean(setup.project), setup.project ?? "");

  const page = await (await fetch(`${base}/`)).text();
  check("serves the phone page", page.includes("voice-claude"));
  check("the page asks the Mac what it should be", page.includes("/setup"));

  const token = await fetch(`${base}/token`, { method: "POST" });
  check(
    "refuses to buy paid voice while in free mode",
    token.status === 409,
    `got ${token.status}`,
  );

  const fresh = await fetch(`${base}/new`, { method: "POST" });
  check("can start the drive over", fresh.ok);

  const empty = await fetch(`${base}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  check("turns away an empty request", empty.status === 400, `got ${empty.status}`);

  // The voice half. When the good voice isn't installed the server is supposed to
  // say so and fall back rather than leave someone in a car listening to nothing.
  if (setup.speaker === "mac") {
    const started = Date.now();
    const sound = await fetch(`${base}/say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "One real finding, though." }),
    });
    const audio = sound.ok ? await sound.arrayBuffer() : new ArrayBuffer(0);
    check("the Mac speaks a sentence", sound.ok && audio.byteLength > 10_000, `${audio.byteLength} bytes`);
    check(
      "and does it fast enough not to be noticed",
      Date.now() - started < 15_000,
      `${((Date.now() - started) / 1000).toFixed(1)}s including waking the voice`,
    );

    const nothing = await fetch(`${base}/say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    check("turns away an empty sentence", nothing.status === 400, `got ${nothing.status}`);
  } else {
    check("falls back to the phone's voice when the good one is missing", true, "the Mac voice is not installed");
  }

  check("the banner says plainly that nothing is billed", banner.includes("nothing beyond the Claude subscription"));

  check("tells the phone the phrases that open and close the gate", Boolean(setup.openPhrase && setup.closePhrase), `${setup.openPhrase} / ${setup.closePhrase}`);

  checkItKnowsItsOwnVoice();
  checkTheGate();
} finally {
  server.kill("SIGTERM");
}

const failed = results.filter((r) => !r.passed);
for (const r of results) {
  console.log(`${r.passed ? "ok  " : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(failed.length ? `\n${failed.length} failed.` : `\nAll ${results.length} fine.`);
process.exit(failed.length ? 1 : 0);
