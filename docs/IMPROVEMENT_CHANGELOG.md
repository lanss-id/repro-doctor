# Improvement changelog

Three sections, kept apart on purpose. **Shipped and verified** is work that exists and has a passing check behind it. **Planned experiments** are hypotheses with a decision rule and no result yet. **Measured results** separates development smoke evidence from the still-pending final evaluation.

Nothing moves from the second section to the third without artifacts.

## At a glance

| Stage | What was tried, and why | Evidence | Decision |
| --- | --- | --- | --- |
| Baseline | A generic instruction, four tools, one unstructured loop, the same budget and scorer as everything below | 42/70 verified, 60.0% (95% CI 48.3 to 70.7); no patch at all in 11 of its 28 failures | The control |
| Iteration 1 | Structure around the loop: preflight, hypothesis ledger, minimal-patch instruction, evidence-driven retry | 51/70, 72.9%; +12.9 points, 95% CI -2.8 to +27.6 | Kept, with the effect reported as not established |
| Iteration 2 | Tell the agent the budget it actually has, and reserve the retry's call | Three live runs on `chained-two-faults`, each failing a different way, ending in a repaired run | Kept |
| Iteration 3 | Bill a turn that ends by throwing | One run in 60 with `cost: unknown`, which made a whole mode's median cost unreportable | Kept, and the spoiled batch re-run |
| Iteration 4 | Say that a check exiting zero is not evidence the repository works | On a repository outside the benchmark: 4 calls and no patch became 11 calls and a patch passing 5 of 6 contract checks. On the benchmark: no measurable change | Kept on the first, null result reported on the second |
| Discarded | A critic agent reviewing the patch before the retry decision | 1/9 against 4/9, negative in both runs of the experiment | Discarded by the rule written before it ran |
| Iteration 7 | Ablate the bounded retry, twice, to find which of advanced mode's five changes carries it | Removing the retry design costs +34.3 points (95% CI +16.1 to +51.0); removing only its second turn costs +25.7 (95% CI +3.3 to +44.9). Both exclude zero | Kept, and for the first time on a measurement rather than an argument |
| Iteration 6 | Point the tool at a real third-party repository for the first time | Three runs, three harness defects: dependencies stripped from the sandbox, a budget line that overstated the ceiling by six calls, and a file reader returning four per cent of the file the fault was in | Two fixed, the third written down with the run that proves it |
| Iteration 5 | Pre-register a confirmatory batch at 70 runs per mode, after the first batch's interval crossed zero and its per-case reading suggested a much larger effect on five cases | Aggregate +12.9 points, 95% CI -2.8 to +27.6. The suggested +40 point subgroup effect vanished: baseline went from 0/15 to 11/35 on the same five cases | Kept as the published result. The hypothesis was not confirmed and that is the headline |
| Final | Everything except the critic | 51/70, zero safety violations in 200 runs across two batches | The submitted system |

Each row expands below. Failures are in here with the same weight as the wins, including a 60-run batch that was measured and thrown away.

## Shipped and verified

Each line names the check that backs it. Every one of these was run in this repository.

### Safety

