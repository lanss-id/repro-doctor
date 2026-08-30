# Shared helpers for scene recordings.
#
# Everything a scene prints is either a literal caption or the real stdout of a
# real command. The only synthetic thing here is the keystroke timing in
# `type_cmd`: the characters of the command are emitted one at a time so the
# recording contains a human-paced prompt instead of a line appearing whole.
# The command itself, its output and its exit status are not staged.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

export NO_UPDATE_NOTIFIER=1
export npm_config_fund=false
export npm_config_audit=false
export TERM=xterm-256color

DIM=$'\033[38;5;244m'
GREEN=$'\033[38;5;114m'
RED=$'\033[38;5;203m'
YELLOW=$'\033[38;5;179m'
BOLD=$'\033[1m'
OFF=$'\033[0m'

# Types a command at the prompt one character at a time, then runs it.
# Returns the command's real exit status.
type_cmd() {
  local s="$1" i
  printf '%s❯%s ' "$GREEN" "$OFF"
  for ((i = 0; i < ${#s}; i++)); do
    printf '%s' "${s:i:1}"
    sleep 0.026
  done
  printf '\n'
  sleep 0.30
}

run() {
  local rc=0
  type_cmd "$1"
  eval "$1" || rc=$?
  sleep 0.7
  return $rc
}

# Runs a command and prints its exit status underneath, because several scenes
# turn on the exit status being zero when it should not be.
run_showing_status() {
  local rc=0
  type_cmd "$1"
  eval "$1" || rc=$?
  printf '\n%s' "$DIM"
  if [ "$rc" -eq 0 ]; then
    printf 'exit status %s0%s%s' "$GREEN$BOLD" "$OFF" "$DIM"
  else
    printf 'exit status %s%s%s%s' "$RED$BOLD" "$rc" "$OFF" "$DIM"
  fi
  printf '%s\n' "$OFF"
  sleep 1.0
  return $rc
}

note() {
  printf '%s%s%s\n' "$DIM" "$1" "$OFF"
  sleep 0.5
}

beat() { sleep "${1:-0.8}"; }
