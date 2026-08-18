#!/usr/bin/env bash
# Installs the session holder — the process that keeps one conversation open per
# project, so a question is answered rather than rebuilt from scratch first. Run it
# once. It uses the Claude subscription that is already signed in; no key, nothing
# metered, nothing sent anywhere it was not already going.
set -euo pipefail

cd "$(dirname "$0")/.."
VENV=".session"

say() { printf '\n%s\n' "$*"; }

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code isn't installed, and the session holder is built on it." >&2
  exit 1
fi

# Newer than the packages expect is the usual way this fails, so pick a known-good one
# rather than whatever "python3" happens to mean on this machine today.
python_bin=""
for candidate in python3.13 python3.12 python3.11; do
  if command -v "$candidate" >/dev/null 2>&1; then python_bin="$(command -v "$candidate")"; break; fi
done

if [ -z "$python_bin" ]; then
  if command -v brew >/dev/null 2>&1; then
    say "Installing a Python it can use..."
    brew install python@3.12
    python_bin="$(command -v python3.12)"
  else
    echo "Needs Python 3.11-3.13. Install Homebrew, or install Python 3.12 yourself, then run this again." >&2
    exit 1
  fi
fi

say "Setting up the session holder with $python_bin ..."
rm -rf "$VENV"
"$python_bin" -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet claude-agent-sdk

# Prove it can actually sign in before saying it is ready. Without the key, so it has
# to use the subscription — which is the arrangement this whole thing depends on, and
# finding out it does not work here is worth ten seconds now rather than mid-drive.
say "Checking it can sign in on the subscription..."
env -u ANTHROPIC_API_KEY "$VENV/bin/python" - <<'PY'
import asyncio

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage


async def main():
    async with ClaudeSDKClient(options=ClaudeAgentOptions(allowed_tools=[])) as client:
        await client.query("Reply with just: ready")
        async for message in client.receive_response():
            if isinstance(message, ResultMessage):
                if message.subtype != "success":
                    raise SystemExit(f"it answered with {message.subtype}")


asyncio.run(main())
print("signed in, and answering")
PY

say "Done. The app starts it on its own from now on; nothing else to do."
