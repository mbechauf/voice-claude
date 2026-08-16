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
STILL_TALKING = HERE / "still-talking.md"

# The smallest model that can do this at all, squeezed to a quarter of its size. It
# is not being asked to think — only to write down what it was given, properly — and
# a bigger one buys nothing but delay in a car.
MODEL = "mlx-community/Qwen3-0.6B-4bit"


def say(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


try:
    import mlx.core as mx
    from mlx_lm import load, generate
    from mlx_lm.sample_utils import make_sampler
except Exception as err:  # noqa: BLE001
    say({"ready": False, "error": f"{err}"})
    sys.exit(1)


def read_the_sheet(sheet, asked, answered):
    """The rules, and the worked examples that make a small model follow them.

    Told the rules alone, this model hands the sentence straight back unchanged, or
    shouts it in capitals. Shown three sentences repaired the way we want them, it
    does the job. So the examples are not decoration — they are most of the
    instruction, and they belong beside the rules where they can be edited by
    anyone, in the same plain English.

    Both of this model's jobs are written the same way — rules, then examples under
    a heading — so reading a sheet takes the two labels rather than knowing which
    job it is for.
    """
    rules, _, examples = sheet.read_text().partition("## Examples")

    shown = []
    heard = None
    for line in examples.splitlines():
        if line.startswith(f"{asked}:"):
            heard = line[len(asked) + 1 :].strip()
        elif line.startswith(f"{answered}:") and heard is not None:
            shown.append((heard, line[len(answered) + 1 :].strip()))
            heard = None

    return rules.strip(), shown


class Tidier:
    def __init__(self):
        self.model, self.tokenizer = load(MODEL)
        self.rules, self.shown = read_the_sheet(INSTRUCTIONS, "Heard", "Repaired")
        # The second job: not what the words should say, but whether the person has
        # stopped. Same model, same weights, a different sheet of instructions —
        # loading a second model would cost a second or two of car time for nothing.
        self.pause_rules, self.pause_shown = read_the_sheet(STILL_TALKING, "Said", "Answer")
        # The first piece of each of the two allowed answers. Comparing them is the
        # whole judgement, so they are worked out once rather than every pause.
        self.more_token = self.tokenizer.encode("MORE", add_special_tokens=False)[0]
        self.done_token = self.tokenizer.encode("DONE", add_special_tokens=False)[0]
        # No randomness. The same mangled sentence must come back the same way every
        # time, or a mistake seen once can never be chased down.
        self.sampler = make_sampler(temp=0.0)

    def instructions(self, words):
        listed = ", ".join(words) if words else "(none yet)"
        return self.rules.replace("{{words}}", listed)

    def ask(self, rules, shown, text, room):
        conversation = [{"role": "system", "content": rules}]
        for said, answer in shown:
            conversation.append({"role": "user", "content": said})
            conversation.append({"role": "assistant", "content": answer})
        conversation.append({"role": "user", "content": text})

        prompt = self.tokenizer.apply_chat_template(
            conversation,
            add_generation_prompt=True,
            # Qwen can be asked to reason at length before answering. Here that is
            # pure delay: the job is a rewrite, not a puzzle.
            enable_thinking=False,
        )

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

    def tidy(self, text, words):
        # Room for the sentence and no more. A repair that runs on past twice the
        # length of what was said has stopped repairing and started talking.
        room = max(48, int(len(self.tokenizer.encode(text)) * 2) + 24)
        return self.ask(self.instructions(words), self.shown, text, room)

    def still_talking(self, text):
        """How strongly it leans towards more being coming, from nought to one.

        Not asked to write the answer. Asked to write anything at all, a model this
        small says MORE to everything, including "is the build broken?" — the shape
        of the sheet carries it and the meaning of the sentence does not. So instead
        of reading what it writes, we look at what it was about to write: the two
        words are the only two answers allowed, and the only question is which one it
        leant towards and by how much. That turns a coin toss into a measurement, and
        a measurement can have a line drawn through it wherever it needs to be.
        """
        conversation = [{"role": "system", "content": self.pause_rules}]
        for said, answer in self.pause_shown:
            conversation.append({"role": "user", "content": said})
            conversation.append({"role": "assistant", "content": answer})
        conversation.append({"role": "user", "content": text})

        prompt = self.tokenizer.apply_chat_template(
            conversation, add_generation_prompt=True, enable_thinking=False
        )

        started = time.time()
        logits = self.model(mx.array([prompt]))[0, -1]
        leaning = mx.softmax(logits.astype(mx.float32))
        more = float(leaning[self.more_token])
        done = float(leaning[self.done_token])
        # Between them rather than out of everything, because the model spends most of
        # its confidence on words that are not answers at all, and a sheet that only
        # allows two answers does not care about those.
        share = more / (more + done) if (more + done) > 0 else 0.5
        return round(share, 4), round((time.time() - started) * 1000)


if __name__ == "__main__":
    if "--try" in sys.argv:
        sentence = sys.argv[sys.argv.index("--try") + 1]
        tidier = Tidier()
        repaired, took = tidier.tidy(sentence, [])
        print(f"\nheard:    {sentence}\nrepaired: {repaired}\n({took} ms)\n")
        sys.exit(0)

    if "--more" in sys.argv:
        tidier = Tidier()
        for sentence in sys.argv[sys.argv.index("--more") + 1 :]:
            share, took = tidier.still_talking(sentence)
            print(f"{share:.3f}  ({took:>4} ms)  {sentence}")
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
            if request.get("job") == "still-talking":
                answer, took = tidier.still_talking(request.get("text", ""))
            else:
                answer, took = tidier.tidy(request.get("text", ""), request.get("words") or [])
            say({"id": request.get("id"), "text": answer, "took": took})
        except Exception as err:  # noqa: BLE001
            say({"id": request.get("id"), "error": f"{err}"})
