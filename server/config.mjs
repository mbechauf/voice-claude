// Everything you might want to change lives here.

import { homedir } from "node:os";
import path from "node:path";

export const PORT = Number(process.env.VOICE_CLAUDE_PORT ?? 8787);

// ---------------------------------------------------------------- the projects
//
// What you are working on right now, said out loud: "work on the voice app".
//
// This is the one setting everything else hangs off. The folder decides which
// repository an issue is filed against, which files get changed, and what Claude is
// looking at — so a project chosen by mistake files your ideas onto somebody else's
// list and edits the wrong code, quietly, while you are watching the road. Saying it
// out loud and hearing it repeated back is the whole point.
//
// The spoken name is what you would actually call it in conversation, not the name
// of the folder. Add as many as you like.
const CODE = path.join(homedir(), "Code");

// Several names each, for the same reason the commands have several wordings: you
// call a thing whatever comes to mind, and dictation drops or adds a word without
// telling you. The first name is the one it says back to you.
export const PROJECTS = {
  "the advisor app": {
    at: path.join(CODE, "Advisor-LLM"),
    alsoCalled: ["advisor", "the advisor", "advisor llm", "the advisor project"],
  },
  "the voice app": {
    at: path.join(CODE, "voice-claude"),
    alsoCalled: [
      "voice", "the voice", "voice claude", "the voice claude app", "voice claude app",
      "the voice project", "this app", "yourself",
    ],
  },
  "the knowledge app": {
    at: path.join(CODE, "Advisor-LLM-Knowledge"),
    alsoCalled: ["knowledge", "the knowledge", "knowledge app", "knowledge graph", "the knowledge branch"],
  },
  "the speech branch": {
    at: path.join(CODE, "Advisor-LLM-Speech"),
    alsoCalled: ["speech", "the speech", "speech branch", "the listening branch", "listening"],
  },
  "the resume builder": {
    at: path.join(CODE, "resume_builder"),
    alsoCalled: ["resume", "the resume", "resume builder", "the cv builder"],
  },
  "the financial overview": {
    at: path.join(CODE, "financial-overview"),
    alsoCalled: ["financial", "the financials", "financial overview"],
  },
  "aws admin": {
    at: path.join(CODE, "aws-admin"),
    alsoCalled: ["the aws admin", "aws", "the aws project"],
  },
};

// Every name it answers to, longest first — so "the voice claude app" is recognised
// as that rather than as "the voice" with three stray words after it.
export const EVERY_PROJECT_NAME = Object.entries(PROJECTS)
  .flatMap(([name, { alsoCalled = [] }]) => [name, ...alsoCalled].map((said) => ({ said, name })))
  .sort((a, b) => b.said.split(" ").length - a.said.split(" ").length);

// The word that gives each project away.
//
// Matching a whole spoken name is too brittle: "the clot voice app" is what came
// back when the app's own name was said out loud, and no amount of listing names
// catches that. But "voice" is in there, and "voice" belongs to exactly one project.
// So the giveaway words are worked out here rather than listed — every word used in
// any of a project's names, minus the ones that say nothing, minus any word that
// more than one project could claim.
const SAYS_NOTHING = new Set([
  "the", "my", "a", "an", "app", "apps", "application", "project", "code", "thing", "llm",
  "branch",
]);

const wordsUsedBy = Object.fromEntries(
  Object.entries(PROJECTS).map(([name, { alsoCalled = [] }]) => [
    name,
    new Set(
      [name, ...alsoCalled]
        .flatMap((said) => said.toLowerCase().split(/\s+/))
        .filter((word) => word && !SAYS_NOTHING.has(word)),
    ),
  ]),
);

export const GIVEAWAY_WORDS = Object.fromEntries(
  Object.entries(wordsUsedBy).map(([name, words]) => [
    name,
    [...words].filter((word) =>
      Object.entries(wordsUsedBy).every(([other, theirs]) => other === name || !theirs.has(word)),
    ),
  ]),
);

// Where a drive starts, before you have said otherwise.
export const STARTING_PROJECT = process.env.VOICE_CLAUDE_PROJECT ?? PROJECTS["the advisor app"].at;

// ------------------------------------------------------------ the voice layer
//
// Talking is two separate jobs: hearing you, and speaking back. Only one thing
// forces them together, and that is the realtime model, which does both inside a
// single billed audio stream. That convenience is the whole cost of this project,
// so the default keeps the two jobs apart and buys each one separately — today
// from the phone itself, for nothing.
//
//   "split"    — a listener and a speaker, chosen independently. Free by default.
//   "realtime" — OpenAI's speech-to-speech model. Billed per minute, both ways.
export const MODE = process.env.VOICE_CLAUDE_MODE ?? "split";

