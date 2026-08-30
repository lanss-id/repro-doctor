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

Expected: no output from typecheck or lint, and `pass 163` from the tests. The suite takes about a minute, most of it real subprocesses.

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

```bash
npm run eval -- --repeats 3
npm run report
open artifacts/report/index.html
```

Sixty runs. Measured on the machine that produced the published result: **26.8 minutes of wall clock and $0.4262** of model spend, with a median of 25 seconds and $0.0073 per run. The per-run ceiling is 360 seconds, so a pathological batch could take six hours, but none has come close.

See [EVALUATION.md](EVALUATION.md) for what the numbers mean and how many of them you should believe.

To run the critic experiment instead, eighteen runs over the three hardest fixtures, scored by the rule fixed in advance:

```bash
npm run eval -- --experiment critic --repeats 3
```

Eighteen runs, about 8 minutes, about $0.13.

Both commands stop before spending anything if the pinned model has no token price in `config/pricing.json`, since an unpriced batch cannot enforce its cost budget.

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
