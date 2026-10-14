#!/usr/bin/env bash
# Sourced by run-cron.sh and run-loop.sh.
#
# launchd and cron start a job with a minimal PATH (usually /usr/bin:/bin:...),
# so user-installed CLIs like claude, goose, node, and gh are often missing. Add
# the common install locations if they aren't already on PATH. Appending (not
# prepending) avoids shadowing anything the environment already set.
#
# If a binary lives somewhere unusual, skip all this and point straight at it
# with MAILSITE_CLAUDE_BIN or MAILSITE_GOOSE_BIN (absolute paths).
#
# Written to always succeed, so sourcing it under `set -e` never aborts.

_mailsite_add_path() {
  case ":$PATH:" in
    *":$1:"*) ;;                                   # already present
    *) [ -d "$1" ] && PATH="$PATH:$1" ;;           # add only if it exists
  esac
  return 0
}

_mailsite_add_path "/opt/homebrew/bin"
_mailsite_add_path "/usr/local/bin"
_mailsite_add_path "$HOME/.local/bin"
_mailsite_add_path "$HOME/.npm-global/bin"
_mailsite_add_path "$HOME/.volta/bin"
_mailsite_add_path "$HOME/.bun/bin"

# nvm: use the newest installed node's bin directory.
if [ -d "$HOME/.nvm/versions/node" ]; then
  _mailsite_nvm="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$_mailsite_nvm" ]; then _mailsite_add_path "$_mailsite_nvm"; fi
  unset _mailsite_nvm
fi

export PATH
unset -f _mailsite_add_path
return 0 2>/dev/null || true
