#!/usr/bin/env bash
# 0:32-0:58. What is in a fixture, which part of it the agent can reach, and
# what the part it cannot reach actually asks.
source "$(dirname "$0")/lib/rec.sh"

beat 0.5
run "ls fixtures/broken-test-discovery"
beat 1.2
run "sed -n '45,58p' fixtures/broken-test-discovery/oracle/oracle.mjs"
beat 2.0
