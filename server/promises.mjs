// A promise to come back, and whether it has been kept.
//
// A conversation only ever runs when something arrives at it: a question from the
// person, or a notification about a background command it started itself. Nothing
// else. So "I'll tell you when it finishes" is keepable in exactly one case and
// unkeepable in every other — waiting on another program, on a file, on a machine
// coming up. It is not ignoring the promise; it is not running at all.
//
// The cure is to go and ask. This file is the part that decides when there is
// something to ask about, and whether the answer is worth passing on.

// What a promise sounds like. Deliberately narrow: every one of these is somebody
// undertaking to come back unasked, in the first person, about something not finished.
// Widening this costs questions nobody asked and, worse, interruptions — so anything
// that only might be a promise is left alone. A promise missed is today's behaviour;
// a promise imagined is a new fault.
const PROMISES = [
  /\bi'?ll (?:tell|let) you\b/i,
  /\bi'?ll (?:come|get|report|check) back\b/i,
  /\bi'?ll (?:report|say|shout|flag|update)\b/i,
  /\bi'?ll let it run\b/i,
  /\bi'?ll keep (?:an eye|watching)\b/i,
  /\bwill (?:tell|let) you (?:when|once|as soon as)\b/i,
];

// Said while asking rather than while promising. "Shall I tell you when it finishes"
// is an offer, and treating it as a promise means chasing something nobody started.
const ASKING = /\b(?:shall|should|want me to|would you like)\b/i;

/**
 * Has this answer undertaken to come back on its own?
 *
 * Judged on the end of it, because that is where somebody says what happens next. The
 * middle of a long answer is full of narration about what was done, and "I'll tell you"
 * in the middle of that is usually part of the story rather than a commitment.
 */
export function soundsLikeAPromise(text) {
  const whole = String(text ?? "").trim();
  if (!whole) return false;
  const sentences = whole.split(/(?<=[.?!])\s+/).filter(Boolean);
  const ending = sentences.slice(-3).join(" ");
  if (!PROMISES.some((one) => one.test(ending))) return false;
  // An offer is not a promise, and a question is never a promise.
  const promising = sentences.filter((one) => PROMISES.some((p) => p.test(one)));
  return promising.some((one) => !ASKING.test(one) && !one.trim().endsWith("?"));
}

// What "nothing has changed" sounds like coming back. It is asked for in those words,
// so a plain match is enough — and anything else at all is treated as news, which errs
// towards telling somebody something rather than sitting on it.
// Broadened deliberately. Getting this wrong in one direction costs another question
// two minutes later, which nobody hears; getting it wrong in the other direction ends
// the chasing on a reply that said nothing, and the promise is quietly dropped — which
// is the very fault this whole thing exists to fix.
const NOTHING_YET =
  /^\W*(?:still (?:running|going|working|waiting|at it|in progress)|not (?:yet|finished|done|back)|nothing (?:yet|new|to report)|no news|in progress|running|waiting)\b/i;

/** Is this answer worth reading out, or is it "nothing has changed"? */
export function worthWaking(text) {
  const said = String(text ?? "").trim();
  if (!said) return false;
  if (NOTHING_YET.test(said)) return false;
  // A single short line with nothing in it is not news either.
  return said.split(/\s+/).length >= 3;
}

// How the asking is worded. It says what to reply when there is nothing to say, so that
// "nothing has changed" is recognisable rather than guessed at — and it says plainly
// that nobody asked, so the conversation does not treat it as the person talking.
export const NUDGE =
  "This is the app checking, not the person — they have not said anything. " +
  "You undertook to come back when something finished. If it has finished, or anything " +
  "has gone wrong, say so now in one or two plain spoken sentences. If it is still " +
  "running and there is nothing new, reply with exactly: still running";


// Asking the one that knows.
//
// Everything else here infers what is running from what this Mac can see — files left
// by background jobs, programs in its own process list. That misses the half that
// matters: a download onto a rented box, a model loading onto a card. This machine has
// nothing to show for those and never will.
//
// The conversation knows. It started the work, it knows where it is running, and asked
// plainly it says so. So it is asked.
export const WHAT_IS_RUNNING =
  "This is the app checking, not the person — they have not said anything and are not " +
  "waiting on this. In one short line: is anything still running or still being waited " +
  "on, here or on any machine you started it on? If yes, say what it is and roughly how " +
  "long it has been going. If nothing at all is running, reply with exactly: nothing running";

/** Read an answer to that as either "nothing" or a plain line worth showing. */
export function whatItSaidIsRunning(text) {
  const said = String(text ?? "").trim();
  if (!said) return "";
  if (/^\W*nothing (?:running|is running|at all)\b/i.test(said)) return "";
  // A whole paragraph is an answer to something else, or it has misunderstood. The
  // panel wants a line, and a line is what it was asked for.
  const first = said.split(/(?<=[.?!])\s+/)[0]?.trim() ?? said;
  return first.split(/\s+/).length > 40 ? "" : first;
}