// Who does each half in split mode. A paid speech service would slot in here as
// another name, and would change nothing else in the system.
//
//   listener "device" — the phone's own dictation. Only the words leave the phone.
//   speaker  "mac"    — a proper voice generated here and sent down to the phone.
//   speaker  "device" — the phone's own built-in voice. Free, and rough to listen to
//                       for any length of time; kept as the fallback for when the
//                       Mac voice isn't installed.
export const LISTENER = process.env.VOICE_CLAUDE_LISTENER ?? "device";
export const SPEAKER = process.env.VOICE_CLAUDE_SPEAKER ?? "mac";

// Which voice. For the Mac voice these are its own names — the American women are
// af_heart and af_bella, the American men am_michael and am_adam, and the British
// pair are bf_emma and bm_george. For the phone's voice it is matched loosely
// against whatever that phone happens to offer, and empty means "let it choose".
export const SPEAKER_VOICE =
  process.env.VOICE_CLAUDE_SPEAKER_VOICE ?? (SPEAKER === "mac" ? "af_heart" : "");

// How fast it reads answers out. Slightly quick suits driving; raise it once the
// phrasing is familiar.
export const SPEAKER_RATE = Number(process.env.VOICE_CLAUDE_SPEAKER_RATE ?? 1.05);

// How it decides that something was meant for it.
//
//   "phrases" — nothing counts unless it is said between the two phrases below, and
//               a silence never sends anything. You decide when a question is
//               finished, because a pause in a car means you are thinking, not done.
//   "always"  — everything you say is the question, sent once you stop talking.
//               Only sane somewhere quiet with nobody else talking.
export const GATE = process.env.VOICE_CLAUDE_GATE ?? "phrases";

// The things you can say that are instructions rather than part of the question.
//
// Deliberately not names. A phone's dictation is trained on ordinary speech, so a
// proper noun it has never met comes back as whatever ordinary word sounds nearest —
// "Claude" arrived as cloud, clod, cold, clawed, and "Claude go" as "Claude girl".
// These are plain words it cannot get wrong, in an order nobody says by accident,
// and none of them turns up inside a question about code.
//
// Adding another is one line here and one line in the page. Two or more everyday
// words each: one word fires by accident all day, and an invented word never gets
// transcribed as itself.
// Each has several wordings, for two reasons. You will not remember one exact
// phrase while driving, and dictation mishears — "read prompt" comes back as "rep
// prompt" often enough to matter. Any of them does the same thing, so the one that
// comes to mind is the right one.
//
// Add to these freely. The cost of another wording is that it can no longer appear
// inside a question, so keep them to things nobody says while describing code.
export const PHRASES = {
  // That is the question — go.
  send: ["all done", "that's it", "over to you", "off you go"],

  // Read back what has been recorded so far.
  // "read the prompt" is deliberately absent: "can it read the prompt file" is a
  // real question about this project, and a wording that can appear inside a
  // question is worse than one fewer way of saying it.
  read: ["read prompt", "read it back", "read that back", "read this back", "read back", "say it back", "rep prompt"],

  // Drop the last thing said, keep the rest.
  undo: ["take that back", "take this back", "delete last", "delete the last", "scratch last"],

  // Throw the whole question away and start it again.
  wipe: ["scratch that", "scratch this", "start again", "wipe that", "wipe this"],

  // Forget the whole drive, not just this question.
  forget: ["fresh start", "forget everything"],

  // Change what you are working on: "work on the voice app". The words after it are
  // the project, matched against the list above.
  project: [
    "work on", "let's work on", "lets work on", "working on",
    "switch to", "switch over to", "switch over", "switch project to",
    // "go to" is deliberately absent: two-letter words are too easy to mishear into,
    // and it read "does it send it to the server" as an instruction.
    "change to", "move to", "over to the",
    // Cheap to add, because a switch only counts when a real project is named after
    // it. Wordings for the other commands cost something — they can appear inside a
    // question — but these cannot fire on their own.
    "back to", "let's do", "lets do", "do the", "onto the", "look at the",
  ],

  // Which one are we on? Answered by the phone, never by Claude.
  where: ["what project", "which project", "where are we"],

  // Pick up code that has just changed. Only means anything when the project being
  // worked on is this app; otherwise there is nothing new to pick up.
  restart: ["start yourself again", "restart yourself", "pick that up", "reload yourself"],

  // Take a newer version of the phone's page. Offered rather than forced, because
  // loading it costs the sound channel until you tap.
  update: ["load the new page", "take the new page", "update the page"],

  // Hand this project's conversation to a Remote Control session, so it can be picked
  // up on a screen. The whole wording is required rather than the bare two words: a
  // conversation about remote control would otherwise perform one.
  remote: ["put into remote control", "hand over to remote control", "put this into remote control"],

  // Say what all of these are. Answered by the phone itself, out of the list below —
  // it never goes to Claude, because the one moment you cannot remember a command is
  // the worst moment to wait a minute for an answer.
  help: ["what can i say", "help me out", "say the commands"],

  // Stop listening altogether, and start again. A car is full of talk that was never
  // meant for the machine — a passenger, a phone call, a podcast — and until now the
  // only way to keep it out was to stop the whole session.
  pause: ["pause", "hold on"],
  resume: ["unpause", "listen again"],
};

