// Runs Claude Code against the real project and reports what it is doing as it
// goes, so the voice has something honest to say during the long pauses.

import { spawn } from "node:child_process";
import { NEVER, ONLY_THESE, STARTING_PROJECT, WORK_TIMEOUT_MS } from "./config.mjs";

// Turns a tool name into something sayable. Deliberately vague about paths —
// nobody driving wants to hear a directory listing.
function describeTool(name) {
  switch (name) {
    case "Read":
      return "reading the code";
    case "Edit":
    case "Write":
      // Deliberately not the file name, and deliberately not what changed. Hearing
      // the same path read out twenty times tells you nothing you did not know, and
      // what it actually did belongs in the answer at the end.
      return "changing the code";
    case "Grep":
    case "Glob":
      return "searching through the project";
    case "Bash":
      return "checking the change history";
    case "WebSearch":
    case "WebFetch":
      return "looking something up";
    case "Task":
      return "handing part of this to a helper";
    default:
      return "working";
  }
}

let current = null;

// The conversation Claude is having with us, carried across questions so that
// "explain that" and "next" mean something, and so the project context is loaded
// once rather than paid for again on every single question.
let conversationId = null;

export function isBusy() {
  return current !== null;
}

export function forgetConversation() {
  conversationId = null;
}

export function stopWork() {
  if (!current) return false;
  current.child.kill("SIGTERM");
  current = null;
  return true;
}

/**
 * Hand a request to Claude. Returns immediately; results arrive through `emit`.
 * emit(kind, text) where kind is "progress" | "final" | "error".
 *
 * `briefing` is how Claude is told to answer — plain spoken sentences rather than a
 * written report. It only goes out on the first request of a conversation, because
 * every later one continues that same conversation and Claude still has it.
 */
export function startWork(request, emit, { briefing = "", project = STARTING_PROJECT } = {}) {
  if (current) stopWork();

  const opening = briefing && !conversationId ? `${briefing}\n\n---\n\n${request}` : request;

  const args = [
    "-p",
    opening,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // Two ways of deciding what it may do, and only one of them is on.
  //
  // By default it may act, and asks first — a spoken question, a spoken yes. Stopping
  // to ask through a permission prompt is useless here because there is no screen to
  // answer it on, so the asking happens in the conversation instead, where the person
  // already is. A short list is still refused outright: things that cannot be undone
  // are not things to consent to at seventy miles an hour.
  //
  // The old way — a fixed list of permitted actions, everything else refused without
  // asking — is one setting away, in case this proves to have been a bad idea.
  if (ONLY_THESE) {
    args.push("--permission-mode", "dontAsk", "--allowedTools", ...ONLY_THESE);
  } else {
    args.push("--permission-mode", "bypassPermissions", "--disallowedTools", ...NEVER);
  }

  // Continue the same conversation rather than starting cold every time.
  if (conversationId) args.push("--resume", conversationId);

  // Deliberately drop the Anthropic API key so Claude falls back to the signed-in
  // subscription. Leaving it in place means every question is billed per token,
  // including reloading the whole project context each time. Other projects on
  // this machine keep their key — this only affects what we spawn.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  // The folder it runs in is the project you said you were working on. Everything
  // follows from that: which files it sees, and which repository an issue lands on.
  const child = spawn("claude", args, {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const job = { child, lastPhrase: null };
  current = job;

  const timer = setTimeout(() => {
    if (current === job) {
      child.kill("SIGTERM");
      emit("error", "That took too long and I stopped it.");
      current = null;
    }
  }, WORK_TIMEOUT_MS);

  let buffer = "";
  let finalText = "";

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue; // not JSON; ignore rather than crash mid-drive
      }

      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_use") {
            const phrase = describeTool(block.name);
            if (phrase !== job.lastPhrase) {
              job.lastPhrase = phrase;
              emit("progress", phrase);
            }
          }
        }
      }

      if (event.session_id) conversationId = event.session_id;

      if (event.type === "result") {
        finalText = event.result ?? finalText;
      }
    }
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("close", (code) => {
    clearTimeout(timer);
    if (current !== job) return; // superseded or stopped on purpose
    current = null;

    if (code === 0 && finalText.trim()) {
      emit("final", finalText.trim());
    } else if (code === 0) {
      emit("error", "It finished but didn't come back with anything.");
    } else {
      const hint = stderr.trim().split("\n").pop() ?? "";
      emit("error", `Something went wrong on my machine. ${hint}`.trim());
    }
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    if (current === job) current = null;
    emit("error", `I couldn't start the work. ${err.message}`);
  });
}
