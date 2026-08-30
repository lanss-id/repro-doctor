# Evaluation

## Result: 60 runs, 30 per mode

Run on 30 August 2026 with `openai/gpt-4.1-mini` through an OpenAI-compatible gateway, Docker sandbox, ten fixtures, three repeats per case per mode. Report generated `2026-08-30T06:30:50Z`.

| | Baseline | Advanced |
| --- | --- | --- |
| Verified repair rate | 14/30, 46.7% (95% CI 30.2 to 63.9) | 21/30, 70.0% (95% CI 52.1 to 83.3) |
| Median wall clock | 24.3s | 25.7s |
| Median cost per run | $0.0074 | $0.0072 |
| Unsafe mutations | 0 | 0 |
| Budget violations | 0 | 0 |
| Oracle access violations | 0 | 0 |

Total measured spend for the batch: $0.4262.

**Advanced minus baseline: +23.3 points, 95% CI -1.5 to +44.5.** The interval includes zero. Thirty runs per mode is not enough to establish that the structure is what produced the gap, and this document is not going to claim otherwise because the point estimate looks good. What the batch does establish is the direction, the cost, and that the extra structure did not cost extra money: advanced repaired more and its median run was fractionally cheaper, because the baseline's failures burn the full twelve calls while an advanced run that gets it right stops earlier.

### How much of that is the retry

Six of the thirty advanced runs used a second patch attempt, and four of those six ended verified. So the retry is not what carries the mode: twenty-one runs were verified and seventeen of them never needed it. The preflight, the minimal-patch instruction and the closed tools do most of the work, and the retry is the recovery path for the cases where the first patch is wrong in a way only an independent check can see. [submission/examples/retry-run/](../submission/examples/retry-run) is one of those four, event by event.

### Per case, three runs each

`P` is a verified repair: the hidden oracle exited zero and every safety check passed.

| Case | Baseline | Advanced |
| --- | --- | --- |
| `broken-test-discovery` | `...` | `PP.` |
| `case-sensitive-import` | `PPP` | `PPP` |
| `chained-two-faults` | `...` | `P..` |
| `entrypoint-mismatch` | `.PP` | `PPP` |
| `env-contract` | `PPP` | `PPP` |
| `esm-cjs-mismatch` | `PPP` | `PPP` |
| `health-route-port` | `PPP` | `PPP` |
| `manifest-lockfile-mismatch` | `...` | `...` |
| `monorepo-build-order` | `...` | `.P.` |
| `tsconfig-include-scope` | `...` | `P.P` |

Four cases are solved by both modes every time and carry no information about the comparison. The gap lives in `broken-test-discovery`, `tsconfig-include-scope`, `chained-two-faults` and `monorepo-build-order`, and `manifest-lockfile-mismatch` defeats both modes six times out of six.

`broken-test-discovery` is the case the whole design is aimed at. Its own check exits zero while running zero tests, so a mode with no independent signal has nothing to react to. Baseline verified it zero times in three; advanced twice in three.

### How the two modes fail

| Failure | Baseline | Advanced |
| --- | ---: | ---: |
| Patch produced, oracle rejected it | 7 | 5 |
| No patch at all | 9 | 4 |
| Budget exhausted | 0 | 0 |

Baseline's characteristic failure is spending twelve calls reading files and never proposing anything. [submission/examples/baseline-run/](../submission/examples/baseline-run) is one of those nine: it worked out the fault, then had its first `propose_patch` refused at call thirteen.

### What variance actually looks like here

The baseline arm was byte-identical across two consecutive 60-run batches, because only the advanced instructions changed between them. It scored 16/30 in the first and 14/30 in the second: 53.3% then 46.7%, a swing of 6.7 points from nothing but run-to-run noise at temperature zero.

That is the most useful number in this document. It is measured rather than asserted, it is why every rate here carries an interval, and it is the reason a five point difference between two arms should never be read as a result.

### The critic experiment, decided

Eighteen runs, three cases, three repeats, advanced mode with and without a critic call before the retry decision, generated `2026-08-30T06:38:18Z`, total measured spend $0.1370.

| | Control | Treatment with critic |
| --- | --- | --- |
| Verified repair rate | 4/9, 44.4% (95% CI 18.9 to 73.3) | 1/9, 11.1% (95% CI 2.0 to 43.5) |
| Median cost per run | $0.0075 | $0.0073 |

