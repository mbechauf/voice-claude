#!/usr/bin/env bash
# Installs the good voice — the one that runs on this Mac and gets sent down to the
# phone. Run it once. It costs nothing to run and nothing to use.
set -euo pipefail

cd "$(dirname "$0")/.."
VENV=".voice"

say() { printf '\n%s\n' "$*"; }

# The voice needs a Python between 3.10 and 3.12. Newer ones can't build one of the
# pieces it depends on, which is a confusing failure if you meet it head-on.
python_bin=""
for candidate in python3.12 python3.11 python3.10; do
  if command -v "$candidate" >/dev/null 2>&1; then python_bin="$(command -v "$candidate")"; break; fi
done

if [ -z "$python_bin" ]; then
  if command -v brew >/dev/null 2>&1; then
    say "Installing a Python the voice can use..."
    brew install python@3.12
    python_bin="$(command -v python3.12)"
  else
    echo "Needs Python 3.10-3.12. Install Homebrew, or install Python 3.12 yourself, then run this again." >&2
    exit 1
  fi
fi

# Pronunciation data for words the voice hasn't met before. The system copy is the
# one that works; the copy bundled with the Python package points nowhere on a Mac.
if [ ! -d /opt/homebrew/share/espeak-ng-data ] && [ ! -d /usr/local/share/espeak-ng-data ]; then
  if command -v brew >/dev/null 2>&1; then
    say "Installing the pronunciation data..."
    brew install espeak-ng
  else
    echo "Needs espeak-ng. Install Homebrew and run this again." >&2
    exit 1
  fi
fi

say "Setting up the voice with $python_bin ..."
rm -rf "$VENV"
"$python_bin" -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet kokoro soundfile numpy

# Say one word now, so the model is downloaded and cached here rather than on the
# first question of a drive.
say "Warming it up (this downloads the voice once)..."
ESPEAK_DATA_PATH="${ESPEAK_DATA_PATH:-/opt/homebrew/share/espeak-ng-data}" \
PHONEMIZER_ESPEAK_LIBRARY="${PHONEMIZER_ESPEAK_LIBRARY:-/opt/homebrew/lib/libespeak-ng.dylib}" \
"$VENV/bin/python" - <<'PY' 2>/dev/null
from kokoro import KPipeline
pipeline = KPipeline(lang_code="a")
list(pipeline("Ready.", voice="af_heart"))
print("the voice is ready")
PY

say "Done. Start it with: npm start"
