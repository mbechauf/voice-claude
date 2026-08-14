# Issue draft — recognise a command by what it meant

Not filed yet. Delete this file once it is an issue.

---

**Title:** Recognise a command by meaning, not just by how it sounded

**Body:**

While driving, "can you read the commands to me" fell straight through the gate and
went to Claude as an ordinary question. It came back as all six commands spoken in
one breath. The wording was not on the list, and the list is the only thing the gate
knows.

The gate compares how words sound against a fixed set of wordings. That catches
dictation mishearing words you did say; it cannot catch you saying different words.
And you will say different words, because you cannot remember exact phrases at
seventy miles an hour. Adding more wordings is not the fix — every wording added is
a phrase that can no longer appear inside an ordinary question about code, and the
list of things you might say is open-ended while the list of things nobody says
about code is not.

The proposal is in `doc/recognising-commands-by-meaning.md`: keep the sound-alike
matching first and unchanged, add a meaning-matcher behind it that only wakes up
when no question is in progress, and have it ask before doing anything destructive
rather than acting on its own. The matcher runs on the Mac, borrowing the approach
from the sibling advisor project.

There is a second, smaller thing this drive exposed, worth a separate issue: the
"read a couple, then ask if you want the rest" rule only covers lists the phone
builds itself. Anything Claude says is spoken whole, and stopping after two is only
an instruction in its notes.

**Done when:** saying "read me the commands", "what were those commands again", or
"I've forgotten the commands" gets you the command list; "can it read the prompt
file" still goes to Claude untouched; and nothing in an ordinary question about code
wipes or forgets anything without asking first.
