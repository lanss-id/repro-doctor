#!/usr/bin/env bash
# 0:58-1:45, part three. The human checkpoint. `apply` prints the whole diff
# and then waits for a word typed at a terminal; anything but `apply` writes
# nothing.
#
# The answer is fed through `script`, which gives the command a real pty, so the
# refusal below is the interactive refusal and not the weaker one that a piped
# answer gets.
source "$(dirname "$0")/lib/rec.sh"

RUN_ID="${RUN_ID:?RUN_ID must be set to the run recorded by 03a-diagnose.sh}"
TARGET="$(mktemp -d)/demo-repo"
cp -r fixtures/entrypoint-mismatch/repo "$TARGET"

beat 0.3
type_cmd "npm run doctor -- apply $RUN_ID --to $TARGET"
{
  sleep 3.2
  for c in n o; do printf '%s' "$c"; sleep 0.16; done
  printf '\n'
  sleep 1.2
} | script -q -e -c "npm run doctor -- apply $RUN_ID --to $TARGET" /dev/null || true
beat 1.5
