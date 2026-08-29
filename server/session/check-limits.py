# Does the holder actually let go of conversations?
#
# The limits are the whole of issue 22 on the Python side, and they are the kind of
# thing that looks obviously right and silently never runs. So they are exercised here
# against stand-in conversations rather than only in a car, where "it closed nothing"
# looks identical to "there was nothing to close" until the machine is out of memory.
#
# The real package is not imported: this is about the closing rules, not about Claude,
# and a test that needs a subscription to run is a test nobody runs.

import asyncio
import contextlib
import sys
import types
from pathlib import Path

fake = types.ModuleType("claude_agent_sdk")
for name in (
    "AssistantMessage", "ClaudeAgentOptions", "ClaudeSDKClient", "ResultMessage",
    "SystemMessage", "TextBlock", "ToolResultBlock", "ToolUseBlock", "UserMessage",
):
    setattr(fake, name, type(name, (), {}))
sys.modules.setdefault("claude_agent_sdk", fake)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import holder  # noqa: E402

results = []


def check(name, passed, detail=""):
    results.append((name, passed, detail))


class StandIn:
    """A conversation that only records whether it was let go of."""

    def __init__(self):
        self.closed = False

    async def disconnect(self):
        self.closed = True


async def main():
    # ---- untouched for too long gets closed, in use does not ----
    holder.IDLE_LIMIT_S = 100
    sessions = holder.Sessions()
    cold, warm = StandIn(), StandIn()
    sessions.open = {"/cold": cold, "/warm": warm}
    now = 1_000.0
    sessions.used = {"/cold": now - 500, "/warm": now - 5}

    import time as clock
    was, clock.monotonic = clock.monotonic, lambda: now
    holder.time = clock
    await sessions.close_the_idle()
    clock.monotonic = was

    check("a conversation left untouched for too long is closed", cold.closed)
    check("one still being used is left alone", not warm.closed and "/warm" in sessions.open)

    # ---- one mid-answer is never closed, however cold ----
    holder.IDLE_LIMIT_S = 1
    sessions = holder.Sessions()
    busy = StandIn()
    sessions.open = {"/busy": busy}
    sessions.used = {"/busy": 0}
    sessions.answering = {"/busy": 1}
    await sessions.close_the_idle()
    check("one that is mid-answer is never closed under it", not busy.closed)

    # ---- more open than the ceiling: the coldest goes first ----
    holder.MOST_OPEN = 2
    sessions = holder.Sessions()
    oldest, middle, newest = StandIn(), StandIn(), StandIn()
    sessions.open = {"/oldest": oldest, "/middle": middle, "/newest": newest}
    sessions.used = {"/oldest": 1, "/middle": 2, "/newest": 3}
    await sessions.make_room()
    check("over the ceiling, the one unused longest goes first", oldest.closed and not newest.closed)
    check("and it stops once it is back under the ceiling", len(sessions.open) == 2, f"{len(sessions.open)} left")

    # ---- the ceiling never cuts off somebody who is waiting ----
    holder.MOST_OPEN = 1
    sessions = holder.Sessions()
    a, b = StandIn(), StandIn()
    sessions.open = {"/a": a, "/b": b}
    sessions.used = {"/a": 1, "/b": 2}
    sessions.answering = {"/a": 1, "/b": 1}
    await sessions.make_room()
    check("the ceiling waits rather than cutting off a question in flight", not a.closed and not b.closed)

    # ---- stopping closes everything ----
    sessions = holder.Sessions()
    one, two = StandIn(), StandIn()
    sessions.open = {"/one": one, "/two": two}
    await sessions.close_everything()
    check("being told to stop closes every conversation", one.closed and two.closed and not sessions.open)

    # ---- rebuilding a conversation before it fills up ----
    #
    # The dangerous half is not the rebuild, it is doing it when it should not, or
    # throwing the old conversation away before anything has been written down to
    # replace it. Both refusals are checked harder than the success.
    import tempfile

    class Roomy:
        """A conversation that answers how full it is, and remembers being asked."""

        def __init__(self, full, writes_to=None):
            self.full = full
            self.writes_to = writes_to
            self.asked = []
            self.closed = False

        async def get_context_usage(self):
            return {"totalTokens": int(1000 * self.full), "maxTokens": 1000}

        async def query(self, text):
            self.asked.append(text)
            if self.writes_to:
                Path(self.writes_to).parent.mkdir(parents=True, exist_ok=True)
                Path(self.writes_to).write_text("what the next one needs")

        async def receive_response(self):
            return
            yield   # pragma: no cover - makes this an async generator

        async def disconnect(self):
            self.closed = True

    class Nowhere:
        """Somewhere for it to say things, when nobody is listening for them."""

        def __init__(self):
            self.said = []

        def write(self, line):
            self.said.append(line.decode())

        def spoken(self):
            """Only the lines meant for a person to hear."""
            import json as _json
            out = []
            for line in self.said:
                try:
                    was = _json.loads(line)
                except Exception:
                    continue
                if was.get("kind") == "notice":
                    out.append(was.get("text", ""))
            return out

    nowhere = Nowhere()

    with tempfile.TemporaryDirectory() as where:
        note = holder.summary_file(where)

        # plenty of room: nothing should happen at all
        sessions = holder.Sessions()
        roomy = Roomy(0.2)
        sessions.open = {where: roomy}
        await holder.rebuild_if_full(sessions, nowhere, where)
        check("a conversation with room left is left alone", not roomy.asked and not roomy.closed)
        check("and says nothing about it", not nowhere.spoken())

        # full, and the summary gets written: rebuild, and the next one is told to read it
        sessions = holder.Sessions()
        full = Roomy(0.9, writes_to=note)
        sessions.open = {where: full}
        spoke = Nowhere()
        await holder.rebuild_if_full(sessions, spoke, where)
        check("a full conversation is asked to write down what matters", len(full.asked) == 1)
        check("and only then is it closed", full.closed and where not in sessions.open)
        check("and the next one is told where to read it", sessions.carrying_on.get(where) == note)
        # The announcement is the point of the change: unannounced, a conversation that
        # has quietly forgotten everything is indistinguishable from a broken one, and
        # the person it happens to is driving. Both ends are said — the warning before
        # the wait, and the all-clear after it — so nobody is left listening to silence.
        said = spoke.spoken()
        check("a rebuild is announced before it starts", len(said) >= 2, f"{said}")
        check("and the all-clear comes after it", len(said) >= 2 and "fresh" in said[-1])

        # Somebody asking again in the meantime is what the announcement makes likely, so
        # it must not run alongside them: a second question on one conversation is the
        # fault the turn exists to stop.
        sessions = holder.Sessions()
        busy = Roomy(0.9, writes_to=note)
        sessions.open = {where: busy}
        sessions.turns[where] = asyncio.Lock()
        await sessions.turns[where].acquire()
        quiet = Nowhere()
        await holder.rebuild_if_full(sessions, quiet, where)
        sessions.turns[where].release()
        check(
            "a question already running puts the rebuild off rather than joining in",
            not busy.asked and not busy.closed and not quiet.spoken(),
        )

        # THE ONE THAT MATTERS: nothing written down means nothing thrown away.
        sessions = holder.Sessions()
        silent = Roomy(0.9)          # says nothing, writes nothing
        sessions.open = {where: silent}
        Path(note).unlink(missing_ok=True)
        gave_up = Nowhere()
        await holder.rebuild_if_full(sessions, gave_up, where)
        check(
            "a summary that was never written leaves the conversation standing",
            not silent.closed and where in sessions.open and where not in sessions.carrying_on,
        )
        # Having said it was about to start again, going quiet would leave somebody
        # believing it had — and repeating themselves for no reason.
        check(
            "and having announced it, it says the restart did not happen",
            len(gave_up.spoken()) >= 2, f"{gave_up.spoken()}",
        )

        # and a conversation that cannot say how full it is is not guessed at
        class Silent(Roomy):
            async def get_context_usage(self):
                raise RuntimeError("no idea")

        sessions = holder.Sessions()
        mute = Silent(0.9)
        sessions.open = {where: mute}
        await holder.rebuild_if_full(sessions, nowhere, where)
        check("one that cannot say how full it is is left alone", not mute.asked and not mute.closed)

    # ---- the off-by-one: a reply nobody asked for must not become the next answer ----
    #
    # Taken from a real drive. A background job finished, the conversation was told and
    # answered that with nobody listening, and from then on every spoken answer was the
    # one before — the question about which fixes were meant got a report on a batch
    # job, and the reply that actually answered it was never heard at all.
    class Chatty:
        """A conversation that has already said something nobody asked for.

        Deliberately shaped like the real one: replies come from a queue belonging to
        the conversation, and a reader that gives up leaves what is left where it is.
        """

        def __init__(self, waiting):
            self.queue = list(waiting)
            self.asked = []
            self.closed = False

        async def query(self, text):
            self.asked.append(text)
            self.queue.extend([Said(f"answer to: {text}"), Ended(f"answer to: {text}")])

        def receive_messages(self):
            async def reader():
                while self.queue:
                    yield self.queue.pop(0)
                # Nothing left: wait rather than end, exactly as a live one does.
                await asyncio.sleep(3600)
            return reader()

        async def receive_response(self):
            while self.queue:
                said = self.queue.pop(0)
                yield said
                if isinstance(said, Ended):
                    return

        async def disconnect(self):
            self.closed = True

    class Block(holder.TextBlock):
        def __init__(self, text):
            self.text = text

    class Said(holder.AssistantMessage):
        def __init__(self, text):
            self.text = text
            self.content = [Block(text)]

    class Ended(holder.ResultMessage):
        def __init__(self, text):
            self.result = text
            self.subtype = "success"

    stray = [Said("the background job finished"), Ended("the background job finished")]
    chatty = Chatty(stray)
    left, said_meanwhile = await holder.clear_the_line(chatty)
    check("a reply nobody asked for is cleared before the question goes out", left == 2, f"{left}")
    # And kept. What finished while nobody was asking is the thing somebody waiting on
    # it actually wants; telling them only that it happened is the worst of both.
    check("and what it said is kept, not just counted",
          "the background job finished" in said_meanwhile, said_meanwhile)

    heard = Nowhere()
    sessions = holder.Sessions()
    # A fresh one, still carrying the stray: the whole point is that the question runner
    # clears it for itself rather than relying on somebody having cleared it first.
    chatty = Chatty(stray)
    sessions.open = {"/somewhere": chatty}
    await holder.run_the_question(sessions, heard, "/somewhere", chatty, {"ask": "which three fixes"})
    # The one that matters: the answer reported as finished is the answer to the
    # question that was asked, not to something else that happened to be waiting.
    import json as _json
    finals = []
    for line in heard.said:
        try:
            was = _json.loads(line)
        except Exception:
            continue
        if was.get("kind") == "done":
            finals.append(was.get("text", ""))
    check(
        "so the answer that comes back is to the question that was asked",
        len(finals) == 1 and "which three fixes" in finals[0],
        finals[0][:120] if finals else "nothing came back",
    )
    check("and what finished is read out rather than hidden",
          any("the background job finished" in line for line in heard.spoken()), f"{heard.spoken()}")

    # And the ordinary case pays nothing and says nothing: a clear line stays quiet.
    quiet = Chatty([])
    calm = Nowhere()
    await holder.run_the_question(sessions, calm, "/somewhere", quiet, {"ask": "what changed"})
    check("a conversation with nothing waiting is not announced at all", not calm.spoken())

    # ---- the listener must never eat a live answer ----
    #
    # It reads from the same one stream the answers come down, which makes it dangerous
    # in a way nothing else here is: anything it takes is something a person never
    # hears. It has to stand aside for a question that has merely been asked, not only
    # for one already being answered — the gap between those two is exactly where it
    # settled in and started eating.
    sessions = holder.Sessions()
    live = Chatty([Said("part of a live answer"), Ended("part of a live answer")])
    sessions.open = {"/somewhere": live}
    sessions.wanted["/somewhere"] = 1          # a question has arrived, not yet started
    listening = asyncio.create_task(holder.listen_while_idle(sessions))
    await asyncio.sleep(holder.LISTEN_EVERY_S * 2.5)
    listening.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await listening
    check(
        "a question on its way in stops the listener reading at all",
        not sessions.mail.get("/somewhere") and len(live.queue) == 2,
        f"{sessions.mail.get('/somewhere')}, {len(live.queue)} left",
    )

    # ---- and it can say what it is holding ----
    sessions = holder.Sessions()
    sessions.open = {"/somewhere": StandIn()}
    sessions.used = {"/somewhere": 0}
    told = sessions.report()
    check(
        "it can say what it is holding open",
        len(told) == 1 and told[0]["project"] == "/somewhere" and "idleSeconds" in told[0],
        f"{told}",
    )


asyncio.run(main())

for name, passed, detail in results:
    print(f"{'ok  ' if passed else 'FAIL'}  {name}{f' — {detail}' if detail else ''}")
sys.exit(1 if any(not p for _, p, _ in results) else 0)
