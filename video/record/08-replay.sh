#!/usr/bin/env bash
# 4:38-4:56. Every published number recomputed from committed artifacts.
source "$(dirname "$0")/lib/rec.sh"

beat 0.5
run "npm run doctor -- replay submission/evidence/confirmatory"
beat 2.0
