// Boots the server the way a drive would and checks the parts that are easy to
// break and hard to notice until you are moving. It deliberately runs with no
// OpenAI credential in the environment: the free mode has to work for someone who
// does not have one at all.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { isInstalled as tidyUpInstalled, whatItMeant, whyNotToTrust } from "./cleanup.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PORT = 8799; // not the real one, so this never fights a live session

// The certificate is this machine's own, so the check has to accept it.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const env = { ...process.env, VOICE_CLAUDE_PORT: String(PORT) };
delete env.OPENAI_API_KEY;

// Pointed at a scratch file, and this one is not optional. The app now sweeps up what
// a previous run left behind the moment it starts, so a check that shared the real
// record would end the voice and the tidy-up belonging to a live session — this test
// killing the app somebody is actually driving with. Isolation here is a safety
// measure, not tidiness.
const scratchRunning = path.join(root, ".voice-claude", "running.check.json");
env.VOICE_CLAUDE_RUNNING_FILE = scratchRunning;
fs.rmSync(scratchRunning, { force: true });
// And it must not close a session somebody has walked away from to a desk. Sweeping
// those is right when the app really starts and wrong when a test does.
env.VOICE_CLAUDE_LEAVE_HANDOVERS = "1";
// Its own conversation helper, on its own socket. Stopping now genuinely stops that
// helper — which is the point of the change — and the one this machine is really using
// must not be the one a test stops. Sharing it would mean running the checks ended the
// conversations of whoever was mid-drive.
env.VOICE_CLAUDE_SESSION_SOCKET = path.join(root, ".voice-claude", "session.check.sock");

const server = spawn("node", [path.join(here, "index.mjs")], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });

let banner = "";
server.stdout.on("data", (c) => (banner += c.toString()));
server.stderr.on("data", (c) => (banner += c.toString()));

const base = `https://127.0.0.1:${PORT}`;
const results = [];

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
}

// Ending things is the one job here that can do real harm if it is wrong. Every other
// fault in this app costs a repeated question; this one can kill somebody's editor. So
// the refusals are checked harder than the successes.
async function checkItOnlyEndsItsOwn() {
  const scratch = path.join(root, ".voice-claude", "running.rules.json");
  process.env.VOICE_CLAUDE_RUNNING_FILE = scratch;
  fs.rmSync(scratch, { force: true });

  // Loaded fresh so it reads the scratch file rather than anything already held.
  const register = await import(`./running.mjs?rules=${Date.now()}`);
  const held = [];
  const holdOne = () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    held.push(child);
    return child;
  };
  const alive = (pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  try {
    // ---- a record whose process has gone is dropped, not acted on ----
    const shortLived = spawn("sleep", ["30"], { stdio: "ignore" });
    register.noteStarted({ what: "something brief", pid: shortLived.pid, rule: register.WITH_THE_APP });
    shortLived.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 300));
    const gone = register.end(register.written().find((e) => e.pid === shortLived.pid));
    check("a record whose process has gone is simply dropped", gone.ended === false, gone.why);
    check("and the record goes with it", !register.written().some((e) => e.pid === shortLived.pid));

    // ---- THE ONE THAT MATTERS: a number that now belongs to something else ----
    //
    // Process numbers get reused. A record naming something that has died and had its
    // number handed to a browser or an editor must never be acted on. This is checked
    // by writing down a record that deliberately does not match the process wearing
    // that number, and requiring that the process survives.
    const stranger = holdOne();
    register.noteStarted({ what: "a stranger", pid: stranger.pid, rule: register.WITH_THE_APP });
    const all = register.written();
    const wrong = all.map((e) =>
      e.pid === stranger.pid ? { ...e, startedAt: "Mon Jan  1 00:00:00 2001", command: "/not/what/is/there" } : e,
    );
    fs.writeFileSync(scratch, `${JSON.stringify(wrong, null, 2)}\n`);
    const refused = register.end(wrong.find((e) => e.pid === stranger.pid));
    check("it refuses to end a number that now belongs to something else", refused.ended === false, refused.why);
    check("and the process it refused to end is still alive", alive(stranger.pid));

    // ---- the same refusal at startup, where the sweep runs unattended ----
    fs.writeFileSync(scratch, `${JSON.stringify(wrong, null, 2)}\n`);
    const swept = register.sweep();
    check("the startup sweep refuses it too", alive(stranger.pid) && swept.swept.length === 0);
    check("and clears the record rather than trying again forever", register.written().length === 0);

    // ---- the three kinds end on the right occasions and not the wrong ones ----
    const goesWithIt = holdOne();
    const survivesRestart = holdOne();
    const outlives = holdOne();
    register.noteStarted({ what: "a helper", pid: goesWithIt.pid, rule: register.WITH_THE_APP });
    register.noteStarted({ what: "the conversation helper", pid: survivesRestart.pid, rule: register.ACROSS_RESTARTS });
    register.noteStarted({ what: "a handover", pid: outlives.pid, rule: register.OUTLIVES_ON_PURPOSE });

    register.endEverything([register.WITH_THE_APP]); // what a restart does
    await new Promise((r) => setTimeout(r, 300));
    check("restarting ends what only serves the running app", !alive(goesWithIt.pid));
    check("restarting leaves the conversation helper alone", alive(survivesRestart.pid));
    check("restarting leaves a handed-over session alone", alive(outlives.pid));

    register.endEverything([register.WITH_THE_APP, register.ACROSS_RESTARTS]); // a deliberate stop
    await new Promise((r) => setTimeout(r, 300));
    check("stopping for good ends the conversation helper too", !alive(survivesRestart.pid));
    check("but a handed-over session still outlives it", alive(outlives.pid));

    // ---- and it can say what it has, in words ----
    const said = register.whatIsRunning();
    const handover = said.find((one) => one.pid === outlives.pid);
    check(
      "it can say what is running and why, in words",
      Boolean(handover?.whyItIsStillHere) && handover.running === true,
      handover?.whyItIsStillHere ?? "said nothing",
    );
  } finally {
    for (const child of held) { try { child.kill("SIGKILL"); } catch {} }
    fs.rmSync(scratch, { force: true });
    process.env.VOICE_CLAUDE_RUNNING_FILE = scratchRunning;
  }
}

