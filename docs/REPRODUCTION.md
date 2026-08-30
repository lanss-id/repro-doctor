# Reproduction

Everything here was run on Linux with Node 25 and Docker 29. The runner image is Node 22, so the sandbox is the same regardless of the Node on your machine.

## From a clean machine

```bash
git clone <repository-url> repro-doctor
cd repro-doctor
npm ci                  # exact versions from package-lock.json
npm run docker:build    # builds repro-doctor-runner:1
```

`npm ci` needs network. Nothing after it does, except the commands that call a model.

## Step 1: the parts that need no API key

```bash
npm run typecheck
npm run lint
npm test
```

Expected: no output from typecheck or lint, and `pass 198` from the tests. The suite takes about a minute, most of it real subprocesses.

```bash
npm run doctor -- fixtures list
```

Expected: ten cases, then an isolation section confirming every oracle, reference repair and metadata file sits outside the agent-visible directory.

```bash
npm run doctor -- fixtures verify
```

Expected: `ok` for all ten, and the line "Every fixture fails before its reference repair and passes after it." This runs each hidden oracle twice per case inside Docker, once against the broken tree and once against the tree after the reference repair. It takes a few minutes.

Without Docker, the same check runs on the host with the clearly labelled test adapter:

```bash
REPRO_DOCTOR_ALLOW_LOCAL_ADAPTER=1 npm run doctor -- \
  fixtures verify --executor local-test-adapter --allow-local-adapter
```

```bash
npm run report
```

Expected: `artifacts/report/index.html`, with the evaluation status `not-run-yet` and a page that says no evaluation has been run rather than showing zeros.

## Step 1b: reproduce every published number, without an API key

This is the shortest path from a clean clone to checking the claims in the README, and it costs nothing.

```bash
npm run doctor -- replay submission/evidence/confirmatory
```

Expected: the recomputed aggregate `baseline 42/70` and `advanced 51/70`, the difference `+12.9 points (95% CI -2.8 to +27.6)`, both difficulty strata, and the line

```
Every re-scored run agrees with the published report on status, on all seven checks and on the verified verdict.
```

It exits non-zero on a single disagreement. About ten seconds, no model call, no network, no Docker, no money.

