# Pre-registration: the confirmatory batch, the retry ablation and the budget check

Written and committed before any of the three batches ran. The commit that adds this file is
the proof of order: everything below was fixed while the results were still
unknown, so nothing in it can have been chosen to fit an answer.

Three experiments are registered here. E5 re-measures the headline comparison at
a sample size large enough to settle it. E6 asks which ingredient of advanced
mode carries the difference. E7 asks whether the difference is a capability
difference at all, or only an efficiency difference under a tight budget.

## What is already known, and what that entitles us to claim

The exploratory batch (60 runs, 3 repeats per case per mode, report
`2026-08-30T06:30:50Z`, preserved as `artifacts/eval/eval-exploratory-b3.json`)
measured:

| | baseline | advanced |
|---|---|---|
| verified repairs | 14/30 (46.7%) | 21/30 (70.0%) |
| difference | | +23.3 points, 95% CI -1.5 to +44.5 |

The interval includes zero, so that batch established nothing about the
difference. It is exploratory and is reported as such.

Reading the same 60 runs per case, rather than in aggregate, shows the sample is
not homogeneous:

| stratum | cases | baseline | advanced |
|---|---|---|---|
| saturated | `case-sensitive-import`, `entrypoint-mismatch`, `env-contract`, `esm-cjs-mismatch`, `health-route-port` | 14/15 | 15/15 |
| hard | `broken-test-discovery`, `chained-two-faults`, `manifest-lockfile-mismatch`, `monorepo-build-order`, `tsconfig-include-scope` | 0/15 | 6/15 |

On the hard stratum the difference is +40.0 points with a 95% CI of +11.3 to
+64.3, which excludes zero. **That number is not a claim and must not be quoted
as one.** The stratification was chosen after seeing the results, which is
exactly the move this project exists to argue against. Its only legitimate use
is the one made of it here: to become a hypothesis that a fresh batch tests.

The strata above are frozen as of this document. Membership was assigned by the
exploratory batch's *baseline* result alone (0/3 is hard, 2/3 or better is
saturated), never by the advanced result, and will not be revised after E5 runs
no matter what E5 shows.

## E5: confirmatory comparison

**Question.** Does advanced mode repair more broken repositories than baseline,
at a sample size that can answer the question?

**Design.** The same ten fixtures, the same two modes, the same hidden oracles,
the same budget, the same model and the same Docker executor as the exploratory
batch. Seven repeats. 10 cases x 2 modes x 7 repeats = **140 runs**.

**Sample size.** Seventy runs per mode. Detecting the observed 23-point
aggregate difference at 80% power and alpha 0.05 needs about 66 per arm;
detecting the hard-stratum difference needs about 19 per arm, and seven repeats
give 35 there. Both hypotheses are powered by the same batch.

**Primary hypothesis.** Advanced mode's verified repair rate exceeds baseline's,
aggregated over all ten cases.

**Primary decision rule.** The claim "advanced improves the verified repair
rate" may be published only if the 95% Newcombe interval on the difference
excludes zero. If it includes zero, the published statement is that the
difference is not established at this sample size, and the headline stays
descriptive.

**Secondary hypothesis.** The improvement is concentrated in the hard stratum.
The same interval rule is applied within each stratum. The saturated stratum is
reported as a ceiling check rather than as a hypothesis: baseline already scores
14/15 there, so it has almost no room to show a difference and a null result in
it means nothing.

**Also recorded, not hypothesised.** The baseline arm is measured a third time
under identical conditions. Its rate against the two earlier batches (16/30,
then 14/30) is published as a direct measurement of run-to-run variance at
temperature zero.

**Published regardless of outcome.** All 140 runs, the per-case table, both
stratum intervals, every unverified and failed run, and the cost.

## E6: bounded-retry ablation

**Question.** Advanced mode is five changes at once: the preflight report, the
hypothesis ledger, the live budget footer, the independent evidence gate, and
one bounded evidence-driven retry. Nobody currently knows which of them carries
the difference. Does removing the retry lower the repair rate?

**Design.** Two arms, both advanced mode, differing only in the retry.

- **Control:** advanced mode exactly as published.
- **Treatment:** advanced mode without the evidence-driven retry. That means
  three coupled things, because they are one design and not three: no retry
  turn, no tool-call reservation held back for it, and step 8 of the
  instructions tells the truth about what happens after the patch instead of
  promising a second turn.

Releasing the reservation in the treatment arm is deliberate. Holding calls back
for a turn that will never happen would handicap the treatment on budget as well
as on structure, and would measure two changes while claiming to measure one. It
also makes the ablation conservative: the treatment arm gets *more* usable
tool calls in its only turn, so if it still loses, the retry is doing real work.

