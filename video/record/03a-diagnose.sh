#!/usr/bin/env bash
# 0:58-1:45, part one. One repair, end to end, against a real model in a real
# container. Nothing here is replayed: the run this records is the run the next
# two scenes read their evidence out of.
source "$(dirname "$0")/lib/rec.sh"

beat 0.5
run "npm run doctor -- diagnose fixtures/entrypoint-mismatch/repo --mode advanced"
beat 2.0