Difference: -33.3 points, 95% CI -63.6 to +7.9, for 3.3 percent less cost. The rule required at least +10 points for no more than +25 percent cost. **Decision: discard the critic.** It stays in the codebase behind `--experiment critic`, off by default, with this result recorded next to it.

The experiment was run twice, before and after an unrelated change to the advanced instructions, and came out negative both times: -11.1 points and then -33.3. Nine runs per arm still cannot distinguish -33 from +8, so this is not proof the critic hurts. It is a pre-registered rule returning "not shown to help", which is the answer it was written to be able to give.

One resource note belongs with the number: the treatment arm holds back two tool calls where the control holds back one, because the critic's own call has to come from the same budget. Part of the treatment's disadvantage is therefore one fewer investigation call, not the critic's advice.

### What is still not measured

- Any repository that is not one of these ten fixtures. They are synthetic by construction, small, and dependency free. [examples/bring-your-own-oracle/](../examples/bring-your-own-oracle) is the one run against something outside the benchmark, and it is a single case, not evidence of a rate.
- Any model other than `gpt-4.1-mini`.
- Five repeats. Experiment E4 in the improvement changelog fires when the observed difference falls between 5 and 15 points, and 23.3 points did not trigger it. That rule was fixed in advance and is being followed rather than rewritten after seeing a result that would benefit from more data.

### What did not need a model, and was verified anyway

163 tests pass with no API key and no network. All ten fixtures fail their hidden oracle before the reference repair and pass it after, under Docker and under the local test adapter. The parts of the loop that do need a model are exercised by integration tests that drive the real sandbox, the real patch engine and the real oracle with a scripted stand-in, which is how the feedback retry, the budget reservation and the cumulative cost accounting are tested without inventing a benchmark number.

## What is being measured

The headline number is the **verified repair rate**: the fraction of runs where the hidden semantic oracle exited zero *and* every safety check passed. A run that produces a patch the oracle rejects counts as a failure. A run that produces a patch the oracle accepts but that mutated the source repository, overran its budget, or touched the oracle also counts as a failure.

Every rate is printed with a 95 percent Wilson interval, because ten runs per mode cannot support a point estimate and a bare percentage invites a reader to treat it as one. Alongside it: median wall clock time, median cost, and counts of unsafe mutations, budget violations and oracle access violations. Medians rather than means, because a single 360 second timeout would otherwise dominate ten fast runs.

## The gate checks

Every scored run is checked by `src/eval/checks.ts` before it can count:

| Check | Fails when |
| --- | --- |
| `oracle-access` | The trajectory mentions the fixture's `oracle/`, `reference/` or `meta.json` path |
| `source-immutability` | The input tree's checksum changed during the run |
| `budget-compliance` | Tool calls, patch attempts, wall clock or measured cost exceeded the budget |
| `verification-exit-status` | The oracle produced no exit status at all, for example it timed out or could not start |
| `semantic-oracle` | The oracle did not exit zero |
| `production-sandbox` | The run used the local test adapter, or a scripted model |
| `cost-accounting` | A live run reported an unknown cost, which means the cost budget was never enforced |

Note the difference between the last two and `verification-exit-status`. An oracle that exits 1 is a valid measurement, a real negative result. An oracle that never ran is a broken measurement, and the two must not be confused.

Before any run happens, `runEvaluation` calls `findIsolationProblems()` across all fixtures and refuses to score anything if a fixture has its oracle, reference repair or metadata inside the copied directory. A benchmark that leaks its answers is worse than no benchmark.

## The fairness contract

Baseline and advanced share:

- the same model, temperature, top-p, turn limit and serial-tool setting, hashed into `modelSettingsFingerprint`
- the same repository copy procedure and the same fixtures
- the same task message
- the same four tools, built by the same function, with identical schemas and descriptions, each result ending with the same live `[budget]` line
- the same budget: 12 tool calls, 2 patch attempts, 360 seconds, USD 0.30, 60 second per-command timeout
- the same hidden oracle as the scorer

They differ only in the instruction text and the harness structure around the loop: preflight, hypothesis ledger, minimal-patch instruction, and an evidence gate with at most one feedback retry.

### The resource difference, stated exactly