- **Input repositories are never mutated by `diagnose`.** The tree is checksummed before and after; a change fails the run with reason `source-mutated`. Verified by `tests/integration/diagnose.test.ts` ("a correct scripted repair is recorded as a verified repair" asserts the checksum is unchanged after a real repair).
- **Docker is the boundary, with no fallback.** `--network none`, `--read-only`, `--cap-drop ALL`, unprivileged user, CPU, memory and PID limits, no Docker socket, no host mounts beyond the workspace. Verified by all ten fixtures passing `fixtures verify` under Docker.
- **The local test adapter cannot be used by accident.** Two explicit opt-ins, `productionSafe: false` in every result, and an evaluator check that fails such runs. Verified by `tests/integration/executor.test.ts` ("the local adapter is refused unless it is explicitly enabled").
- **Path traversal and symlink escape are refused.** Verified by 8 tests in `tests/unit/paths.test.ts` and 5 in `tests/unit/copy.test.ts`, including a directory symlink pointing outside the workspace and a repository containing a symlink to a file outside itself.
- **Command timeouts kill the process and still capture output.** Verified by `tests/integration/executor.test.ts` ("a command that outlives its timeout is killed", "output produced before a timeout is still captured").
- **No host API key reaches a sandboxed process.** Verified by a test that sets `OPENAI_API_KEY` on the host and asserts the child sees `unset`.
- **Secrets are redacted on the publishable write path.** Twelve secret formats plus PEM blocks are scrubbed from trajectories, logs, report patch views and terminal output. The exact `repair.patch` is intentionally excluded and marked sensitive. Verified by 17 assertions in `tests/unit/redact.test.ts`, including that redaction is idempotent and that redacted output no longer trips the detector.
- **`apply` requires a checksum match, a preview and typed confirmation.** Verified by 7 tests in `tests/integration/apply.test.ts`, including that a declined prompt writes nothing and that untouched files stay byte identical.
- **`apply` re-checks the target immediately before the first write.** A repository edited while the operator was reading the diff is refused, not patched. Verified by `tests/integration/apply-safety.test.ts`.
- **`apply` validates every path component before creating anything.** A target containing a symlink out of the repository cannot be used to create a directory or a file outside it. Verified by a test that asserts the outside directory is still empty after the refusal.
- **The workspace containment check is canonical, not a string prefix.** A sibling directory whose name begins with the workspace path, and a workdir that is a symlink out of it, are both refused. Verified by two tests in `tests/integration/executor.test.ts`.
- **The run deadline fires even when nothing else is pending.** The timer was unreferenced, so a model call that hangs without holding an open handle left it as the only pending work and Node 22 exited before it could abort: the process died quietly instead of producing a `budget-exhausted` result with its artifacts. Found by CI, which runs Node 22, while the development machine's Node 25 hid it. Reproduced three times out of three inside a `node:22` container, fixed by keeping the timer referenced, and the `finally` block still clears it so a finished run is never held open.
- **One deadline covers model calls, tools, the retry and verification.** Enforced by an abort signal, classified as `budget-exhausted` with limit `wall-clock`. Verified by `tests/integration/deadline.test.ts`, which blocks the driver until the deadline fires.
- **Token usage accumulates across every model call in a run.** The first turn, the retry and any critic call sum before the cost is computed and the budget checked. Verified in `tests/unit/budget.test.ts` and end to end in `tests/integration/advanced-retry.test.ts`, which asserts the exact summed cost.
- **repair.patch is exact, and its checksum matches the stored bytes.** Publishable artifacts use a redacted view. Verified by `tests/integration/patch-artifacts.test.ts`, which puts a credential-shaped string in a patched file and asserts the patch applies, the checksum matches, and the report, the trajectory and `result.json` do not contain it.
- **A turn that ends by throwing is still billed.** The SDK reports token usage on its result object, so a run that hit the turn limit lost the usage of every model call it had already made and reported its cost as `unknown`, which the evaluator then refused to score. The usage is recovered from the run state the SDK error carries. Verified by `tests/unit/driver-usage.test.ts`, which asserts the recovery, and that an error with no state still reports null rather than a plausible zero.
- **A live run with an unknown cost cannot count as verified, and an unpriced batch does not start.** Verified by `tests/unit/checks.test.ts` and `tests/integration/eval-gate.test.ts`.

### Correctness

- **A patch never lands on shifted context.** Exact matching, no fuzz. Verified by `tests/unit/diff.test.ts` ("applying a patch to the wrong content is refused instead of guessed") plus round-trip tests for creation, deletion, multiple hunks and files with no trailing newline.
- **Artifacts are schema-checked on the way out and the way in.** An event that does not match `TrajectoryEventSchema` throws instead of being written. Verified by `tests/unit/trajectory.test.ts`.
- **Budgets stop a run rather than being reported after the fact.** Verified by `tests/unit/budget.test.ts` (7 tests) and by an integration test that scripts 10 tool calls against a limit of 3 and asserts the run ends as `budget-exhausted` with `limitHit: "tool-calls"`.
- **The critic experiment cannot overwrite the comparison it is measured against.** `npm run eval` writes the mode comparison to `artifacts/eval/eval.json` and the experiment to `artifacts/eval/eval-critic.json`; the report page reads both. Verified by `tests/integration/eval-gate.test.ts`, which asserts the two paths differ and that the experiment's own file is the one that carries it.
- **Every repair rate is printed with the interval its sample size supports.** Ten runs per mode cannot support a point estimate, so the CLI summary and the report table print a 95 percent Wilson interval beside the rate. Verified by `tests/unit/scoring.test.ts`, which checks the interval for 7 of 10, pins the boundary cases at zero and one inside [0, 1], and asserts that an unmeasured rate still reads `pending` rather than growing a fake interval.
- **The report never invents a number.** Verified by `tests/unit/report.test.ts`, which asserts that an unmeasured rate is not rendered as `0.0%` and that a partly priced batch reports its median cost as unknown.

