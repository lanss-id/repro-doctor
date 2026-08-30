# Decisions

Each entry is a call I made, what I gave up, and what would change my mind.

## 1. The oracle is hidden, not just separate

**Decision.** The scorer lives outside the copied tree, is mounted read-only into a different container, and only runs after the agent's session has ended.

**Alternative.** Ship the test suite inside the repository and score on `npm test`. Much simpler.

**Why not.** An agent that can read the test can edit the test, and the transcript of a repair and the transcript of a laundered test look the same until you diff the tree. Hiding the scorer is the cheapest way to make the pass signal mean something.

**Cost.** More moving parts: a second container, a mount, an isolation check in the evaluator, and a rule that fixture authors have to follow.

**Would change my mind.** Nothing about the current scope. If the fixtures ever became repositories with real dependency graphs, I would keep the hidden oracle and add an in-repo suite as a separate, clearly labelled signal.

## 2. Docker is required, with no fallback

**Decision.** `diagnose` fails if Docker is not usable.

**Alternative.** Fall back to running on the host with a warning.

**Why not.** A fallback that triggers on a machine without Docker is a fallback that triggers on the machine you least want it to. The warning scrolls past, the run looks the same, and the result claims an isolation property it never had.

**Cost.** Repro Doctor does not run at all on machines without Docker, apart from the tests.

**How the test adapter stays honest.** It needs two explicit opt-ins, it stamps `productionSafe: false` on every result, and the evaluator's `production-sandbox` check fails those runs so they cannot be scored.

## 3. The advanced preflight is charged to the same budget

**Decision.** The three preflight commands come out of the same 12 tool calls the baseline has.

**Alternative.** Run preflight for free, on the grounds that it is harness work, not agent work.

**Why not.** Then advanced starts with information the baseline had to buy, and the comparison measures the head start rather than the method. If the structure is not worth three tool calls, I want the numbers to say so.

**Cost.** Advanced begins with a quarter of its budget spent, which will hurt it on cases needing wide exploration.

**Would change my mind.** If preflight turns out to be strictly better than what a model spends its first three calls on, "always preflight" stops being an experiment and becomes the default for both arms, and the comparison moves to something else.

### Evidence gates are scorer work, not agent calls

**Decision.** Tool calls are serial in both modes. A successful advanced patch checkpoints the repair turn and disables every model tool. The harness then runs the visible evidence gate and hidden oracle outside the agent tool counter, under the same wall-clock deadline. A failed signal may open one final repair turn if an agent call and patch attempt remain.

**Evidence.** In the first live `chained-two-faults` smoke run, advanced spent three calls on preflight, patched one fault, then consumed its remaining calls re-running and re-reading evidence. The promised retry never happened. Run `20260829T185749Z-1c9e05` ended at 12 calls with one fault still present. A regression reproduces the same pressure and proves the second patch can be call twelve while both scorer gates still execute.

**Why this boundary.** Preflight changes what the model knows, so charging it preserves fairness. Post-patch gates decide how the scorer judges a fixed tree; charging them would let evaluation consume the budget it is supposed to measure. Baseline's final oracle already lived outside that counter.

**Cost.** Advanced still gets more harness work and up to one extra model turn. The report states that difference directly, and both remain inside the same time and API-cost ceilings.

## 4. Whole-file writes instead of model-authored diffs

**Decision.** `propose_patch` takes complete file contents. The harness computes the unified diff afterwards.

**Alternative.** Have the model emit a unified diff and apply it.

**Why not.** Models are unreliable at hunk offsets and context lines, and a patch that fails to apply burns an attempt on a formatting mistake rather than a reasoning one. Since the harness owns the before state, it can produce a correct diff itself.

**Cost.** A one-line change to a large file costs a large tool call. There is a 64 KB per-file cap for this reason.

**Would change my mind.** An anchor-based edit tool ("replace this exact string once") would beat both, and is what I would build next.

## 5. Prices are configured, with their source, and unpriced models fail closed

**Decision.** `config/pricing.json` carries `gpt-4.1-mini` and `gpt-4.1-mini-2025-04-14` at $0.40 and $1.60 per million tokens, standard API rates, each with the page it came from and the date a human read it. Every live `diagnose` or evaluation run refuses an unpriced model before its first API call. Imported or stale artifacts can still represent an unknown cost, but the evaluator's `cost-accounting` check prevents them from counting as verified.

**Alternative one.** Ship no prices at all. That was the earlier decision here, and it made every cost column read "unknown" out of the box, which is honest but useless.

**Alternative two.** Ship prices with no provenance.

**Why this one.** A price is a fact with an expiry date. Recording `sourceUrl` and `verifiedOn` in the schema turns "is this number still right" into something a reviewer can check in a minute instead of a question nobody asks. And failing closed matters more than the price itself: a run that cannot enforce its cost budget should not call the model, while the `cost-accounting` check protects evaluation integrity when older artifacts are imported.

