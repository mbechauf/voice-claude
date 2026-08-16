#!/usr/bin/env bash
# Installs the tidy-up — the small model that reads what the phone heard and writes
# it out properly before Claude ever sees it. Run it once. Free to install, free to
# use, and it never talks to anyone: the words stay on this Mac.
set -euo pipefail

cd "$(dirname "$0")/.."
VENV=".cleanup"

say() { printf '\n%s\n' "$*"; }

# Apple's own machine-learning framework only exists for Apple silicon. On an Intel
# Mac there is nothing to install, and saying so now is kinder than a build error.
if [ "$(uname -m)" != "arm64" ]; then
  echo "The tidy-up needs an Apple-silicon Mac. Everything else still works without it." >&2
  exit 1
fi

# Same constraint as the voice: the newest Python is usually ahead of the packages.
python_bin=""
for candidate in python3.12 python3.11 python3.10; do
  if command -v "$candidate" >/dev/null 2>&1; then python_bin="$(command -v "$candidate")"; break; fi
done

if [ -z "$python_bin" ]; then
  if command -v brew >/dev/null 2>&1; then
    say "Installing a Python it can use..."
    brew install python@3.12
    python_bin="$(command -v python3.12)"
  else
    echo "Needs Python 3.10-3.12. Install Homebrew, or install Python 3.12 yourself, then run this again." >&2
    exit 1
  fi
fi

say "Setting up the tidy-up with $python_bin ..."
rm -rf "$VENV"
"$python_bin" -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet mlx-lm

# Fetch the model now, so the first sentence of a drive is not spent downloading
# four hundred megabytes on a phone tether.
say "Fetching the model (about four hundred megabytes, once)..."
"$VENV/bin/python" - <<'PY'
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/Qwen3-0.6B-4bit")
prompt = tokenizer.apply_chat_template(
    [{"role": "user", "content": "Say ready."}],
    add_generation_prompt=True,
    enable_thinking=False,
)
generate(model, tokenizer, prompt=prompt, max_tokens=8, verbose=False)
print("the tidy-up is ready")
PY

say "Done. It is used automatically from now on; nothing else to do."
