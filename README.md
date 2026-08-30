# Repro Doctor

**[lanss-id.github.io/repro-doctor](https://lanss-id.github.io/repro-doctor/)** is the one page version: the problem, how the verdict is produced, and the measured result.

Repro Doctor takes a TypeScript repository that does not work, copies it into a sandbox, lets a model try to repair the copy, and then checks the result with an oracle the model never saw. What you get back is a patch with evidence attached: a trajectory of every command, the oracle's exit status, and a checksum proving the original repository was not touched.

The reason for the hidden oracle is simple. An agent that can see the test can make the test pass. Most "the agent fixed it" claims are really "the agent convinced itself it fixed it", and the two look identical in a transcript. Here the pass or fail signal comes from a program stored outside the workspace, mounted read-only, and run after the agent's session has ended.

The project also runs the same repair task two ways, so you can see whether the structure around a model is doing anything. Baseline gets a generic instruction and an unstructured loop. Advanced gets a deterministic preflight, a hypothesis ledger, a minimal-patch instruction, and one feedback retry driven by two independent signals: the repository's own check re-run under harness control, and the hidden oracle run against a fresh copy of the repaired tree. Both modes get the same model, repository, tools, budget and scorer. Advanced also spends more, one extra model turn and one extra oracle run, and [docs/EVALUATION.md](docs/EVALUATION.md) states that difference in a table rather than leaving you to find it.

## Who this is for

An engineer who lets a coding agent fix a repository, and then has to decide whether to trust the patch it hands back.

That is a real position to be in. You inherit a service that does not build. You point an agent at it. Two minutes later there is a diff and a paragraph explaining why it works, and both look plausible. The agent ran the project's own check and it went green.

**The bottleneck is not the fix. It is the review.** Reading a patch closely enough to believe it costs about as much attention as writing it, and the transcript cannot help you: an agent that can run your check can also satisfy it without repairing anything, and the two are indistinguishable in a log. So you re-derive the contract by hand. That is the expensive part, it happens on every patch, and it is the part nobody wants to do at the end of a day.

Repro Doctor removes that step by making the verdict come from somewhere the agent could not reach. You write down what your repository is supposed to do, once, as a script. The agent never sees it. It runs afterwards, in a separate container, against a fresh copy of the repaired tree, and its exit status is the answer. What you review is not a claim, it is a result.

**Who it is not for:** anyone who wants a patch fast and does not care whether it is right. The whole cost of this tool is the oracle you have to write, and the whole benefit is the trust that buys.

## Use it on your own repository

Every fixture ships a hidden oracle, but there is nothing special about fixtures. `--oracle-dir` takes any directory:

```bash
npm run doctor -- diagnose path/to/your/repo \
  --mode advanced \
  --oracle-dir path/to/your/oracle
```

An oracle is one Node script. It gets a fresh copy of the repaired tree, no network, and `REPO_DIR` pointing at it; exit 0 means the repository keeps its promises. [examples/bring-your-own-oracle/](examples/bring-your-own-oracle) is a worked example with the full contract, a repository whose own tests pass while its documented behaviour is broken, and the two real runs that were done against it, including the one where the agent's patch looked right and the oracle caught the case it missed.

## Requirements

- Node.js 22 or newer
- Docker, running, with permission to start containers
- An OpenAI API key for `diagnose` and `eval`. Everything else runs without one.

## Setup

```bash
npm install
npm run docker:build     # builds repro-doctor-runner:1, the sandbox image
npm test                 # 163 tests, no API key needed
```

Check that the benchmark itself is honest before you trust any score from it. This command copies each of the ten fixtures, runs its hidden oracle to confirm it fails, applies the reference repair, and runs the oracle again to confirm it passes:

```bash
npm run doctor -- fixtures verify
```

## Commands

```bash
# Repair a repository. Docker is required; there is no quiet fallback to the host.
npm run doctor -- diagnose <repo> --mode baseline|advanced

# Review a patch and apply it to a real repository, with a confirmation prompt.
npm run doctor -- apply <run-id> --to <repo>

# Run every fixture in both modes, three times each, and score the results.
npm run eval -- --repeats 3

# Run the critic A/B experiment instead, against its pre-registered decision rule.
npm run eval -- --experiment critic --repeats 3

# Build the comparison page from whatever real results are on disk.
npm run report
```

`npm run doctor -- help` prints every option. Note the `--` before the arguments: npm needs it to pass them through.

Try it on a fixture:

```bash
export OPENAI_API_KEY=...
npm run doctor -- diagnose fixtures/entrypoint-mismatch/repo --mode advanced
```

## What a run leaves behind

Every run writes one directory under `artifacts/runs/<run-id>/`:

| File | What it holds |
| --- | --- |
| `result.json` | The whole run as typed data: mode, model, sandbox profile, budget, usage, outcome, verification, patch summary, checksums |
| `trajectory.jsonl` | One JSON object per event, schema-checked and secret-redacted before it is written |
| `repair.patch` | Unified diff between the pristine copy and the repaired copy. **Exact and unredacted**, because its checksum and `apply` need byte equality. Read it before you publish it. |
| `verification.log` | The hidden oracle's stdout, stderr and exit code |
| `report.html` | A standalone page for that single run, with the patch shown redacted |

Runtime artifacts are gitignored. `submission/examples/` holds a sanitized copy of one run so you can see the shape of the output without running anything.

## Safety

The short version, with the details in [SECURITY.md](SECURITY.md):

- `diagnose` never writes to the repository you point it at. It copies the tree, works on the copy, and re-checksums the original at the end. A changed checksum fails the run.
- Repair runs in a container with `--network none`, `--read-only`, `--cap-drop ALL`, an unprivileged user, CPU, memory and PID limits, and a per-command timeout. No Docker socket, no host filesystem beyond the copied workspace, no API key inside the sandbox.
- The hidden oracle is mounted read-only, into a separate container, only during verification.
- Path traversal and symlink escape are refused at the boundary, and there are tests for both.
- Secrets are redacted on the write path, so trajectories, logs and reports are safe to attach to a submission. `repair.patch` is the deliberate exception: it is exact repository content, marked `sensitive` in the result, and yours to review before publishing.
- One deadline covers model calls, tool calls, the retry and verification. A provider call that never returns still ends the run, as `budget-exhausted`.
- `apply` shows the full patch, verifies the target's checksum matches the tree the patch was built against, re-checks it immediately before writing in case the tree moved during review, and asks for typed confirmation. `--yes-i-reviewed-the-patch` is the only way to skip the prompt, and it means what it says.

If Docker is unavailable, `diagnose` fails with an actionable message. It does not run repair commands on your machine instead. The local test adapter exists for the test suite, is labelled `productionSafe: false` in every result it produces, and refuses to start unless you both pass `--executor local-test-adapter` and set `REPRO_DOCTOR_ALLOW_LOCAL_ADAPTER=1`.

## The benchmark

Ten small TypeScript repositories, each broken in one specific way that a compiler alone will not catch. Every fixture has a package manifest and lockfile, a hidden oracle, hidden metadata, and a deterministic reference repair. None of the hidden material is inside the directory that gets copied into the sandbox.

| Case | Fault |
| --- | --- |
| `entrypoint-mismatch` | `main` names a file the build never emits |
| `esm-cjs-mismatch` | tsconfig emits CommonJS into a package declared as ESM |
| `case-sensitive-import` | Import path casing that only works on macOS |
| `tsconfig-include-scope` | `include` and `rootDir` exclude a directory the app imports |
| `env-contract` | Config reads `SERVICE_PORT`; deployment sets `PORT` |
| `monorepo-build-order` | The app builds before the package it imports |
| `broken-test-discovery` | The test glob matches nothing and the runner exits zero |
| `health-route-port` | `/healthz` on a hardcoded port, against a `/health` and `PORT` contract |
| `manifest-lockfile-mismatch` | `npm ci` refuses because the lockfile lacks a declared dependency |
| `chained-two-faults` | Two faults on one path; fixing either alone still fails |

`broken-test-discovery` is the one I would watch. The repository's own check exits zero while running zero tests, so an agent that trusts exit codes will report success on a project whose tests never ran. That is exactly the failure the hidden oracle is there to catch.

## Result

Two batches, both published in full. The first was exploratory and its numbers
turned out to be noise. The second was pre-registered and it did not confirm the
hypothesis. Both are here because publishing only the flattering one is the
thing this project exists to argue against.

### The confirmatory batch

140 runs, ten fixtures, seven repeats per case per mode, `openai/gpt-4.1-mini`,
Docker, 30 August 2026. Sample size, hypotheses and decision rules were fixed in
[docs/PREREGISTRATION.md](docs/PREREGISTRATION.md) and committed before the first
run started.

| | Baseline | Advanced |
| --- | --- | --- |
| Verified repair rate | 42/70, 60.0% (95% CI 48.3 to 70.7) | 51/70, 72.9% (95% CI 61.5 to 81.9) |
| Median wall clock | 25.4s | 28.9s |
| Unsafe mutations, budget violations, oracle access violations | 0, 0, 0 | 0, 0, 0 |

Advanced minus baseline is **+12.9 points, 95% CI -2.8 to +27.6**. The interval
includes zero.

**By the rule written before the batch ran, that is a null result.** Seventy runs
per mode do not establish that the difference is real. It is not a finding that
the two are equal: the data are consistent with anything from a small harm to a
large benefit, and advanced has scored higher than baseline in every batch so
far. What cannot be said is that the improvement is established, and this
project would be worth nothing if it said it anyway.

The pre-registered secondary hypothesis fared no better. Neither stratum
separates:

| Stratum | Baseline | Advanced | Difference |
| --- | --- | --- | --- |
| saturated | 31/35, 88.6% | 35/35, 100.0% | +11.4 points (95% CI -0.6 to +26.0) |
| hard | 11/35, 31.4% | 16/35, 45.7% | +14.3 points (95% CI -8.2 to +34.9) |

### What the exploratory batch had said, and why it was wrong

The first batch, 60 runs at three repeats, measured baseline 14/30, 46.7%
(95% CI 30.2 to 63.9) against advanced 21/30, 70.0% (95% CI 52.1 to 83.3), a
difference of +23.3 points with a 95% CI of -1.5 to +44.5.

Reading it per case rather than in aggregate suggested something sharper. On
five fixtures baseline had scored **0 out of 15** while advanced scored 6, a
difference of +40.0 points whose interval excluded zero. It was tempting and it
was post hoc, so instead of publishing it I froze those five cases as a stratum
and made it the secondary hypothesis of the batch above.

In the confirmatory batch, baseline scored **11 out of 35** on those same five
cases. Zero per cent became thirty-one per cent in an arm that had not changed
by a single character. The +40 points was noise, and the only reason it is not
in this README as a headline is that it was registered as a hypothesis instead
of reported as a result.

### The number that matters more than either

The baseline arm is byte-identical across all three batches. It has now measured:

| Batch | Baseline verified repair rate |
| --- | --- |
| Development batch, 29 August | 16/30, 53.3% |
| Exploratory batch, 30 August | 14/30, 46.7% |
| Confirmatory batch, 30 August | 42/70, 60.0% |

A spread of 13.3 points, at temperature zero, from nothing but running the same
thing again. The effect this project set out to measure is 12.9 points.

**The variance between batches is larger than the effect being measured.** Any
comparison of an agent against a baseline that were not run in the same batch is
measuring the weather. That is the most useful thing I learned building this,
and it is measured rather than asserted: the runs are all in
[submission/evidence/](submission/evidence) and you can recompute them yourself
without an API key.

### Two cases worth naming

`tsconfig-include-scope`: baseline verified it **0 times in 7**, advanced **7 in
7**. Complete separation, the clearest single case in the benchmark.

`monorepo-build-order`: baseline **6 in 7**, advanced **1 in 7**. Advanced mode
is dramatically worse here, and I do not yet know why. It is in the per-case
table in [docs/EVALUATION.md](docs/EVALUATION.md) and in the trajectories rather
than left out.

### Cost

Two runs of the 140, one per mode, ended `budget-exhausted` on a path that loses
the usage of the model calls it had already made, so the median cost is
unreportable for both modes by design rather than estimated. Over the 138 runs
with measured cost the median is $0.007144 and the batch total is $0.9727 for
64.5 minutes of wall clock. The defect is real and is listed in the changelog;
it was not fixed mid-sequence because the pre-registration forbids changing the
code while batches that are being compared are still running.

### Verify it without spending anything

```bash
npm run doctor -- replay submission/evidence/confirmatory
```

No API key, no model call, no Docker, no network. It puts all 140 committed run
artifacts back through the same scoring code that produced the report and tells
you about every verdict that comes out differently. On this machine it reports
zero disagreements across all 140 runs, seven checks each.

[docs/EVALUATION.md](docs/EVALUATION.md) has the per-case grid, the failure
profile, the fairness contract and what is still unmeasured.

## Improvement changelog

The full version with evidence, run ids and the experiments that were thrown away is [docs/IMPROVEMENT_CHANGELOG.md](docs/IMPROVEMENT_CHANGELOG.md). The short version:

| Stage | What was tried, and why | Evidence | Decision |
| --- | --- | --- | --- |
| Baseline | A generic instruction, four tools, one unstructured loop, the same budget and the same scorer as everything below | 42/70 verified, 60.0% (95% CI 48.3 to 70.7). Its characteristic failure is a patch the hidden oracle rejects, in 16 of its 28 failures | The starting point, and the control for everything after |
| Iteration 1 | Structure around the loop: deterministic preflight, hypothesis ledger, minimal-patch instruction, and a retry driven by evidence the harness collects rather than by the agent's opinion | 51/70 verified, 72.9%, a difference of +12.9 points with a 95% CI of -2.8 to +27.6 | Kept, with the effect reported as not established. It has scored higher in every batch and the interval has crossed zero in every batch |
| Iteration 2 | Tell the agent the budget it actually has. The instructions claimed 12 tool calls while the preflight had already spent 3, and a first patch on the last call silently cancelled the promised retry | Three live runs on `chained-two-faults`: correct diagnosis refused at call 13, then a patch with no retry left, then a repaired run using the reserved call | Kept. Every tool result now ends with a live `[budget]` line and the retry's call is reserved up front |
| Iteration 3 | Bill a turn that ends by throwing. A run that hit the SDK turn limit lost the usage of every model call it had made | One run in 60 reported `cost: unknown`, which made its whole mode's median cost unreportable | Kept, and the 60-run batch it spoiled was re-run from scratch. A second path with the same defect survived it and cost the confirmatory batch its median too |
| Iteration 4 | Tell the agent that a check exiting zero is not evidence the repository works, after it gave up in 4 calls on a repository whose tests passed while its documented behaviour was broken | On that repository, `no-patch` in 4 calls became an engaged patch in 11 that passed 5 of 6 contract checks. On the benchmark: no measurable change | Kept on the strength of the first, with the second reported as a null result |
| Discarded | A critic agent reviewing the patch against the ledger before the retry decision, scored by a rule written before it ran | 1/9 against the control's 4/9, twice run and negative both times | Discarded by its own rule. Still in the tree behind `--experiment critic`, off by default |
| Final | Everything above except the critic | 51/70, and zero safety violations in 200 runs across two batches | The submitted system |

## The failure mode this design keeps running into

A patch that looks right and is not.

Across the benchmark, the most common way a run fails is not that the agent gives up. It is `unverified-patch`: a real diff, in the right file, that the repository's own check accepts and the hidden oracle rejects. The clearest example is in [examples/bring-your-own-oracle/](examples/bring-your-own-oracle), where the agent rewrote a duration parser correctly, passed five of six contract checks, and left `parseDuration("")` returning zero instead of throwing. Everything visible to the agent said it was done.

That failure mode is the reason the oracle is not optional and the reason `apply` asks a human. Both exist to put a gap between "the agent believes this works" and "this reaches your repository".

The second failure mode is narrower and was found late: when a repository's own check exits zero, an agent has nothing to react to and stops early. That is the same blindness as the first, one level up, and it is what the advanced instructions now name explicitly.

## Hot take

Most of what went wrong with this agent was not reasoning. It was bookkeeping.

Four separate live failures were traced during development, and every one of them was the harness telling the agent something untrue, or failing to tell it something it needed:

- The instructions said "you have 12 tool calls" while the preflight had already spent 3. The agent planned against a number that stopped being true before its first turn.
- A first patch landing on the last call silently cancelled a retry the instructions had promised. Nothing errored. The run just ended early.
- The retry's feedback message never said how small the retry was, so the agent spent its one remaining call re-reading a file it had already read.
- A turn that ended by throwing lost the token usage of every model call it had made, so a run reported its cost as unknown and the evaluator refused to score it.

None of those look like agent problems in a transcript. They look like the model being careless. The lesson I did not expect: before blaming the model's judgement, check whether the numbers you handed it were true, and whether the promises in your prompt are ones your harness actually keeps. [docs/IMPROVEMENT_CHANGELOG.md](docs/IMPROVEMENT_CHANGELOG.md) has each one with the run id that exposed it.

## Pinning the model

Both modes read the model from `REPRO_DOCTOR_MODEL`, defaulting to `gpt-4.1-mini`. A submitted run should pin an exact model string:

```bash
export REPRO_DOCTOR_MODEL=gpt-4.1-mini-2025-04-14
```

The model, along with temperature, top-p, turn limit and serial-tool setting, is hashed into `modelSettingsFingerprint` in every `result.json`. Two runs are only comparable if that fingerprint matches, which is easy to check and hard to fake.

## Layout

```
src/domain      Zod schemas and discriminated unions: results, budgets, trajectories, verification
src/infra       Filesystem safety, checksums, unified diff, sandbox executors, redaction, logging
src/agent       Budget tracker, tool session, preflight, instructions, model driver, diagnose
src/oracle      Hidden oracle execution
src/eval        Scoring, gate checks, the evaluation loop
src/report      HTML for a single run and for the comparison
src/cli         Argument parsing, presentation, the five commands
fixtures/<id>   repo/ is copied into the sandbox; oracle/, reference/ and meta.json never are
tests           Unit and integration tests, mostly against real processes
```

## Documentation

- [docs/REPRODUCTION.md](docs/REPRODUCTION.md), how to reproduce a run from a clean machine
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), how the pieces fit and why the seams are where they are
- [docs/EVALUATION.md](docs/EVALUATION.md), the protocol, the fairness contract and the honesty rules
- [docs/DECISIONS.md](docs/DECISIONS.md), the calls I made and what I gave up
- [docs/IMPROVEMENT_CHANGELOG.md](docs/IMPROVEMENT_CHANGELOG.md), every iteration with its evidence, including the ones that were thrown away
- [docs/AGENT_USE.md](docs/AGENT_USE.md), which agents were used to build this and which run inside it, with a trajectory for each
- [examples/bring-your-own-oracle/](examples/bring-your-own-oracle), the oracle contract and a worked example on a repository outside the benchmark
- [submission/examples/](submission/examples), committed trajectories for every agent and a transcript of the human checkpoint
- [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