What it does: the committed `result.json` and `trajectory.jsonl` of all 140 runs go back through the same scoring code that produced the report, and every check is recomputed rather than read from the report. What it does not do: re-run the model. That would produce different numbers by design, since the provider is not deterministic, and the size of that difference is itself measured in [EVALUATION.md](EVALUATION.md#what-variance-actually-looks-like-here).

Two other bundles are committed and replay the same way:

```bash
npm run doctor -- replay submission/evidence/exploratory   # the 60-run batch that came first
npm run doctor -- replay submission/evidence/ablation      # the retry ablation
npm run doctor -- replay submission/evidence/reserve       # the retry ablation with the reservation held
npm run doctor -- replay submission/evidence/critic        # the discarded critic experiment
```

One caveat the command prints itself: the oracle-access check searches the trajectory for the absolute paths of the hidden fixture directories, and those belong to the machine that produced the run. On any other machine that check passes because it cannot find strings that could never appear there. The replay says so rather than counting it as a re-derivation.

## Step 2: what happens without a key

```bash
unset OPENAI_API_KEY
npm run doctor -- diagnose fixtures/entrypoint-mismatch/repo --mode advanced
```

Expected: a failure with reason `missing-api-key` and a message pointing at this document. No run directory is left behind, and nothing is reported as attempted.

## Step 3: a real repair

```bash
export OPENAI_API_KEY=...
export REPRO_DOCTOR_MODEL=gpt-4.1-mini-2025-04-14
npm run doctor -- diagnose fixtures/entrypoint-mismatch/repo --mode advanced
```

The command prints the run id, the outcome, the verification result, budget spend, and the paths to the five artifacts. Then:

```bash
RUN=<the run id it printed>
cat artifacts/runs/$RUN/result.json | head -40
cat artifacts/runs/$RUN/repair.patch
cat artifacts/runs/$RUN/verification.log
open artifacts/runs/$RUN/report.html
```

Confirm for yourself that the source repository was not touched:

```bash
git status --porcelain fixtures/
```

Expected: empty. `result.json` says the same thing under `repo.treeChecksumBefore`, `repo.treeChecksumAfter` and `repo.mutated`.

Run the same case in the other mode and compare the trajectories:

```bash
npm run doctor -- diagnose fixtures/entrypoint-mismatch/repo --mode baseline
```

## Step 4: applying a patch

`apply` refuses unless the target is byte-identical to the tree the patch was built against, which the fixture is, since diagnose never wrote to it.

```bash
cp -r fixtures/entrypoint-mismatch/repo /tmp/demo-repo
npm run doctor -- apply $RUN --to /tmp/demo-repo
```

It prints the patch and waits for you to type `apply`. Type anything else and nothing is written. To see the refusal path, change a file in `/tmp/demo-repo` first and run it again: it stops on the checksum mismatch before showing anything.

## Step 5: the full evaluation

This is the part that costs money. Everything above is free.

```bash
npm run eval -- --repeats 7
npm run report
open artifacts/report/index.html
```

140 runs. Measured on the machine that produced the published result: **64.5 minutes of wall clock and $0.9727** of model spend, a median of 29 seconds and $0.007144 per run. The per-run ceiling is 360 seconds, so a pathological batch could take fourteen hours; none has come close.

Expected: `baseline 42/70` and `advanced 51/70` are what this machine measured, and you will not get them. The provider is not deterministic and the same baseline arm has scored 53.3%, 46.7% and 60.0% across three batches. If your numbers land inside those intervals, the run reproduced; if you get one number and treat it as the number, the run did not teach you anything. [EVALUATION.md](EVALUATION.md) explains why at length.

The smaller batch the first published result used:

```bash
npm run eval -- --repeats 3      # 60 runs, about 27 minutes, about $0.43
```

The two pre-registered experiments, each writing its own report file so it cannot overwrite the comparison it is measured against:

```bash
npm run eval -- --experiment critic --repeats 3      # 18 runs, about 8 minutes, about $0.13
npm run eval -- --experiment ablation --repeats 7    # 70 runs, about 31 minutes, about $0.53
npm run eval -- --experiment reserve --repeats 7     # 70 runs, about 30 minutes, about $0.52
```

The budget-sensitivity batch, which raises the tool-call ceiling for both modes at once:

```bash
npm run eval -- --repeats 3 --max-tool-calls 25      # 60 runs, longer and dearer per run
```

Every one of these stops before spending anything if the pinned model has no token price in `config/pricing.json`, since an unpriced batch cannot enforce its cost budget.

## Step 6: a real repository

The ten fixtures are mine. This one is not.

```bash
bash examples/real-world-commander/prepare.sh
```

It clones [commander](https://github.com/tj/commander.js) at a pinned SHA, restores the one line commander itself had before it fixed a real bug, holds commander's own regression test out of the visible tree to serve as the oracle, prints a full diff of both edits, installs commander's devDependencies, and then shows you `npm run check` exiting zero and the oracle failing on the same tree. Needs network; the repair afterwards does not. About a minute.

```bash
npm run doctor -- diagnose examples/real-world-commander/repo \
  --mode advanced \
  --oracle-dir examples/real-world-commander/oracle \
  --max-tool-calls 20
```

[examples/real-world-commander/README.md](../examples/real-world-commander/README.md) states exactly which parts are upstream's and which are mine, and `RESULT.md` beside it records what happened when it was run.

## Determinism, and its limits

Deterministic: the fixtures, the reference repairs, the reference patches, the oracles, the tree checksums, the diff engine, the scoring, the report rendering. `fixtures verify` gives the same answer every time.

Not deterministic: the model. Temperature is zero and top-p is one, which reduces variance without removing it. Tool ordering, output truncation and provider-side changes all move results between runs. This is why `eval` defaults to three repeats and why the report shows per-repeat detail rather than only an average.

## Environment

| Variable | Effect |
| --- | --- |
| `OPENAI_API_KEY` | Required by `diagnose` and `eval`. Never passed into a sandbox. |
| `OPENAI_BASE_URL` | Any OpenAI-compatible endpoint. Read by the OpenAI SDK under the agents library, not by this project. Unset means OpenAI itself. |
| `REPRO_DOCTOR_MODEL` | Model for both modes. Default `gpt-4.1-mini`. Pin an exact version for a submitted run. |
| `REPRO_DOCTOR_RUNNER_IMAGE` | Sandbox image. Default `repro-doctor-runner:1`. |
| `REPRO_DOCTOR_EXECUTOR` | `docker` or `local-test-adapter`. Default `docker`. |
| `REPRO_DOCTOR_ALLOW_LOCAL_ADAPTER` | Must be `1` before the test adapter will start at all. |
| `REPRO_DOCTOR_PRICE_INPUT_PER_MTOK` | Input price per million tokens for the pinned model. Overrides `config/pricing.json`. |
| `REPRO_DOCTOR_PRICE_OUTPUT_PER_MTOK` | Output price per million tokens. |
| `REPRO_DOCTOR_ARTIFACTS_DIR` | Where artifacts go. Default `./artifacts`. Tests use a temporary directory. |
| `REPRO_DOCTOR_LOG_FORMAT` | `human` or `json` for the stderr log stream. |

`.env.example` lists the same set with comments. The CLI does not read `.env` files by itself; load them into your shell.

The published evaluation was produced through OpenRouter rather than OpenAI directly, which is why `config/pricing.json` carries the OpenRouter model id alongside the OpenAI ones:

```bash
export OPENAI_API_KEY=<your key>
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
export REPRO_DOCTOR_MODEL=openai/gpt-4.1-mini
```

Any OpenAI-compatible provider works the same way. The price for whatever model you pin has to be in `config/pricing.json`, or supplied through the two price variables, or the batch refuses to start.

## If something fails

**`the sandbox image repro-doctor-runner:1 is missing`.** Run `npm run docker:build`.

**`Docker is required for diagnose and is not available`.** The Docker daemon is not running, or your user cannot reach it. `diagnose` will not run repair commands on your host instead, by design.

**`sandbox.noNewPrivileges: false` in a result.** Your Docker rejects `--security-opt no-new-privileges`, which some installations do. Repro Doctor probes for it, drops the flag, and records that it did. The other protections are unaffected.

**A fixture fails `fixtures verify`.** That is a benchmark bug and the suite treats it as one. The oracle output in the command's `before` and `after` detail says which check failed.

**Tests pass but `fixtures verify` fails only under Docker.** Compare `node --version` inside the image with the version the tests used. The runner image pins Node 22 and TypeScript 5.9.3 for exactly this reason.
