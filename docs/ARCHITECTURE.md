# Architecture

## The shape of a run

```
diagnose <repo> --mode advanced
        |
        v
  validate the path, checksum the input tree
        |
        v
  copy repo/ -> artifacts/runs/<id>/workspace/        (source is now read-only forever)
        |
        v
  create the sandbox executor                          (Docker, or a hard failure)
        |
        v
  advanced only: preflight, three charged tool calls, one call reserved for the retry
        |
        v
  model loop over four tools, every agent call budgeted, validated and recorded
        |
        v
  advanced only: successful patch closes model tools at a checkpoint;
                 scorer runs the evidence gate and hidden oracle on fresh copies,
                 then at most one repair turn carries both results
        |
        v
  diff pristine copy against repaired copy -> repair.patch (exact bytes)
        |
        v
  hidden oracle, second container, fresh copy, read-only /oracle mount
        |
        v
  re-checksum the input tree, write result.json, trajectory.jsonl, report.html
```

The whole column sits inside one deadline. `maxWallClockSeconds` is enforced by an abort signal handed to the model driver and re-checked before verification, so a provider call that never returns cannot outlive it. Expiry is recorded as `budget-exhausted` with limit `wall-clock`.

The order matters in two places. The oracle runs after the agent's session is over, which is what makes it hidden rather than merely unmentioned. The input tree is checksummed at both ends, which is what turns "we do not mutate the source" from a claim into a recorded measurement.

## Layers

**`src/domain`** holds Zod schemas and the types derived from them, and nothing else. No I/O, no dependencies on the rest of the codebase. `RunResult`, `TrajectoryEvent`, `Budget`, `VerificationOutcome`, `RunOutcome`, `Cost` and `PatchSummary` all live here. Everything crossing a process boundary is parsed against one of these.

**`src/infra`** is the machinery that has to be right: path safety, tree checksums, the unified diff engine, the sandbox executors, redaction, structured logging, artifact writing. It knows nothing about agents.

**`src/agent`** is the repair loop: the budget tracker, the tool session, the preflight, the instructions, the model driver, and `diagnose.ts` which orchestrates them.

**`src/oracle`**, **`src/eval`**, **`src/report`**, **`src/cli`** sit on top. The CLI is the only layer allowed to write to stdout.

Dependencies point downward. `src/infra` never imports from `src/agent`.

## Why these seams

**The diff engine is ours.** `src/infra/diff/unified.ts` implements a longest-common-subsequence diff, a unified-diff parser and a strict applier. Shelling out to `git apply` would have been shorter, but the workspaces are not git repositories, and the applier is the one place where a mistake silently damages a real repository. Ours refuses on any context mismatch: no fuzz factor, no offset search, no relocated hunks. That decision is worth more than the code it cost.

**The executor is an interface with two implementations.** `SandboxExecutor` has `DockerExecutor` and `LocalTestAdapter` behind it. The interface exists so tests can drive the real pipeline without Docker, not so production can quietly do the same. Which one you got is in `result.json` under `sandbox.executor` and `sandbox.productionSafe`, and the evaluator refuses to score a run that used the adapter.

**The model driver is one file.** `src/agent/driver.ts` is the only module that imports `@openai/agents`. It handles key setup, tracing, usage extraction and error mapping, and everything else talks to the two-method `ModelDriver` interface. That is what makes the scripted test driver possible: integration tests run the real sandbox, the real patch pipeline and the real oracle, with only the model replaced.

**Tools go through `RepairSession`, not straight to the filesystem.** The four tools are thin wrappers. `RepairSession` validates paths, charges the budget, redacts output and appends to the trajectory. No action can happen off the record, because there is no other route to the filesystem or the sandbox.

## Budgets

One `BudgetTracker` per run holds the limits and the spend. Tools call `chargeToolCall` or `chargePatchAttempt`, which throw `BudgetExceededError` at the limit. That error is special: `RepairSession.fail` re-throws it instead of handing it back to the model, so exhaustion ends the run rather than becoming another thing to reason about.

The wall clock is checked on every charge, and `commandTimeoutMs()` clamps a command's timeout to the time the run has left, so a 60 second command cannot overrun a run with 10 seconds remaining.

A run that exhausts its budget still gets its patch computed and its oracle run. Running out of tool calls after writing a correct fix is a real outcome, and it would be dishonest to score it as a failure without checking.

## The two modes

Held identical: model, temperature, top-p, turn limit, serial-tool setting, repository, task message, tool set, budget, sandbox profile, and the oracle. `modelSettingsFingerprint` in `result.json` is a hash of the model settings so a reviewer can confirm the first part without reading code.

