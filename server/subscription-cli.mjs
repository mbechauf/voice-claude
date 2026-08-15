// Subscription-only bridge for ChatGPT Voice/Codex. This process never calls an
// OpenAI endpoint and requires Claude Code to report an active claude.ai subscription.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { NEVER, ONLY_THESE, STARTING_PROJECT, WORK_TIMEOUT_MS } from "./config.mjs";

// This mode predates the projects list and has no way to be told which one you mean,
// so it works where a drive starts. Same permission model as everywhere else.
const PROJECT_DIR = STARTING_PROJECT;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const stateDir = path.join(root, ".voice-claude");
const projectKey = createHash("sha256").update(path.resolve(PROJECT_DIR)).digest("hex").slice(0, 12);
const sessionFile = path.join(stateDir, `claude-session-${projectKey}`);

function subscriptionEnvironment() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function subscriptionStatus() {
  const check = spawnSync("claude", ["auth", "status"], {
    env: subscriptionEnvironment(),
    encoding: "utf8",
  });

  if (check.error?.code === "ENOENT") {
    return { ok: false, reason: "Claude Code is not installed or is not on PATH." };
  }

  let status;
  try {
    status = JSON.parse(check.stdout || "{}");
  } catch {
    return { ok: false, reason: "Claude Code returned an unreadable authentication status." };
  }

  if (!status.loggedIn) {
    return {
      ok: false,
      reason:
        "Claude Code is not signed into a subscription when ANTHROPIC_API_KEY is removed. " +
        "Run: env -u ANTHROPIC_API_KEY claude auth login",
    };
  }

  if (status.authMethod !== "claude.ai" || !status.subscriptionType) {
    return {
      ok: false,
      reason:
        "Claude Code did not report an active claude.ai subscription after ANTHROPIC_API_KEY " +
        "was removed. Sign in and choose your Claude.ai subscription with: " +
        "env -u ANTHROPIC_API_KEY claude auth login",
    };
  }

  return {
    ok: true,
    method: String(status.authMethod),
    subscriptionType: String(status.subscriptionType),
  };
}

function readSessionId() {
  try {
    const id = fs.readFileSync(sessionFile, "utf8").trim();
    return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

function writeSessionId(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  fs.mkdirSync(stateDir, { recursive: true });
  const temporary = `${sessionFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${id}\n`, { mode: 0o600 });
  fs.renameSync(temporary, sessionFile);
}

function forgetSession() {
  try {
    fs.unlinkSync(sessionFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function parseRequest(argv) {
  const requestIndex = argv.indexOf("--request");
  if (requestIndex >= 0) return argv.slice(requestIndex + 1).join(" ").trim();
  return argv.filter((arg) => !arg.startsWith("--")).join(" ").trim();
}

function runClaude(request, sessionId) {
  return new Promise((resolve) => {
    const args = [
      "-p",
      request,
      "--output-format",
      "stream-json",
      "--verbose",
      ...(ONLY_THESE
        ? ["--permission-mode", "dontAsk", "--allowedTools", ...ONLY_THESE]
        : ["--permission-mode", "bypassPermissions", "--disallowedTools", ...NEVER]),
    ];
    if (sessionId) args.push("--resume", sessionId);

    const child = spawn("claude", args, {
      cwd: PROJECT_DIR,
      env: subscriptionEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    let stderr = "";
    let finalText = "";
    let resolvedSessionId = sessionId;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, WORK_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.session_id) {
          resolvedSessionId = event.session_id;
          writeSessionId(event.session_id);
        }

        if (event.type === "assistant") {
          for (const block of event.message?.content ?? []) {
            if (block.type === "tool_use") process.stderr.write(`[Claude: ${block.name}]\n`);
          }
        }

        if (event.type === "result") finalText = event.result ?? finalText;
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, sessionId: resolvedSessionId });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ ok: false, error: "Claude timed out.", sessionId: resolvedSessionId });
      if (code === 0 && finalText.trim()) {
        return resolve({ ok: true, text: finalText.trim(), sessionId: resolvedSessionId });
      }
      const hint = stderr.trim().split("\n").pop() ?? `Claude exited with status ${code}.`;
      resolve({ ok: false, error: hint, sessionId: resolvedSessionId });
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--new")) {
    forgetSession();
    console.log("Started a new Claude conversation for the configured project.");
    return;
  }

  const auth = subscriptionStatus();
  if (!auth.ok) {
    console.error(auth.reason);
    process.exitCode = 2;
    return;
  }

  if (argv.includes("--check")) {
    console.log(`Claude subscription mode is ready (${auth.method}, ${auth.subscriptionType}).`);
    console.log(`Project: ${PROJECT_DIR}`);
    console.log("OpenAI API calls: disabled in this mode.");
    return;
  }

  const request = parseRequest(argv);
  if (!request) {
    console.error('No request supplied. Use: npm run claude:subscription -- --request "your question"');
    process.exitCode = 2;
    return;
  }

  const result = await runClaude(request, readSessionId());
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  console.log(result.text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
