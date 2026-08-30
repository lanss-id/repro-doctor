#!/usr/bin/env bash
# Records the live repair scene. A single diagnose run is one draw from a
# distribution this project spends its whole evaluation measuring, so the
# attempt is not hidden: every attempt is logged to attempts.json with its run
# id and outcome, and the recording kept is the first one whose hidden oracle
# exited zero.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/video/recordings"
LOG="$OUT/03a-attempts.json"
MAX="${MAX_ATTEMPTS:-5}"

mkdir -p "$OUT"
attempts='[]'
[ -f "$LOG" ] && attempts="$(jq '.attempts' "$LOG")"

for ((n = 1; n <= MAX; n++)); do
  echo "diagnose attempt $n"
  asciinema rec --overwrite --quiet --cols "${COLS:-100}" --rows "${ROWS:-30}" \
    --title "03a-diagnose" --command "$HERE/03a-diagnose.sh" \
    "$OUT/03a-diagnose.cast"

  run_id="$(ls -1t "$ROOT/artifacts/runs" | sed -n 1p)"
  result="$ROOT/artifacts/runs/$run_id/result.json"
  status="$(jq -r '.outcome.status' "$result")"
  verification="$(jq -r '.verification.kind' "$result")"
  attempts="$(jq --arg id "$run_id" --arg s "$status" --arg v "$verification" \
    '. + [{runId: $id, status: $s, verification: $v}]' <<<"$attempts")"
  echo "  $run_id $status/$verification"

  if [ "$verification" = passed ]; then
    jq -n --argjson a "$attempts" --arg id "$run_id" \
      '{kept: $id, attempts: $a, note: "Every attempt is listed. The kept recording is the first whose hidden oracle exited zero."}' >"$LOG"
    echo "$run_id" >"$OUT/03a-run-id.txt"
    exit 0
  fi
done

jq -n --argjson a "$attempts" '{kept: null, attempts: $a}' >"$LOG"
echo "no verified run in $MAX attempts" >&2
exit 1
