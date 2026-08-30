#!/usr/bin/env bash
# 0:58-1:45, part two. What the run left behind: the patch, the two checksums
# that say the input repository was not touched, and the hidden oracle's verdict.
source "$(dirname "$0")/lib/rec.sh"

RUN_ID="${RUN_ID:?RUN_ID must be set to the run recorded by 03a-diagnose.sh}"

beat 0.4
run "cd artifacts/runs/$RUN_ID"
run "cat repair.patch"
beat 1.4
run "jq '.repo | {treeChecksumBefore, treeChecksumAfter, mutated}' result.json"
beat 1.4
run "jq -r '.verification | .kind, .exitCode, .checks[]' result.json"
beat 1.6