// What each one does, in the words it should be said aloud in.
//
// It lives beside the wordings rather than in the page for one reason: a command and
// its description go stale separately if they live apart, and a help list that lies
// is worse than none. The page builds what it says from PHRASES, so a command added
// above turns up in the spoken list whether or not it is described here — a missing
// description costs you the sentence, never the command.
export const WHAT_EACH_DOES = {
  send: "send what you have said so far",
  read: "hear back what you have said so far",
  undo: "drop just the last thing you said",
  pause: "stop listening until you say unpause",
  resume: "start listening again",
  wipe: "throw the whole question away and start it again",
  forget: "forget the whole drive, not just this question",
  help: "this list",
  project: "change what we are working on — say work on, then the project",
  where: "say which project we are on",
  restart: "start the app again, to pick up code that just changed",
  update: "load a newer version of this page, when one is waiting",
  remote: "hand this conversation to remote control, to carry on from a screen",
};

// ------------------------------------------------ words the phone has never met
//
// The tidy-up on the Mac can only put right a word it has heard of, and a phone's
// dictation is trained on ordinary speech: the words below come back as whatever
// everyday word sounds nearest, every single time. Handing the list over is what
// lets "the cloud code bridge" become "the Claude Code bridge".
//
// Only the ones that are true wherever you are working belong here. The rest are
// taken from the project itself, so a project nobody has thought about yet still
// gets its own vocabulary without anyone adding a line.
export const WORDS_WE_USE = [
  "Claude", "Claude Code", "Anthropic", "GitHub", "npm", "git", "repo", "repository",
  "commit", "branch", "pull request", "issue", "merge", "README", "dictation",
  "trace log", "endpoint", "server", "browser", "Safari", "Mac", "iPhone",
];

// ------------------------------------------------- answering a question it asked
//
// Everything above is two or more words, because a single everyday word fires by
// accident all day. These are single words, and that is safe for one reason only:
// they are not listened for. They only mean anything in the seconds after the phone
// itself has asked you something, and the window shuts the instant you say anything
// at all — an answer, or a sentence that is plainly not one. Outside that window
// "yes" is just a word in a question, exactly as it was before.
//
// Why it exists: without it, answering "more?" means saying yes AND then the send
// phrase, which is two things to remember for a one-word answer, at the moment your
// attention is on the road.
//
// Whole utterance only. "yes" is an answer; "yes and check the tests" is not, and
// falls through into the question the way it always would.
export const ANSWERS = {
  yes: ["yes", "yeah", "yep", "sure", "ok", "okay", "go on", "more", "next", "carry on"],
  no: ["no", "nope", "stop", "enough", "that's enough", "no thanks", "that'll do"],
};

// How long the phone waits for that one-word answer before deciding you have moved
// on. Long enough to think at a junction, short enough that a stray "yes" minutes
// later is just a word again.
export const ANSWER_WINDOW_MS = Number(process.env.VOICE_CLAUDE_ANSWER_WINDOW ?? 25_000);

// How many things it reads out before stopping to ask whether you want the rest.
// Two is about what survives being heard once, at speed, with traffic.
export const READ_OUT_PAGE = Number(process.env.VOICE_CLAUDE_PAGE ?? 2);

// Only used when there is no gate. How long a silence means you have finished.
export const PAUSE_MS = Number(process.env.VOICE_CLAUDE_PAUSE ?? 3_500);

// How long the gate waits before giving up on a question you started and forgot
// about. Zero means never, which is the default: nothing you did not finish
// yourself is ever sent, and nothing you were still thinking about is ever thrown
// away. Set it to a number of milliseconds if you would rather it tidied up.
export const OPEN_TIMEOUT_MS = Number(process.env.VOICE_CLAUDE_OPEN_TIMEOUT ?? 0);

