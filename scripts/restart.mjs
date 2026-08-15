// Ask the running app to start again, from a command line.
//
// It exists so that whatever just changed the code can put the change into effect
// without a person. The app watches its own files and usually notices on its own;
// this is for when it should not be waited on, and for saying plainly "I have
// finished, pick it up" rather than hoping.

import { PORT } from "../server/config.mjs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // its certificate is its own

const why = process.argv.slice(2).join(" ") || "asked from the command line";

try {
  await fetch(`https://127.0.0.1:${PORT}/restart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ why }),
  });
  console.log("Asked it to start again. It comes back on its own in a second or two.");
} catch {
  // It went down before it could answer, which is exactly what was asked for.
  console.log("Asked it to start again.");
}
