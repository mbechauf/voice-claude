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
import json
import os
import sys
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
        self.busy = {}          # project -> the task currently answering

    async def client_for(self, project, resume=None):
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
        return client

    async def close(self, project):
        client = self.open.pop(project, None)
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass


async def answer(sessions, writer, request):
    """Put one question to a project's session and report everything that comes back."""
    project = request["project"]
    client = await sessions.client_for(project, resume=request.get("resume"))

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
            tell(writer, "alive", projects=list(sessions.open))
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


async def main():
    sessions = Sessions()
    SOCKET.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(
        lambda r, w: serve(r, w, sessions), path=str(SOCKET)
    )
    print(f"session holder ready on {SOCKET}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    finally:
        SOCKET.unlink(missing_ok=True)
