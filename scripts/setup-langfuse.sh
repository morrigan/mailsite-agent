#!/usr/bin/env bash
#
# setup-langfuse.sh, install the Langfuse tracing hook's Python environment.
# Creates <hub>/.venv-langfuse with a pinned Langfuse SDK, then prints the
# hook's config status. See docs/langfuse.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HUB="${MAILSITE_HUB:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}"
VENV="$HUB/.venv-langfuse"
LANGFUSE_VERSION="5.2.0"   # the hook is tested against this release

PY="${PYTHON:-python3}"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || {
  echo "setup-langfuse: Python 3.11+ required (found $("$PY" --version 2>&1))." >&2; exit 1; }

[ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check "langfuse==$LANGFUSE_VERSION"

MAILSITE_HUB="$HUB" "$VENV/bin/python" -I "$HUB/mailsite-agent/adapters/claude-code/langfuse_hook.py" --check
