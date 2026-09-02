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
