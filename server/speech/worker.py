# The voice itself. Loads the model once and then waits, because loading it takes
# seconds and nobody driving wants that pause before every sentence.
#
# It speaks when spoken to: one request per line on the way in, one answer per line
# on the way out, so the Mac side can stay a thin pipe and this file can be swapped
# for a different voice without anything else noticing.
#
#   in   {"id": 1, "text": "...", "voice": "af_heart", "speed": 1.05}
#   out  {"id": 1, "path": "/tmp/....wav"}   or   {"id": 1, "error": "..."}

import json
import os
import sys
import tempfile

# Said before the model loads, so the Mac side knows the difference between "still
# starting up" and "never going to work".
def announce(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


try:
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline
except Exception as err:  # noqa: BLE001 - anything here means the voice is unavailable
    announce({"ready": False, "error": f"{err}"})
    sys.exit(1)

SAMPLE_RATE = 24_000

# American and British voices come from different pipelines; keep whichever ones get
# used, and don't build the other until someone asks for it.
pipelines = {}


def pipeline_for(voice):
    lang = "b" if voice.startswith(("b", "B")) else "a"
    if lang not in pipelines:
        pipelines[lang] = KPipeline(lang_code=lang)
    return pipelines[lang]


def say(text, voice, speed):
    chunks = [audio for _, _, audio in pipeline_for(voice)(text, voice=voice, speed=speed)]
    if not chunks:
        raise RuntimeError("nothing came out")
    handle, path = tempfile.mkstemp(prefix="voice-claude-", suffix=".wav")
    os.close(handle)
    sf.write(path, np.concatenate(chunks), SAMPLE_RATE)
    return path


announce({"ready": True})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        continue

    try:
        path = say(
            request.get("text", ""),
            request.get("voice") or "af_heart",
            float(request.get("speed") or 1.0),
        )
        announce({"id": request.get("id"), "path": path})
    except Exception as err:  # noqa: BLE001 - one bad sentence must not end the drive
        announce({"id": request.get("id"), "error": f"{err}"})
