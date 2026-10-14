#!/usr/bin/env bash
#
# scheduler.sh, the container entrypoint. Runs the self-healing supervisor
# (run-loop.sh), which ticks every MAILSITE_INTERVAL seconds and repairs and
# retries on failure instead of dying.
set -u

HUB="${MAILSITE_HUB:-/hub}"
cd "$HUB" || { echo "hub not mounted at $HUB"; exit 1; }

# Let git/gh push using a token if provided (GH_TOKEN is read by gh natively).
if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git >/dev/null 2>&1 || true
fi
git config --global --add safe.directory '*' >/dev/null 2>&1 || true
[ -n "${GIT_AUTHOR_NAME:-}" ]  && git config --global user.name  "$GIT_AUTHOR_NAME"  || true
[ -n "${GIT_AUTHOR_EMAIL:-}" ] && git config --global user.email "$GIT_AUTHOR_EMAIL" || true

if [ ! -x ./active-agent/run-cron.sh ]; then
  echo "No ./active-agent/run-cron.sh, create the symlink (see an adapter install.md)."
  exit 1
fi

echo "scheduler: self-healing loop via mailsite-agent/bin/run-loop.sh"
exec mailsite-agent/bin/run-loop.sh
