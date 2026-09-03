// What is still running out of sight.
//
// Until now the only way to know was to notice a promise in an answer and go and ask.
// That works for anything at all — including work that nothing tracks — but it depends
// on the promise having been made in words, and it believes the reply.
//
// This is the other half, and it is not a guess. Every job started in the background
// leaves a file of its own on this machine while it runs, and when it finishes the
// conversation is told, in writing, in its own record. So one is a list of what was
// started and the other is a list of what has reported back, and the difference is what
// is still out.
//
// It is deliberately quiet about being unsure. Anything it cannot read — a folder that
// is not there, a record it cannot open — counts as nothing running, because a screen
// insisting that four things are going when the truth is unknown is worse than a screen
// that says nothing.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Where the machine keeps a file per background job, one folder per project and
// conversation. Read rather than asked for: there is nothing here to ask.
const scratchFor = (project) =>
  path.join(os.tmpdir().replace(/\/$/, ""), "..", `claude-501`, project.replace(/[/.]/g, "-"));

const recordFor = (project) =>
  path.join(os.homedir(), ".claude", "projects", project.replace(/[/.]/g, "-"));

function newestIn(where, ending) {
  try {
    const found = fs
      .readdirSync(where)
      .filter((name) => name.endsWith(ending))
      .map((name) => ({ name, at: fs.statSync(path.join(where, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    return found.length ? path.join(where, found[0].name) : null;
  } catch {
    return null;
  }
}

/**
 * The jobs started in this project that have not reported back.
 *
 * `started` is one file per job, made when it starts. `finished` is every job the
 * conversation has been told about, which is written into its own record word for word.
 * A job in the first list and not the second is still going.
 */
export function stillRunning(project, { now = Date.now(), oldest = 6 * 60 * 60 * 1000 } = {}) {
  const scratch = scratchFor(project);
  let sessions = [];
  try {
    sessions = fs.readdirSync(scratch);
  } catch {
    return [];
  }

  const started = [];
  for (const session of sessions) {
    const tasks = path.join(scratch, session, "tasks");
    let files = [];
    try {
      files = fs.readdirSync(tasks);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".output")) continue;
      let at = 0;
      try {
        at = fs.statSync(path.join(tasks, name)).mtimeMs;
      } catch {
        continue;
      }
      // Anything from hours ago is not still running, it is left over. Machines are not
      // tidied up and a folder keeps everything it was ever given, so without this the
      // count only ever grows and stops meaning anything.
      if (now - at > oldest) continue;
      started.push({ id: name.replace(/\.output$/, ""), at });
    }
  }
  if (!started.length) return [];

  const record = newestIn(recordFor(project), ".jsonl");
  let told = "";
  try {
    told = record ? fs.readFileSync(record, "utf8") : "";
  } catch {
    told = "";
  }

  return started
    .filter((one) => !told.includes(`<task-id>${one.id}</task-id>`))
    .map((one) => ({ id: one.id, minutes: Math.max(1, Math.round((now - one.at) / 60_000)) }))
    .sort((a, b) => b.minutes - a.minutes);
}


/**
 * Programs this project started and left running.
 *
 * The other half of the count, and the half that was missing. A job started properly in
 * the background leaves a file and is easy to count. A command simply launched and left
 * — a build, a server, a long script — leaves nothing at all, and from outside the
 * conversation looks completely idle while an hour of work is going on. That is exactly
 * what was being missed: a build running for ninety minutes while the screen said
 * nothing was happening.
 *
 * Recognised by where they are running from, which is the only honest signal available:
 * a program launched out of this project's folder belongs to this project.
 *
 * Young ones only. Something up for days is a service somebody meant to leave running,
 * not work anybody is waiting on, and counting those makes the number meaningless
 * within a week.
 */
export function programsItLeftRunning(project, { youngerThanHours = 4 } = {}) {
  let listed = "";
  try {
    listed = execFileSync("ps", ["-eo", "etime,command"], { encoding: "utf8", timeout: 2_000 });
  } catch {
    return [];
  }

  const out = [];
  for (const line of listed.split("\n")) {
    // The folder, not merely those letters. One project's folder is the beginning of
    // another's here — the advisor and the advisor's knowledge branch — so a plain
    // search for the shorter name matched every program belonging to the longer one,
    // and a build running in one appeared in both, with the same running time. What
    // follows the name has to be the end of it or a slash.
    // Judged on what is being run, not on anything the line happens to mention. A
    // program borrows libraries from wherever they live, so a build in one project can
    // name another project's folder in passing — which is how work in the knowledge
    // branch appeared under the advisor as well, with the same running time, on a
    // project nobody had touched in weeks.
    const script = (line.match(/\S+\.(?:mts|mjs|cjs|js|ts|py|sh)\b/g) ?? []).find(
      (one) => belongsTo(one, project) && !one.includes("/node_modules/"),
    );
    if (!script) continue;
    const [elapsed, ...rest] = line.trim().split(/\s+/);
    const command = rest.join(" ");
    // Anything belonging to this app itself is not work somebody is waiting on.
    if (/session\/holder\.py|cleanup\/worker\.py|ear\/listen\.py|server\/index\.mjs/.test(command)) continue;
    // Nor the shells and snapshots a machine makes for itself while somebody works.
    if (/\bzsh\b|\bbash\b|\bsh\b|snapshot|\bps\b|\bgrep\b/.test(command)) continue;
    const minutes = minutesFrom(elapsed);
    // Under a minute is something starting, not something to wait on, and it would
    // flicker in and out of the count on every command anybody ran.
    if (minutes === null || minutes < 1 || minutes > youngerThanHours * 60) continue;
    out.push({ minutes, what: shortName(script) });
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}

/** "01:28:15" and "03-06:59:26" and "16:11" into minutes. */
function minutesFrom(elapsed) {
  const [days, rest] = elapsed.includes("-") ? elapsed.split("-") : [null, elapsed];
  const parts = rest.split(":").map(Number);
  if (parts.some((one) => Number.isNaN(one))) return null;
  const [hours, mins] = parts.length === 3 ? [parts[0], parts[1]] : [0, parts[0]];
  return (Number(days ?? 0) * 24 + hours) * 60 + mins;
}

/** The name at the end of what was run, which is what a person would call it. */
function shortName(command) {
  const said = command.split(/\s+/).find((one) => /\.(mts|mjs|js|ts|py|sh)$/.test(one));
  if (!said) return "something";
  return said.split("/").pop().replace(/\.[a-z]+$/, "").replace(/[-_]+/g, " ");
}


/** Is this command running out of that folder, rather than one whose name starts the same? */
function belongsTo(line, project) {
  let from = line.indexOf(project);
  while (from !== -1) {
    const after = line[from + project.length];
    if (after === undefined || after === "/" || after === " " || after === '"' || after === "'") return true;
    from = line.indexOf(project, from + 1);
  }
  return false;
}
