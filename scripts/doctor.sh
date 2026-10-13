#!/usr/bin/env bash
#
# doctor.sh, check (and optionally install) prerequisites for mailsite-agent.
#
#   bash scripts/doctor.sh          # check only
#   bash scripts/doctor.sh --install  # try to install missing native deps
#
# Native deps are installed via Homebrew (macOS) or apt-get (Debian/Ubuntu).
set -uo pipefail

INSTALL=0
MODE_LABEL=""
[ "${1:-}" = "--install" ] && { INSTALL=1; MODE_LABEL=" (install mode)"; }

ok=0; warn=0; miss=0
green() { printf '\033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1)); }
yellow() { printf '\033[33m!\033[0m %s\n' "$1"; warn=$((warn+1)); }
red() { printf '\033[31m✗\033[0m %s\n' "$1"; miss=$((miss+1)); }

PKG=""
if command -v brew >/dev/null 2>&1; then PKG=brew
elif command -v apt-get >/dev/null 2>&1; then PKG=apt; fi

install_one() { # install_one <brew-formula> <apt-package>
  [ "$INSTALL" = "1" ] || return 1
  case "$PKG" in
    brew) brew install "$1" ;;
    apt) sudo apt-get update -y && sudo apt-get install -y "$2" ;;
    *) return 1 ;;
  esac
}

ver() { ("$1" --version 2>/dev/null || "$1" -version 2>/dev/null || true) | head -1; }
check() { # check <cmd> <label> <brew> <apt> <required|optional>
  local cmd="$1" label="$2" brew="$3" apt="$4" level="$5"
  if command -v "$cmd" >/dev/null 2>&1; then green "$label ($(ver "$cmd"))"; return; fi
  if install_one "$brew" "$apt" && command -v "$cmd" >/dev/null 2>&1; then green "$label (installed)"; return; fi
  if [ "$level" = optional ]; then yellow "$label missing (optional)"; else red "$label missing (required)"; fi
}

echo "mailsite-agent doctor, checking prerequisites${MODE_LABEL}"
echo "package manager: ${PKG:-none detected}"
echo

# --- required ---
check node "Node.js (>=18)" node nodejs required
check git  "git"            git  git required
check gh   "GitHub CLI"     gh   gh  required
if command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1; then
  green "ImageMagick"
else
  install_one imagemagick imagemagick >/dev/null 2>&1
  if command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1; then green "ImageMagick (installed)"; else red "ImageMagick missing (required)"; fi
fi

# --- optional ---
check cwebp "cwebp (better WebP)" webp webp optional
check claude "Claude Code CLI"    "" "" optional
check goose  "Goose CLI"          "" "" optional
check resend "Resend CLI (only for Resend inbound mode)" "" "" optional

# --- Node version floor ---
if command -v node >/dev/null 2>&1; then
  major=$(node -p "process.versions.node.split('.')[0]")
  [ "$major" -ge 18 ] || red "Node is v$major; need >=18 (global fetch)"
fi

# --- IMAP optional packages (only if you plan to use the imap provider) ---
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if node -e 'require.resolve("imapflow")' >/dev/null 2>&1; then
  green "IMAP packages present (imapflow, nodemailer, mailparser)"
else
  yellow "IMAP packages not installed, only needed for mail.read/send = imap."
  [ "$INSTALL" = "1" ] && { echo "  installing imapflow nodemailer mailparser"; npm install --prefix "$SELF" imapflow nodemailer mailparser; }
fi

echo
echo "summary: $ok ok, $warn optional-missing, $miss required-missing"
[ "$miss" -eq 0 ] || { echo "Install the required items (re-run with --install to auto-install native deps)."; exit 1; }
echo "Required prerequisites satisfied. Next: cp clients.sample.json ../clients.json and cp .env.example ../.env"
