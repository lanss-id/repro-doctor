# Bring your own oracle

Repro Doctor's ten benchmark fixtures each ship a hidden oracle. That is not a
special case: `--oracle-dir` points at any directory, so you can write one for
your own repository and get the same independent verdict on a patch that an
agent proposes for your code.

This directory is a complete worked example, outside `fixtures/`, that goes
through exactly the path a user goes through.

## Why bother writing an oracle

Because your test suite passing is not the same as your code being right, and an
agent that can run your test suite will stop as soon as it goes green.

`repo/` here is a small library whose README documents a duration parser. Its
own test suite passes. `npm run check` exits zero. And `parseDuration("1h30m")`
returns 3600000 instead of 5400000, because the parser reads the first
number-and-unit pair and ignores the rest. The tests only ever check one unit at
a time, so nothing in the repository notices.

That is the shape of the bug an oracle is for. If your repository has no such
gap, you do not need this file.

## The oracle contract

An oracle is one Node script. Repro Doctor runs it like this:

| | |
| --- | --- |
| Command | `node <entry>`, where entry defaults to `oracle.mjs` and is set with `--oracle-entry` |
| When | After the agent's session has ended, never during it |
| Where | The same sandbox image as the repair: Node 22, TypeScript 5.9.3 on PATH, no network |
| Against what | A **fresh copy** of the repaired tree, so nothing the agent left running can interfere |
| Working directory | That copy. `REPO_DIR` also points at it, and is what you should use |
| Your files | Mounted read-only at `/oracle`. The agent's sandbox never mounts this directory |
| Verdict | Exit 0 passes, anything else fails |
| Timeout | `--oracle-timeout`, default 120 seconds |

Two more rules worth knowing, because they change how you write it:

**Print your checks as `[oracle] PASS <name>` or `[oracle] FAIL <name>`.** Those
lines are parsed into the run result, and in advanced mode the failing ones are
the evidence that opens the agent's single retry. They are sanitized of every
path first, so the agent learns *what* failed and never *where the oracle lives*.
A check named `every unit in a compound duration is added up` is a useful thing
to hand back. A check named `assertion 4 failed` is not.

**Never import anything from the oracle directory into the repository, and never
have the repository import from `/oracle`.** The whole value of this file is that
the agent could not have read it.

`oracle/oracle.mjs` in this directory is a complete example of the shape:
compile, load through the declared entry point, assert the contract the README
promises, and one check that the repository's own test suite is still there and
still runs, so a patch cannot pass by deleting tests.

## Running it

```bash
npm run docker:build     # once

npm run doctor -- diagnose examples/bring-your-own-oracle/repo \
  --mode advanced \
  --oracle-dir examples/bring-your-own-oracle/oracle
```

Point the first argument at your own repository and `--oracle-dir` at your own
oracle and nothing else changes. Repositories under `fixtures/` infer their
oracle; everything else needs the flag.

Confirm the oracle is satisfiable before you trust its verdict, the same way the
fixtures are checked:

```bash
D=$(mktemp -d) && cp -r examples/bring-your-own-oracle/repo/* "$D"
REPO_DIR=$D node examples/bring-your-own-oracle/oracle/oracle.mjs   # expect exit 1
REPO_DIR=$D node examples/bring-your-own-oracle/reference/repair.mjs
(cd "$D" && npx tsc -p tsconfig.json)
REPO_DIR=$D node examples/bring-your-own-oracle/oracle/oracle.mjs   # expect exit 0
```

An oracle that fails before a known good repair and passes after it is measuring
something. One that fails both times is measuring your patience.

## What happened when this was run

Both runs used `openai/gpt-4.1-mini` in the Docker sandbox with the default
budget. Their artifacts are under `artifacts/runs/`, and the second one is
published in full at [`submission/examples/byo-oracle-run/`](../../submission/examples/byo-oracle-run).

**Run `20260830T055854Z-89d6da`: no patch, 4 of 12 tool calls, $0.0015.**
The agent listed the root, read `package.json`, ran `npm run check`, saw it exit
zero, and stopped. It never opened the README. A repository whose own check
passes gave it nothing to react to, which is the same blind spot the hidden
oracle exists to cover, showing up one level higher, in the agent instead of in
the test suite.

That failure changed the advanced instructions: a check that exits zero is now
explicitly not evidence that the repository works, and the agent is told to read
what the README, manifest and configuration promise and to test that promise
directly. No knowledge of this example is in the production code.

**Run `20260830T060136Z-7a08e1`: patch produced, oracle rejected it, 11 of 12
tool calls, 2 patch attempts, $0.0111.**
The agent found the fault, rewrote the parser to accumulate every unit, and
added a check that the matched pairs cover the whole string. Five of the six
contract checks passed. The sixth did not: `parseDuration("")` returns 0 instead
of throwing, because with no matches the loop never runs and the length check is
trivially satisfied.

That is the outcome worth looking at. The patch is good. The repository's own
tests pass on it. The agent's ledger says the fault is fixed. And the run is
still reported as `unverified-patch`, because an oracle the agent never saw
disagreed, and this tool believes the oracle. You see that before you type
`apply`, not after.