**Cases.** The five hard-stratum cases only. The retry fires when the evidence
gate refuses a patch, which on the saturated cases almost never happens, so
including them would spend a third of the batch measuring a mechanism that never
runs. 5 cases x 2 arms x 7 repeats = **70 runs**.

**Paired control.** The control arm is re-run rather than reused from E5, even
though E5 measures the same thing on the same cases. Reusing it would compare
two batches executed at different times against each other. The duplicate also
yields a fourth independent estimate of advanced mode on hard faults, which is
worth its cost.

**Hypothesis.** Removing the bounded retry lowers the verified repair rate on
hard faults.

**Decision rule.** The claim "the bounded retry is load-bearing" may be
published only if the 95% Newcombe interval on control minus treatment excludes
zero. If it includes zero, the published statement is that the ablation did not
resolve which ingredient carries the difference, and the retry stays in advanced
mode on the grounds that it was not shown to hurt, which is a weaker reason and
will be described as one.

**What this does not measure.** The retry as a mechanism, not the sentence that
describes it. No claim will be made about the instruction text in isolation.

## E7: budget sensitivity

**Question.** The sharpest objection to this project's central claim is that
advanced mode does not diagnose better, it merely spends a tight budget better.
Twelve tool calls is a hard ceiling, and the largest failure this project found
was an agent going blind to how much of that ceiling was left. If baseline is
given more room, does it catch up?

If it does, the honest conclusion is that advanced mode buys budget efficiency
rather than capability. That is still a real result and a more interesting one
than a bare win, and it would be published as the headline finding.

**Design.** The same ten fixtures, the same two modes, the same oracles, the
same model and executor, with one change: `maxToolCalls` raised from 12 to 25.
Every other budget limit is unchanged. Five repeats. 10 cases x 2 modes x 5
repeats = **100 runs**.

**Primary hypothesis.** At 25 tool calls the advantage of advanced mode over
baseline is smaller than at 12.

**Primary decision rule.** Three intervals are computed and all three are
published:

1. baseline at 25 against baseline at 12 (E5's baseline arm). This measures what
   the extra budget alone is worth.
2. advanced at 25 against baseline at 25. If this interval excludes zero,
   advanced still leads when budget is not scarce, and the capability claim
   stands at both budgets.
3. baseline at 25 against advanced at 12 (E5's advanced arm). If this interval
   excludes zero in baseline's favour, buying tool calls beats structuring the
   agent, and the project's recommendation changes accordingly.

**What this cannot establish.** Fifty runs per arm can detect a difference of
roughly twenty points but cannot prove equivalence. If interval 2 includes zero,
the published statement is that advanced's lead at 25 calls is not established,
never that the two are equal.

**Why 25.** Roughly double the current ceiling, chosen before the run and not
tuned afterwards. It is large enough that budget starvation stops being the
binding constraint and small enough that a run still finishes inside the
existing 360 second wall clock.

## Rules that bind all three experiments

1. No fixture, hidden oracle, reference repair, budget, model, provider,
   executor, or agent instruction changes between this commit and the end of
   both batches, other than the single ablated design in E6's treatment arm. If
   anything else changes, the affected batch is discarded and re-run. Two
   batches have already been discarded on this rule and both are in the
   improvement changelog.
2. Sample sizes are fixed here. No batch is extended after seeing its result,
   and no result is reported from a partially completed batch as though it were
   complete.
3. Every rate is published with its interval. Every difference is published with
   a Newcombe interval. A point estimate quoted without its interval is a
   reporting error, including in the video and in any submission form.
4. Spend cap: $8 across the three batches. The exploratory batch cost $0.43 for
   60 runs. E5 and E6 add 210 runs at the same budget, and E7 adds 100 runs at
   roughly double the tool calls, so the three together should cost about $3. If
   the total passes $8 the batches stop and the partial result is reported as
   partial.
5. Any deviation from this document is written into
   `docs/IMPROVEMENT_CHANGELOG.md` with the reason, rather than quietly applied.

## What would falsify the project's central claim

The claim is that structuring an agent's context, evidence and budget makes it
repair more broken repositories than the same model with the same tools and the
same budget and no structure.

E5 falsifies it if the aggregate interval includes zero at 70 runs per mode and
the hard-stratum interval also includes zero.

E7 falsifies it in a different and more interesting way: if baseline at 25 tool
calls matches or beats advanced at 12, then the contribution was budget
efficiency under scarcity, not better repair, and the project's own
recommendation to a reader would change from "structure the agent" to "give it
more room first".

Either result would be published as the headline, in the README and in the
video, with the same prominence as a positive one.
