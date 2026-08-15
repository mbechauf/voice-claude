#!/usr/bin/env bash
# Keeps the app up.
#
# The point is not crash recovery. It is that the app is now changed by talking to
# it, from a car, and a change to its own code means nothing until it starts again —
# and there is nobody at the keyboard to do that. So it says how it wants to be
# treated on the way out, and this loop obeys:
#
#   0   done. Stay down. This is what stopping deliberately looks like.
#   75  start me again — the code underneath me changed.
#   *   it fell over. Start it again, but slow down if it keeps happening, because
#       a crash loop that restarts instantly hides the crash.
#
# Anything wanting a restart exits 75 rather than restarting itself: a process that
# replaces itself in place carries its old code in memory, which is the one thing
# this exists to avoid.
set -uo pipefail
cd "$(dirname "$0")/.."

RESTART_CODE=75
failures=0

while true; do
  node server/index.mjs
  code=$?

  if [ "$code" -eq 0 ]; then
    echo "voice-claude stopped."
    exit 0
  fi

  if [ "$code" -eq "$RESTART_CODE" ]; then
    failures=0
    echo ""
    echo "-- starting again with the new code --"
    sleep 0.3
    continue
  fi

  failures=$((failures + 1))
  wait=$((failures * 2))
  [ "$wait" -gt 30 ] && wait=30
  echo ""
  echo "-- it fell over (exit $code). Starting again in ${wait}s. --"
  sleep "$wait"
done
