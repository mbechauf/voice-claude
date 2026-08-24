#!/usr/bin/env bash
# Installs the ear — the speech model that does the hearing on this Mac, instead of
# the phone hearing for itself. Run it once. Free to install, free to use, and it
# never talks to anyone: the sound stays on this machine.
set -euo pipefail

cd "$(dirname "$0")/.."
VENV=".ear"

say() { printf '\n%s\n' "$*"; }

# Apple's own machine-learning framework only exists for Apple silicon. On an Intel
# Mac there is nothing to install, and saying so now is kinder than a build error.
if [ "$(uname -m)" != "arm64" ]; then
  echo "The ear needs an Apple-silicon Mac. The phone's own dictation still works without it." >&2
  exit 1
fi

# Its own environment, apart from the speaking voice and apart from the tidy-up. They
# want different libraries, and sharing one is how a working setup breaks on an
# upgrade that had nothing to do with it.
python_bin=""
for candidate in /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 python3.12 python3.11; do
  if command -v "$candidate" >/dev/null 2>&1; then python_bin="$candidate"; break; fi
done
if [ -z "$python_bin" ]; then
  echo "Needs Python 3.11 or 3.12. Install one with: brew install python@3.12" >&2
  exit 1
fi

say "Making a place for the ear to live ($VENV), with $python_bin"
"$python_bin" -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
say "Fetching what it needs. A few minutes the first time."
"$VENV/bin/pip" install --quiet parakeet-mlx

say "Fetching the model itself — about two and a half gigabytes, once."
"$VENV/bin/python" server/ear/listen.py --fetch

say "The ear is installed. Nothing else to do: the app starts it when it needs it."
