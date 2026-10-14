#!/usr/bin/env bash
#
# run-loop.sh — self-healing supervisor.
#
# Runs ticks forever via the active-agent's run-cron.sh. When a tick fails, it
# runs a bounded agent repair pass (mailsite-agent/REPAIR.md) and retries. After
# repeated failures it opens a circuit breaker: it raises logs/NEEDS_ATTENTION
# and backs off, but keeps running so it recovers on its own once the cause
# clears. One bad tick never kills the loop.
#
# Env knobs:
#   MAILSITE_INTERVAL   seconds between healthy ticks (default 600)
#   MAILSITE_MAX_REPAIR consecutive failures to repair before the breaker opens (default 3)
#   MAILSITE_REPAIR     set to 0 to disable the agent repair pass (retry only)
#
# This is the one native runtime. Install it as a service (launchd on macOS,
# systemd on Linux) with scripts/install-service.sh; Docker runs it for you.
set -uo pipefail   # deliberately not -e: the loop must survive failures

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HUB_ROOT="${MAILSITE_HUB:-$(cd "$SCRIPT_DIR/.." && pwd -P)}"
export MAILSITE_HUB="$HUB_ROOT"
cd "$HUB_ROOT"

if [ ! -x "$HUB_ROOT/active-agent/run-cron.sh" ]; then
  echo "run-loop.sh: no ./active-agent/run-cron.sh in $HUB_ROOT. Run setup first." >&2
  exit 1
fi

# launchd/cron give a minimal PATH; add the usual CLI install locations so the
# repair pass below can find claude/goose (ticks handle this in run-cron.sh too).
# shellcheck source=/dev/null
. "$HUB_ROOT/mailsite-agent/scripts/agent-path.sh"

mkdir -p "$HUB_ROOT/logs"
LOG="$HUB_ROOT/logs/loop.log"
RUN_LOG="$HUB_ROOT/logs/run.log"
MARKER="$HUB_ROOT/logs/NEEDS_ATTENTION"
REPAIR_DOC="$HUB_ROOT/mailsite-agent/REPAIR.md"

INTERVAL="${MAILSITE_INTERVAL:-600}"
MAX_REPAIR="${MAILSITE_MAX_REPAIR:-3}"
REPAIR_ENABLED="${MAILSITE_REPAIR:-1}"

log() { echo "$(date -u +%FT%TZ) $*" >>"$LOG"; }

# Which agent is wired in (claude-code | goose), resolved through the symlink.
runner="$(basename "$(cd "$HUB_ROOT/active-agent" && pwd -P)")"

run_tick() { "$HUB_ROOT/active-agent/run-cron.sh"; }

# Hand the recent run log to the agent and let it follow REPAIR.md.
run_repair() {
  [ "$REPAIR_ENABLED" = "1" ] || { log "repair disabled (MAILSITE_REPAIR=0)"; return 1; }
  [ -f "$REPAIR_DOC" ] || { log "no REPAIR.md at $REPAIR_DOC; skipping repair"; return 1; }
  local recent prompt
  recent="$(tail -n 200 "$RUN_LOG" 2>/dev/null)"
  prompt="A scheduled run just failed. Read ${REPAIR_DOC} and follow it exactly to
diagnose and, only if safe, fix the problem, then stop. Recent run log:
${recent}"
  local bin
  case "$runner" in
    claude-code)
      bin="${MAILSITE_CLAUDE_BIN:-$(mailsite_find_bin claude || true)}"
      [ -n "$bin" ] || { log "claude not found for repair"; return 1; }
      "$bin" -p "$prompt" >>"$LOG" 2>&1 ;;
    goose)
      bin="${MAILSITE_GOOSE_BIN:-$(mailsite_find_bin goose || true)}"
      [ -n "$bin" ] || { log "goose not found for repair"; return 1; }
      "$bin" run -t "$prompt" >>"$LOG" 2>&1 ;;
    *) log "unknown runner '$runner'; cannot auto-repair"; return 1 ;;
  esac
}

clear_fail_state() { fails=0; rm -f "$MARKER" 2>/dev/null || true; }

fails=0
log "loop start (runner=$runner interval=${INTERVAL}s max_repair=${MAX_REPAIR})"

while true; do
  if run_tick; then
    [ "$fails" -gt 0 ] && log "recovered after $fails failure(s)"
    clear_fail_state
    sleep "$INTERVAL"
    continue
  fi

  fails=$((fails + 1))
  log "tick failed (consecutive=$fails)"

  if [ "$fails" -le "$MAX_REPAIR" ]; then
    log "self-repair attempt $fails/$MAX_REPAIR (runner=$runner)"
    run_repair && log "repair pass finished" || log "repair unavailable or errored"
    if run_tick; then
      log "tick succeeded after repair"
      clear_fail_state
      sleep "$INTERVAL"
      continue
    fi
    log "tick still failing after repair"
  fi

  if [ "$fails" -ge "$MAX_REPAIR" ]; then
    : > "$MARKER"
    log "CIRCUIT OPEN after $fails failures. Raised $MARKER. A human should check $RUN_LOG and $LOG."
  fi

  # Linear backoff capped at 6x the interval so a persistent fault stays quiet.
  mult=$(( fails < 6 ? fails : 6 ))
  backoff=$(( INTERVAL * mult ))
  log "backing off ${backoff}s"
  sleep "$backoff"
done
