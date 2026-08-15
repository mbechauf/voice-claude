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
function checkTheGate(livePhrases) {
  const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  // Each part says where it ends as well as where it starts. Saying only where they
  // start once worked by accident — a run-on match swept up the list of polite words
  // sitting between two of them, and adding anything in that gap broke the lot.
  const wanted = [
    /function howItSounds[\s\S]*?\n}/,
    /function nearlySame[\s\S]*?\n}/,
    /function phraseStartsAt[\s\S]*?\n}/,
    /const plainWords[\s\S]*?;\n/,
    /const NOISES = [\s\S]*?\];/,
    /const STALLS = [\s\S]*?\n\];/,
    /function withoutFiller[\s\S]*?\n}/,
    /const POLITENESS = [\s\S]*?\n\]\);/,
    /function makePhraseReader[\s\S]*?\n}/,
    /function readAsInstructions[\s\S]*?\n}/,
  ];
  const pieces = wanted.map((one) => page.match(one)).filter(Boolean).map((m) => m[0]);

  if (pieces.length !== wanted.length) {
    check("the page can be read for the gate", false, `found ${pieces.length} of ${wanted.length} parts`);
    return;
  }

  const read = new Function(`${pieces.join("\n")}; return readAsInstructions;`)();
  const makeReader = new Function(`${pieces.join("\n")}; return makePhraseReader;`)();

  const NAMED = { open: "claude go", close: "claude stop" };
  const label = (step) => (step.command ? step.command.toUpperCase() : step.say);
  const shape = (text) => read(text, NAMED).map(label).join(" | ");

  // The phone hands over whatever it had when you paused, so a phrase said with a
  // pause in the middle of it arrives in two pieces. This is what was quietly
  // breaking it: the words fell through and became part of the question instead.
  const overPieces = (chunks, phrases = NAMED) => {
    const reader = makeReader(phrases);
    const out = [];
    for (const chunk of chunks) for (const step of reader.feed(chunk)) out.push(label(step));
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
  // The phrases actually in use, read from the running server rather than copied.
  // A copy drifts, and a test that passes against a stale copy is worse than none.
  const REAL = livePhrases;
  const withRealPhrases = (chunks) => overPieces(chunks, REAL);

  const real = [
    ["sending", ["what changed in the last commit", "all done"], "what changed in the last commit | SEND"],
    ["sending when it arrives in pieces", ["what changed", "all", "done"], "what changed | SEND"],
    ["starting the question again", ["no scratch that", "what about the tests"], "no | WIPE | what about the tests"],
    ["a question about sending things is not a send", ["does it send it to the server"], "does it send it to the server"],
    ["a question containing all", ["are all the tests passing"], "are all the tests passing"],
    ["a question containing done", ["is the migration done yet"], "is the migration done yet"],
    ["and containing both, apart", ["are all the migrations done"], "are all the migrations done"],
    ["hearing it back", ["what changed lately", "read prompt"], "what changed lately | READ"],
    ["hearing it back in pieces", ["read", "prompt"], "READ"],
    ["a question about reading is not the command", ["can it read the prompt file"], "can it read the prompt file"],
    ["asking it to read something else", ["read the tests"], "read the tests"],
    ["taking back the last thing said", ["and check the tests", "take that back"], "and check the tests | UNDO"],
    ["taking it back in pieces", ["take that", "back"], "UNDO"],
    ["a question about taking things back is not the command", ["can you roll that back for me"], "can you roll that back for me"],
    ["a question mentioning back", ["put the old version back"], "put the old version back"],
    ["another way of saying send", ["check the tests", "that's it"], "check the tests | SEND"],
    ["and another", ["check the tests", "over to you"], "check the tests | SEND"],
    ["read misheard as rep", ["rep prompt"], "READ"],
    ["another way of asking to hear it", ["say it back"], "READ"],
    ["another way of taking one back", ["delete last"], "UNDO"],
    ["forgetting the whole drive", ["fresh start"], "FORGET"],
    ["a question about starting things", ["how do i start the server"], "how do i start the server"],
    ["a question about deleting a file", ["delete the old migration file"], "delete the old migration file"],
    ["changing project", ["work on the voice app"], "PROJECT | the voice app"],
    ["changing project in pieces", ["work on", "the voice app"], "PROJECT | the voice app"],
    ["asking which project", ["what project are we on"], "WHERE | are we on"],
    // Politely asked, this reads as an instruction and the reader treats it as one.
    // What stops it becoming a switch is the next test but one: "the login bug" is
    // not a project, so the page puts every word back into the question.
    ["work on inside an ordinary question", ["can you work on the login bug"], "PROJECT | the login bug"],
    ["a command at the front counts", ["all done"], "SEND"],
    ["a short word that merely sounds alike is not a command", ["can you help me with this test"], "can you help me with this test"],
    ["taking a newer page", ["load the new page"], "UPDATE"],
    ["asked politely still counts", ["can you switch to the claude voice app"], "PROJECT | the claude voice app"],
    ["asked very politely", ["ok so could you please switch to the voice app"], "PROJECT | the voice app"],
    ["politeness is not passed on to claude", ["can you all done"], "SEND"],
    ["a command at the end counts", ["check the tests all done"], "check the tests | SEND"],
    ["the same words mid-sentence do not", ["it said all done and then stopped"], "it said all done and then stopped"],
    ["switching at the front counts", ["work on the voice app"], "PROJECT | the voice app"],
    ["and wiping at the end", ["no i meant something else scratch that"], "no i meant something else | WIPE"],
    ["asking what the commands are", ["what can i say"], "HELP"],
    ["asking for them in pieces", ["what can", "i say"], "HELP"],
    ["another way of asking", ["help me out"], "HELP"],
    ["and another", ["say the commands"], "HELP"],
    ["asking for help with the code is not the command", ["can you help me with this test"], "can you help me with this test"],
    ["a question about what something can say", ["what can the server say back"], "what can the server say back"],
  ];

  for (const [name, chunks, expected] of real) {
    const got = withRealPhrases(chunks);
    check(`the real phrases: ${name}`, got === expected, got === expected ? "" : `got "${got}"`);
  }
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

// Naming a project out loud, in the middle of a sentence. Getting this wrong sends
// the question to the project you just left, which answers confidently about the
// wrong code — so it is worth testing rather than discovering at seventy miles an hour.
// The noises people make while thinking should never reach Claude, and taking them
// out must not take any meaning with them. The two halves of that are tested
// together: what comes out, and what must stay in.
function checkFillerComesOut() {
  const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  const parts = [/const NOISES = [\s\S]*?\];/, /const STALLS = [\s\S]*?\n\];/, /function withoutFiller[\s\S]*?\n}/]
    .map((one) => page.match(one))
    .filter(Boolean)
    .map((m) => m[0]);
  if (parts.length !== 3) {
    check("the page can be read for filler words", false, `found ${parts.length} of 3 parts`);
    return;
  }

  const strip = new Function(`${parts.join("\n")}; return withoutFiller;`)();

  const cases = [
    ["a noise in the middle", "check the um tests", "check the tests"],
    ["a noise at the front", "er look at the login bug", "look at the login bug"],
    ["nothing but a noise", "um", ""],
    ["a stall at the front", "well the tests are failing", "the tests are failing"],
    ["two stalls stacked up", "well you know the tests are failing", "the tests are failing"],
    ["a stall at the end", "have a look at the tests you know", "have a look at the tests"],
    ["a stall in the middle keeps its meaning", "you know the tests you know about", "the tests you know about"],
    ["an ordinary sentence is left alone", "what changed in the last commit", "what changed in the last commit"],
    ["words that only look like noises stay", "ering on the side of caution", "ering on the side of caution"],
    ["the word so as a real word", "so the build is broken", "the build is broken"],
    ["punctuation left behind is tidied", "well, the tests are failing", "the tests are failing"],
    ["nothing at all", "", ""],
  ];

  for (const [name, said, expected] of cases) {
    const got = strip(said);
    check(`filler: ${name}`, got === expected, got === expected ? "" : `got "${got}"`);
  }
}