// The limits on the Python side are its own check, run here so one command still
// answers "is this sound". Skipped rather than failed when Python is missing: not
// having it is a fair state for this app to be in, and a check that fails for that
// reason teaches people to ignore failures.
function checkConversationsAreLetGoOf() {
  const test = path.join(here, "session", "check-limits.py");
  const python = ["python3", "/usr/bin/python3"].find((p) => {
    try { execFileSync(p, ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
  });
  if (!python) return check("conversations are let go of", true, "no python here — skipped");
  try {
    const out = execFileSync(python, [test], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const failed = (out.match(/^FAIL/gm) ?? []).length;
    const passed = (out.match(/^ok/gm) ?? []).length;
    check("conversations are let go of when idle, and capped", failed === 0, `${passed} checks`);
  } catch (err) {
    check("conversations are let go of when idle, and capped", false, (err.stdout ?? err.message).toString().trim().split("\n").pop());
  }
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
    // "no" is now treated as throat-clearing in front of an instruction and dropped,
    // rather than passed on to Claude as part of the question. That is the intent.
    ["starting the question again", ["no scratch that", "what about the tests"], "WIPE | what about the tests"],
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
    // "back" is held at the end of a piece of speech, because it could still become
    // "back to the advisor app". It is shown on screen while held and delivered the
    // moment the next words arrive, so nothing is lost — but it is not delivered
    // inside this one chunk, and the test says so honestly.
    ["a question mentioning back", ["put the old version back"], "put the old version | back"],
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
    ["a question about what something can say", ["what can the server say back"], "what can the server say | back"],
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
// The tidy-up rewrites what somebody said before Claude acts on it, and the only
// thing standing between a small model having an off day and an instruction that
// nobody gave is this. It is checked without the model, on purpose: the cases that
// matter are the ones the model produces rarely, and waiting for one to happen is
// not a test.
function checkTheGuard() {
  const words = ["Claude", "Claude Code", "trace log"];
  const cases = [
    ["ordinary tidying is trusted", "um can you check the tests", "Can you check the tests?", true],
    ["a hesitation removed is trusted", "so like what does the gate do", "What does the gate do?", true],
    ["a word repaired by sound is trusted", "look at the cloud code bridge", "Look at the Claude Code bridge.", true],
    ["a word invented is refused", "the meeting is at two sorry three pm", "The meeting is at two and three pm.", false],
    ["an instruction invented is refused", "have a look at the tests", "Have a look at the tests and delete the old ones.", false],
    ["half the sentence lost is refused", "check the tests and then look at the login bug and the trace log", "Check the tests.", false],
    ["a spoken word used twice over is refused", "no not yet is that a model he created", "No, not yet \u2014 that's not a model he created.", false],
    ["answering instead of repairing is refused", "what does the gate do", "Sure! The gate decides what reaches Claude.", false],
    ["nothing at all is refused", "what does the gate do", "", false],
  ];

  for (const [name, heard, repaired, shouldTrust] of cases) {
    const why = whyNotToTrust(heard, repaired, words);
    const trusted = why === "";
    check(`the guard: ${name}`, trusted === shouldTrust, trusted ? "trusted" : why);
  }

  check("the tidy-up never stops a question", typeof tidyUpInstalled() === "boolean");
}

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

  // What it says during a long wait. Saying one step and dropping the other forty is
  // the thing this replaced, so the counting is the part that has to be right.
  const gathered = page.match(/const COUNTED = [\s\S]*?\n}/);
  if (!gathered) {
    check("the page can be read for what happened", false);
  } else {
    const whatHappened = new Function(`${gathered[0]}; return whatHappened;`)();
    const gatherings = [
      ["nothing yet", [], ""],
      ["one step", ["reading cleanup"], "Read cleanup."],
      ["two of a kind are named", ["reading cleanup", "reading conversations"],
        "Read cleanup and conversations."],
      ["a pile of them is counted", ["reading a", "reading b", "reading c", "reading d"],
        "Read four files."],
      ["the same step over and over is one step", ["reading a", "reading a", "reading a"], "Read a."],
      ["different kinds are joined up", ["reading a", "changing b", "searching for resume"],
        "Read a, changed b, then searched for resume."],
      ["a sentence is kept whole and goes last",
        ["reading a", "reading b", "Run the checks"], "Read a and b, then Run the checks."],
      ["only the last couple of sentences survive",
        ["one thing", "another thing", "a third thing"], "Another thing, then a third thing."],
    ];
    for (const [name, steps, expected] of gatherings) {
      const got = whatHappened(steps);
      check(`what happened: ${name}`, got === expected, got === expected ? "" : `said "${got}"`);
    }
  }

  // The model's opinion on top of the words. Only one word means anything; a model
  // that starts explaining itself has left the sheet behind and gets no vote.
  const heard = [
    ["sure he is still going", 0.97, true],
    ["sure he has finished", 0.05, false],
    ["barely leaning either way", 0.5, null],
    ["leaning, but not enough to act on", 0.75, null],
    ["leaning the other way, still not enough", 0.3, null],
    ["no model there at all", null, null],
    ["nonsense instead of a number", "MORE", null],
  ];
  for (const [name, leaning, expected] of heard) {
    const got = whatItMeant(leaning);
    check(`the pause, read as: ${name}`, got === expected, got === expected ? "" : `read as ${got}`);
  }

  // How long it waits, given the words and the model. The one that matters is the
  // last: a finished-looking sentence that the model says is mid-thought must not be
  // asked about on the short clock.
  const waits = page.match(/function waitBefore[\s\S]*?\n  }/);
  if (!waits) {
    check("the page can be read for how long it waits", false);
    return;
  }
  const waitBefore = new Function(`const setup = {}; ${waits[0]}; return waitBefore;`)();
  check("a finished sentence is asked about quickly", waitBefore(true, null) === 1_500);
  check("an unfinished one is left alone a long while", waitBefore(false, null) === 10_000);
  check("the model can hold off a finished-sounding sentence",
    waitBefore(true, true) === 10_000);
  check("the model can bring forward an unfinished-looking one, but not all the way",
    waitBefore(false, false) === 3_000);
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

// Claude cannot see which folder it is in. Everything it believes about where it is
// comes from what it was told, so the telling has to be right on two counts: a bare
// mention of a project must not read as a switch already made, and where we are must
// be repeated rather than said once and trusted for the rest of the conversation.
// Both were wrong on the drive of 2026-08-15 and work landed in the wrong project.
async function checkItSaysWhereWeAre() {
  // The wording first, because the fault was entirely in what it said. Naming a
  // project used to be described as switching to it, which is how a passing mention
  // became a switch the model believed had already happened.
  const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");
  check(
    "switching is described by the words that actually do it",
    /"work on" \(or "switch to"\)/.test(source),
  );
  check(
    "naming a project is not described as switching to it",
    !/It takes effect at once/.test(source) && /never perform the switch yourself/.test(source),
  );

  const { openingFor } = await import("./claude-bridge.mjs");
  if (typeof openingFor !== "function") {
    check("what Claude is given can be examined", false, "the bridge no longer offers it");
    return;
  }

  const asked = {
    request: "what did we decide",
    briefing: "SPEAK PLAINLY. You are on the advisor app.",
    standing: "You are on the advisor app, at /somewhere.",
  };

  const resumed = openingFor({ ...asked, resume: "an-earlier-conversation" });
  check(
    "a continued conversation is still told where it is",
    resumed.includes(asked.standing) && !resumed.includes("SPEAK PLAINLY"),
  );

  const first = openingFor({ ...asked, resume: null });
  check(
    "a fresh conversation gets the whole briefing",
    first.includes("SPEAK PLAINLY") && first.endsWith(asked.request),
  );
}

// Remembering the conversation is only worth anything if it survives the app dying,
// keeps the projects apart, and knows when it has nothing to offer. All three are
// invisible from the driver's seat until the moment they are wrong.
async function checkItRemembersPerProject() {
  const scratch = path.join(root, ".voice-claude", "check-conversations.json");
  process.env.VOICE_CLAUDE_MEMORY_FILE = scratch;
  fs.rmSync(scratch, { force: true });

  // Imported fresh each run so it reads the scratch file, not the real one.
  const memory = await import(`./conversations.mjs?check=${results.length}`);
  const { forget, gapPhrase, recall, remember } = memory;

  try {
    check("with nothing remembered, it starts clean", recall("/a") === null);

    remember("/a", "aaa");
    remember("/b", "bbb");
    check("it hands back the same project's conversation", recall("/a")?.id === "aaa");
    check("two projects never share a conversation", recall("/b")?.id === "bbb");

    // The real test of it: the store is a file, so a fresh reader sees it too. That
    // is exactly what happens when the app restarts.
    const afterRestart = await import(`./conversations.mjs?restart=${results.length}`);
    check("it survives the app restarting", afterRestart.recall("/a")?.id === "aaa");

    forget("/a");
    check("starting fresh clears the project you are on", recall("/a") === null);
    check("starting fresh leaves the other projects alone", recall("/b")?.id === "bbb");

    // The failure that started all this: one project used hard while another sits
    // there, and the one sitting there quietly disappears.
    remember("/a", "aaa");
    for (let i = 0; i < 50; i += 1) remember("/b", "bbb", new Date(Date.now() + i * 60_001));
    check("using one project heavily never loses another", recall("/a")?.id === "aaa");

    // A half-written store used to read as an empty one, and the next write made that
    // permanent. Now it is kept where it can still be salvaged.
    fs.writeFileSync(scratch, '{"/a": {"id": "aa');
    remember("/c", "ccc");
    check("a damaged store is set aside, not written over", fs.existsSync(`${scratch}.unreadable`));
    check("a damaged store does not stop the new conversation being kept", recall("/c")?.id === "ccc");
    fs.rmSync(`${scratch}.unreadable`, { force: true });

    // Handing the turn to a screen and taking it back. The whole point is that there
    // is one conversation, so what matters is that the handover survives the app
    // restarting, and that picking it back up ends it rather than leaving it standing.
    const { handedOver, outstandingHandover, pickedBackUp } = memory;
    remember("/d", "ddd");
    check("nothing is handed over to begin with", outstandingHandover("/d") === null);
    handedOver("/d", "a-session");
    check("a handover is remembered", outstandingHandover("/d")?.name === "a-session");
    const afterRestartAgain = await import(`./conversations.mjs?handover=${results.length}`);
    check("a handover survives the app restarting",
      afterRestartAgain.outstandingHandover("/d")?.name === "a-session");
    remember("/d", "eee");
    check("a handover outlives the conversation moving on", outstandingHandover("/d")?.name === "a-session");
    pickedBackUp("/d");
    check("picking it back up ends the handover", outstandingHandover("/d") === null);
    check("and leaves the conversation alone", recall("/d")?.id === "eee");

    const now = new Date("2026-08-15T12:00:00Z");
    check("a conversation from minutes ago is picked up silently",
      gapPhrase(new Date("2026-08-15T11:30:00Z").toISOString(), now) === null);
    check("a conversation from days ago says where it is picking up from",
      Boolean(gapPhrase(new Date("2026-08-12T12:00:00Z").toISOString(), now)));

    // What is worth saying out loud while it works. The costly mistake is reading out
    // half a written answer, or a path, at seventy miles an hour.
    const { anUpdateWorthHearing } = await import("./claude-bridge.mjs");
    const updates = [
      ["a line about what it is off to do", "Let me look at how the sending works.", "Let me look at how the sending works."],
      ["only the first sentence of it", "I'll check the tests. Then I will fix the bug.", "I'll check the tests."],
      ["a file path is not for saying", "Let me open server/index.mjs and look.", ""],
      ["code punctuation is not for saying", "The `send` function does it.", ""],
      ["the answer being written is not an update", "There are six issues open and the first is about understanding a command by meaning rather than by how it sounded, which matters because", ""],
      ["too short to mean anything", "Right.", ""],
      ["a question mid-job is not an update", "Shall I merge it?", ""],
      ["nothing at all", "", ""],
    ];
    for (const [name, said, expected] of updates) {
      const got = anUpdateWorthHearing(said);
      check(`saying where it is up to: ${name}`, got === expected, got === expected ? "" : `said "${got}"`);
    }

    // The account handed to the summary, with the written-down furniture taken out.
    // Told a path, a small model reads the path out, so it is never shown one.
    const { inPlainWords, worthSaying } = await import("./cleanup.mjs");
    const plainly = [
      ["a full path becomes a plain name", "Read /Users/x/server/conversations.mjs now", "Read conversations now"],
      ["a short path too", "found in web/index.html", "found in index"],
      ["line numbers go", "index:1214 and config:88", "index and config"],
      ["a bare file name loses its kind", "changed cleanup.mjs", "changed cleanup"],
      ["ordinary words are left alone", "the checks all passed", "the checks all passed"],
    ];
    for (const [name, before, expected] of plainly) {
      const got = inPlainWords(before);
      check(`plainly: ${name}`, got === expected, got === expected ? "" : `got "${got}"`);
    }

    const summaries = [
      ["a plain sentence", "The checks all passed and it is now changing the settings file",
        "The checks all passed and it is now changing the settings file"],
      ["quoted, because small models do that", '"It found four failures"', "It found four failures"],
      ["symbols mean it went wrong", "It ran `npm run check` and it passed", ""],
      ["a stub is not worth saying", "Working.", ""],
      ["a document is not worth saying", new Array(70).fill("word").join(" "), ""],
      ["nothing at all", "", ""],
    ];
    for (const [name, said, expected] of summaries) {
      const got = worthSaying(said);
      check(`worth saying: ${name}`, got === expected, got === expected ? "" : `got "${got}"`);
    }

    // Saying which file and what it searched for is the difference between knowing
    // something is happening and knowing what is happening. But a path or a thicket of
    // symbols read aloud is worse than the vague phrase it replaced.
    const { describeTool } = await import("./claude-bridge.mjs");
    const steps = [
      ["the file being read", "Read", { file_path: "/a/b/conversations.mjs" }, "reading conversations"],
      ["a file with a hyphen in it", "Read", { file_path: "/a/self-check.mjs" }, "reading self check"],
      ["a file it cannot say", "Read", { file_path: "/a/x9$@.mjs" }, "reading the code"],
      ["nothing to go on", "Read", {}, "reading the code"],
      ["the file being changed", "Edit", { file_path: "/a/cleanup.mjs" }, "changing cleanup"],
      ["a plain search", "Grep", { pattern: "resume" }, "searching for resume"],
      ["a search full of symbols", "Grep", { pattern: "^\\s*(a|b)+$" }, "searching through the project"],
      ["what a command is for", "Bash", { description: "Run the checks" }, "Run the checks"],
      ["a command with nothing said about it", "Bash", {}, "running a command"],
      ["something not known at all", "Sparkle", {}, "working"],
    ];
    for (const [name, tool, input, expected] of steps) {
      const got = describeTool(tool, input);
      check(`what it is doing: ${name}`, got === expected, got === expected ? "" : `said "${got}"`);
    }

    // What a step came back with, cut down for the record. Both roads to Claude write
    // this, so it has to mean the same thing on each.
    const { trimmedResult } = await import("./claude-bridge.mjs");
    check("a short result is kept whole", trimmedResult("one\ntwo") === "one / two");
    check("nothing came back is nothing", trimmedResult("") === "");
    const long = trimmedResult(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    check("a long result keeps its head and tail", long.startsWith("line 0") && long.endsWith("line 39"));
    check("and says how much it dropped", long.includes("34 more lines"));

    // The open session has to fail towards the old way rather than leave somebody in
    // silence. With nothing listening, asking must give up rather than hang.
    const holder = await import("./session-holder.mjs");
    const nothingThere = await holder.isRunning();
    check("it can tell whether a session is open", typeof nothingThere === "boolean");
    let gaveUp = false;
    try {
      await holder.ask({ project: root, ask: "hello" }, () => {});
    } catch {
      gaveUp = true;
    }
    check("with no session open, asking gives up rather than hanging", gaveUp || nothingThere);

    const { lostTheConversation } = await import("./claude-bridge.mjs");
    check("it can tell a vanished conversation from a real failure",
      lostTheConversation("Error: No conversation found with session ID abc") &&
      !lostTheConversation("Error: you are out of credit"));
  } finally {
    fs.rmSync(scratch, { force: true });
    delete process.env.VOICE_CLAUDE_MEMORY_FILE;
  }
}

// A screen reading everything that happened, while the car hears its one sentence.
// The whole design rests on the record being something nobody can take from anybody
// else, so what is exercised here is mostly that: two readers, a reader that comes
// back later, a conversation replaced underneath one, and a line caught half-written.
async function checkAScreenCanWatch() {
  const scratch = path.join(root, ".voice-claude", "check-watching.json");
  const kept = path.join(root, ".voice-claude", "check-transcripts");
  const project = "/tmp/a-project";
  const folder = path.join(kept, project.replace(/[^a-zA-Z0-9]/g, "-"));

  process.env.VOICE_CLAUDE_MEMORY_FILE = scratch;
  process.env.VOICE_CLAUDE_TRANSCRIPTS = kept;
  fs.rmSync(scratch, { force: true });
  fs.rmSync(kept, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });

  const watching = await import(`./watching.mjs?check=${results.length}`);
  const { remember } = await import(`./conversations.mjs?watching=${results.length}`);

  const file = (id) => path.join(folder, `${id}.jsonl`);
  const said = (text) =>
    `${JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:00Z", message: { role: "assistant", content: [{ type: "text", text }] } })}\n`;
  const step = (name, why) =>
    `${JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:00Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name, input: { description: why } }] } })}\n`;
  const came = (text) =>
    `${JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: text }] } })}\n`;

  try {
    check("with nothing said yet, a screen is told so rather than shown nothing",
      watching.since(project).happenings.length === 0 && Boolean(watching.since(project).waiting));

    remember(project, "one");
    fs.writeFileSync(file("one"), said("hello") + step("Bash", "look at the tests") + came("all fine"));

    const first = watching.since(project);
    check("a screen sees everything that happened", first.happenings.length === 3,
      `${first.happenings.length} things`);
    check("it sees what was said", first.happenings[0].kind === "said" && first.happenings[0].text === "hello");
    check("it sees each step and what it was for",
      first.happenings[1].kind === "step" && first.happenings[1].why === "look at the tests");
    check("it sees what came back", first.happenings[2].kind === "result" && first.happenings[2].text === "all fine");

    check("looking again shows nothing twice", watching.since(project, first.place).happenings.length === 0);

    // The point of the whole thing: one screen reading changes nothing for anybody
    // else. The account the car reads empties as it is read, which is exactly why a
    // second viewer could not be pointed at it.
    const second = watching.since(project);
    check("a second screen sees the same, whole", second.happenings.length === 3);
    check("and the first screen is unaffected", watching.since(project, first.place).happenings.length === 0);

    fs.appendFileSync(file("one"), said("more"));
    const later = watching.since(project, first.place);
    check("it is handed only what is new", later.happenings.length === 1 && later.happenings[0].text === "more");

    // The file is being written to while it is read, so the last line is regularly a
    // fragment. Treating one as an entry would put something on the screen that was
    // never true.
    fs.appendFileSync(file("one"), '{"type": "assistant", "message": {"role": "assist');
    const mid = watching.since(project, later.place);
    check("a half-written line is never shown", mid.happenings.length === 0);
    fs.appendFileSync(file("one"), 'ant", "content": [{"type": "text", "text": "finished"}]}}\n');
    const done = watching.since(project, mid.place);
    check("and appears the moment it is complete",
      done.happenings.length === 1 && done.happenings[0].text === "finished");

    // A screen that carried on counting into a different conversation would show
    // nonsense with total confidence, so it starts again and says why.
    remember(project, "two");
    fs.writeFileSync(file("two"), said("a fresh start"));
    const moved = watching.since(project, done.place);
    check("a new conversation is shown from the beginning", moved.happenings.length === 1);
    check("and the screen is told that is what happened", moved.startedAgain === true && Boolean(moved.note));

    // Falling behind what is left has to be said out loud. Handing back whatever is
    // there now is how a viewer ends up quietly lying about what it has seen.
    fs.writeFileSync(file("two"), said("rewritten"));
    const rewound = watching.since(project, watching.placeOf("two", 99_999));
    check("a place that no longer exists is admitted, not papered over",
      rewound.startedAgain === true && Boolean(rewound.note));

    fs.writeFileSync(file("two"), came("x".repeat(9_000)));
    const big = watching.since(project);
    check("a huge result is bounded but says how much was left out",
      big.happenings[0].dropped > 0 && big.happenings[0].text.length < 9_000,
      `${big.happenings[0].dropped} left out`);

    // The record is Claude Code's own file, which nothing here writes to — so a
    // screen keeps working across the app restarting, which happens constantly.
    const afterRestart = await import(`./watching.mjs?restart=${results.length}`);
    check("a screen carries on after the app restarts",
      afterRestart.since(project).happenings.length === 1);
  } finally {
    fs.rmSync(scratch, { force: true });
    fs.rmSync(kept, { recursive: true, force: true });
    delete process.env.VOICE_CLAUDE_MEMORY_FILE;
    delete process.env.VOICE_CLAUDE_TRANSCRIPTS;
  }
}

// An answer comes back the way the question went in: spoken to the car, written to
// the screen. That rule rests on a single line in the driving page, and until now the
// only thing guarding it was a search for that line's own text — which would still
// have passed if the line were moved below the speaking, or turned around so that
// typed answers were the only ones read out. So the page's ear is lifted out and fed
// real frames, and the refusals are checked alongside the successes: a check that only
// proves silence would also pass if the page had gone deaf altogether.
function checkAnswersGoBackTheWayTheyCame() {
  const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  const source = page.match(/function listenForResults[\s\S]*?\n}/);
  if (!source) {
    check("the driving page stays quiet about anything typed", false, "couldn't find that part of the page");
    return;
  }

  // Everything the lifted piece leans on, stubbed so it can run outside a browser.
  // What each frame did is recorded rather than acted on.
  function run(frames) {
    const seen = { handled: [], remembered: null, yourLine: null, restarted: false };
    const build = new Function(`
      let results = null;
      let lastAnswer = null;
      let wasRestarting = false;
      let running = false;
      const yourLineBox = { textContent: null };
      const seen = arguments[0];
      const yourLastLine = yourLineBox;
      const trace = () => {};
      const log = () => {};
      const setState = () => {};
      const comeBackFresh = () => { seen.restarted = true; };
      const checkForANewPage = () => {};
      class EventSource {
        constructor() { this.onmessage = null; this.onerror = null; }
        addEventListener() {}
      }
      ${source[0]}
      listenForResults((kind, text) => seen.handled.push([kind, text]));
      return (frame) => {
        results.onmessage({ data: JSON.stringify(frame) });
        seen.remembered = lastAnswer;
        seen.yourLine = yourLineBox.textContent;
      };
    `)(seen);
    for (const frame of frames) build(frame);
    return seen;
  }

  const answer = "The tests pass, and the migration is the only file left.";

  // Typed: nothing may reach the part of the page that speaks, and nothing may be
  // remembered as the last answer either — what is remembered is what gets read out
  // again and what its own voice is judged against, so a typed answer landing there
  // would come out of the speaker by another road.
  const typedFinal = run([{ kind: "final", text: answer, how: "typed" }]);
  check("a typed answer never reaches the part that talks", typedFinal.handled.length === 0,
    typedFinal.handled.map(([kind]) => kind).join(", ") || "nothing came through");
  check("and a typed answer is not remembered as the last thing said", typedFinal.remembered === null);

  // The repaired-question frame comes before the answer, so if the refusal ever moved
  // below it the driver would watch their own screen rewrite itself with somebody
  // else's typing. This is what catches the line being moved rather than removed.
  const typedTidy = run([{ kind: "tidied", text: "what changed in the migration", how: "typed" }]);
  check("and a typed question never rewrites the driver's own line", typedTidy.yourLine === null);

  // The other direction, which is the half that catches the refusal being turned
  // around or the page simply going deaf: spoken frames must still get through.
  const spoken = run([{ kind: "final", text: answer, how: "spoken" }]);
  check("a spoken answer still gets through to be read out",
    spoken.handled.length === 1 && spoken.handled[0][1] === answer);
  check("and a spoken answer is remembered as the last thing said", spoken.remembered === answer);

  const spokenTidy = run([{ kind: "tidied", text: "what changed in the migration", how: "spoken" }]);
  check("and a spoken question does rewrite the driver's own line",
    spokenTidy.yourLine === "you: what changed in the migration");

  // Nothing arrives without the word today, because the one road in always attaches
  // it. If one ever did it came from the spoken side, which is what the server assumes
  // when nothing says otherwise — so the two ends agree rather than quietly differing.
  const unlabelled = run([{ kind: "final", text: answer }]);
  check("a frame with nothing said about where it came from is treated as spoken",
    unlabelled.handled.length === 1);
}

// The drawing half of the screen. Lifted out of the page and run here against a
// pretend document, for the same reason the voice check is: a thing only ever
// exercised by looking at it is a thing nobody notices has broken.
function checkTheScreenCanDrawIt() {
  const page = fs.readFileSync(path.join(root, "web", "watching.html"), "utf8");
  const pieces = ["line", "label", "body", "readable"].map((name) =>
    page.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n      }`)),
  );
  const clock = page.match(/const at = \([\s\S]*?;\n/);
  if (pieces.some((piece) => !piece) || !clock) {
    check("the screen's drawing can be found in the page", false, "couldn't find those parts");
    return;
  }

  const made = [];
  const document = {
    createElement: (tag) => {
      const el = {
        tag,
        className: "",
        textContent: "",
        children: [],
        append(...kids) { this.children.push(...kids); },
      };
      made.push(el);
      return el;
    },
  };
  const draw = new Function(
    "document",
    `${clock[0]}${pieces.map((p) => p[0]).join("\n")}; return line;`,
  )(document);

  const text = (el) => [el.textContent, ...el.children.map(text)].join(" ");

  const said = draw({ kind: "said", when: "2026-01-01T09:00:00Z", text: "here is the answer" });
  check("the screen shows what was said", text(said).includes("here is the answer"));

  const step = draw({ kind: "step", name: "Bash", why: "run the checks", detail: { command: "npm run check" } });
  check("the screen shows a step and what it was for", text(step).includes("run the checks"));
  // What you would have typed, rather than a record of what you would have typed.
  check("the screen shows the command itself", text(step).includes("npm run check"));

  const result = draw({ kind: "result", text: "all fine", dropped: 1_234 });
  check("the screen shows what came back", text(result).includes("all fine"));
  check("and says how much of it was left out", text(result).includes("1,234"));

  const briefing = draw({ kind: "asked", text: "the standing briefing", background: true });
  // Folded away, never dropped: a screen showing less than what happened is worse
  // than one showing it dully.
  check("background is folded rather than hidden",
    briefing.children.some((kid) => kid.tag === "details") && text(briefing).includes("the standing briefing"));
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

  await checkItOnlyEndsItsOwn();
  checkConversationsAreLetGoOf();
  checkItKnowsItsOwnVoice();
  checkTheGuard();
  checkFillerComesOut();
  checkFinishedThoughts();
  checkTheGate(setup.phrases);
  checkPickingAProject({ projectNames: setup.projectNames, giveaways: setup.giveaways });
  await checkItSaysWhereWeAre();
  await checkItRemembersPerProject();
  await checkAScreenCanWatch();
  checkTheScreenCanDrawIt();
  checkAnswersGoBackTheWayTheyCame();

  const watchingPage = await (await fetch(`${base}/watching`)).text();
  check("serves the page a screen watches from", watchingPage.includes("/watching/since"));
  // Typing and talking are two modes rather than a mixture. The refusal itself is
  // exercised for real further up, by feeding the page's ear actual frames; all that
  // is left here is that the screen offers somewhere to type and says on the box what
  // will happen to it.
  const watchPage = await (await fetch(`${base}/watching`)).text();
  check("the watching screen has somewhere to type", watchPage.includes('id="typed"') && watchPage.includes("/typed"));
  check("and the typing box says on it that nothing will be read out", watchPage.includes("read out loud"));

  const nothing = await fetch(`${base}/typed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request: "   " }),
  });
  check("an empty typed question is refused rather than started", nothing.status === 400, `got ${nothing.status}`);

  const cleared = await (await fetch(`${base}/never-mind`, { method: "POST" })).json();
  check("typed questions waiting their turn can be dropped", typeof cleared.dropped === "number");

  const watchingFeed = await (await fetch(`${base}/watching/since`)).json();
  check("tells a screen which projects there are", Array.isArray(watchingFeed.projects));
  check("tells a screen where the car is", Boolean(watchingFeed.driving));
} finally {
  server.kill("SIGTERM");
}

const failed = results.filter((r) => !r.passed);
for (const r of results) {
  console.log(`${r.passed ? "ok  " : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(failed.length ? `\n${failed.length} failed.` : `\nAll ${results.length} fine.`);
process.exit(failed.length ? 1 : 0);
