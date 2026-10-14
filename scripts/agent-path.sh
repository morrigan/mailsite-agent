#!/usr/bin/env bash
# Sourced by run-cron.sh and run-loop.sh.
#
# launchd and cron start a job with a minimal PATH (usually /usr/bin:/bin:...),
# so user-installed CLIs like claude, goose, node, and gh are often missing.
# This file (a) widens PATH with the common install locations and (b) provides
# mailsite_find_bin, which resolves a command to an absolute path by also
# checking the places those installers actually drop binaries.
#
# If a binary lives somewhere unusual, point straight at it with an absolute
# MAILSITE_CLAUDE_BIN or MAILSITE_GOOSE_BIN (env or hub .env).
#
# Written to always succeed, so sourcing it under `set -e` never aborts.

_mailsite_add_path() {
  case ":$PATH:" in
    *":$1:"*) ;;                                   # already present
    *) [ -d "$1" ] && PATH="$PATH:$1" ;;           # add only if it exists
  esac
  return 0
}

# Guard HOME: launchd/cron may not export it, and these scripts run under `set -u`.
_mailsite_home="${HOME:-}"
_mailsite_add_path "/opt/homebrew/bin"
_mailsite_add_path "/usr/local/bin"
_mailsite_add_path "${_mailsite_home}/.local/bin"
_mailsite_add_path "${_mailsite_home}/.npm-global/bin"
_mailsite_add_path "${_mailsite_home}/.volta/bin"
_mailsite_add_path "${_mailsite_home}/.bun/bin"
_mailsite_add_path "${_mailsite_home}/.claude/local"
if [ -n "$_mailsite_home" ]; then
  for _d in "$_mailsite_home"/.nvm/versions/node/*/bin; do _mailsite_add_path "$_d"; done
  unset _d
fi
export PATH

# Resolve a command name to an absolute path. Echoes the path and returns 0, or
# returns 1 if nothing is found. Checks PATH first, then explicit candidates
# (every nvm version, the Claude native installer dir, the usual bin dirs).
mailsite_find_bin() {
  local name="$1" p
  p="$(command -v "$name" 2>/dev/null || true)"
  if [ -n "$p" ]; then echo "$p"; return 0; fi
  local h="${HOME:-}"
  for p in \
    "$h/.claude/local/$name" \
    "$h/.local/bin/$name" \
    "$h/.npm-global/bin/$name" \
    "/opt/homebrew/bin/$name" \
    "/usr/local/bin/$name" \
    "$h/.bun/bin/$name" \
    "$h/.volta/bin/$name" \
    "$h/.deno/bin/$name" \
    "$h"/.nvm/versions/node/*/bin/"$name"; do
    if [ -x "$p" ]; then echo "$p"; return 0; fi
  done
  return 1
}

unset -f _mailsite_add_path
unset _mailsite_home
return 0 2>/dev/null || true
