// How well does it understand what was said?
//
// Every attempt at this so far has been judged by whether the last thing that went
// wrong stopped going wrong, which is how you fix six things and break a seventh
// without noticing. This runs the real understanding against every sentence anyone
// has really said, and says plainly what it gets right and what it gets wrong.
//
// It is deliberately not part of `npm run check`. That answers "is it broken"; this
// answers "is it any good", and the second question has no pass mark — it has a
// score you are trying to move, and a list of mistakes you are trying to shorten.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EVERY_PROJECT_NAME, GIVEAWAY_WORDS, PHRASES } from "../server/config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

// The understanding itself lives in the page, so it is lifted out and run here
// rather than reimplemented — a copy would drift, and then this would be measuring
// something nobody uses.
const page = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
const pieces = [
  /const POLITENESS = [\s\S]*?\n\]\);/,
  /function howItSounds[\s\S]*?\n}/,
  /function nearlySame[\s\S]*?\n}/,
  /function phraseStartsAt[\s\S]*?\n}/,
  /const plainWords[\s\S]*?;/,
  /function makePhraseReader[\s\S]*?\n  };\n}/,
].map((pattern) => {
  const found = page.match(pattern);
  if (!found) {
    console.error("Couldn't find part of the understanding in the page. Has it moved?");
    process.exit(1);
  }
  return found[0];
});

const makePhraseReader = new Function(`${pieces.join("\n")}; return makePhraseReader;`)();

// The app does not act on a switch unless what follows actually names a project, so
// this has to apply the same test — otherwise the score flatters or damns something
// nobody experiences. Measure what happens, not what one layer of it decides.
const namesAProject = new Function(
  "setup",
  `${pieces.join("\n")}\n${page.match(/  function projectAtTheFront[\s\S]*?\n  }/)[0].replace(/^  /gm, "")}; return projectAtTheFront;`,
)({ projectNames: EVERY_PROJECT_NAME, giveaways: GIVEAWAY_WORDS });

// What it decides a sentence means. Only a command said at an edge counts, which is
// the same rule the app itself applies.
function whatItThinks(said) {
  const reader = makePhraseReader(PHRASES);
  const steps = reader.feed(said);

  for (let i = 0; i < steps.length; i += 1) {
    const command = steps[i].command;
    if (!command) continue;

    // A switch that does not name a real project is not a switch — the words go
    // back into the question, exactly as they do in the app.
    if (command === "project") {
      const after = steps[i + 1]?.say ?? reader.held();
      if (!after || !namesAProject(after)) continue;
    }
    return command;
  }
  return "none";
}

const lines = fs
  .readFileSync(path.join(root, "data", "what-was-meant.jsonl"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.said);

const wrong = [];
const missed = [];
let right = 0;

for (const { said, meant, from, note } of lines) {
  const thought = whatItThinks(said);
  if (thought === meant) { right += 1; continue; }
  (meant === "none" ? wrong : missed).push({ said, meant, thought, from, note });
}

const real = lines.filter((l) => l.from === "real").length;

console.log(`\n${right} of ${lines.length} understood — ${Math.round((right / lines.length) * 100)}%`);
console.log(`(${real} of these were really said out loud; the rest are the awkward cases)\n`);

if (wrong.length) {
  console.log(`FIRED WHEN IT SHOULD NOT HAVE (${wrong.length}) — the ones that hurt:`);
  for (const { said, thought, from } of wrong) {
    console.log(`  heard as ${thought.padEnd(8)} "${said}"${from === "real" ? "   [really said]" : ""}`);
  }
  console.log("");
}

if (missed.length) {
  console.log(`DID NOT UNDERSTAND (${missed.length}) — you say it, nothing happens:`);
  for (const { said, meant, thought, from, note } of missed) {
    const as = thought === "none" ? "nothing" : `${thought}`;
    console.log(`  meant ${meant.padEnd(8)} heard as ${as.padEnd(8)} "${said}"${from === "real" ? "   [really said]" : ""}`);
    if (note) console.log(`${" ".repeat(12)}(${note})`);
  }
  console.log("");
}

console.log(
  wrong.length
    ? "Firing wrongly is the worse of the two: it takes an action you did not ask for."
    : "Nothing fires that should not. The remaining gap is things it does not yet understand.",
);
console.log("");
