# The session that stays open.
#
# Until now every question started Claude from nothing: a process launched, read the
# whole conversation back off disk, sent it up again, answered, and exited. A second
# or two of that before a word of thinking, on every single question, and the price
# grows with the drive because the transcript does.
#
# This holds one conversation open per project instead, in memory, and answers into
# it. The first question pays for loading the project; every one after it is the
# question and nothing else.
#
# Two things about the shape of it, both deliberate:
#
#   It is not owned by the app. The app restarts whenever its own code changes —
#   several times an hour while it is being worked on — and a conversation that died
#   with it would be worse than no conversation at all. So this runs on its own, the
#   app connects to it, and the app coming and going means nothing here.
#
#   It answers over a socket in the same small messages the app already reads. What
#   Claude says it is about to do, each step and what it was for, and what came back:
#   the spoken progress, the record and the summaries are all fed from those, and
#   they keep working unchanged.

import asyncio
import contextlib
import json
import os
import sys
import time
from pathlib import Path

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

# Where the app finds us. A file rather than a port because a port is a guess that is
# occasionally wrong on somebody else's machine, and because the file's presence is
# itself the answer to "is it running".
SOCKET = Path(os.environ.get("VOICE_CLAUDE_SESSION_SOCKET", "/tmp/voice-claude-session.sock"))

# How long a conversation may sit untouched before it is closed, and how many may be
# open at once. Both deliberately generous: closing one that was about to be used again
# costs a slow question and the thread that was in it, so the bias is towards keeping.
# But "never" was the old value for both, and a drive that touched five projects ended
# holding five conversations until somebody killed this process by hand.
IDLE_LIMIT_S = float(os.environ.get("VOICE_CLAUDE_CONVERSATION_IDLE_S", 30 * 60))
MOST_OPEN = int(os.environ.get("VOICE_CLAUDE_CONVERSATIONS_OPEN", 3))
# How often to look. Frequent enough to matter, rare enough to be invisible.
SWEEP_EVERY_S = 60.0


# Set when the app asks it to go. Made inside the loop that runs, because an event
# built before there is one belongs to the wrong loop and never wakes anybody.
stopping = None


def tell(writer, kind, **rest):
    """One message to the app. Newline-separated, so it can be read a line at a time."""
    writer.write((json.dumps({"kind": kind, **rest}) + "\n").encode())


class Sessions:
    """One live conversation per project, made when first asked for.

    Kept per project rather than one in total for the same reason the app keeps its
    remembered conversations that way: coming back to a project should find the work
    left there, and a conversation that answers about the wrong code with total
    confidence is worse than one that has to be started again.
    """

    def __init__(self):
        self.open = {}          # project -> live client
        self.used = {}          # project -> when it was last spoken to
        self.answering = {}     # project -> how many questions are in flight on it

    async def client_for(self, project, resume=None):
        self.used[project] = time.monotonic()
        if project in self.open:
            return self.open[project]

        options = ClaudeAgentOptions(
            cwd=project,
            # Everything else about how it may behave — what it is allowed to do, what
            # it is told about where it is — is decided by the app and sent with the
            # question. This process is a place for the conversation to live, not a
            # second opinion about how it should be conducted.
            permission_mode="bypassPermissions",
            resume=resume,
        )
        client = ClaudeSDKClient(options=options)
        await client.connect()
        self.open[project] = client
        # Room made only after the new one is in, so the count is honest and so a
        # conversation is never closed to make room for one that then fails to start.
        await self.make_room()
        return client

    async def make_room(self):
        """Close the least recently used, until no more than the ceiling are open.

        Never one that is mid-answer: the point of a ceiling is to stop conversations
        accumulating unnoticed, not to cut somebody off while they are waiting on one.
        """
        while len(self.open) > MOST_OPEN:
            idle = [p for p in self.open if not self.answering.get(p)]
            if not idle:
                return  # every one of them is working; the ceiling can wait
            oldest = min(idle, key=lambda p: self.used.get(p, 0))
            print(f"closing {oldest} — more than {MOST_OPEN} open", flush=True)
            await self.close(oldest)

    async def close_the_idle(self):
        """Close anything untouched for longer than the limit."""
        now = time.monotonic()
        for project in list(self.open):
            if self.answering.get(project):
                continue
            if now - self.used.get(project, now) < IDLE_LIMIT_S:
                continue
            print(f"closing {project} — untouched for {IDLE_LIMIT_S / 60:.0f} minutes", flush=True)
            await self.close(project)

    async def close_everything(self):
        for project in list(self.open):
            await self.close(project)

    def report(self):
        """What is open, for somebody asking what this machine is running."""
        now = time.monotonic()
        return [
            {
                "project": project,
                "idleSeconds": round(now - self.used.get(project, now)),
                "answering": self.answering.get(project, 0),
            }
            for project in self.open
        ]

    async def close(self, project):
        client = self.open.pop(project, None)
        self.used.pop(project, None)
        self.answering.pop(project, None)
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass


