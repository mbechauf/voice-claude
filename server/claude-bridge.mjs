// Runs Claude Code against the real project and reports what it is doing as it
// goes, so the voice has something honest to say during the long pauses.

import { spawn } from "node:child_process";
import { ALLOWED_TOOLS, PROJECT_DIR, WORK_TIMEOUT_MS } from "./config.mjs";

// Turns a tool name into something sayable. Deliberately vague about paths —
// nobody driving wants to hear a directory listing.
function describeTool(name) {
  switch (name) {
    case "Read":
      return "reading the code";
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

export function isBusy() {
  return current !== null;
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
 */
export function startWork(request, emit) {
  if (current) stopWork();

  const args = [
    "-p",
    request,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...ALLOWED_TOOLS,
  ];

  const child = spawn("claude", args, {
    cwd: PROJECT_DIR,
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
