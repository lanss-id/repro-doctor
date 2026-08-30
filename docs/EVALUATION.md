# Evaluation

## Result: 140 runs, 70 per mode

Run on 30 August 2026 with `openai/gpt-4.1-mini` through an OpenAI-compatible gateway, Docker sandbox, ten fixtures, seven repeats per case per mode. Report generated `2026-08-30T15:18:26Z`. Sample size, hypotheses and decision rules were fixed in [PREREGISTRATION.md](PREREGISTRATION.md) and committed before the first run of this batch started.

| | Baseline | Advanced |
| --- | --- | --- |
| Verified repair rate | 42/70, 60.0% (95% CI 48.3 to 70.7) | 51/70, 72.9% (95% CI 61.5 to 81.9) |
| Median wall clock | 25.4s | 28.9s |
| Median cost per run | unreportable | unreportable |
| Unsafe mutations | 0 | 0 |
| Budget violations | 0 | 0 |
| Oracle access violations | 0 | 0 |

Total measured spend for the batch: $0.9727 over 64.5 minutes of wall clock.

**Advanced minus baseline: +12.9 points, 95% CI -2.8 to +27.6.** The interval includes zero.

By the rule fixed before the batch ran, that is a null result: seventy runs per mode do not establish that the difference is real. It is not a finding that the two modes are equal. The data are consistent with anything from a small harm to a substantial benefit, advanced has scored higher in all three batches run so far, and the failure profile below moves in a direction that noise would not obviously produce. What cannot be said is that the improvement is established.

### The secondary hypothesis, also not established

The strata were frozen by the exploratory batch's baseline result alone, before this batch ran, and are defined in [PREREGISTRATION.md](PREREGISTRATION.md) and in `src/eval/strata.ts`.

| Stratum | Baseline | Advanced | Difference |
| --- | --- | --- | --- |
| saturated | 31/35, 88.6% (95% CI 74.0 to 95.5) | 35/35, 100.0% (95% CI 90.1 to 100.0) | +11.4 points (95% CI -0.6 to +26.0) |
| hard | 11/35, 31.4% (95% CI 18.6 to 48.0) | 16/35, 45.7% (95% CI 30.5 to 61.8) | +14.3 points (95% CI -8.2 to +34.9) |

Both intervals include zero.

### Why the exploratory batch's stratification was wrong

The exploratory batch, 60 runs at three repeats, generated `2026-08-30T06:30:50Z`, measured baseline 14/30, 46.7% (95% CI 30.2 to 63.9) against advanced 21/30, 70.0% (95% CI 52.1 to 83.3): a difference of +23.3 points, 95% CI -1.5 to +44.5.

Per case, it looked much sharper than that. On the five cases that became the hard stratum, baseline scored **0 of 15** and advanced scored 6, a difference of +40.0 points whose interval, +11.3 to +64.3, excluded zero.

In this batch baseline scored **11 of 35** on those same five cases, in an arm that had not changed by a character. Two of the five, `broken-test-discovery` and `monorepo-build-order`, went from 0 of 3 to 5 of 7 and 6 of 7 respectively.

The +40 points was noise. It survives here only as a worked example of why a subgroup found after seeing the data has to become a hypothesis rather than a headline.

### What variance actually looks like here

The baseline arm is byte-identical across every batch: only advanced instructions changed between them.

| Batch | Baseline verified repair rate |
| --- | --- |
| Development batch, 29 August | 16/30, 53.3% |
| Exploratory batch, 30 August | 14/30, 46.7% |
| Confirmatory batch, 30 August | 42/70, 60.0% |

A spread of 13.3 points at temperature zero and top-p one, from nothing but running the same thing again on different occasions. The effect this benchmark is trying to detect is 12.9 points.

**Between-batch variance exceeds the effect being measured.** Any comparison whose two arms were not run in the same batch is measuring the weather, and that includes comparing a number in a README against a number someone else published last week. It is the most useful thing this project measured, and every interval in this document exists because of it.

### Per case, seven runs each

`P` is a verified repair: the hidden oracle exited zero and every safety check passed.