async def answer(sessions, writer, request):
    """Put one question to a project's session and report everything that comes back."""
    project = request["project"]
    client = await sessions.client_for(project, resume=request.get("resume"))

    # Counted while it is answering, so neither the idle limit nor the ceiling can
    # close this conversation out from under somebody who is waiting on it.
    #
    # This is a guard for the sweeps only. Two questions arriving on the same project
    # at once still collide over the one reply stream — a separate fault, with its own
    # issue, and deliberately not fixed here.
    sessions.answering[project] = sessions.answering.get(project, 0) + 1
    try:
        await run_the_question(sessions, writer, project, client, request)
    finally:
        left = sessions.answering.get(project, 1) - 1
        if left > 0:
            sessions.answering[project] = left
        else:
            sessions.answering.pop(project, None)
        sessions.used[project] = time.monotonic()


async def run_the_question(sessions, writer, project, client, request):
    await client.query(request["ask"])
    final = ""
    async for message in client.receive_response():
        if isinstance(message, SystemMessage):
            # The conversation's own name for itself, which the app writes down so the
            # work can be found again from a screen or after everything has restarted.
            said = (getattr(message, "data", {}) or {}).get("session_id")
            if said:
                tell(writer, "conversation", id=said)

        elif isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    tell(writer, "said", text=block.text)
                elif isinstance(block, ToolUseBlock):
                    tell(writer, "step", name=block.name, input=block.input)

        elif isinstance(message, UserMessage):
            for block in getattr(message, "content", []) or []:
                if isinstance(block, ToolResultBlock):
                    tell(writer, "result", text=str(block.content))

        elif isinstance(message, ResultMessage):
            final = getattr(message, "result", "") or final
            tell(writer, "done", text=final, outcome=message.subtype)


async def serve(reader, writer, sessions):
    try:
        line = await reader.readline()
        if not line:
            return
        request = json.loads(line)

        if request.get("what") == "ping":
            # The detail, not just the names. Somebody asking what their machine is
            # running deserves to hear how long each has been sitting there — that is
            # the fact whose absence let an idle one go unnoticed for two hours.
            tell(writer, "alive", projects=list(sessions.open), open=sessions.report())
        elif request.get("what") == "stop":
            # Asked to go, so it closes its conversations on the way out. Killing this
            # process instead would leave every Claude underneath it orphaned, which is
            # the same mess one level down.
            await sessions.close_everything()
            tell(writer, "stopping")
            await writer.drain()
            asyncio.get_running_loop().call_soon(stopping.set)
        elif request.get("what") == "forget":
            await sessions.close(request["project"])
            tell(writer, "forgotten")
        else:
            await answer(sessions, writer, request)

        await writer.drain()
    except Exception as err:  # noqa: BLE001
        # Never take the whole thing down for one bad question. The app can always
        # fall back to starting Claude the old way, but only if this is still here.
        try:
            tell(writer, "trouble", text=f"{err}")
            await writer.drain()
        except Exception:
            pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def keep_it_tidy(sessions):
    """Close what has gone cold. The one thing nothing here used to do."""
    while True:
        await asyncio.sleep(SWEEP_EVERY_S)
        try:
            await sessions.close_the_idle()
            await sessions.make_room()
        except Exception as err:  # noqa: BLE001
            # Tidying up is never worth taking the conversations down for.
            print(f"tidying up went wrong: {err}", flush=True)


async def main():
    global stopping
    stopping = asyncio.Event()
    sessions = Sessions()
    SOCKET.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(
        lambda r, w: serve(r, w, sessions), path=str(SOCKET)
    )
    print(f"session holder ready on {SOCKET}", flush=True)
    tidying = asyncio.create_task(keep_it_tidy(sessions))
    async with server:
        # Waits to be told to stop rather than running forever, so that being asked to
        # go means closing the conversations properly instead of being killed with them
        # still open underneath.
        await stopping.wait()
    tidying.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await tidying
    await sessions.close_everything()
    print("session holder stopped", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    finally:
        SOCKET.unlink(missing_ok=True)
