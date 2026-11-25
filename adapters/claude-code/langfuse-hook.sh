#!/usr/bin/env bash
#
# langfuse-hook.sh, Claude Code Stop hook that exports a scheduled run to
# Langfuse (see docs/langfuse.md). Always exits 0: tracing must never fail a run.
#
# It does nothing unless all of these hold:
#   - MAILSITE_RUN_KIND is set (run-cron.sh / run-loop.sh set it; interactive
#     sessions in the hub don't, so they are never exported)
#   - the Langfuse venv exists (scripts/setup-langfuse.sh)
#   - LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are in <hub>/.env
[ -n "${MAILSITE_RUN_KIND:-}" ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HUB="${MAILSITE_HUB:-$(cd "$SCRIPT_DIR/../../.." && pwd -P)}"
PY="${MAILSITE_LANGFUSE_PYTHON:-$HUB/.venv-langfuse/bin/python}"
[ -x "$PY" ] || exit 0

MAILSITE_HUB="$HUB" "$PY" -I "$SCRIPT_DIR/langfuse_hook.py" >/dev/null 2>&1 || true
exit 0