// Deciding a thought is finished is what saves saying the send phrase every time, and
// the only failure that actually costs anything is calling something finished when it
// was not — that interrupts. So the cases here lean hard on the unfinished side.
function checkFinishedThoughts() {
  const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  const parts = [
    /const plainWords[\s\S]*?;\n/,
    /const NOISES = [\s\S]*?\];/,
    /const STALLS = [\s\S]*?\n\];/,
    /function withoutFiller[\s\S]*?\n}/,
    /const CANNOT_END = [\s\S]*?\n\]\);/,
    /function soundsFinished[\s\S]*?\n}/,
  ].map((one) => page.match(one)).filter(Boolean).map((m) => m[0]);
  if (parts.length !== 6) {
    check("the page can be read for finished thoughts", false, `found ${parts.length} of 6 parts`);
    return;
  }

  const finished = new Function(`${parts.join("\n")}; return soundsFinished;`)();

  const cases = [
    ["a plain question", "what changed in the last commit", true],
    ["an instruction", "run the tests", true],
    ["a short question", "any failures", true],
    ["hanging on a joining word", "check the tests and", false],
    ["hanging on a pointing word", "what changed in the", false],
    ["hanging on a linking word", "have a look at the tests for", false],
    ["hanging on a helper verb", "the build is", false],
    ["trailing off with a noise", "can you look at the um", false],
    ["a noise after a finished sentence", "run the tests um", true],
    ["one word is never enough", "tests", false],
    ["nothing said", "", false],
    ["ending on a question word", "tell me what", false],
    ["a finished sentence with a full stop", "look at the tests.", true],
  ];

  for (const [name, said, expected] of cases) {
    const got = finished(said);
    check(`finished: ${name}`, got === expected, got === expected ? "" : `said ${got}`);
  }
}

