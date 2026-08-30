# Example artifacts

Eight committed artifacts, so the claims in this repository can be read rather than believed. Every run below used `openai/gpt-4.1-mini` in the Docker sandbox with the default budget of 12 tool calls, 2 patch attempts, 360 seconds and a $0.30 ceiling. Paths are replaced with placeholders; nothing else is edited.

| Directory | Agent | Case | Outcome | Why it is here |
| --- | --- | --- | --- | --- |
| [`live-run/`](live-run) | advanced | `chained-two-faults` | repaired | The hardest fixture, solved |
| [`retry-run/`](retry-run) | advanced | `tsconfig-include-scope` | repaired | The evidence-driven retry, start to finish |
| [`baseline-run/`](baseline-run) | baseline | `broken-test-discovery` | no patch | How the control arm characteristically fails |
| [`critic-run/`](critic-run) | advanced with the critic | `broken-test-discovery` | repaired | The experimental treatment that was discarded |
| [`byo-oracle-run/`](byo-oracle-run) | advanced | not a fixture | patch rejected by the oracle | The user path, with a user-written oracle |
| [`apply-session.txt`](apply-session.txt) | none, this is the human checkpoint | — | applied after review | What a person sees before anything is written |
| [`video-run/`](video-run) | advanced | `entrypoint-mismatch` | repaired | The run the submission video shows being made |
| [`video-run-rejected/`](video-run-rejected) | advanced | `entrypoint-mismatch` | patch rejected by the oracle | The attempt before it, on the same case, kept for the same reason |
| [`run/`](run) | scripted stand-in | `entrypoint-mismatch` | repaired | The artifact shapes, reproducible with no API key |

## live-run: the hardest fixture

Run `20260830T061056Z-e32fc9`, advanced, repaired and verified, 12 tool calls, 1 patch attempt, 31.7 seconds, $0.010403.

`chained-two-faults` hides two faults behind one error. The package entry point names a file the build never emits, and until that is fixed nothing can reveal the second fault: the source reads `APP_GREETING` while the repository's own README and smoke script say the variable is `GREETING`. The visible error only ever shows the first fault.

This run found both in one patch. `evidence.gate` and the hidden oracle then both passed on the first attempt, so the retry was never spent. `retry-run/` is there for the case where it is.

What is not in the file matters as much: no path to the oracle, no oracle source, no API key. `result.json` records `treeChecksumBefore` equal to `treeChecksumAfter`, so the fixture repository itself was never touched, and `sandbox.oracleMountedDuringRepair` is `false`.

## retry-run: the loop that the whole design is about

Run `20260830T062910Z-e87630`, advanced, repaired, 9 tool calls, 2 patch attempts, $0.007532. Read `trajectory.jsonl` in order:

| Event | What happens |
| --- | --- |
| seq 2 to 6 | The deterministic preflight: list the root, read the manifest, run the project's own check |
| seq 9 to 15 | Four investigation calls, each result ending with the live `[budget]` line |
| seq 17, 18 | `propose_patch`, accepted, and the checkpoint closes every model tool |
| seq 20 | The agent returns its hypothesis ledger and stops, as instructed |
| seq 21 | `evidence.gate`: the harness re-runs `npm run check` itself. It fails |
| seq 23 | `verification.completed`, stage `interim`: the hidden oracle also fails |
| seq 24 | The one feedback message, `role: user`. This is the event that changed the next step |
| seq 25, 26 | The second and last patch attempt, paid for by the reserved tool call |
| seq 29, 32 | `evidence.gate` passes, then the oracle passes, and the run is scored `repaired` |

The feedback at seq 24 carries the oracle's sanitized `PASS` and `FAIL` lines and nothing else: no path, no source, no hint of where the oracle lives.

## baseline-run: how the control arm loses

Run `20260830T060402Z-95ef4b`, baseline, no patch, 12 tool calls, $0.007773.

`broken-test-discovery` is the case where the repository's own check exits zero while running zero tests. The baseline agent investigated for twelve calls, worked out that the test glob does not match the files, and then had its first `propose_patch` refused at call thirteen: `patch.attempt` at seq 27 records `accepted: false, budget limit reached: tool-calls`.

Worth noting honestly, because it is the limit of a fix this project shipped: this agent read a live `[budget]` line on every one of those twelve results and still spent its last call reading. Telling an agent what it has left helps, and it does not make the failure go away.

One trajectory is not a summary. Baseline verified 14 of its 30 runs overall; the per-case grid is in [docs/EVALUATION.md](../../docs/EVALUATION.md).

## critic-run: the treatment that lost

Run `20260830T063122Z-0a1cc1`, advanced with the critic enabled, repaired, 12 tool calls, $0.006946. The `critic.reviewed` event at seq 30 shows the critic approving the patch with its reason.

The critic worked mechanically and still lost its experiment: 1 of 9 against the control's 4 of 9, which the rule fixed in advance turned into a discard. It is published because a discarded experiment with its trajectory is worth more than one described in prose.

## byo-oracle-run: the user path

Run `20260830T060136Z-7a08e1`, advanced, patch produced and rejected by the oracle, 11 tool calls, 2 patch attempts, $0.011117.

This is not a fixture. The repository is [`examples/bring-your-own-oracle/repo`](../../examples/bring-your-own-oracle), and the oracle was supplied with `--oracle-dir`, which is how anyone points this tool at their own code.

The agent rewrote a duration parser to accumulate every unit and to reject trailing junk. Five of the six contract checks passed. The sixth did not: `parseDuration("")` returns 0 instead of throwing. The repository's own tests pass on this patch, the agent's ledger says the fault is fixed, and the run is still reported as `unverified-patch` because the oracle disagreed. That gap is the entire product.

## video-run and video-run-rejected: the run in the video, and the one before it

Runs `20260830T205502Z-0a731f` and `20260830T205332Z-603341`, both advanced, both on `entrypoint-mismatch`, recorded twenty seconds apart. The first produced a patch the hidden oracle rejected. The second produced a one-line patch the oracle passed, and that is the run [`video/`](../../video) records and shows.

Two runs are here rather than one because the video selects. `video/recordings/03a-attempts.json` lists every attempt with its outcome, and both are published so the list can be checked rather than taken.

The case matters to how this reads. `entrypoint-mismatch` scored 7 of 7 for advanced mode in the confirmatory batch, and it still failed on the first draw here. Nothing changed between the two runs: same repository, same mode, same model at temperature zero. It is the variance the evaluation spends thirteen point three points measuring, arriving unannounced in a demo.

## apply-session.txt: the human checkpoint

Three attempts against the `live-run` patch, in one transcript: the whole diff printed before anything is asked, a piped answer refused because a confirmation has to come from a person at a terminal, a target that changed during the review refused on its checksum, and finally a clean target patched with the approval flag that says out loud that a human read it.

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
