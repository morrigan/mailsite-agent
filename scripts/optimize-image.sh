#!/usr/bin/env bash
#
# optimize-image.sh — the IMAGE port for mailsite-agent.
#
# Usage: optimize-image.sh <input> <output> [maxEdge] [quality]
#   maxEdge   longest side in px, default 1600 (only shrinks, never enlarges)
#   quality   JPEG/WebP quality, default 82
#
# Auto-orients from EXIF, strips all metadata (incl. GPS), and re-encodes.
# If <output> ends in .webp, encodes WebP (cwebp if present, else ImageMagick).
# Requires ImageMagick (magick or convert); cwebp optional for best WebP.
set -euo pipefail

in="${1:?usage: optimize-image.sh <input> <output> [maxEdge] [quality]}"
out="${2:?usage: optimize-image.sh <input> <output> [maxEdge] [quality]}"
max_edge="${3:-1600}"
quality="${4:-82}"

[ -f "$in" ] || { echo "input not found: $in" >&2; exit 1; }
mkdir -p "$(dirname "$out")"

# Pick an ImageMagick entrypoint (v7 = magick, v6 = convert).
if command -v magick >/dev/null 2>&1; then IM=(magick)
elif command -v convert >/dev/null 2>&1; then IM=(convert)
else echo "ImageMagick not found (need 'magick' or 'convert')" >&2; exit 1; fi

ext="${out##*.}"
ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"

if [ "$ext" = "webp" ] && command -v cwebp >/dev/null 2>&1; then
  # Normalize/orient/resize with ImageMagick to a temp PNG, then cwebp.
  tmp="$(mktemp -t mailsite.XXXXXX).png"
  trap 'rm -f "$tmp"' EXIT
  "${IM[@]}" "$in" -auto-orient -strip -resize "${max_edge}x${max_edge}>" "$tmp"
  cwebp -quiet -q "$quality" "$tmp" -o "$out"
else
  "${IM[@]}" "$in" -auto-orient -strip -resize "${max_edge}x${max_edge}>" -quality "$quality" "$out"
fi

# Emit a JSON line so the agent can log what happened.
bytes=$(wc -c < "$out" | tr -d ' ')
printf '{"input":"%s","output":"%s","bytes":%s}\n' "$in" "$out" "$bytes"
