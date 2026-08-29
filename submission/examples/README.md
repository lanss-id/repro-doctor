# Example artifacts

Two complete sets of run artifacts, committed so you can read the output without running anything.

- `run/` is produced by a scripted stand-in for the model, so anyone can regenerate it with no API key.
- `live-run/` is a real `openai/gpt-4.1-mini` run on the hardest fixture, kept because the retry loop is the part of this project a reader has most reason to doubt.

## live-run: what a real model did

Run `20260829T194032Z-42c6b5`, `chained-two-faults`, advanced mode, Docker sandbox, repaired and verified, 40.2 seconds, $0.010387 measured.

`chained-two-faults` hides two faults behind one error. The package entry point names a file the build never emits, and until that is fixed nothing can reveal the second fault: the source reads `APP_GREETING` while the repository's own README and smoke script say the variable is `GREETING`. One patch cannot be enough, and the visible error only ever shows the first fault.

Read `trajectory.jsonl` in order and the whole loop is there in 40 events:

| Events | What happens |
| --- | --- |
| 3 tool calls | The deterministic preflight: list the root, read the manifest, run the project's own check |
| 7 tool calls | The model investigates, and every result it reads ends with the live `[budget]` line |
| call 11 | `propose_patch` fixes the entry point, and the checkpoint closes every model tool |
| `evidence.gate` | The harness re-runs `npm run check` itself: still failing |
| `verification.completed`, stage `interim` | The hidden oracle runs on a fresh copy and reports that `GREETING` is still ignored |
| call 12 | The one reserved retry call patches the environment contract |
| `evidence.gate`, then stage `final` | Both independent checks pass, and the run is scored `repaired` |

What is not in that file matters as much: no path to the oracle, no oracle source, and no API key. The feedback the model received carries the oracle's sanitized `PASS` and `FAIL` lines and nothing else. `verification.log` names the oracle because it is the harness's own record, written outside the sandbox after the agent's session ended.

`result.json` records `treeChecksumBefore` equal to `treeChecksumAfter`, so the fixture repository itself was never touched, and `sandbox.oracleMountedDuringRepair` is `false`.

## run: how the scripted example was produced

```bash
npm run build && node scripts/make-example-run.mjs
```

Real Docker sandbox, real preflight, real patch engine, real hidden oracle, real checksums. The one part that is not real is the model: a scripted stand-in proposes the patch, so the example can be regenerated on a machine with no API key.

The artifacts say so themselves rather than relying on this file:

- `result.json` records `"model": "scripted-example-driver"`.
- `usage.tokens` is `null` and `usage.cost` is `{"kind": "unknown", "why": "no-usage-reported"}`, because nothing was spent.
- The evaluator's `production-sandbox` check fails any run whose model name starts with `scripted`, so this run could never be counted as a verified repair in a score.

The only edit after the run is sanitization: the checkout path was replaced with `/example/repro-doctor`. Secrets are already redacted on the write path for every artifact except the patch.

`repair.patch` is stored exact, because its checksum and `apply` depend on byte equality, so it is the one file that could carry repository content verbatim. The generator applies a mechanical rule: it publishes the exact patch only when the redactor finds nothing in it, and otherwise publishes `repair.patch.redacted` and leaves the exact file local. For this run the exact patch was published, and its SHA-256 still matches the one in `result.json`, which you can check:

```bash
shasum -a 256 submission/examples/run/repair.patch
```

## What to look at

| File | Worth noticing |
| --- | --- |
| `result.json` | `repo.treeChecksumBefore` equals `repo.treeChecksumAfter`, so the input repository was untouched. `sandbox` records the exact isolation the run had, including `noNewPrivileges: false` on the machine this was recorded on. |
| `trajectory.jsonl` | Twenty events in order: three preflight tool calls, the patch attempt, the evidence gate re-running `npm run check` under harness control, then the independent verification. Its `stage` is `interim`, the run that would have driven a retry had it failed; because it passed and nothing was patched afterwards, it is also the final verdict and no second oracle execution was spent. |
| `repair.patch` | One line changed. Exact bytes, marked `sensitive` in `result.json`. |
| `verification.log` | The hidden oracle's five checks and its exit code. This is what decided the outcome. |
| `report.html` | The single-run page, generated from `result.json`, with the patch shown redacted. |

## What is not here

The evaluation artifacts. The 60-run comparison and the 18-run critic experiment did run, and their numbers are in [docs/EVALUATION.md](../../docs/EVALUATION.md), but `artifacts/` is gitignored: 186 run directories carry repository contents and exact patches, and committing them to make a point about transparency would be the wrong trade. Regenerate them with `npm run eval -- --repeats 3` and `npm run report`.
