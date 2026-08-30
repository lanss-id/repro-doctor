#!/usr/bin/env bash
# Records every terminal scene as an asciicast. Each scene runs the real
# commands; the cast files under video/recordings are the only source the video
# has for terminal content.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/video/recordings"
COLS="${COLS:-100}"
ROWS="${ROWS:-30}"

mkdir -p "$OUT"

record() {
  local name="$1"
  shift
  echo "recording $name"
  asciinema rec \
    --overwrite --quiet \
    --cols "$COLS" --rows "$ROWS" \
    --title "$name" \
    --command "$HERE/$name.sh" \
    "$OUT/$name.cast"
}

for name in "$@"; do
  record "$name"
done
