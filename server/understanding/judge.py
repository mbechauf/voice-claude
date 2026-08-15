# Understanding what was said by what it means, rather than by which words are in it.
#
# Matching words has a ceiling and we are at it: "can I get some help" and "can I
# please get some help" are the same request and share almost nothing with the list
# of wordings, while "can you help me with this test" shares a great deal and must
# not fire. No list fixes that, because the difference is not in the words.
#
# So every example — the commands AND the sentences that must not fire — is turned
# into a point, and a new sentence is judged by which it lands nearest. The sentences
# that must not fire are half the reference set, and they are the half that does the
# work: without them, anything about help looks like a request for help.
#
# Two ways to run it:
#   --evaluate   score it honestly against the labelled set, holding each out
#   (no flag)    stay open, judging a sentence per line, for the app to use
#
# Deliberately no training. With a hundred examples there is nothing to train that
# would not simply memorise them, and an off-the-shelf encoder already knows that
# "get some help" and "help me out" mean the same thing.

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
EXAMPLES = ROOT / "data" / "what-was-meant.jsonl"

# Small, fast, and good at short sentences. It runs in about ten milliseconds on this
# machine, which matters: the commands this judges have to feel immediate.
MODEL = "BAAI/bge-small-en-v1.5"


def say(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


try:
    import numpy as np
    from sentence_transformers import SentenceTransformer
except Exception as err:  # noqa: BLE001
    say({"ready": False, "error": f"{err}"})
    sys.exit(1)


def load_examples():
    said, meant = [], []
    for line in EXAMPLES.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        if not entry.get("said"):
            continue
        said.append(entry["said"])
        meant.append(entry["meant"])
    return said, meant


def normalise(vectors):
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


class Judge:
    def __init__(self):
        self.model = SentenceTransformer(MODEL)
        self.said, self.meant = load_examples()
        self.points = normalise(self.model.encode(self.said, batch_size=64))

    def judge(self, sentence, skip=None):
        """What this sentence most resembles, and how sure that is.

        `skip` holds one example out, so a sentence is never judged by itself —
        without that, every score is a perfect recollection of the answer sheet.
        """
        point = normalise(self.model.encode([sentence]))[0]
        nearness = self.points @ point
        if skip is not None:
            nearness[skip] = -1.0

        # The best of each kind, so "how much more like a command than like ordinary
        # talk is this" can be asked — which is the actual question, and is not
        # answerable from the nearest neighbour alone.
        best = {}
        for i, label in enumerate(self.meant):
            if nearness[i] > best.get(label, (-1.0, -1))[0]:
                best[label] = (float(nearness[i]), i)

        ranked = sorted(best.items(), key=lambda kv: -kv[1][0])
        top, (score, which) = ranked[0]
        runner_up = ranked[1][1][0] if len(ranked) > 1 else -1.0
        return {
            "command": top,
            "nearness": round(score, 3),
            "clear_of_the_next": round(score - runner_up, 3),
            "closest": self.said[which],
        }


def evaluate(judge, floor):
    right, fired_wrongly, missed = 0, [], []

    for i, (sentence, meant) in enumerate(zip(judge.said, judge.meant)):
        verdict = judge.judge(sentence, skip=i)
        thought = verdict["command"]

        # Not sure enough is the same as no command at all: doing nothing is always
        # recoverable, and taking an action nobody asked for is not.
        if verdict["nearness"] < floor:
            thought = "none"

        if thought == meant:
            right += 1
        elif meant == "none":
            fired_wrongly.append((sentence, thought, verdict))
        else:
            missed.append((sentence, meant, thought, verdict))

    total = len(judge.said)
    print(f"\n{right} of {total} understood — {round(100 * right / total)}%  (sure at {floor})")

    if fired_wrongly:
        print(f"\nFIRED WHEN IT SHOULD NOT HAVE ({len(fired_wrongly)}) — the ones that hurt:")
        for sentence, thought, verdict in fired_wrongly:
            print(f'  heard as {thought:<8} "{sentence}"')
            print(f'{" ":12}nearest was "{verdict["closest"]}" ({verdict["nearness"]})')

    if missed:
        print(f"\nDID NOT UNDERSTAND ({len(missed)}) — you say it, nothing happens:")
        for sentence, meant, thought, verdict in missed:
            print(f'  meant {meant:<8} heard as {thought:<8} "{sentence}"')
            print(f'{" ":12}nearest was "{verdict["closest"]}" ({verdict["nearness"]})')

    print("")
    return right / total


def evaluate_as_a_boundary(judge):
    """The other shape: learn where the line is, rather than what is nearest.

    Nearest-neighbour fails here for a reason worth writing down. These points carry
    what a sentence is ABOUT, and "are all the tests passing" is about the same thing
    as "check the tests all done" — so it lands right next to it. What separates them
    is not their subject but whether they are an instruction or a question, and that
    is a direction through the space rather than a place in it. A boundary can learn
    a direction; nearest-neighbour cannot.
    """
    from sklearn.linear_model import LogisticRegression

    labels = sorted(set(judge.meant))
    right, fired_wrongly, missed = 0, [], []

    for i in range(len(judge.said)):
        keep = [j for j in range(len(judge.said)) if j != i]
        x = judge.points[keep]
        y = [judge.meant[j] for j in keep]
        if len(set(y)) < 2:
            continue

        boundary = LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced")
        boundary.fit(x, y)

        chances = boundary.predict_proba(judge.points[i : i + 1])[0]
        best = int(np.argmax(chances))
        thought = boundary.classes_[best]
        sure = float(chances[best])

        if sure < 0.5:
            thought = "none"

        meant = judge.meant[i]
        if thought == meant:
            right += 1
        elif meant == "none":
            fired_wrongly.append((judge.said[i], thought, sure))
        else:
            missed.append((judge.said[i], meant, thought, sure))

    total = len(judge.said)
    print(f"\nLEARNING WHERE THE LINE IS: {right} of {total} — {round(100 * right / total)}%")

    if fired_wrongly:
        print(f"\n  fired when it should not have ({len(fired_wrongly)}):")
        for sentence, thought, sure in fired_wrongly:
            print(f'    {thought:<8} ({sure:.2f})  "{sentence}"')

    if missed:
        print(f"\n  did not understand ({len(missed)}):")
        for sentence, meant, thought, sure in missed:
            print(f'    meant {meant:<8} heard as {thought:<8} ({sure:.2f})  "{sentence}"')
    print("")


def write_verdicts(judge):
    """Every verdict, held out, written down so the two ways can be compared as one.

    The interesting question was never "encoder or words" but "does the encoder help
    where the words fail", and answering it needs both verdicts side by side.
    """
    out = {}
    for i, sentence in enumerate(judge.said):
        out[sentence] = judge.judge(sentence, skip=i)
    where = ROOT / "data" / "encoder-verdicts.json"
    where.write_text(json.dumps(out, indent=1))
    print(f"wrote {len(out)} verdicts to {where.relative_to(ROOT)}")


if __name__ == "__main__":
    if "--verdicts" in sys.argv:
        write_verdicts(Judge())
        sys.exit(0)

    if "--boundary" in sys.argv:
        evaluate_as_a_boundary(Judge())
        sys.exit(0)

    if "--evaluate" in sys.argv:
        judge = Judge()
        # The line between sure and not sure is chosen from the data rather than by
        # taste, so it is worth seeing what it costs at each setting.
        for floor in (0.55, 0.60, 0.65, 0.70, 0.75):
            evaluate(judge, floor)
        sys.exit(0)

    judge = Judge()
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
            verdict = judge.judge(request.get("text", ""))
            say({"id": request.get("id"), **verdict})
        except Exception as err:  # noqa: BLE001
            say({"id": request.get("id"), "error": f"{err}"})
