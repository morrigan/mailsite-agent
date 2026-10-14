#!/usr/bin/env bash
#
# install-service.sh, install the mailsite-agent self-healing loop as a native
# OS service, so it starts on boot and restarts on crash. The loop
# (bin/run-loop.sh) ticks on its own interval; the OS only keeps it alive.
#
#   bash mailsite-agent/scripts/install-service.sh [install|uninstall|status|print]
#
# Detects the platform and uses the right supervisor:
#   macOS  -> launchd user agent   (ops/macos/com.mailsite.loop.plist)
#   Linux  -> systemd user service (ops/linux/mailsite-loop.service)
#   no systemd -> prints a cron @reboot fallback
#   other (Windows) -> points you at Docker or WSL2
#
# Docker users do not need this: the container already runs the loop.
set -uo pipefail

CMD="${1:-install}"

# Resolve the hub (the dir containing clients.json + mailsite-agent/), the same
# way run-cron.sh/run-loop.sh do: this script is <hub>/mailsite-agent/scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HUB_ROOT="${MAILSITE_HUB:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}"
AGENT_DIR="$HUB_ROOT/mailsite-agent"

die() { echo "install-service: $*" >&2; exit 1; }

[ -x "$HUB_ROOT/active-agent/run-cron.sh" ] || die \
  "no $HUB_ROOT/active-agent/run-cron.sh. Run the setup wizard and wire an adapter first."

# Fill REPLACE_ME/hub in a template with the real hub path.
render() { sed "s#REPLACE_ME/hub#$HUB_ROOT#g" "$1"; }

# ---------------------------------------------------------------- macOS (launchd)
LABEL="com.mailsite.loop"
PLIST_SRC="$AGENT_DIR/ops/macos/$LABEL.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

mac_install() {
  mkdir -p "$HOME/Library/LaunchAgents"
  render "$PLIST_SRC" > "$PLIST_DEST"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
  launchctl load "$PLIST_DEST" || die "launchctl load failed"
  echo "Installed launchd agent $LABEL."
  echo "  loaded from: $PLIST_DEST"
  echo "  logs:        $HUB_ROOT/logs/loop.log (and logs/loop.err.log)"
  echo "  stop:        bash $0 uninstall"
}
mac_uninstall() {
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
  rm -f "$PLIST_DEST"
  echo "Removed launchd agent $LABEL."
}
mac_status() {
  if launchctl list 2>/dev/null | grep -q "$LABEL"; then
    echo "$LABEL is loaded."; launchctl list "$LABEL" 2>/dev/null || true
  else
    echo "$LABEL is not loaded."
  fi
}

# ---------------------------------------------------------------- Linux (systemd)
UNIT="mailsite-loop"
UNIT_SRC="$AGENT_DIR/ops/linux/$UNIT.service"
UNIT_DEST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT.service"

have_systemd_user() { command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; }

cron_fallback() {
  cat <<EOF
systemd --user is not available here. Two options:

1. Run the loop under cron (starts at boot, no restart-on-crash):
     ( crontab -l 2>/dev/null; echo "@reboot MAILSITE_HUB=$HUB_ROOT nohup $AGENT_DIR/bin/run-loop.sh >>$HUB_ROOT/logs/loop.out.log 2>&1 &" ) | crontab -
   Then start it now without rebooting:
     MAILSITE_HUB=$HUB_ROOT nohup $AGENT_DIR/bin/run-loop.sh >>$HUB_ROOT/logs/loop.out.log 2>&1 &

2. Use Docker, which supervises the loop for you:
     docker compose -f mailsite-agent/docker/docker-compose.yml up -d
EOF
}

linux_install() {
  have_systemd_user || { cron_fallback; exit 0; }
  mkdir -p "$(dirname "$UNIT_DEST")"
  render "$UNIT_SRC" > "$UNIT_DEST"
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT" || die "systemctl --user enable failed"
  echo "Installed systemd user service $UNIT."
  echo "  unit:  $UNIT_DEST"
  echo "  logs:  journalctl --user -u $UNIT -f   (and $HUB_ROOT/logs/loop.log)"
  echo "  stop:  bash $0 uninstall"
  echo
  echo "Run it without an active login session (recommended):"
  echo "  sudo loginctl enable-linger $USER"
}
linux_uninstall() {
  if have_systemd_user; then
    systemctl --user disable --now "$UNIT" 2>/dev/null || true
    rm -f "$UNIT_DEST"
    systemctl --user daemon-reload
    echo "Removed systemd user service $UNIT."
  else
    echo "No systemd --user here. If you used the cron fallback, remove the @reboot line with: crontab -e"
  fi
}
linux_status() {
  if have_systemd_user; then
    systemctl --user status "$UNIT" --no-pager 2>/dev/null || echo "$UNIT is not installed."
  else
    echo "systemd --user not available; cannot report status."
  fi
}

# ---------------------------------------------------------------- dispatch
OS="$(uname -s)"
case "$OS" in
  Darwin)
    case "$CMD" in
      install)   mac_install ;;
      uninstall) mac_uninstall ;;
      status)    mac_status ;;
      print)     render "$PLIST_SRC" ;;
      *) die "unknown command: $CMD (install|uninstall|status|print)" ;;
    esac ;;
  Linux)
    case "$CMD" in
      install)   linux_install ;;
      uninstall) linux_uninstall ;;
      status)    linux_status ;;
      print)     render "$UNIT_SRC" ;;
      *) die "unknown command: $CMD (install|uninstall|status|print)" ;;
    esac ;;
  *)
    echo "No native installer for '$OS'. Run mailsite-agent in Docker, or under WSL2 on Windows:"
    echo "  docker compose -f mailsite-agent/docker/docker-compose.yml up -d"
    [ "$CMD" = "print" ] || exit 1 ;;
esac
