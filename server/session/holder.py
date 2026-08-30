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
# How long a question will wait for the one before it on the same project, before
# giving up and saying so rather than waiting for ever.
WAIT_FOR_TURN_S = float(os.environ.get("VOICE_CLAUDE_WAIT_FOR_TURN", "180"))

# How full a conversation is allowed to get before it is rebuilt on purpose.
#
# It will be rebuilt either way — when it runs out of room, whatever is happening at the
# time. This conversation's own record shows four of those, one dropping it from four
# hundred thousand to thirteen thousand, none of them announced. Landing mid-question,
# that reads exactly like the thing losing the thread, and the person it happens to is
# driving and cannot look.
#
# So it is done early, at a moment nobody is waiting, while there is still room to write
# a proper summary rather than one made by something already struggling. Sixty per cent
# is late enough to be rare and early enough to be done well.
FULL_ENOUGH = float(os.environ.get("VOICE_CLAUDE_REBUILD_AT", "0.6"))

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


def speak(writer, text):
    """Something the person should hear, in the words they should hear it in.

    Kept apart from the progress notes and from trouble on purpose. Progress is about
    the question being answered and is rationed; trouble goes to the app rather than to
    the person. This is the machinery telling somebody something was done to their
    conversation, which is never worth rationing and never worth swallowing.
    """
    with contextlib.suppress(Exception):
        tell(writer, "notice", text=text)


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
        self.turns = {}         # project -> whose turn it is on that one conversation
        self.mail = {}          # project -> what it said when nobody was asking
        self.wanted = {}        # project -> how many questions are on their way in
        self.carrying_on = {}   # project -> what a rebuilt conversation must read first

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
    # A conversation that was rebuilt does not resume: resuming is what we were trying to
    # get away from. It starts clean and reads what the last one wrote down for it.
    #
    # Asked of the disk rather than remembered, because a note held only in this
    # process's head is a note lost the moment it restarts — and restarting is exactly
    # when a fresh conversation most needs to be told where it came from. The file being
    # there is the whole of the state; nothing has to survive in memory for this to work.
    note = sessions.carrying_on.pop(project, None) or waiting_note(project)
    client = await sessions.client_for(project, resume=None if note else request.get("resume"))
    if note:
        request = dict(request)
        request["ask"] = (
            f"This conversation carries on from one that grew too long. Read {note} first — "
            "it is what the last one wrote down for you — and then answer what follows "
            "as if you had been here all along. Do not mention having read it.\n\n"
            + request["ask"]
        )
        # Read once and then put out of the way. Left in place it would be handed to
        # every conversation that ever started here, including ones with no connection
        # to it — and a fresh start that begins by reading somebody else's notes is
        # worse than one that begins with nothing.
        with contextlib.suppress(Exception):
            Path(note).replace(Path(note).with_suffix(".read.md"))

    # One at a time, on this conversation.
    #
    # Two questions on the same project used to run at once and read from the one
    # stream of replies between them, so the replies were split arbitrarily and neither
    # question reliably saw the end of its own answer. Nothing ever finished, nothing
    # ever timed out, and the app was left believing it was busy for good — five
    # questions deep, with a beep every ten seconds and no way back short of killing
    # this helper by hand. That is what this lock is for.
    #
    # The wait has a limit, because a wait without one is how the freeze happened in the
    # first place. Giving up and saying so is always better than waiting silently: the
    # person is in a car and cannot see that anything is wrong.
    turn = sessions.turns.setdefault(project, asyncio.Lock())
    # Said before anything is waited for. Whoever else might be reading this
    # conversation has to know a question is coming the instant it arrives, not once
    # the turn has changed hands — the gap between those two is small and it is exactly
    # where somebody else's reader can settle in and start eating the answer.
    sessions.wanted[project] = sessions.wanted.get(project, 0) + 1
    try:
        await asyncio.wait_for(turn.acquire(), timeout=WAIT_FOR_TURN_S)
    except asyncio.TimeoutError:
        sessions.wanted[project] = max(0, sessions.wanted.get(project, 1) - 1)
        tell(writer, "error", text="that project is still busy with the question before this one")
        tell(writer, "done")
        return

    # Counted while it is answering, so neither the idle limit nor the ceiling can
    # close this conversation out from under somebody who is waiting on it.
    sessions.answering[project] = sessions.answering.get(project, 0) + 1
    try:
        await run_the_question(sessions, writer, project, client, request)
    finally:
        turn.release()
        sessions.wanted[project] = max(0, sessions.wanted.get(project, 1) - 1)
        left = sessions.answering.get(project, 1) - 1
        if left > 0:
            sessions.answering[project] = left
        else:
            sessions.answering.pop(project, None)
        sessions.used[project] = time.monotonic()

    # Between questions on this project, with the turn given back and nobody waiting.
    # This is the only honest moment for it: anywhere earlier and a rebuild lands in the
    # middle of an answer somebody is listening to.
    await rebuild_if_full(sessions, writer, project)


