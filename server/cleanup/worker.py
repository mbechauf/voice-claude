# The tidy-up: a small model that reads what the phone heard and writes it out
# properly, before any of it reaches Claude.
#
# It stays open and answers a sentence per line, because loading the model takes a
# second or two and a driver waiting a second or two before every question would
# rather have the mess. Everything about how it behaves lives in the instruction
# sheet next to this file, in plain English, so changing its manners is editing
# sentences rather than retraining anything.
#
# Two ways to run it:
#   --try "some sentence"   repair one sentence and print it, for trying things out
#   (no flag)               stay open, repairing a sentence per line, for the app

import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
INSTRUCTIONS = HERE / "instructions.md"

# The smallest model that can do this at all, squeezed to a quarter of its size. It
# is not being asked to think — only to write down what it was given, properly — and
# a bigger one buys nothing but delay in a car.
MODEL = "mlx-community/Qwen3-0.6B-4bit"


def say(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


try:
    from mlx_lm import load, generate
    from mlx_lm.sample_utils import make_sampler
except Exception as err:  # noqa: BLE001
    say({"ready": False, "error": f"{err}"})
    sys.exit(1)


def read_the_sheet():
    """The rules, and the worked examples that make a small model follow them.

    Told the rules alone, this model hands the sentence straight back unchanged, or
    shouts it in capitals. Shown three sentences repaired the way we want them, it
    does the job. So the examples are not decoration — they are most of the
    instruction, and they belong beside the rules where they can be edited by
    anyone, in the same plain English.
    """
    rules, _, examples = INSTRUCTIONS.read_text().partition("## Examples")

    shown = []
    heard = None
    for line in examples.splitlines():
        if line.startswith("Heard:"):
            heard = line[len("Heard:") :].strip()
        elif line.startswith("Repaired:") and heard is not None:
            shown.append((heard, line[len("Repaired:") :].strip()))
            heard = None

    return rules.strip(), shown


class Tidier:
    def __init__(self):
        self.model, self.tokenizer = load(MODEL)
        self.rules, self.shown = read_the_sheet()
        # No randomness. The same mangled sentence must come back the same way every
        # time, or a mistake seen once can never be chased down.
        self.sampler = make_sampler(temp=0.0)

    def instructions(self, words):
        listed = ", ".join(words) if words else "(none yet)"
        return self.rules.replace("{{words}}", listed)

    def tidy(self, text, words):
        conversation = [{"role": "system", "content": self.instructions(words)}]
        for heard, repaired in self.shown:
            conversation.append({"role": "user", "content": heard})
            conversation.append({"role": "assistant", "content": repaired})
        conversation.append({"role": "user", "content": text})

        prompt = self.tokenizer.apply_chat_template(
            conversation,
            add_generation_prompt=True,
            # Qwen can be asked to reason at length before answering. Here that is
            # pure delay: the job is a rewrite, not a puzzle.
            enable_thinking=False,
        )

        # Room for the sentence and no more. A repair that runs on past twice the
        # length of what was said has stopped repairing and started talking.
        room = max(48, int(len(self.tokenizer.encode(text)) * 2) + 24)

        started = time.time()
        out = generate(
            self.model,
            self.tokenizer,
            prompt=prompt,
            max_tokens=room,
            sampler=self.sampler,
            verbose=False,
        )
        return out.strip(), round((time.time() - started) * 1000)


if __name__ == "__main__":
    if "--try" in sys.argv:
        sentence = sys.argv[sys.argv.index("--try") + 1]
        tidier = Tidier()
        repaired, took = tidier.tidy(sentence, [])
        print(f"\nheard:    {sentence}\nrepaired: {repaired}\n({took} ms)\n")
        sys.exit(0)

    tidier = Tidier()
    say({"ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            repaired, took = tidier.tidy(request.get("text", ""), request.get("words") or [])
            say({"id": request.get("id"), "text": repaired, "took": took})
        except Exception as err:  # noqa: BLE001
            say({"id": request.get("id"), "error": f"{err}"})