Baseline is a generic instruction and one unstructured loop. Nothing else.

Advanced adds four things:

1. **Deterministic preflight.** The harness lists the root, reads `package.json` and runs the repository's own check command, then hands the output to the model as part of the task. No model call is involved in deciding what to run.
2. **Structured hypothesis ledger.** The final answer is a Zod-validated list of hypotheses, each with a statement, the evidence line behind it, and a status. It ends up in the trajectory and the run report.
3. **Minimal-patch instruction.** Change what a supported hypothesis says is broken, and nothing else.
4. **Two independent signals, one retry.** Tool calls are serial. A successful patch checkpoints the model turn: every tool is disabled until the model returns its ledger, so no self-verification command can race the checkpoint. The harness then re-runs the repository's check command itself and reads the exit status, and separately runs the hidden oracle against a fresh copy of the repaired tree. The model's claim of success carries no weight against either. If either is unsatisfied, and a patch attempt and a tool call remain, the failure evidence opens exactly one more repair turn.

The second signal is the one that matters on `broken-test-discovery`, where the repository's own check exits zero while running zero tests. A gate built only on the visible check would approve that patch.

What crosses back to the model is the sanitized `PASS` and `FAIL` lines the oracle printed, scrubbed of the oracle directory, its entry file name, the run directory and any remaining absolute path, then redacted. The oracle's code is never mounted in the repair sandbox, and `DockerExecutor` constructed with `purpose: 'repair'` throws if anyone asks it for a mount.

The three preflight commands are charged to the same 12 tool calls because they give advanced information that baseline would have to buy. Evidence gates and oracle executions are not charged: both are scorer actions after model tools have closed. They still consume the same six-minute deadline. This boundary was tightened after the first live chained-case smoke run spent its last calls self-verifying and never reached the promised retry; the regression now succeeds with the retry patch as tool call twelve.

What the agent is told about that budget matters as much as the budget itself. Every tool result ends with a `[budget]` line naming the calls and patch attempts the current turn may still spend, the preflight report states what it already spent, and the retry's own call is reserved up front and released only when the retry starts, so the agent's plan and the harness's accounting refer to the same number. Live runs failed three different ways before this was true, and the four diagnostics are in the improvement changelog.

## Verification

`runHiddenOracle` copies the repaired workspace again, builds a fresh executor with `purpose: 'verify'`, and runs `node /oracle/<entry>` with `REPO_DIR` pointing at the workspace. The verdict is the exit status. The oracle's own `[oracle] PASS|FAIL <name>` lines are parsed for the report, but they do not decide anything: a lying oracle that exits zero passes, which is why oracles are part of the repository and reviewable.

The repair executor refuses extra mounts at the type level of its purpose, so "the oracle is not mounted during repair" is enforced in code rather than by convention.

## Artifacts

`TrajectoryWriter` assigns the sequence number and timestamp, redacts the payload, validates it against `TrajectoryEventSchema`, and rewrites the file. An event that does not match the schema throws rather than being written, so a trajectory file is either valid throughout or absent.

`result.json` is parsed on the way out as well as on the way in. The writer runs `RunResultSchema.parse` before serializing, which means a shape the schema does not describe cannot reach disk.

`repair.patch` is the exception to redaction, and deliberately so. Its SHA-256 and `apply` both depend on byte equality, so it is stored exactly and marked `patch.sensitive: true` in the result. The redacted view exists only for the HTML report and for published examples. SECURITY.md sets out what that means for anyone attaching a patch to an issue.

## Verification stages

`verification.started` and `verification.completed` carry a `stage`: `interim` for the run that drives the advanced retry, `final` for the one that decides the outcome. When no retry followed the interim run, its result is reused as the final verification rather than spending a second oracle execution on an identical workspace, and the verification log says so.

## Failure model

Every failure has a reason from a closed set (`src/domain/failure.ts`), so the reports can group failures without matching on strings. `ReproDoctorError` carries the reason plus an optional detail line, and the CLI maps `internal-error` to exit code 2, which is the usage error, and everything else to 1.

## What I would change with more time

The agent gets whole-file writes rather than authoring diffs. That is the right call for reliability, models are poor at hunk offsets, but it means a large file costs a large patch attempt. A structured edit tool with anchors would be better on both counts.

The evidence gate re-runs the whole check command. On a slow repository that can dominate wall-clock time. Caching the preflight result and re-running only what the patch could have affected would buy real headroom without weakening the final full check.