async def how_full(client):
    """How much of the room is used, nought to one. None when it cannot be told."""
    try:
        seen = await client.get_context_usage()
    except Exception:
        return None
    # Asked for rather than worked out. The window is not ours to assume — it is
    # different per model and larger than any number worth writing down here.
    room = seen.get("maxTokens") or seen.get("rawMaxTokens")
    used = seen.get("totalTokens")
    if not room or used is None:
        return None
    return used / room


# How long to listen for something already on its way before deciding the line is
# clear. Short, because it is paid on every single question; long enough that a reply
# already sitting there is certain to be seen, which it is — anything queued is
# delivered the moment it is asked for.
LINE_CLEAR_S = float(os.environ.get("VOICE_CLAUDE_LINE_CLEAR", "0.15"))
# And how long to keep listening once something has turned up, because a turn arrives
# in pieces with thinking time between them and stopping half way through it would
# leave the rest to be mistaken for the next answer.
MID_TURN_S = float(os.environ.get("VOICE_CLAUDE_MID_TURN", "5"))
# A stray turn that never ends must not hold up the question. Better a question that
# goes out with the line not quite clear than one that never goes out.
GIVE_UP_S = float(os.environ.get("VOICE_CLAUDE_CLEARING_LIMIT", "30"))


async def next_thing_said(client, patience):
    """The next thing this conversation says, or None if it says nothing for a while.

    A fresh reader each time on purpose: giving up on one ends it, and the replies are
    a queue belonging to the conversation rather than to any reader, so the next reader
    carries on from exactly where this one stopped. Nothing waiting is lost by looking.
    """
    reader = client.receive_messages().__aiter__()
    try:
        return await asyncio.wait_for(reader.__anext__(), patience)
    except (asyncio.TimeoutError, StopAsyncIteration):
        return None
    finally:
        with contextlib.suppress(Exception):
            await reader.aclose()


async def clear_the_line(client):
    """Throw away anything said before we asked, and say how much there was.

    This is the off-by-one, and it is worth stating plainly because it looks impossible
    until you see it. A conversation does not only speak when spoken to. A job left
    running in the background finishes, the conversation is told so, and it answers
    that — with nobody waiting, into a queue nobody is reading. It sits there.

    The next question then reads the queue from the beginning, finds that reply, sees
    it end, and reports it as the answer. It is a whole reply, it is about this project,
    it is recent, and it is completely wrong — it is the answer to something else. From
    then on every answer is one behind, permanently, and the last one is never heard at
    all. Two hours of a real drive went that way: a question about which fixes were
    meant got back a report on a batch job, and the reply that actually answered it was
    never spoken.

    Nothing here tries to be clever about whose reply is whose, because nothing in what
    comes back says so. It relies on one thing that is always true: whatever is already
    waiting when we ask cannot be an answer to what we are about to ask.
    """
    dropped = 0
    words = []
    mid_turn = False
    started = time.monotonic()
    while time.monotonic() - started < GIVE_UP_S:
        said = await next_thing_said(client, MID_TURN_S if mid_turn else LINE_CLEAR_S)
        if said is None:
            break
        dropped += 1
        # Kept, not merely counted. This is a real report on something that finished —
        # usually the very thing somebody has been waiting on — and it was written to
        # nobody. Throwing it away and saying "something finished" is the worst of both:
        # they know they missed something and cannot have it.
        words.extend(plain_text(said))
        mid_turn = not isinstance(said, ResultMessage)
    return dropped, " ".join(w for w in words if w).strip()


def plain_text(message):
    """Whatever a message says in words, and nothing it says in machinery."""
    said = []
    if isinstance(message, ResultMessage):
        # The result repeats the last thing said, so it is left out to avoid saying it
        # twice; it is only used when nothing else came through at all.
        return said
    for block in getattr(message, "content", []) or []:
        if isinstance(block, TextBlock) and block.text.strip():
            said.append(block.text.strip())
    return said


