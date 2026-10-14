#!/usr/bin/env bash
#
# run-cron.sh (Goose adapter), one scheduled tick.
# Mirror of the Claude adapter's wrapper, but invokes `goose run`.
set -euo pipefail

# pwd -P resolves symlinks, so invoking via the active-agent symlink still finds
# the real hub three levels up.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HUB_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
export MAILSITE_HUB="$HUB_ROOT"

if [ ! -d "$HUB_ROOT/mailsite-agent" ]; then
  echo "run-cron.sh: could not locate the hub (looked in $HUB_ROOT)." >&2
  echo "Run it as <hub>/active-agent/run-cron.sh, or set MAILSITE_HUB." >&2
  exit 1
fi

# launchd/cron give a minimal PATH; add the usual CLI install locations.
# shellcheck source=/dev/null
. "$HUB_ROOT/mailsite-agent/scripts/agent-path.sh"

mkdir -p "$HUB_ROOT/logs"
LOG="$HUB_ROOT/logs/run.log"

# Resolve the agent to an absolute path: explicit override (env or hub .env)
# first, otherwise search the real install locations (mailsite_find_bin).
GOOSE_BIN="${MAILSITE_GOOSE_BIN:-}"
if [ -z "$GOOSE_BIN" ] && [ -f "$HUB_ROOT/.env" ]; then
  GOOSE_BIN="$(sed -n 's/^MAILSITE_GOOSE_BIN=//p' "$HUB_ROOT/.env" | tail -1)"
  GOOSE_BIN="${GOOSE_BIN%\"}"; GOOSE_BIN="${GOOSE_BIN#\"}"
fi
[ -n "$GOOSE_BIN" ] || GOOSE_BIN="$(mailsite_find_bin goose || true)"
if [ -z "$GOOSE_BIN" ]; then
  echo "$(date -u +%FT%TZ) goose not found. Set MAILSITE_GOOSE_BIN=<absolute path> in .env (find it with 'command -v goose'). PATH was: $PATH" >>"$LOG"
  exit 127
fi

# Single-instance lock that records the holder's PID, so a tick that is still
# running is never cleared. A lock whose PID is dead (a crash) is reclaimed; a
# lock with no PID recorded is only reclaimed after MAILSITE_LOCK_STALE_MIN min.
LOCKDIR="$HUB_ROOT/logs/run.lock.d"
STALE_MIN="${MAILSITE_LOCK_STALE_MIN:-60}"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  lockpid="$(cat "$LOCKDIR/pid" 2>/dev/null || true)"
  if [ -n "$lockpid" ] && kill -0 "$lockpid" 2>/dev/null; then
    echo "$(date -u +%FT%TZ) another run (pid $lockpid) is active; skipping" >>"$LOG"; exit 0
  fi
  if [ -z "$lockpid" ] && [ -z "$(find "$LOCKDIR" -prune -mmin +"$STALE_MIN" 2>/dev/null)" ]; then
    echo "$(date -u +%FT%TZ) lock present without a live PID but recent; skipping" >>"$LOG"; exit 0
  fi
  echo "$(date -u +%FT%TZ) clearing stale lock (pid ${lockpid:-none} not running)" >>"$LOG"
  rm -f "$LOCKDIR/pid" 2>/dev/null || true; rmdir "$LOCKDIR" 2>/dev/null || true
  mkdir "$LOCKDIR" 2>/dev/null || { echo "$(date -u +%FT%TZ) could not acquire lock; skipping" >>"$LOG"; exit 0; }
fi
echo "$$" > "$LOCKDIR/pid"
trap 'rm -f "$LOCKDIR/pid" 2>/dev/null; rmdir "$LOCKDIR" 2>/dev/null || true' EXIT

cd "$HUB_ROOT"
echo "$(date -u +%FT%TZ) tick start (goose)" >>"$LOG"

# Capture the agent's real exit code (|| keeps `set -e` from aborting first) so a
# supervisor (run-loop.sh) can see failures.
rc=0
"$GOOSE_BIN" run --recipe mailsite-agent/adapters/goose/recipe.yaml \
  >>"$LOG" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then
  echo "$(date -u +%FT%TZ) goose exited $rc" >>"$LOG"
  exit "$rc"
fi

echo "$(date -u +%FT%TZ) tick end" >>"$LOG"