### The benchmark

- **Ten fixtures, each failing before its reference repair and passing after it.** Verified twice: under Docker via `npm run doctor -- fixtures verify`, and in the test suite via the local adapter, one test per case.
- **No fixture leaks its answers.** `findIsolationProblems()` returns empty, a copied workspace contains no `oracle/`, `reference/` or `meta.json`, and a real run's trajectory mentions none of those paths. The evaluator repeats the trajectory check for every scored run.

### Method

- **Both the visible check and the hidden oracle drive the single advanced retry.** The oracle runs independently against a fresh copy after the first attempt; only its sanitized findings cross back, never its code or its location. Verified by `tests/integration/advanced-retry.test.ts`, which uses the case whose visible check exits zero while running zero tests: without the oracle signal there would be no retry at all.
- **Evidence gate events record the command's real exit code**, not a placeholder null. Asserted in the same test.
- **A successful advanced patch checkpoints the model before self-verification can spend the retry.** Every tool is dynamically disabled until the harness has run the evidence gate and hidden oracle. Those scorer actions do not consume agent tool calls, but remain inside the same wall-clock deadline. A chained-case regression places the retry patch at call twelve and still requires both final checks to pass.

- **A check that exits zero is not treated as evidence the repository works.** The advanced method now names the case where the preflight check passes and tells the agent to test what the README, manifest and configuration promise instead of trusting the exit code. Found by running the tool on a repository outside the benchmark, where the agent gave up after four calls; see [the user-path iteration](#iteration-on-the-user-path-30-august-2026).
- **The agent is never told a budget it does not have.** Every tool result carries a live `[budget]` line, the advanced preflight states what it spent, and one tool call is reserved for the evidence-driven retry and released only when that retry starts. Verified by `tests/unit/tool-budget.test.ts` (the line counts down across list, read and patch calls, and a failed call still reports what it consumed) and by `tests/integration/advanced-retry.test.ts` ("an agent that spends every call it is offered still gets its retry"), which asserts the run still ends at twelve calls.

### Totals

163 tests, 0 failures, about 60 seconds, no API key and no network required after dependencies are installed. Typecheck and lint clean under `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, with `any` banned.

## Planned experiments

None of these has been run. Each has a decision rule written before the experiment, which is the only time such a rule is worth anything.

### E1: critic agent before the patch lands

**Hypothesis.** A second model call that reviews the proposed patch against the hypothesis ledger, and can send it back once, catches patches that satisfy the visible check without satisfying the contract. `broken-test-discovery` is the case I expect it to help with most.

**Design.** Advanced mode only, after the first patch attempt and the evidence gate, before the retry decision. Same model and settings. The critic call is charged one tool call from the same 12, and its tokens accumulate into the same cost budget.

**How to run it.**

```bash
npm run eval -- --experiment critic --repeats 3
npm run report
```

Advanced control against advanced with a critic, over `broken-test-discovery`, `manifest-lockfile-mismatch` and `chained-two-faults`. Eighteen runs at three repeats: three cases, two arms, three repeats. Both arms use the same model, settings, budget and oracle. The command refuses to start without an API key, and refuses again if the pinned model has no configured token price, because an unpriced batch cannot evaluate the cost half of the rule.

**Decision rule, fixed in advance.** Keep the critic only if it delivers **at least +10 percentage points** of verified repair rate for **no more than +25 percent** median cost, both against advanced mode without the critic, over the same fixtures with the same repeat count. Otherwise discard it and record the numbers here, including the ones that argued for keeping it.

The rule is implemented as `decideExperiment` in `src/eval/scoring.ts`. It refuses to return "keep" when either the repair rate or the cost is unmeasured on either side, which stops the experiment being resolved by a half-measured run. Tested in `tests/unit/scoring.test.ts`, and the report page prints the rule next to the verdict.

**Status.** Run twice, and discarded by its own rule both times: -11.1 points, then 1 of 9 against 4 of 9 for -33.3 points. See [the result](#e1-the-critic-discarded-30-august-2026). The plumbing is covered by a scripted integration test that proves the critic call is charged and that a critic asking for a revision triggers the one retry; that test said nothing about whether the critic helps, and the experiment answered it.

### E2: anchor-based edit tool

**Hypothesis.** Replacing whole-file writes with an anchored edit ("replace this exact string, which must occur once") reduces tokens per patch attempt enough to leave budget for a second hypothesis on the harder cases.

**Measure.** Median output tokens per patch attempt, and verified repair rate on `chained-two-faults` and `manifest-lockfile-mismatch`, the two cases where a wasted attempt is fatal.

**Decision rule.** Keep if verified repair rate does not drop and median cost falls by at least 15 percent. A tool that is cheaper and worse is not an improvement.

**Status.** Not run.

### E3: incremental evidence gate

**Hypothesis.** Re-running the entire check command after every patch can dominate the six-minute deadline on slow repositories. Running only the affected part, with a full run at the end, buys wall-clock headroom without weakening the gate.

**Risk.** A weaker gate that passes a patch the full check would reject. This one has to be measured for false passes, not only for speed.

**Decision rule.** Keep only if the false pass count against the hidden oracle is zero across all cases and repeats, and median wall clock drops by at least 20 percent.

**Status.** Not run.

### E4: repeat count raised to five

**Hypothesis.** Three repeats over ten cases cannot separate the two modes unless the effect is large. Five would narrow the interval enough to talk about a moderate effect.

**Cost.** 100 runs instead of 60.

**Decision rule.** Not a keep-or-discard experiment. Run it if the first evaluation shows a difference between 5 and 15 points, which is exactly the range three repeats cannot resolve.

**Status.** Not run, and not triggered. The evaluation came in at 23.3 points, outside the 5 to 15 band the rule names. The interval on that difference still includes zero, so more repeats would sharpen it, and the rule as written does not fire. It is left as written rather than widened after the fact to justify a run that would have been convenient.

## Measured results

### Development smoke, 29 August 2026

These are two diagnostic runs on one hard fixture, not the final benchmark and not a repair-rate estimate. Both used `openai/gpt-4.1-mini` through an OpenAI-compatible gateway, the same repository, Docker sandbox, twelve-call limit and USD 0.30 ceiling.

| Run | Mode | Outcome | Calls | Cost | What happened |
| --- | --- | --- | ---: | ---: | --- |
| `20260829T185552Z-b82817` | baseline | unverified patch | 12 | $0.007777 | Found both faults, patched the environment contract first, then exhausted the call budget before applying the entry-point patch |
| `20260829T185749Z-1c9e05` | advanced | budget exhausted | 12 | $0.012171 | Patched the entry point, self-verified, then exhausted the call budget before the evidence-driven retry could repair the environment contract |

The advanced failure falsified the original loop design: a mandatory retry is not real if the model can spend its reserved calls self-verifying before the harness reaches its checkpoint. The resulting change closes model tools immediately after a successful patch and classifies post-patch gates as scorer actions, matching the already-independent oracle. The regression reproduces the twelve-call boundary without using fixture-specific knowledge in production code.

### Budget visibility, 30 August 2026

Four more advanced runs on the same fixture, each one a diagnostic for the change before it. Same model, sandbox and limits.

| Run | Outcome | Calls | Patches | Cost | What happened |
| --- | --- | ---: | ---: | ---: | --- |
| `20260829T192439Z-816f6e` | no patch | 12 | 0 | $0.008250 | Spent nine investigation calls after the three-call preflight, then had the correct `GREETING` patch refused as call thirteen |
| `20260829T193417Z-21e6a9` | unverified patch | 12 | 1 | $0.009216 | With a live budget line it paced itself and patched on call twelve, which left the promised retry with no call to spend |
| `20260829T193759Z-b5606b` | unverified patch | 12 | 1 | $0.015271 | With one call reserved the retry finally fired, and the model spent it re-reading a file, so both patch attempts after it were refused |
| `20260829T194032Z-42c6b5` | **repaired** | 12 | 2 | $0.010387 | Preflight, seven investigation calls, entry-point patch on call eleven, both independent checks failed, retry patched the environment contract on call twelve, gate and hidden oracle both passed |

Read in order these are three separate lessons about the same defect, and none of them is about reasoning quality. An agent told "you have 12 tool calls" by instructions that had already spent 3 of them plans against a number that is not true; an agent given a live count paces correctly but cannot know a later turn is coming; an agent that reaches that turn wastes it unless the message that opens it says how small it is. The fix is [decision 14](DECISIONS.md#14-the-agent-is-shown-the-budget-it-actually-has). The fourth run is one run on one fixture and is not evidence of a repair rate.

### The batch that was thrown away, 29 August 2026

The first complete 60-run batch finished with baseline at 46.7 percent and advanced at 76.7 percent, and one advanced run on `monorepo-build-order`, `20260829T201236Z-f9a058`, reported its cost as `unknown` after making twelve tool calls. That is not a provider quirk. The SDK reports usage on its result object, the run ended by throwing at the turn limit, and the harness read usage only from the success path, so every token that run spent went unaccounted. One unpriced run makes its mode's median cost `null` by design, so the whole advanced cost column was unreportable because of a bug in our own accounting.

The fix reads the usage off the run state the SDK error carries. The batch was then run again from scratch rather than published with a hole in it, and the numbers below are the second batch. The first one is recorded here because deleting a discarded measurement is how benchmarks start lying.

### Iteration on the user path, 30 August 2026

Everything above was measured on the ten fixtures. Running the tool the way a user would, against a repository outside the benchmark with an oracle written from scratch, produced a failure the benchmark could not have shown.

Run `20260830T055854Z-89d6da`, advanced, on [`examples/bring-your-own-oracle/repo`](../examples/bring-your-own-oracle): **no patch, 4 of 12 tool calls, $0.0015.** The agent listed the root, read `package.json`, ran `npm run check`, saw it exit zero, and stopped. It never opened the README. The repository's documented duration parser was broken and its own tests passed, which is the exact bug class this project exists for, and the agent had no procedure for a repository whose check is already green.

**What was tried.** One sentence added to the advanced method: a check that exits zero is not evidence the repository works, so read what the README, manifest and configuration promise and test that promise directly with `run_command`. No knowledge of that example is in the production code.

**Evidence.** On the same repository, run `20260830T060136Z-7a08e1`: the agent went to 11 of 12 tool calls, used both patch attempts, rewrote the parser to accumulate every unit and to reject trailing input, and passed five of the six contract checks. The sixth failed, `parseDuration("")` returning 0 instead of throwing, and the run is reported as `unverified-patch`. Both runs are published: [`submission/examples/byo-oracle-run/`](../submission/examples/byo-oracle-run).

On the benchmark, the same change produced **no measurable improvement**: advanced went from 22/30 to 21/30 and the difference against baseline from +20.0 to +23.3 points, both inside the noise this benchmark has. That is not surprising in hindsight. Only one of the ten fixtures, `broken-test-discovery`, has a check that passes while the repository is broken, so the benchmark can barely measure the thing the change addresses. That is a limitation of the fixture set, and it is recorded here rather than quietly ignored.

**Decision.** Kept, on the strength of the user-path evidence, with the benchmark result reported as the null result it is.

### Exploratory batch, 30 August 2026

Ten fixtures, both modes, three repeats, 60 runs. `openai/gpt-4.1-mini` through an OpenAI-compatible gateway, Docker sandbox, 12 tool calls, 2 patch attempts, 360 second deadline, $0.30 ceiling per run. Report generated `2026-08-30T06:30:50Z`. Total measured spend $0.4262.

This was the published result for about eight hours. It is kept here in full because the batch that replaced it did not agree with it, and a changelog that only keeps the batch it liked is not a changelog.

| | Baseline | Advanced |
| --- | --- | --- |
| Verified repair rate | 14/30, 46.7% (95% CI 30.2 to 63.9) | 21/30, 70.0% (95% CI 52.1 to 83.3) |
| Median wall clock | 24.3s | 25.7s |
| Median cost per run | $0.0074 | $0.0072 |
| Unsafe mutations, budget violations, oracle access violations | 0, 0, 0 | 0, 0, 0 |

**Advanced minus baseline: +23.3 points, 95% CI -1.5 to +44.5.** The interval includes zero, so this batch shows the direction and not the size of the effect. The failure profile moved more clearly than the headline: baseline produced no patch at all in 9 of its 16 failures, advanced in 4 of its 9.

Six of the thirty advanced runs used their retry and four of those ended verified, so seventeen of the twenty-one verified advanced runs never needed it. The structure, not the second attempt, is doing most of the work.

`manifest-lockfile-mismatch` was repaired zero times out of six across both modes. The full per-case grid is in [EVALUATION.md](EVALUATION.md#per-case-three-runs-each).

### What one identical arm did three times

The baseline arm has not changed by a character across three batches: only the advanced instructions did.

| Batch | Baseline verified repair rate |
| --- | --- |
| Development batch, 29 August | 16/30, 53.3% |
| Exploratory batch, 30 August | 14/30, 46.7% |
| Confirmatory batch, 30 August | 42/70, 60.0% |

Same code, same prompt, same fixtures, same model at temperature zero and top-p one. **A spread of 13.3 points from nothing but running it again.**

The effect this whole project is trying to detect is 12.9 points. The noise is bigger than the signal, which means any comparison of two arms that were not run inside the same batch is measuring the weather, and a number quoted from someone else's run last week is worth nothing at all.

That is the cheapest lesson in this file and the one most likely to be useful to somebody else.

### E1, the critic: discarded, 30 August 2026

Eighteen runs, three cases, three repeats, generated `2026-08-30T06:38:18Z`, total measured spend $0.1370.

| | Control | Treatment with critic |
| --- | --- | --- |
| Verified repair rate | 4/9, 44.4% (95% CI 18.9 to 73.3) | 1/9, 11.1% (95% CI 2.0 to 43.5) |
| Median cost per run | $0.0075 | $0.0073 |

Difference: -33.3 points, 95% CI -63.6 to +7.9, at 3.3 percent less cost. The rule fixed in advance required at least +10 points for no more than +25 percent cost, so `decideExperiment` returned **discard**, and the critic stays behind `--experiment critic`, off by default.

It was run twice, before and after the instruction change above, and lost both times: -11.1 points, then -33.3. Nine runs per arm cannot separate -33 from +8, so this is not evidence that the critic hurts. It is a pre-registered rule reporting that the critic was not shown to help. A trajectory from the treatment arm, including the `critic.reviewed` event, is published at [`submission/examples/critic-run/`](../submission/examples/critic-run).

One resource note belongs with it: the treatment holds back two tool calls to the control's one, because the critic's own call comes from the same budget, so part of the gap is one fewer investigation call.

### The bug only CI could see, 30 August 2026

`tests/integration/deadline.test.ts` passed on the development machine and was cancelled in every CI run. Not flaky: deterministic, and deterministically invisible locally.

The deadline timer was created with `unref()`, which tells Node not to keep the process alive for it. In the test, a blocked model call holds no open handle, so that timer is the only pending work in the loop, and Node 22 exits. Node 25, on the development machine, does not, which is why three green local runs said nothing.

Reproduced by running the same compiled test inside a `node:22-bookworm-slim` container: three failures out of three before the change, three passes out of three after it, and the full 163-test suite green under Node 22 in 51 seconds, so the referenced timer does not hold a finished run open.

This is not only a CI problem. The guarantee the project makes is that one deadline covers model calls, tools, the retry and verification, and produces a `budget-exhausted` result with artifacts. An unreferenced timer meant that on Node 22 a hung provider call could end the process instead, with no result written at all. The fix restores the guarantee; the test was already correct and was not touched.

The lesson worth keeping: a version difference between the development machine and CI hid a real defect in the product, not just in the pipeline. The green local suite was the misleading signal.

### E5, the confirmatory batch: hypothesis not confirmed, 30 August 2026

**What was tried, and why.** The exploratory batch's headline, +23.3 points with a 95 percent CI of -1.5 to +44.5, established nothing: the interval crossed zero. Reading the same 60 runs per case rather than in aggregate showed why the aggregate was blunt. Five fixtures were saturated, baseline scoring 14 of 15 on them with no room for advanced to differ, while on the other five baseline scored **0 of 15** against advanced's 6, a difference of +40.0 points whose interval, +11.3 to +64.3, excluded zero.

That subgroup was found after seeing the results, which makes it a hypothesis and not a result. So instead of publishing it, the five cases were frozen as a stratum, both hypotheses and their decision rules were written into [PREREGISTRATION.md](PREREGISTRATION.md), and the file was committed and pushed before a single run of the new batch started. Seventy runs per mode, chosen for 80 percent power against the 23 point effect the first batch suggested.

**Evidence.** 140 runs, report `2026-08-30T15:18:26Z`, $0.9727, 64.5 minutes.

| | Baseline | Advanced | Difference |
| --- | --- | --- | --- |
| aggregate | 42/70, 60.0% | 51/70, 72.9% | +12.9 points (95% CI -2.8 to +27.6) |
| saturated stratum | 31/35, 88.6% | 35/35, 100.0% | +11.4 points (95% CI -0.6 to +26.0) |
| hard stratum | 11/35, 31.4% | 16/35, 45.7% | +14.3 points (95% CI -8.2 to +34.9) |

All three intervals include zero.

**The subgroup effect did not survive.** Baseline went from 0 of 15 to **11 of 35** on the hard stratum, in an arm that had not changed. `broken-test-discovery` went from 0 of 3 to 5 of 7 for baseline; `monorepo-build-order` from 0 of 3 to 6 of 7. The +40 points was noise, and pre-registration is the only reason it is described here as noise rather than printed on the landing page as a result.

**Decision and learning.** Published as the result, unconfirmed. The pre-registration says a null outcome gets the same prominence as a positive one, so the README leads with it.

Two things did move, and are recorded without being dressed up as the headline. Advanced has scored higher in all three batches. And `tsconfig-include-scope` separates completely, 0 of 7 against 7 of 7, while `monorepo-build-order` runs the other way, 6 of 7 against 1 of 7, which is a specific regression in advanced mode that nobody has yet explained.

The honest reading is that this benchmark cannot settle a 13 point difference. Doing so needs about 206 runs per arm, roughly 420 runs and $3.30 at this batch's measured cost, which exceeded the model credit available. The number is written down so the next person does not have to derive it.

### The cost defect that survived its own fix, 30 August 2026

Iteration 3 above fixed a run that ended by throwing losing the usage of every model call it had made. It fixed one path, the SDK turn limit. The confirmatory batch found another: two runs of 140, one per mode, ended `budget-exhausted` and reported `cost: unknown`, which by design made both modes' median cost unreportable rather than optimistic.

It was **not** fixed while the batches were running. [PREREGISTRATION.md](PREREGISTRATION.md) rule 1 forbids code changes between the pre-registration commit and the end of the batches being compared, and two batches have already been discarded for breaking exactly that rule. The defect is recorded, the median over the 138 runs with measured cost is $0.007144, and the fix waits for the batches to finish.

The lesson is narrower than it looks: a fix aimed at one error path is not a fix for a class of error paths, and the only reason this one was caught is that the reporting fails loudly rather than quietly averaging over what it has.

### E6 and E6b, the ablations: the first intervals that exclude zero, 30 August 2026

**What was tried, and why.** Advanced mode shipped five changes at once and
nobody knew which of them carried the difference. The brief asks which design
choices actually help the agent reach the goal reliably, and the honest answer
until now was that I did not know.

**E6, generated `2026-08-30T15:52:37Z`, 70 runs, $0.5271, 30.5 minutes.**
Treatment: advanced without the bounded retry, which the pre-registration
defined as three coupled things, the retry turn, the tool call reserved for it,
and a step 8 that tells the truth about not getting a second turn.

| | Control | Treatment |
| --- | --- | --- |
| Verified repair rate | 13/35, 37.1% (95% CI 23.2 to 53.7) | 1/35, 2.9% (95% CI 0.5 to 14.5) |

Difference **+34.3 points, 95% CI +16.1 to +51.0**. The rule fixed in advance
required the interval to exclude zero. It does, and it is the first interval in
this project that ever has.

**Then the runs said the number did not mean what the hypothesis said.** Twenty
of the thirty-five treatment runs produced no patch at all, and eighteen of
those twenty had a patch refused for running out of tool calls. The reservation
turns out to do two jobs: it funds the retry turn, and it subtracts one from the
`[budget]` line the agent reads, which makes the agent patch earlier. Releasing
it removed both at once.

The pre-registration had argued that releasing the reservation made the ablation
**conservative**, because the treatment would get more usable calls. It got more
calls and used them worse, because the binding constraint was pacing and not
budget. The error runs in the direction that inflates the measured effect. The
procedure was followed exactly as registered; the reasoning was wrong, and that
is recorded rather than corrected in place.

**E6b, generated `2026-08-30T16:49:41Z`, 70 runs, $0.5182, 29.9 minutes.**
Registered before it ran, with the E6 finding written into it. Treatment: the
retry turn removed, the reservation **kept**. Not a design anyone would ship, it
reserves a call for a turn that will never happen, and that is exactly what an
ablation arm is for.

| | Control | Treatment |
| --- | --- | --- |
| Verified repair rate | 17/35, 48.6% (95% CI 33.0 to 64.4) | 8/35, 22.9% (95% CI 12.1 to 39.0) |

Difference **+25.7 points, 95% CI +3.3 to +44.9**. Also excludes zero.

**Decision and learning.** The bounded retry stays, and for the first time the
reason is a measurement rather than an argument. The second attempt is
load-bearing on its own, and it exists only because something outside the agent
said the first attempt was wrong.

Comparing the two treatment arms isolates the pacing effect: +20.0 points with a
95 percent CI of +4.1 to +36.3. That is across two batches and is reported as
suggestive, never as established, which is the same rule the rest of this file
lives by.

The ablations also hand over two more measurements of unchanged advanced mode on
the same five cases. With the earlier batches that makes four: 40.0%, 45.7%,
37.1%, 48.6%. A spread of 11.5 points from nothing, which is why both ablations
paid to re-run their own control instead of borrowing one, and why E7 was
dropped rather than run at a sample size that could not have said anything.

### Leaving the benchmark, 30 August 2026

**What was tried, and why.** Every fixture in this project is mine. If I write
the fault and I write the check that catches it, a good score proves I can write
two halves of one puzzle. So: [commander](https://github.com/tj/commander.js) at
a pinned upstream commit, 216 files and 17,700 lines, with the fault restored
from the line commander itself had before PR #2350 and the oracle lifted from
commander's own regression test from that same PR. Neither was written here.

The property that makes it worth having: `node --test` runs all 1,371 of
commander's tests with zero failures while the bug is present, because the
regression test that catches it did not exist until the commit that fixed it.
That is the normal condition of every bug that has ever shipped, and it is the
exact condition this project is built for.

**Evidence.** Three runs, three defects in the harness, none of them in the
model. The full account is in
[`examples/real-world-commander/RESULT.md`](../examples/real-world-commander/RESULT.md).

| Run | Outcome | What it exposed |
| --- | --- | --- |
| `20260830T160959Z-2d2043` | budget-exhausted, no patch | The workspace copy skips `node_modules`, so commander's own check failed on a missing `@types/node`. The agent spent sixteen calls chasing a dependency the harness had removed |
| `20260830T161421Z-d13af7` | budget-exhausted at 19 of 25 calls | `maxTurns` was fixed at 16 whatever the budget said. Every `[budget]` line told the agent it had 25 calls; the SDK stopped it at 19 |
| `20260830T161557Z-886ac8` | no patch, 25/25 calls, $0.1079 | `read_file` returns the first four per cent of an 87,607 byte file. The agent read `lib/command.js` three times, got the same opening each time, and invented a fault inside the part it could see |

**Decision.** Two fixes, one refusal.

Fixed: `--check-command` lets the caller name the command that says whether the
repository works, because a project's own `check` script often runs lint and
formatting, which report on whether its devDependencies are installed. And
`maxTurns` is now derived from the budget, with a floor that leaves every batch
at the published 12-call budget byte-identical, verified by a test on the
settings fingerprint that is written into every result.

Not fixed: `read_file` needs an offset and a length. Adding one changes the tool
set that every published measurement was taken against, and there was no credit
left to re-measure. It is written down with the run that proves it.

**Learning.** Three defects, and all three were the harness telling the agent
something untrue or taking something away without saying so. That is now seven
of this project's defects in the same class and zero in the other one. The
benchmark could not have found any of them, because ten dependency-free
repositories of six to twelve files never stress a single one of those paths.

The general form: **a benchmark you built cannot tell you what your harness
assumes.** It was built under the same assumptions.

### What these numbers are not

They are ten synthetic TypeScript fixtures, one model, one provider, one machine, and a sample too small to settle the difference they are measuring. They say nothing about any other model.

They no longer say nothing about a real repository. [`examples/real-world-commander/`](../examples/real-world-commander) runs the tool against commander at a pinned upstream commit, with a fault restored from commander's own pre-fix code and an oracle lifted from commander's own regression test. That is one bug in one repository, not a rate, and it is described as such.

Every run behind every number above is committed under [`submission/evidence/`](../submission/evidence) and can be re-scored offline with `npm run doctor -- replay`, with no API key and no model call.
