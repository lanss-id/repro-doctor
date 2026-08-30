#!/usr/bin/env bash
# 0:00-0:32. A repository whose check passes while running no tests at all.
source "$(dirname "$0")/lib/rec.sh"

cd fixtures/broken-test-discovery/repo
beat 0.5
run_showing_status "npm run check"
beat 1.2
run "cat package.json | sed -n '9,12p'"
beat 0.6
run "ls tests"
beat 1.6