**Cost.** The numbers will go stale. The `verifiedOn` date is there so that staleness is visible rather than silent, and EVALUATION.md says to recheck before quoting a cost.

## 6. Unmeasured is null, everywhere

**Decision.** Rates, medians and token counts are `null` when nothing was measured, and the report prints "pending".

**Alternative.** Default to zero, which is simpler to render.

**Why not.** Zero and unmeasured look identical in a table and mean opposite things. A test asserts the report never renders `0.0%` for an unmeasured rate.

**Cost.** Nullable fields, and slightly noisier rendering code.

## 7. Our own diff and patch engine

**Decision.** `src/infra/diff/unified.ts` implements diff, parse and apply, with exact context matching and no fuzz.

**Alternative.** Shell out to `git apply`, or take a dependency.

**Why not.** The workspaces are not git repositories, so `git apply` would need `git init` scaffolding on every run. And the applier is the one place where being clever damages a real repository: a relocated hunk is a silent corruption. Ours refuses instead. The dependency count stays at two, which matters for a tool people are asked to trust with their code.

**Cost.** About 400 lines to write and test, including the trailing-newline case that produces an empty diff if you are not careful. There is a test for it because I got it wrong first.

## 8. Fixtures with no dependencies

**Decision.** No fixture requires `npm install`. TypeScript comes from the runner image; anything else is vendored.

**Alternative.** Realistic repositories with real dependency trees.

**Why not.** The sandbox has no network during repair, which is a safety property I did not want to trade. Vendoring keeps the whole benchmark runnable offline and makes `fixtures verify` fast enough to run on every change.

**Cost.** The faults are configuration and contract faults rather than dependency-resolution faults. `manifest-lockfile-mismatch` recovers part of that with a vendored `file:` dependency and a genuinely out-of-sync lockfile.

**Second cost.** Fixture TypeScript cannot use Node's standard library, since `@types/node` is not installed. Anything touching Node APIs lives in a `.mjs` script instead. Slightly artificial, and worth it.

## 9. Tracing is off

**Decision.** `setTracingDisabled(true)` in the model driver.

**Why.** Repository contents pass through this agent. Uploading them to a trace backend by default is not something a repair tool should do without being asked. The trajectory file is the local equivalent, and it is redacted.

**Cost.** No provider-side traces. Turn it on deliberately if you want them.

## 10. The `no-new-privileges` probe

**Decision.** Probe once per image whether Docker accepts `--security-opt no-new-privileges`. If not, drop the flag and record `sandbox.noNewPrivileges: false` in every result.

**Alternative one.** Always pass it, and fail on hosts that reject it. On the machine this was built on, that means nothing runs at all: the container cannot exec its entrypoint.

**Alternative two.** Drop it quietly.

**Why this one.** Alternative two is the thing this project exists to argue against. A degraded security posture that is written into the artifact is a fact a reviewer can weigh. One that is not written down is a lie by omission.

## 11. The critic agent is runnable, and still an experiment

**Decision.** No critic in either published mode. It is a treatment behind `npm run eval -- --experiment critic`, which runs advanced control against advanced with a critic over the three hardest fixtures and applies a rule fixed in advance: keep it only for at least +10 percentage points of verified repair rate at no more than +25 percent cost.

**Alternative.** Leave it as prose in a changelog.

**Why not.** A planned experiment nobody can run is a wish. Making it executable costs one flag and one extra driver, and it means the decision rule can be checked against real numbers the moment a key exists. The critic call is charged one tool call and its tokens accumulate into the same budget, so the treatment competes on equal terms rather than getting a free second opinion.

**Why the rule exists in writing.** A second model call is easy to justify after the fact, whichever way the numbers land. `decideExperiment` in `src/eval/scoring.ts` implements it, refuses to decide when either side is unmeasured, and has tests for both thresholds. No outcome is claimed: see [IMPROVEMENT_CHANGELOG.md](IMPROVEMENT_CHANGELOG.md).

## 12. Both signals drive the one retry

**Decision.** After the first advanced attempt, the harness runs the repository's own check *and* the hidden oracle, on a fresh copy, and either failing triggers the single retry. The oracle's sanitized findings go back to the model as evidence.

**Alternative.** Gate only on the visible check, keeping the oracle purely as an end-of-run scorer.

**Why not.** `broken-test-discovery` is the counterexample: its check exits zero while running zero tests. A gate built on the visible check alone approves a patch that repaired nothing, and the retry never fires precisely when it is most needed.

**What this costs, and what I will not pretend.** Advanced gets one extra oracle execution and one extra model turn that baseline never gets. That is a real resource difference, stated as a table in EVALUATION.md rather than buried. The oracle's *code* stays invisible: only pass and fail lines, scrubbed of every path, cross back.

