// Handing the conversation over to a screen.
//
// Everything else here is built for someone who cannot look at anything. This is the
// one thing that is not: the moment the drive ends, the work is mid-flight and the
// only way to carry on with it is to be able to see it. Starting again from nothing
// at a desk is how a drive's worth of context gets thrown away.
//
// Remote Control is Claude Code's own way of making a session reachable from
// elsewhere, and it is only available on an interactive session — which is exactly
// what this app does not run. Its questions are one-shot, answered and finished. So
// nothing here converts anything: it starts a fresh interactive session, points it at
// the conversation this project has been using, and turns Remote Control on. What was
// said in the car is what it opens with.

import { execFileSync, spawn } from "node:child_process";

import { recall } from "./conversations.mjs";

// A detached terminal to live in. An interactive session needs one — run without it,
// Claude Code has nothing to draw on and exits — and there is nobody at the keyboard
// here to provide it. Screen ships with macOS, which is the whole reason it is this
// rather than something nicer.
const TERMINAL = "/usr/bin/screen";

const nameFor = (project) => `voice-${project.split("/").filter(Boolean).pop() ?? "session"}`;

/** Is one already running for this project? */
export function alreadyRunning(project) {
  try {
    const listed = execFileSync(TERMINAL, ["-ls"], { encoding: "utf8" });
    return listed.includes(nameFor(project));
  } catch {
    // Screen exits non-zero when there are no sessions at all, which is not an error
    // and means exactly what an empty list means.
    return false;
  }
}

/**
 * Start a Remote Control session on this project's conversation.
 *
 * Returns a sentence to say out loud, because the person asking cannot look at
 * anything to find out whether it worked.
 */
export function handOver(project) {
  const kept = recall(project);

  if (alreadyRunning(project)) {
    return { started: false, say: "There's already one running for this project — it should still be there." };
  }

  const name = nameFor(project);
  const args = ["-dmS", name, "claude"];
  // Without a conversation to resume this is still worth doing — it is a session on
  // the right project, which is most of the value — but it opens on a blank page and
  // the person should be told that rather than discovering it later.
  if (kept?.id) args.push("--resume", kept.id);
  args.push("--remote-control", name);

  try {
    const child = spawn(TERMINAL, args, {
      cwd: project,
      // The point is that it outlives this app. A restart here — and this app restarts
      // whenever its own code changes — must not take the session down with it.
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (err) {
    return { started: false, say: `I couldn't start it: ${err.message}` };
  }

  return {
    started: true,
    say: kept?.id
      ? "Done. This conversation is now in remote control, so you can pick it up on a screen."
      : "Done, but it starts on a blank page — there was no conversation saved for this project yet.",
  };
}