// Realtime mode only. The small model is ~1/3 the price and is only ever a
// mouthpiece — it never reasons about your code — so the quality trade is close
// to free. Swap to "gpt-realtime-2.1" if it sounds bad.
export const VOICE_MODEL = process.env.VOICE_CLAUDE_MODEL ?? "gpt-realtime-2.1-mini";
export const VOICE_NAME = process.env.VOICE_CLAUDE_VOICE ?? "marin";

// ------------------------------------------------------- what it is allowed to do
//
// Permission is asked for, not enumerated.
//
// It used to be a list, and that failed exactly as a list must: it could commit and
// push but not merge, could edit files but not the one file that would have let it
// merge, and could not widen its own permissions to fix either — all discovered from
// a car, silently, with no way to grant anything. A list can only contain what its
// author thought of in advance, so the work stops wherever imagination ran out.
//
// So the check moved to where it belongs: it asks, out loud, at the moment it
// matters, and a spoken yes authorises it. That is a real safety check made by the
// person it protects, rather than a fence built last week by someone guessing.
//
// What it must ask about, and what it must never do, are in spoken-answer-rules.md —
// instructions rather than a fence, because the fence was the problem.
//
// The one thing that does not move: it still cannot change these rules. Something
// that can widen its own permissions has none.

// Refused outright, no matter what is said. Not because consent does not count, but
// because these are hard or impossible to undo, and "are you sure?" answered from
// behind the wheel is not the kind of consent they need. They wait for a desk.
export const NEVER = [
  "Bash(rm -rf:*)",
  "Bash(sudo:*)",
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(git reset --hard:*)",
  "Bash(git clean:*)",
  "Bash(gh repo delete:*)",
];

// Kept only so the older, list-based mode still works if this turns out to be a
// mistake: set this and it goes back to refusing anything not named here.
export const ONLY_THESE = process.env.VOICE_CLAUDE_ONLY_ALLOW === "on" ? [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(ls:*)",

  // Issues, added 2026-08-14 while driving, asked for out loud. The working rule is
  // that the issue list is the record and a note in a file is not — so a piece of
  // work thought up on the road has to be able to reach the list from the road,
  // otherwise it lives in a file nobody opens. Reading them matters as much as
  // writing them: without the list it cannot tell what is already known.
  //
  // Filing and reading only. Closing an issue is deliberately absent — deciding
  // something is finished is not a thing to do while you are looking at the road.
  "Bash(gh issue create:*)",
  "Bash(gh issue list:*)",
  "Bash(gh issue view:*)",

  // Adding to an issue that already exists. Missing at first, and the cost showed
  // up immediately: work done against an issue could not be recorded on it, so it
  // went into a note in a file — which is the exact thing the issue list exists to
  // prevent. Commenting adds to the record and takes nothing away.
  //
  // Editing and closing stay off. Rewriting what an issue says, or deciding
  // something is finished, are not things to do while watching the road.
  "Bash(gh issue comment:*)",

  // Checking its own work. Added 2026-08-14: it was changing code and then unable
  // to find out whether the change was any good, which is half a job. These two run
  // the checks and nothing else — starting servers and installing things stay off,
  // because those have effects that outlive the drive.
  //
  // It cannot add to this list itself, and that is the point: something that can
  // widen its own permissions has none. Widening it is a decision made here, awake.
  "Bash(npm run check:*)",
  "Bash(npm test:*)",

  // Putting its own change into effect. It watches its own files and usually
  // notices, but "usually" is not something to explain to someone driving, and
  // asking them to restart it is asking them to do the one thing they cannot.
  "Bash(npm run restart:*)",
  "Bash(npm run score:*)",

  // Committing and pushing, added 2026-08-15 while driving, asked for out loud.
  // Work that only exists in the working tree is work nobody else can see and one
  // bad afternoon away from being lost, so a change made on the road has to be able
  // to land. The old rule said no, and the cost was a drive's worth of work sitting
  // uncommitted until someone got to a desk.
  //
  // The risk is real and accepted: a push is the one thing here that leaves the
  // machine. What keeps it survivable is that every commit is visible afterwards and
  // can be undone; what would not be survivable is a force push, which is why only
  // the ordinary forms are listed.
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git push:*)",
] : null;

// How long to let a single piece of work run before giving up on it.
export const WORK_TIMEOUT_MS = Number(process.env.VOICE_CLAUDE_TIMEOUT ?? 10 * 60_000);

// Don't interrupt with a progress update more often than this.
export const PROGRESS_MIN_GAP_MS = 25_000;