function checkPickingAProject(names) {
  const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  const source = page.match(/  function projectAtTheFront[\s\S]*?\n  }/);
  if (!source) {
    check("the page can pick a project out of a sentence", false, "couldn't find that part");
    return;
  }

  const helpers = ["function howItSounds", "function nearlySame"]
    .map((start) => page.match(new RegExp(`${start}[\\s\\S]*?\\n}`))[0])
    .join("\n");

  const pick = new Function(
    "setup",
    `${helpers}\n${source[0].replace(/^  /gm, "")}; return projectAtTheFront;`,
  )(names);

  const shape = (said) => {
    const found = pick(said);
    return found ? `${found.project}${found.rest ? ` + "${found.rest}"` : ""}` : "not a project";
  };

  const cases = [
    ["its plain name", "the voice app", "the voice app"],
    ["without the the", "voice app", "the voice app"],
    ["what he actually calls it", "the voice claude app", "the voice app"],
    ["the longer name is not read as the shorter one", "voice claude app", "the voice app"],
    ["a name with the question stuck to it", "the voice app and check the tests", 'the voice app + "and check the tests"'],
    ["the advisor app", "advisor", "the advisor app"],
    ["something that is not a project at all", "the login bug", "not a project"],
    ["a project named part-way through is not one", "some thing the voice app", "not a project"],
    ["the name mangled by dictation", "the clot voice app", "the voice app"],
    ["mangled, with the question stuck to it", "the clot voice app and file the issue", 'the voice app + "and file the issue"'],
    ["just the giveaway word", "voice", "the voice app"],
    ["a giveaway word buried later is only a word", "the thing that broke when i said advisor", "not a project"],
  ];

  for (const [name, said, expected] of cases) {
    const got = shape(said);
    check(`naming a project: ${name}`, got === expected, got === expected ? "" : `got "${got}"`);
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

  const spoken = Object.entries(setup.phrases ?? {}).map(([name, said]) => [name, [said].flat()]);
  const everyWording = spoken.flatMap(([, wordings]) => wordings);
  check(
    "tells the phone what it can be told to do",
    spoken.length >= 4 && everyWording.length > 0,
    spoken.map(([name, wordings]) => `${name} (${wordings.length})`).join(", "),
  );
  // One word fires by accident all day long.
  check(
    "every wording is at least two words",
    everyWording.every((phrase) => phrase.trim().split(/\s+/).length >= 2),
    everyWording.filter((phrase) => phrase.trim().split(/\s+/).length < 2).join(", ") || "all fine",
  );

  // The help list is only worth having if it covers everything. It is built from the
  // commands themselves so it cannot miss one, but a command with no description gets
  // read out with no explanation, which is a poor showing — so say which.
  const undescribed = spoken.map(([name]) => name).filter((name) => !(setup.whatEachDoes ?? {})[name]);
  check(
    "every command has something to say about itself",
    undescribed.length === 0,
    undescribed.join(", ") || "all described",
  );

  // These are single words, which is only safe because they are deaf outside the few
  // seconds after it has asked you something. If one ever appears in the list above,
  // that reasoning is gone and it would fire mid-question.
  const answers = [setup.answers?.yes ?? [], setup.answers?.no ?? []].flat();
  check("it can be answered yes or no", answers.length >= 4, `${answers.length} wordings`);
  check(
    "no answer word doubles as a command",
    answers.every((word) => !everyWording.includes(word)),
    answers.filter((word) => everyWording.includes(word)).join(", ") || "none overlap",
  );
  check(
    "it stops to ask before reading out a long list",
    Number(setup.readOutPage) >= 1 && Number(setup.readOutPage) < spoken.length,
    `${setup.readOutPage} at a time, ${spoken.length} commands`,
  );

  checkItKnowsItsOwnVoice();
  checkFillerComesOut();
  checkFinishedThoughts();
  checkTheGate(setup.phrases);
  checkPickingAProject({ projectNames: setup.projectNames, giveaways: setup.giveaways });
} finally {
  server.kill("SIGTERM");
}

const failed = results.filter((r) => !r.passed);
for (const r of results) {
  console.log(`${r.passed ? "ok  " : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(failed.length ? `\n${failed.length} failed.` : `\nAll ${results.length} fine.`);
process.exit(failed.length ? 1 : 0);
