#!/usr/bin/env bash
#
# run-cron.sh (Goose adapter), one scheduled tick.
# Mirror of the Claude adapter's wrapper, but invokes `goose run`.
# Holds a lock so overlapping ticks can't double-run.
set -euo pipefail

# pwd -P resolves symlinks, so invoking via the active-agent symlink still finds
# the real hub three levels up (not two levels above it, which is how a logical
# path through the symlink lands on /var).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HUB_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
export MAILSITE_HUB="$HUB_ROOT"

if [ ! -d "$HUB_ROOT/mailsite-agent" ]; then
  echo "run-cron.sh: could not locate the hub (looked in $HUB_ROOT)." >&2
  echo "Run it as <hub>/active-agent/run-cron.sh, or set MAILSITE_HUB." >&2
  exit 1
fi

LOG="$HUB_ROOT/logs/run.log"
mkdir -p "$HUB_ROOT/logs"

# Portable single-instance lock (works on macOS, which lacks flock): an atomic
# mkdir. A lock older than 30 min is treated as stale (a crashed prior run).
LOCKDIR="$HUB_ROOT/logs/run.lock.d"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  if [ -n "$(find "$LOCKDIR" -prune -mmin +30 2>/dev/null)" ]; then
    echo "$(date -u +%FT%TZ) removing stale lock" >>"$LOG"; rmdir "$LOCKDIR" 2>/dev/null || true; mkdir "$LOCKDIR" 2>/dev/null || exit 0
  else
    echo "$(date -u +%FT%TZ) another run holds the lock; skipping" >>"$LOG"; exit 0
  fi
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT

cd "$HUB_ROOT"
echo "$(date -u +%FT%TZ) tick start (goose)" >>"$LOG"

goose run --recipe mailsite-agent/adapters/goose/recipe.yaml \
  >>"$LOG" 2>&1 || echo "$(date -u +%FT%TZ) goose exited non-zero" >>"$LOG"

echo "$(date -u +%FT%TZ) tick end" >>"$LOG"