async def rebuild_if_full(sessions, writer, project):
    """Write down what matters, then let the conversation start again from it."""
    client = sessions.open.get(project)
    if client is None:
        return
    full = await how_full(client)
    if full is None or full < FULL_ENOUGH:
        return

    # The turn is taken back for this, and given up on rather than waited for. Writing
    # the summary is a question on the same conversation as any other, and two of those
    # at once is the exact fault the turn exists to prevent — one stream of replies read
    # from both ends, an answer that never finishes, and then the conversation closed
    # out from under somebody mid-sentence. If a question got in first, this simply does
    # not happen now: the check runs again after that one, a few seconds later.
    turn = sessions.turns.setdefault(project, asyncio.Lock())
    if turn.locked():
        return
    await turn.acquire()
    try:
        await rebuild_now(sessions, writer, project, client, full)
    finally:
        turn.release()


async def rebuild_now(sessions, writer, project, client, full):
    """The rebuild itself, with the conversation to itself."""
    note = summary_file(project)

    # Said out loud before anything happens, and this is the point of saying it. A
    # conversation going back to knowing nothing is the largest thing that happens to
    # it, and it happens to somebody who is driving and cannot look at a screen: with
    # nothing said, the first sign is an answer that has forgotten what was just agreed,
    # which reads as the thing breaking rather than as housekeeping. The silence needs
    # covering too — writing the summary takes a while, and a silence straight after an
    # answer is indistinguishable from a fault.
    speak(writer, "This conversation is getting full. I'm writing down where we've got "
                  "to, then starting a fresh one from that note.")

    try:
        # Asked of the conversation that still remembers everything, while it has room
        # to answer properly. Written to a file rather than held in hand, so a rebuild
        # that goes wrong leaves something to read rather than nothing at all — and so
        # the person can see what it decided to keep and say it kept the wrong things.
        await client.query(
            "Before this conversation is started again, write down what the next one needs "
            f"to carry on without having been here. Put it in {note}, replacing anything "
            "already there. Say what we are doing and why, what has been decided and what "
            "was rejected, what is half-finished, and anything that would be expensive to "
            "learn twice. Leave out what is already written down in the project itself.\n\n"
            # Older than a day, a summary is enough — nobody picks a thread back up from
            # three days ago mid-sentence. Newer than that, the actual words matter,
            # because "that one" and "put it back" and "the other way" all point at
            # things said recently, and a summary destroys exactly those.
            "Then, under a heading of its own, write out the last day's exchanges as they "
            "were actually said, in order and word for word — not summarised. What was "
            "said recently is what the next questions will point back at.\n\n"
            "Do not say anything out loud about doing this."
        )
        async for _ in client.receive_response():
            pass
    # Every way out of this is said too, and that is not politeness. Having announced a
    # restart, going quiet and carrying on regardless leaves somebody believing the
    # conversation was emptied when it was not — and acting on that belief, by repeating
    # things it still remembers perfectly well.
    except Exception as err:
        tell(writer, "trouble", text=f"could not write the summary: {err}")
        speak(writer, "I couldn't write that down, so I'm leaving this conversation as it is.")
        return

    if not Path(note).exists():
        tell(writer, "trouble", text="the summary was not written; leaving the conversation alone")
        speak(writer, "Nothing got written down, so I'm leaving this conversation as it is.")
        return

    # Only now. Closing before the summary exists would throw away the very thing the
    # next conversation is supposed to read.
    await sessions.close(project)
    # Remembered here rather than announced. The app has already been told the answer is
    # finished and may well have hung up by now, so a rebuild that depended on the news
    # arriving would be a rebuild that sometimes did not happen. This side knows, and
    # this side is the one that has to act on it.
    sessions.carrying_on[project] = note
    with contextlib.suppress(Exception):
        tell(writer, "rebuilt", note=note, wasFull=round(full, 3))
    speak(writer, "Done. The next thing you ask starts a fresh conversation, "
                  "and it reads that note first.")


def summary_file(project):
    return str(Path(project) / ".voice-claude" / "carrying-on.md")


def waiting_note(project):
    """A summary left for the next conversation, if one is sitting there unread."""
    note = summary_file(project)
    return note if Path(note).exists() else None


