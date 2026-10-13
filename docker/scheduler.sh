#!/usr/bin/env bash
#
# scheduler.sh — the container entrypoint. Replaces launchd/cron inside Docker:
# runs the active agent adapter's run-cron.sh every MAILSITE_INTERVAL seconds.
set -u

INTERVAL="${MAILSITE_INTERVAL:-600}"
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
  echo "No ./active-agent/run-cron.sh — create the symlink (see an adapter install.md)."
  exit 1
fi

echo "scheduler: every ${INTERVAL}s via ./active-agent/run-cron.sh"
while true; do
  ./active-agent/run-cron.sh || echo "run-cron exited non-zero"
  sleep "$INTERVAL"
done
