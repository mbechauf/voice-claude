// What has this app got running, and why.
//
// It exists because none of it was discoverable. Finding a six-hour-old orphan meant
// reading the machine's whole process list by hand and knowing what to look for, which
// is the same as it being invisible. Anything long-lived should be answerable for, in
// one place, in words.
//
// Asks the running app first, because only it knows what it started. Falls back to the
// written record when the app is down — which is exactly when leftovers matter most.

import { PORT } from "../server/config.mjs";
import { whatIsRunning } from "../server/running.mjs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // its certificate is its own

const say = (line = "") => console.log(line);

function show(started, conversations, handedOver) {
  if (!started.length && !conversations.length && !handedOver.length) {
    say("Nothing running.");
    return;
  }

  if (started.length) {
    say("Started by the app:");
    for (const one of started) {
      const where = one.project ? ` on ${one.project}` : "";
      const state = one.running ? `up ${one.forHowLong}` : "GONE — record left behind";
      say(`  ${one.what}${where} — ${state}`);
      say(`      ${one.whyItIsStillHere}${one.note ? `; ${one.note}` : ""}`);
    }
    say();
  }

  if (conversations.length) {
    say("Conversations held open:");
    for (const one of conversations) {
      const idle = one.idleSeconds < 60 ? "in use" : `idle ${Math.round(one.idleSeconds / 60)} minutes`;
      say(`  ${one.project} — ${idle}${one.answering ? ", answering now" : ""}`);
    }
    say();
  }

  if (handedOver.length) {
    say("Handed over to a screen:");
    for (const name of handedOver) say(`  ${name}`);
    say();
  }
}

try {
  const answer = await (await fetch(`https://127.0.0.1:${PORT}/running`)).json();
  show(answer.started ?? [], answer.conversations ?? [], answer.handedOver ?? []);
  const answering = Array.isArray(answer.answering) ? answer.answering : [];
  if (answering.length) say(`Answering right now on ${answering.join(", ")}.`);
  if (answer.queued) say(`${answer.queued} typed question${answer.queued === 1 ? "" : "s"} waiting.`);
} catch {
  // The app being down is not a reason to have no answer. What it wrote down is still
  // on disk, and anything in there still running is a leftover by definition — which
  // is the case somebody checking is most likely to care about.
  say("The app is not running. What it left written down:");
  say();
  const written = whatIsRunning();
  if (!written.length) say("  Nothing — it left nothing behind.");
  for (const one of written) {
    say(`  ${one.what}${one.project ? ` on ${one.project}` : ""} — ${one.running ? `still up, ${one.forHowLong}` : "gone"}`);
  }
  say();
  say("Anything still up here outlives the app on purpose. Starting it again clears the rest.");
}