| Case | Baseline | Advanced |
| --- | --- | --- |
| `broken-test-discovery` | `PPPP.P.` | `.PP.PPP` |
| `case-sensitive-import` | `PPPPPPP` | `PPPPPPP` |
| `chained-two-faults` | `.......` | `P...PP.` |
| `entrypoint-mismatch` | `..P.PP.` | `PPPPPPP` |
| `env-contract` | `PPPPPPP` | `PPPPPPP` |
| `esm-cjs-mismatch` | `PPPPPPP` | `PPPPPPP` |
| `health-route-port` | `PPPPPPP` | `PPPPPPP` |
| `manifest-lockfile-mismatch` | `.......` | `.......` |
| `monorepo-build-order` | `PPPPPP.` | `P......` |
| `tsconfig-include-scope` | `.......` | `PPPPPPP` |

Four cases are solved by both modes every time and carry no information about the comparison. `manifest-lockfile-mismatch` defeats both modes fourteen times out of fourteen, and has now defeated them twenty times out of twenty across both batches.

Two cases deserve to be named rather than averaged away.

`tsconfig-include-scope`: baseline 0 of 7, advanced 7 of 7. Complete separation, and the strongest single case for the structure in the whole benchmark.

`monorepo-build-order`: baseline 6 of 7, advanced 1 of 7. **Advanced mode is dramatically worse here and I do not know why.** It is the one case where the structure appears to hurt, it moved in the opposite direction from the exploratory batch, where it was 0 of 3 against 1 of 3, and the trajectories are in the evidence bundle for anyone who wants to work out what happens. Leaving it out of the aggregate would have raised the published difference by about four points, which is exactly why it is not left out.

### How the two modes fail

| Failure | Baseline | Advanced |
| --- | ---: | ---: |
| Patch produced, oracle rejected it | 16 | 12 |
| No patch at all | 11 | 6 |
| Budget exhausted | 1 | 1 |

Baseline's characteristic failure remains producing nothing at all: eleven runs spent twelve tool calls reading files and never proposed a patch. Advanced halves that, to six.

### Which ingredient carries it: the ablation

Advanced mode shipped five changes at once. Two pre-registered ablations, 140
runs, say which of them the difference belongs to. Both run on the five
hard-stratum cases with seven repeats, both re-run their own control rather than
borrowing one from another batch.

| Experiment | What the treatment removes | Control | Treatment | Difference |
| --- | --- | --- | --- | --- |
| `ablation` | the retry turn and the tool call reserved for it | 13/35, 37.1% | 1/35, 2.9% | **+34.3 points (95% CI +16.1 to +51.0)** |
| `reserve` | the retry turn only, reservation held | 17/35, 48.6% | 8/35, 22.9% | **+25.7 points (95% CI +3.3 to +44.9)** |

**Both intervals exclude zero.** They are the only intervals in this project
that do. The bounded retry is load-bearing, and the second attempt carries most
of it on its own.

The first experiment alone would have been misleading, and reading its runs is
what showed it. Twenty of its thirty-five treatment runs produced no patch at
all, and eighteen of those twenty had a patch **refused for running out of tool
calls**. The reservation was doing two jobs: funding the retry turn, and
subtracting one from the `[budget]` line the agent reads, which made it patch
earlier. Releasing it removed both at once.

The pre-registration for that experiment argued the opposite. It reasoned that
releasing the reservation made the ablation conservative, because the treatment
would get more usable calls. It got more calls and used them worse, because the
binding constraint was pacing rather than budget. The error runs in the
direction that inflates the effect, and the second experiment exists because of
it.

Comparing the two treatment arms isolates the pacing effect: 8/35 with the
reservation against 1/35 without it, +20.0 points with a 95 percent CI of +4.1
to +36.3. **That comparison is across two batches and is reported as suggestive,
never as established.** The batches ran an hour apart on the same code and the
same provider, which makes it worth printing and does not make it sound.

### What the retry does in an ordinary batch

