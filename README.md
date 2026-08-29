# Repro Doctor

Repro Doctor takes a TypeScript repository that does not work, copies it into a sandbox, lets a model try to repair the copy, and then checks the result with an oracle the model never saw. What you get back is a patch with evidence attached: a trajectory of every command, the oracle's exit status, and a checksum proving the original repository was not touched.

The reason for the hidden oracle is simple. An agent that can see the test can make the test pass. Most "the agent fixed it" claims are really "the agent convinced itself it fixed it", and the two look identical in a transcript. Here the pass or fail signal comes from a program stored outside the workspace, mounted read-only, and run after the agent's session has ended.

The project also runs the same repair task two ways, so you can see whether the structure around a model is doing anything. Baseline gets a generic instruction and an unstructured loop. Advanced gets a deterministic preflight, a hypothesis ledger, a minimal-patch instruction, and one feedback retry driven by two independent signals: the repository's own check re-run under harness control, and the hidden oracle run against a fresh copy of the repaired tree. Both modes get the same model, repository, tools, budget and scorer. Advanced also spends more, one extra model turn and one extra oracle run, and [docs/EVALUATION.md](docs/EVALUATION.md) states that difference in a table rather than leaving you to find it.

## Requirements

- Node.js 22 or newer
- Docker, running, with permission to start containers
- An OpenAI API key for `diagnose` and `eval`. Everything else runs without one.

## Setup

```bash
npm install
npm run docker:build     # builds repro-doctor-runner:1, the sandbox image
npm test                 # 161 tests, no API key needed
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

Sixty runs, ten fixtures, three repeats per case per mode, `openai/gpt-4.1-mini`, Docker, 29 August 2026.

| | Baseline | Advanced |
| --- | --- | --- |
| Verified repair rate | 16/30, 53.3% (95% CI 36.1 to 69.8) | 22/30, 73.3% (95% CI 55.6 to 85.8) |
| Median wall clock | 25.2s | 25.3s |
| Median cost per run | $0.0072 | $0.0068 |
| Unsafe mutations, budget violations, oracle access violations | 0, 0, 0 | 0, 0, 0 |

Advanced minus baseline is **+20.0 points, 95% CI -4.2 to +41.2**. That interval includes zero, so thirty runs per mode show the direction and not the size. Saying otherwise would cost this project the only thing it is actually for.

Two things the batch does settle. The structure is not paid for in money: advanced repaired more and its median run was slightly cheaper, because a baseline failure spends all twelve tool calls while a successful advanced run stops earlier. And it changes which failures happen: baseline produced no patch at all in 6 of its 14 failures, advanced in 2 of its 8.

The clearest single case is `broken-test-discovery`, where the repository's own check exits zero while running zero tests. Baseline verified it once in three runs. Advanced verified it three times in three, on a retry that only the hidden oracle could have triggered.

The critic experiment ran too, and its pre-registered rule discarded it: 5 of 9 against 6 of 9, -11.1 points. It stays in the tree behind a flag, off by default, with the number next to it.

[docs/EVALUATION.md](docs/EVALUATION.md) has the per-case grid, the failure profile, the fairness contract and what is still unmeasured.

The default model is priced in `config/pricing.json`, with the page the number came from and the date it was read. A model without a price cannot run live: both `diagnose` and `eval` refuse it before the first API call because the cost budget could not be enforced, and the `cost-accounting` check rejects imported or stale live artifacts whose cost is unknown.

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
- [docs/IMPROVEMENT_CHANGELOG.md](docs/IMPROVEMENT_CHANGELOG.md), what shipped, what is planned, and what is measured
- [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