async def run_the_question(sessions, writer, project, client, request):
    # Before asking, and never after: what is already there is the giveaway, and after
    # the answer there is no way to tell a stray reply from one still arriving.
    dropped, said_meanwhile = await clear_the_line(client)
    if dropped:
        print(f"cleared {dropped} left over on {project} before asking", flush=True)
        # Read out, not merely reported. Something ran to completion while nobody was
        # asking, and what it said about it is exactly what somebody waiting on it
        # wanted — usually the result of the very thing they were waiting for. Saying
        # only that it happened tells them they missed something and does not let them
        # have it.
        #
        # Trimmed, because it can run long and this is arriving in front of the answer
        # to the question actually asked. Enough to know what came of it; the
        # conversation still remembers all of it if they want more.
        if said_meanwhile:
            speak(writer, "While you were away, this finished. "
                          + said_meanwhile[:900])
        else:
            speak(writer, "Something finished on its own while nobody was asking, "
                          "but it did not say what.")

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
            # Set before the goodbye is sent, and never after. Whoever asked has what
            # they came for the moment the line is written, and hangs up — so sending
            # it can fail on a socket the other end has already dropped. That failure
            # used to jump straight past the one line that actually stops this thing,
            # which is how it carried on running for seven hours after being told to
            # go, while everything that asked reported success.
            asyncio.get_running_loop().call_soon(stopping.set)
            with contextlib.suppress(Exception):
                tell(writer, "stopping")
                await writer.drain()
        elif request.get("what") == "mail":
            # What it said while nobody was asking, and emptied by the asking so
            # nothing is ever said twice.
            # Asked for one project or for all of them. All of them matters: a job
            # finishing somewhere you are not standing is exactly the one you cannot
            # see, and it is the one worth being told about.
            project = request.get("project")
            if project:
                tell(writer, "mail", said=sessions.mail.pop(project, []))
            else:
                everywhere = {}
                for where in list(sessions.mail):
                    said = sessions.mail.pop(where, [])
                    if said:
                        everywhere[where] = said
                tell(writer, "mail", everywhere=everywhere)
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


# How often to look in on a conversation nobody is asking anything. Often enough that a
# job finishing is heard about while somebody still cares, rare enough to be invisible.
LISTEN_EVERY_S = float(os.environ.get("VOICE_CLAUDE_LISTEN_EVERY", "2"))


async def listen_while_idle(sessions):
    """Hear what a conversation says when nobody asked it anything.

    A conversation does not only speak when spoken to. A job left running finishes, it
    is told so, and it answers — writing a real report to nobody, because nothing is
    reading between questions. Until now that report sat in the queue until the next
    question came along, which meant somebody waiting on the very thing it was about
    heard nothing until they gave up and asked.

    So something listens. It takes the turn like any other reader, so it can never read
    from underneath a question being answered, and it gives it straight back — holding
    it would be the same fault one level up.
    """
    while True:
        await asyncio.sleep(LISTEN_EVERY_S)
        for project, client in list(sessions.open.items()):
            if sessions.answering.get(project):
                continue
            turn = sessions.turns.setdefault(project, asyncio.Lock())
            if turn.locked():
                continue
            if sessions.wanted.get(project):
                continue
            await turn.acquire()
            try:
                # One thing, briefly, and then the turn goes back. Never a long wait and
                # never a second helping.
                #
                # This listener reads from the same one stream the answers come down,
                # and that makes it dangerous in a way nothing else here is: anything it
                # takes is something a person never hears. It settled in mid-turn and
                # ate pieces of live answers, which sounded exactly like a slow machine
                # rather than like something reading over your shoulder.
                #
                # So it stands aside for anybody at all. If a question is on its way in,
                # it does not even look.
                said = await next_thing_said(client, 0.05)
                if said is not None:
                    for words in plain_text(said):
                        sessions.mail.setdefault(project, []).append(words)
                        print(f"heard while idle on {project}: {words[:80]}", flush=True)
            except Exception as err:  # noqa: BLE001
                print(f"listening while idle went wrong: {err}", flush=True)
            finally:
                turn.release()


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
    listening = asyncio.create_task(listen_while_idle(sessions))
    async with server:
        # Waits to be told to stop rather than running forever, so that being asked to
        # go means closing the conversations properly instead of being killed with them
        # still open underneath.
        await stopping.wait()
    tidying.cancel()
    listening.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await tidying
    with contextlib.suppress(asyncio.CancelledError):
        await listening
    await sessions.close_everything()
    print("session holder stopped", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    finally:
        SOCKET.unlink(missing_ok=True)