Nineteen of the seventy advanced runs in the confirmatory batch received the
evidence-driven feedback turn, which fires only when the harness's own re-run of
the check or the hidden oracle rejects the first patch. **Eighteen of those
nineteen ended verified.** Those nineteen had a first patch an independent check
rejected, so without a second turn they would have ended `unverified-patch`.
More than a third of advanced mode's verified repairs arrived through a turn
that exists only because something outside the agent said the first attempt was
wrong.

### Advanced mode on hard faults, measured four times

The ablations give two more estimates of the published advanced mode on the same
five cases, which makes four in total on unchanged code:

| Batch | Advanced on the hard stratum |
| --- | --- |
| Exploratory, 3 repeats | 6/15, 40.0% |
| Confirmatory, 7 repeats | 16/35, 45.7% |
| `ablation` control, 7 repeats | 13/35, 37.1% |
| `reserve` control, 7 repeats | 17/35, 48.6% |

A spread of 11.5 points, from nothing. It is the same lesson as the baseline arm
and it is why both ablations paid to re-run their own control instead of
borrowing one.

### The critic experiment, decided

Eighteen runs, three cases, three repeats, advanced mode with and without a critic call before the retry decision, generated `2026-08-30T06:38:18Z`, total measured spend $0.1370.

| | Control | Treatment with critic |
| --- | --- | --- |
| Verified repair rate | 4/9, 44.4% (95% CI 18.9 to 73.3) | 1/9, 11.1% (95% CI 2.0 to 43.5) |
| Median cost per run | $0.0075 | $0.0073 |

Difference: -33.3 points, 95% CI -63.6 to +7.9, for 3.3 percent less cost. The rule required at least +10 points for no more than +25 percent cost. **Decision: discard the critic.** It stays in the codebase behind `--experiment critic`, off by default, with this result recorded next to it.

The experiment was run twice, before and after an unrelated change to the advanced instructions, and came out negative both times: -11.1 points and then -33.3. Nine runs per arm still cannot distinguish -33 from +8, so this is not proof the critic hurts. It is a pre-registered rule returning "not shown to help", which is the answer it was written to be able to give.

One resource note belongs with the number: the treatment arm holds back two tool calls where the control holds back one, because the critic's own call has to come from the same budget. Part of the treatment's disadvantage is therefore one fewer investigation call, not the critic's advice.

### The cost defect this batch exposed

Two runs of the 140, one in each mode, ended `budget-exhausted` on a path that loses the usage of the model calls it had already made, and reported `cost: unknown`. By design one unpriced run makes a mode's median cost unreportable rather than optimistic, so both medians above are blank rather than estimated.

This is the second instance of a defect already fixed once, for the SDK turn-limit path, in iteration 3 of the improvement changelog. It was **not** fixed while these batches were running: [PREREGISTRATION.md](PREREGISTRATION.md) forbids code changes between the pre-registration commit and the end of the batches being compared, and two earlier batches were already discarded for exactly that reason. Over the 138 runs with measured cost the median is $0.007144.

### What is still not measured

- Any repository outside the ten fixtures, other than the two worked examples: [bring-your-own-oracle](../examples/bring-your-own-oracle), which is synthetic, and [real-world-commander](../examples/real-world-commander), which is not. Neither is a rate; both are single cases.
- Any model other than `gpt-4.1-mini`, and any provider other than the one route recorded in `config/pricing.json`.
- A sample large enough to settle a 13 point difference. That needs roughly 206 runs per arm at 80 percent power, about 420 runs and $3.30 at this batch's measured cost per run, which is more than the model credit available for this submission. It is the first thing to run with more budget, and the number is written here so nobody has to guess it.

### What did not need a model, and was verified anyway

The test suite passes with no API key and no network. All ten fixtures fail their hidden oracle before the reference repair and pass it after, under Docker and under the local test adapter. The parts of the loop that do need a model are exercised by integration tests that drive the real sandbox, the real patch engine and the real oracle with a scripted stand-in, which is how the feedback retry, the budget reservation, the retry ablation and the cumulative cost accounting are tested without inventing a benchmark number.

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
