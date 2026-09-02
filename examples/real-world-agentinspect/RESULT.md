# What happened on AgentInspect

Six completed runs and one interrupted follow-up were made against the same
historical AgentInspect bug. The completed runs cost $0.500872 in total. No run
mutated its input repository, saw the hidden oracle during repair, or used the
network from inside the sandbox.

This is one case, not a repair-rate estimate. The tool set and instructions on
this branch also differ from the published benchmark, so none of these runs are
comparable with the submitted baseline-versus-advanced numbers.

## Completed runs

| Run | Outcome | Calls | Cost | Evidence |
| --- | --- | ---: | ---: | --- |
| `20260902T155751Z-df5865` | no patch | 30/30 | $0.115835 | The copier removed `node_modules/vitest/dist`, so the sandbox received a dependency tree that could not run |
| `20260902T160510Z-d07779` | no patch | 30/30 | $0.108677 | With dependencies intact, the generic task sent the model into the wrong package and it reached the right files only after its budget was gone |
| `20260902T160840Z-5cf2ce` | unverified patch | 40/40 | $0.190804 | It never read the repository-local issue note and changed unrelated syntax in `packages/cli/src/index.ts`; the oracle refused it |
| `20260902T161652Z-3686c6` | no patch | 15/40 | $0.031446 | With first-class task context it found the exact fault and stated the correct repair, but returned a ledger without calling `propose_patch` |
| `20260902T162033Z-0c344d` | unverified patch | 16/40 | $0.040836 | A no-patch retry made it submit a focused patch to `serve.ts` and `studio-cmd.ts`; the upstream checks rejected the incomplete error-handling contract |
| `20260902T162350Z-e7c561` | wall-clock exhausted | 3/40 | $0.013274 | Vitest reported finishing in 4.77 seconds, but the Docker client kept waiting on open output pipes; the 120-second command timeout did not resolve until 715 seconds |

The most relevant generated patch changed two files, `+29/-2`, and has SHA-256
`041de80cd217823072ca3c7910adf29432960bc98f6705967f38711e4d819fcf`.
It selected `open`, `cmd /c start` and `xdg-open` correctly, but duplicated the
selection in both commands and attached an empty error handler. It was not
applied.

The final follow-up was interrupted before a result artifact was written. Its
trajectory reached tool call 38, repeatedly re-read the same launcher files and
did not submit a patch. It is not counted as a completed run or in the cost
total above.

## What changed in Repro Doctor

### 1. Dependency build directories survive the copy

The default copier used directory names as a global ignore rule. Skipping
`dist` at the repository root also skipped `node_modules/vitest/dist`, silently
turning an installed dependency into a broken one.

The default now skips root build output while preserving nested dependency
output. `.git` is still excluded at every depth. A regression fixture asserts
that root `dist` is absent while `node_modules/left-pad/dist` survives, and an
offline Docker smoke run passed AgentInspect's visible Vitest check from the
copied tree.

### 2. Real issue context is a bounded input

`diagnose` now accepts `--task-file <relative-path>`. The file must be a regular
file inside the target repository, is limited to 16 KiB, follows the same real
path containment checks as the tools, and is redacted before reaching the
model. The oracle and its path remain absent from the task.

This changed the failure from browsing the wrong package to identifying the
exact fault in both affected files.

### 3. A diagnosis without a patch gets the bounded retry

Advanced mode previously retried only when the visible check, hidden oracle or
critic rejected a submitted patch. If the model diagnosed the right fault but
forgot to call `propose_patch`, no oracle ran and a passing visible check made
the harness accept the turn as finished.

An empty first attempt now triggers the existing single retry and states that a
diagnosis alone does not repair the repository. A regression test reproduces
the old `no-patch` result and now ends in a verified repair.

### 4. Process timeout no longer waits for inherited pipes to close

The shared process runner killed its direct child on timeout but waited for the
child's `close` event before resolving. A descendant holding inherited stdout
or stderr open could delay that event indefinitely. The AgentInspect run showed
the same failure shape: completed test output, followed by a 715-second wait
despite a 120-second command limit.

The timeout now resolves at the deadline with output captured up to that point,
while container cleanup continues best-effort. A deterministic regression that
previously took about 3.1 seconds now resolves in about 114 milliseconds against
a 100-millisecond limit.

## Verification

After the four fixes:

```text
typecheck  pass
lint       pass
tests      228 passed, 0 failed
```

The original AgentInspect target stayed unchanged. The generated two-file patch
was retained as evidence but was not applied because the hidden oracle failed.

## What this milestone means

It is not the first verified external repair. It is the first time an adjacent
maintainer's real TypeScript repository and upstream regression checks directly
changed Repro Doctor's production path.

The useful impact is narrower and defensible: the exercise found four harness
assumptions that the synthetic benchmark did not expose, turned each one into a
regression test, and produced a concrete counterexample for AgentInspect's
deterministic evidence workflow.
