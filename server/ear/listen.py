"""
The ear: the hearing done here, rather than on the phone.

Keeps one speech model in memory and answers "here is some sound, what were the
words?". It runs on this Mac's own graphics chip. Nothing is sent anywhere: the
sound arrives from the phone over your own network, is turned into words here,
and is never stored.

Taken from the speech branch of the advisor, where it was built and driven with,
rather than written again. Two things about it were learned the hard way there and
are kept exactly as they were — see the note above the worker below, and the
insistence on plain uncompressed sound.

It listens only to this machine. The app is what the phone talks to, and the app
passes the sound along; opening this to the network would be a second front door
with no lock on it.

  .ear/bin/python server/ear/listen.py           # port 8123 by default
  VOICE_CLAUDE_EAR_PORT=9000 ... same thing, elsewhere

POST /transcribe   body = raw little-endian 16-bit sound, 16 kHz, one channel
                   -> {"text": "...", "seconds": 8.4, "took": 0.65}
GET  /healthz      -> {"ok": true, "model": "...", "loaded": true}
"""

import json
import os
import queue
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

MODEL_NAME = os.environ.get("VOICE_CLAUDE_EAR_MODEL", "mlx-community/parakeet-tdt-0.6b-v3")
PORT = int(os.environ.get("VOICE_CLAUDE_EAR_PORT", "8123"))
SAMPLE_RATE = 16000
MAX_BODY = 32 * 1024 * 1024  # ~16 minutes of 16 kHz mono; refuse more

_model = None


def model():
    """Load once, on first use, so start-up is instant and the cost is paid once."""
    global _model
    if _model is None:
        from parakeet_mlx import from_pretrained

        began = time.time()
        _model = from_pretrained(MODEL_NAME)
        print(f"[ear] loaded {MODEL_NAME} in {time.time() - began:.1f}s", flush=True)
    return _model


def hear(pcm: bytes) -> dict:
    import mlx.core as mx
    from parakeet_mlx.audio import get_logmel

    audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    seconds = len(audio) / SAMPLE_RATE
    if seconds < 0.2:
        return {"text": "", "seconds": seconds, "took": 0.0}

    m = model()
    began = time.time()
    mel = get_logmel(mx.array(audio), m.preprocessor_config)
    result = m.generate(mel)[0]
    return {
        "text": result.text.strip(),
        "seconds": round(seconds, 2),
        "took": round(time.time() - began, 3),
    }


# The maths engine keeps its working state per thread, so the model must be loaded AND used on
# one and the same thread. Requests arrive on many threads, so they are handed to a single worker
# that owns the model and answers them one at a time -- which is also what we want anyway, since
# two clips at once would only fight over the same chip.
_jobs: "queue.Queue" = queue.Queue()


def _worker():
    while True:
        pcm, reply = _jobs.get()
        try:
            reply.put(("ok", hear(pcm)))
        except Exception as err:
            reply.put(("err", err))


threading.Thread(target=_worker, daemon=True).start()


def hear_on_worker(pcm: bytes) -> dict:
    reply: "queue.Queue" = queue.Queue()
    _jobs.put((pcm, reply))
    kind, value = reply.get()
    if kind == "err":
        raise value
    return value


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path.startswith("/healthz"):
            self._send(200, {"ok": True, "model": MODEL_NAME, "loaded": _model is not None})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/transcribe"):
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._send(413, {"error": "no audio, or too much of it"})
            return
        pcm = self.rfile.read(length)
        try:
            heard = hear_on_worker(pcm)
        except Exception as err:  # a bad clip must not take the ear down
            self._send(500, {"error": str(err)})
            return
        print(f"[ear] {heard['seconds']}s heard in {heard['took']}s: {heard['text'][:90]}", flush=True)
        self._send(200, heard)

    def log_message(self, *_args):
        pass  # we print our own, quieter line


if __name__ == "__main__":
    # Fetching is its own errand. The install does it once, with somebody watching and
    # willing to wait for two and a half gigabytes, rather than leaving the first
    # question of the first drive to pay for it.
    if "--fetch" in sys.argv:
        hear_on_worker(b"\x00\x00" * (SAMPLE_RATE // 2))
        print("[ear] model is here", flush=True)
        raise SystemExit(0)
    if "--warm" in sys.argv:
        hear_on_worker(b"\x00\x00" * (SAMPLE_RATE // 2))
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[ear] listening on http://127.0.0.1:{PORT}  model={MODEL_NAME}", flush=True)
    server.serve_forever()