**Would change my mind.** If the sanitized findings turn out to be enough for a model to reverse-engineer the oracle and target it, the feedback would have to shrink to a bare "verification failed", losing most of its value.

## 13. repair.patch is exact, everything else is redacted

**Decision.** The patch file is written verbatim, its SHA-256 is taken over those bytes, and `patch.sensitive: true` goes into the result. The HTML report and published examples use a redacted view.

**Alternative.** Redact the patch too, for consistency.

**Why not.** It was consistent and broken: the checksum was computed over the exact diff while the file on disk was redacted, so any patch containing a secret-shaped string would fail its own integrity check and refuse to apply. A patch is not a log. It is an artifact whose value is being byte-exact.

**Cost.** One artifact per run that may carry repository content and has to be reviewed before it is published. SECURITY.md says so, `result.json` says so in the data, the report page says so on the page, and the example script enforces a mechanical version of the rule.

## 14. The agent is shown the budget it actually has

**Decision.** Every tool result ends with a `[budget]` line naming the tool calls and patch attempts the current turn may still spend. In advanced mode the preflight report states what it spent, and the harness holds one call back for the evidence-driven retry, releasing it only when that retry begins. The retry's feedback message names the number of calls left and tells the agent to spend them on `propose_patch`.

**Alternative.** State the total once in the instructions and let the model count. That is what the first live smokes did.

**Why not.** The instructions said "you have at most 12 tool calls" while the advanced preflight had already spent 3 before the model read a word, so the sentence was false from the first turn. Three live runs on `chained-two-faults` showed what that costs: one arrived at the correct diagnosis on call 13 and had it refused, one landed its first patch on call 12 and left the promised retry with nothing to spend, and one reached the retry and used its single remaining call to re-read a file it had already read. None of those was a reasoning failure. The agent was planning against numbers that were not true.

**Cost.** The budget line is in every tool result, so it costs tokens on every call, and the reservation takes one investigation call away from the first turn. Both modes get the same line from the same function, so the comparison is unaffected. The reservation is advanced-only because the retry is advanced-only, and it partitions the twelve calls rather than raising them: `tests/integration/advanced-retry.test.ts` asserts that an agent which spends every call it is offered still finishes at twelve.

## 15. The caller can name the check, and the SDK ceiling follows the budget

**Decision.** `--check-command` overrides the command resolved from the manifest, for both modes and the evidence gate at once. And `maxTurns`, the SDK's own ceiling on agent turns, is derived from the tool-call budget instead of being fixed at 16, with a floor that leaves every batch at the published 12-call budget byte-identical.

**Alternative.** Keep resolving the check from `package.json` and keep the ceiling fixed. It worked on all ten fixtures.

**Why not.** It worked on all ten fixtures because I wrote all ten fixtures. The first time this tool was pointed at a repository somebody else wrote, both assumptions broke inside three minutes.

commander's `check` script runs `eslint` and `prettier` alongside the type check. In a sandbox with no network those report on whether its devDependencies are installed, which is a fact about the harness and not about whether the library works. The agent spent sixteen of nineteen calls chasing a missing `@types/node` that the workspace copy had removed on the way in.

The ceiling was worse, because it was a lie rather than a wrong answer. A run given `--max-tool-calls 25` was told it had 25 in every `[budget]` line and was stopped by the SDK at 19. That is the same defect as decision 14, in a place decision 14 did not look, and the benchmark could never have found it: at the default budget, 3 preflight calls plus 12 agent calls never reaches 16 turns.

**Cost.** Two more things a caller can get wrong, and a settings fingerprint that now varies with the budget. The fingerprint is written into every result, so a test asserts it is unchanged at the published budget; if that test ever fails, every published measurement has become incomparable and the failure says so.

## 16. An installed copy writes its runs beside your repository

**Decision.** `npx github:lanss-id/repro-doctor` installs and builds through a `prepare` script. An installed copy writes artifacts to `.repro-doctor/` in the working directory rather than to `artifacts/` under its own package root. `REPRO_DOCTOR_ARTIFACTS_DIR` overrides both.

**Alternative.** Keep one rule: artifacts always live under the project root.

**Why not.** Under `npx` the project root is a cache directory npm is free to clear. Every run's evidence would be written somewhere the operator cannot find, and `apply <run-id>` would break the moment `diagnose` returned, which is the one workflow this tool exists for.

**Cost.** Two locations instead of one, decided by whether the package path contains `node_modules`. It is a pure function with its own test rather than a condition buried in an accessor, because a rule about where evidence goes is worth being able to read.

**Not published to npm.** The competition this was built for takes ownership of submissions, so claiming a registry name is not mine to do. A git install needs no registry entry, and `private: true` stays in the manifest so a publish cannot happen by accident.
