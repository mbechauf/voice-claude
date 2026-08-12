// Boots the server the way a drive would and checks the parts that are easy to
// break and hard to notice until you are moving. It deliberately runs with no
// OpenAI credential in the environment: the free mode has to work for someone who
// does not have one at all.

import { spawn } from "node:child_process";
import path from "node:path";
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

  check("the banner says plainly that nothing is billed", banner.includes("nothing beyond the Claude subscription"));
} finally {
  server.kill("SIGTERM");
}

const failed = results.filter((r) => !r.passed);
for (const r of results) {
  console.log(`${r.passed ? "ok  " : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(failed.length ? `\n${failed.length} failed.` : `\nAll ${results.length} fine.`);
process.exit(failed.length ? 1 : 0);