Advanced does not only think differently. It consumes more, and pretending otherwise would make the comparison meaningless. Per run, advanced gets:

| Resource | Baseline | Advanced |
| --- | --- | --- |
| Tool calls available | 12 | 12, of which 3 are spent by the preflight before the model sees the task and 1 is reserved for the retry turn |
| Tool calls charged to the method | 0 | 3 preflight |
| Scorer commands outside the tool counter | final oracle | up to 2 evidence gates and 2 oracle executions |
| Model turns | 1, with serial tool calls | up to 2: the first, and one feedback retry, with serial tool calls |
| Patch attempts | 2 | 2 |
| Hidden oracle executions | 1, the final verification | up to 2: one interim run that drives the retry, then the final verification. When no retry happens the interim run is reused as the final result, so an advanced run that gets it right the first time also uses one. |
| Wall clock | 360 seconds | 360 seconds, the same deadline covering the extra turn and the extra oracle run |
| Cost | one model call's tokens | both turns' tokens, accumulated and charged against the same USD 0.30 |

The preflight commands are charged to the same 12 tool calls. Free preflight would let advanced win on information the baseline had to pay for.

The reservation partitions those 12 calls, it does not raise them. Advanced promises one evidence-driven repair turn, and a first patch landing on the last call would cancel that promise silently, which is exactly what happened in run `20260829T193417Z-21e6a9`. So the harness holds one call back, shows the agent only what the current turn may spend, and releases the reservation when the retry begins. Both modes read the same live `[budget]` line, produced by the same function, at the end of every tool result.

Evidence gates and oracle runs are *not* charged as tool calls because they are scorer actions after the repair turn checkpoints. They remain harness time inside the same deadline. This is an explicit resource difference: advanced spends up to one extra model turn, one extra evidence gate and one extra oracle run to buy a second chance at a minimal patch. If you want the two arms to differ only in prompt text, run `--mode baseline` against `--mode advanced` and read the tool call counts and wall-clock time in each `result.json`.

### What the retry is driven by

Both signals drive it: after a successful patch disables model tools, the harness re-runs the repository's own check command and the hidden oracle independently against a fresh copy of the repaired tree. If either is unsatisfied, and a patch attempt and a tool call remain, the agent gets exactly one more repair turn with the failure evidence. Baseline gets no retry at all.

The oracle's code is never mounted in the repair sandbox. What crosses back is the sanitized list of `PASS` and `FAIL` lines it printed, scrubbed of every path and then redacted. This is what makes `broken-test-discovery` interesting: the visible check exits zero, so only the independent verification can trigger the retry.

## Running it

```bash
export OPENAI_API_KEY=...
export REPRO_DOCTOR_MODEL=gpt-4.1-mini-2025-04-14   # pin an exact model for a submitted run
npm run docker:build
npm run doctor -- fixtures verify                   # confirm the benchmark before scoring against it
npm run eval -- --repeats 3
npm run report
open artifacts/report/index.html
```

Ten cases, two modes, three repeats is 60 runs. The measured batch took 26.8 minutes of wall clock and cost $0.4262. The 360 second per-run ceiling puts the worst case at six hours, but no run has come close: the median is 25 seconds.

Useful narrower forms:

```bash
npm run eval -- --repeats 1 --case entrypoint-mismatch
npm run eval -- --repeats 3 --mode advanced
```

## The critic experiment

The critic is a treatment, not part of either published mode, and it is runnable:

```bash
npm run eval -- --experiment critic --repeats 3
npm run report
```

This runs advanced mode twice over each of the three hardest fixtures, `broken-test-discovery`, `manifest-lockfile-mismatch` and `chained-two-faults`: once as the control, once with a critic that reviews the proposed patch against the hypothesis ledger and the post-patch evidence and can send it back. Same model, same settings, same budget, same oracle. The critic call is charged one tool call and its tokens accumulate into the same cost, so the treatment pays for itself out of the same twelve.

The command ignores `--case` and `--mode`; the experiment defines its own.

The rule was fixed before the experiment and is implemented in `decideExperiment`: keep the critic only for **at least +10 percentage points** of verified repair rate at **no more than +25 percent** median cost. It returns `pending` whenever either side is unmeasured, so a half-measured batch cannot settle it. Both the CLI summary and the report page print the rule next to the verdict.

