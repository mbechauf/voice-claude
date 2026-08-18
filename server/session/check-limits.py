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