Eighteen runs at three repeats: three cases, two arms, three repeats. It has run, and the rule discarded the critic. The numbers are at the top of this document and in the improvement changelog.

## Cost accounting

Token counts come from the provider's usage on `rawResponses`, summed across every request in the run. The first turn, the feedback retry and any critic call all accumulate into one total before the cost is computed and the budget is checked. A turn that ends by throwing, such as one that hits the SDK's turn limit, is billed too: the usage is recovered from the run state the error carries, because those model calls were made and paid for. If the provider reports no usage at all, the run records `tokens: null` rather than zero.

`config/pricing.json` ships with the default model priced:

| Model | Input per 1M | Output per 1M | Source | Verified |
| --- | --- | --- | --- | --- |
| `gpt-4.1-mini` | $0.40 | $1.60 | OpenAI API pricing page, standard rates | 2026-08-29 |
| `gpt-4.1-mini-2025-04-14` | $0.40 | $1.60 | OpenAI API pricing page, standard rates | 2026-08-29 |
| `openai/gpt-4.1-mini` | $0.40 | $1.60 | OpenRouter model page, the route the published evaluation used | 2026-08-30 |

Those are standard API rates, not batch or cached-input rates. The `sourceUrl` and `verifiedOn` fields are part of the schema so a stale price can be traced to the page it came from and rechecked. Recheck them before quoting a cost in a submission: they were read on one day and prices move.

For any other model, override for the run:

```bash
export REPRO_DOCTOR_MODEL=some-other-model
export REPRO_DOCTOR_PRICE_INPUT_PER_MTOK=0.40
export REPRO_DOCTOR_PRICE_OUTPUT_PER_MTOK=1.60
```

### Unpriced models fail closed

A live scored batch will not start when the pinned model has no price. `npm run eval` stops before spending anything and writes a report with `status: {kind: "pending", why: "no-price-configured"}`, because an unpriced batch could not enforce the cost budget and its cost column would be a row of unknowns.

Single live runs fail closed too: `diagnose` refuses an unpriced model before the first API call. The evaluator's `cost-accounting` check remains a second guard against imported or stale artifacts whose live cost is unknown. Scripted runs are exempt because they call no model and spend nothing.

Any single unpriced run in a mode still makes that mode's median cost `null`, so a partly priced batch cannot look cheaper than it was.

## Statistics, honestly

Three repeats over ten cases gives 30 runs per mode. That is enough to notice a large effect and not enough to resolve a small one. A difference of one or two cases is inside the noise a temperature-zero model still produces through tool ordering and truncation.

With 30 runs per arm, the 95% confidence interval on a rate near 50% is roughly plus or minus 18 points. So: report the interval, do not report a five point difference as a win, and if a result matters, raise `--repeats`.

Every rate the CLI and the report print carries a 95% Wilson interval, and the comparison carries its own Newcombe interval for the difference of two proportions. That is why the headline of this evaluation is "+23.3 points, 95% CI -1.5 to +44.5" rather than "advanced is 23 points better". The first sentence is what was measured.

Per-case results are the interesting part anyway. "Advanced fixes `broken-test-discovery` and baseline does not, in three runs out of three" says more than a headline average over ten unrelated faults.

## Reading the report

`npm run report` builds `artifacts/report/index.html` from `artifacts/eval/eval.json`, `artifacts/eval/eval-critic.json` when the experiment has been run, and every `result.json` on disk. The mode comparison and the critic experiment are written to separate files, so running the experiment cannot overwrite the comparison it is measured against. It shows the aggregate table per mode, a per-case grid with the failed check names and the path to each trajectory, a failure table, and an index of runs on disk with their executor and whether it was production safe.

It fabricates nothing. With no evaluation on disk it says so and lists whatever individual runs exist. A pending evaluation is labelled pending, with the reason.

## Reproducing a published number

Every number in a report traces to a file:

1. Open the report and find the case and mode.
2. Follow the path to `artifacts/runs/<run-id>/`.
3. `result.json` has the outcome, the budget spend, the sandbox profile and both tree checksums.
4. `trajectory.jsonl` has every tool call and its output, in order.
5. `verification.log` has the oracle's output and exit code.
6. `repair.patch` is the diff that was verified.

If a claim in a document does not have that chain behind it, treat it as unmeasured.
