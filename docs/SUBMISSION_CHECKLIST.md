# Submission checklist

**Deadline: 31 August 2026, 18:00 UTC.**
**Internal package-ready target: 31 August 2026, 15:00 UTC.**

The three hour gap is not slack, it is for the things that always go wrong at the end: a video re-record, a broken link, a machine that turns out not to have Docker. Treat 15:00 as the deadline and 18:00 as the buffer.

## Done

Everything in this section has been run in this repository.

### Code

- [x] TypeScript on Node 22 with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- [x] `npm run typecheck` clean
- [x] `npm run lint` clean, with `any` and stray `console` calls banned
- [x] `npm test`: 0 failures, no API key or network needed after dependencies are installed
- [x] `npm run build` produces a working CLI at `dist/src/cli/index.js`
- [x] Two runtime dependencies: `@openai/agents` and `zod`, both pinned exactly, `package-lock.json` committed

### Commands

- [x] `npm run doctor -- diagnose <repo> --mode baseline|advanced`
- [x] `npm run doctor -- apply <run-id> --to <repo>`
- [x] `npm run eval -- --repeats 7`
- [x] `npm run eval -- --experiment critic|ablation --repeats 7`
- [x] `npm run eval -- --repeats 3 --max-tool-calls 25`
- [x] `npm run doctor -- replay <evidence-bundle>`
- [x] `npm run report`
- [x] `npm test`
- [x] `npm run doctor -- fixtures list|verify|patches` for benchmark maintenance

### Artifacts

- [x] `result.json`, `trajectory.jsonl`, `repair.patch`, `verification.log`, `report.html` under `artifacts/runs/<run-id>/`
- [x] Runtime artifacts gitignored
- [x] A sanitized example run committed under `submission/examples/`

### Safety

- [x] Input repository never mutated, proven by checksums in every result
- [x] Docker by default with no silent fallback; the test adapter needs two explicit opt-ins and stamps `productionSafe: false`
- [x] No network during repair, no Docker socket, no host mounts beyond the workspace, no secrets in the sandbox
- [x] Resource limits, a per-command timeout, a tool-call limit, a patch-attempt limit, a cost budget, and one run deadline covering model calls, tools, the retry and verification
- [x] Hidden oracles outside the agent-readable workspace, mounted read-only only during verification; the retry sees sanitized findings, never the oracle's code or location
- [x] `apply` requires a preview, a target checksum match, a re-check immediately before writing, and typed confirmation; the non-interactive flag is `--yes-i-reviewed-the-patch`
- [x] Secret redaction on the write path, with tests. `repair.patch` is exact by design, marked `sensitive`, and documented as requiring review before publication
- [x] Path traversal and symlink escape refused, with tests, including a target symlink that would otherwise create a directory outside the repository

### Benchmark

- [x] Ten fixtures with manifests, lockfiles, metadata, hidden oracles and reference repairs
- [x] Every fixture fails before its reference repair and passes after it, verified under Docker and under the local adapter
- [x] Reference patches generated from the reference repairs, not written by hand
- [x] The evaluator checks oracle access, source immutability, budget compliance, verification exit status, the semantic oracle and the sandbox

### Documentation

- [x] `README.md`, `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`
- [x] `docs/REPRODUCTION.md`, `docs/ARCHITECTURE.md`, `docs/EVALUATION.md`
- [x] `docs/IMPROVEMENT_CHANGELOG.md` with every iteration, every measured result, and the experiments that were thrown away
- [x] `docs/PREREGISTRATION.md`, committed and pushed before the batch it governs started
- [x] `docs/DECISIONS.md`, `docs/VIDEO_SCRIPT.md`, this file
- [x] Every experiment's decision rule written down before it ran, and runnable: `npm run eval -- --experiment critic|ablation`. The critic keeps only for at least +10 percentage points at no more than +25 percent cost; the ablation calls the retry load-bearing only if the interval on the difference excludes zero, and reports `unresolved` rather than a verdict when it cannot tell
- [x] Token prices configured for the default model with their source and verification date; unpriced models fail closed
- [x] `.env.example` with no secrets in it

### Evaluation

- [x] Pre-registration written, committed and pushed before the batch it governs ran: [PREREGISTRATION.md](PREREGISTRATION.md), three experiments, sample sizes, hypotheses, decision rules, and what would falsify the project's central claim
- [x] 140-run confirmatory comparison, ten fixtures, both modes, seven repeats: baseline 42/70, advanced 51/70, difference +12.9 points with a 95% CI of -2.8 to +27.6
- [x] **The pre-registered hypothesis was not confirmed**, and the README leads with that rather than with the point estimate
- [x] The pre-registered secondary hypothesis was not confirmed either: neither difficulty stratum separates
- [x] The post-hoc +40 point subgroup effect from the exploratory batch tested and found to be noise: baseline went from 0/15 to 11/35 on the same five cases
- [x] Run-to-run variance measured three times on an identical arm: 53.3%, 46.7%, 60.0%, a spread of 13.3 points against an effect of 12.9
- [x] 60-run exploratory batch published in full alongside the batch that replaced it
- [x] 18-run critic experiment, decided by its pre-registered rule: discard, run twice and negative both times
- [x] Zero unsafe mutations, zero budget violations and zero oracle access violations across all 200 scored runs
- [x] Every rate published with its interval, and every difference with a Newcombe interval, including the ones that make the project look worse
- [x] Two pre-registered ablations, 140 runs, the only intervals in the project that exclude zero: removing the retry design costs +34.3 points (95% CI +16.1 to +51.0), removing only its second turn costs +25.7 (95% CI +3.3 to +44.9)
- [x] The second ablation exists because the first one's registered reasoning was wrong in the direction that inflates the effect, which is recorded rather than corrected in place
- [x] Advanced mode on hard faults measured four times on unchanged code: 40.0%, 45.7%, 37.1%, 48.6%
- [x] A case where advanced mode is worse than baseline, `monorepo-build-order` at 1/7 against 6/7, published rather than dropped
- [x] Two 60-run batches discarded and re-run rather than published: one after it exposed a cost-accounting bug, one after an instruction change made its advanced arm stale
- [x] `config/pricing.json` carries the OpenRouter route used for the published run, verified on 2026-08-30

### Reproducibility

- [x] Every run behind every published number committed under `submission/evidence/`: 358 runs across five bundles
- [x] `npm run doctor -- replay submission/evidence/confirmatory` recomputes all 140 runs, all seven checks each, with no API key, no model call, no Docker and no network, and exits non-zero on a single disagreement
- [x] CI runs that replay on every push, so a document drifting from its evidence fails the build
- [x] Installable with `npx github:lanss-id/repro-doctor`, with runs written beside the repository rather than into the npx cache
- [x] The exploratory bundle replays to 14/30 and 21/30, proving the scorer did not drift under the results it produced
- [x] A test computes the headline numbers from the committed bundle and fails if `README.md` or `docs/EVALUATION.md` quotes a different one
- [x] A test pins the digest of the instruction text every published rate was measured against
- [x] Reproduction guide carries measured runtime and cost for every command, not worst cases

### Submission package

- [x] Complete solution code, tests, and a clearly labelled improvement changelog with a stage table in the shape the brief asks for
- [x] Reproduction guide with exact setup, run, baseline and evaluation commands, versions, expected output, runtime and cost
- [x] A representative trajectory for every agent used: baseline, advanced, advanced with the retry, advanced on the user path, advanced on a real third-party repository, the ablated advanced arm, and the critic
- [x] The human checkpoint recorded as a transcript, including the two refusal paths
- [x] Coding-agent use disclosed, with what pre-existed the competition stated explicitly, in [AGENT_USE.md](AGENT_USE.md)
- [x] A worked example of pointing the tool at a repository outside the benchmark with a user-written oracle
- [x] A worked example on a real third-party repository where neither the fault nor the oracle was written by the author: [`examples/real-world-commander/`](../examples/real-world-commander)
- [x] The video, 4:55 against a five minute limit, built by [`video/`](../video) rather than filmed: the terminal is a real pty capture, every figure is recomputed from the committed runs by the project's own scoring code, and the build refuses a highlight around text the recording never printed or a timeline over the limit. Two things in it are synthetic and both are declared on screen and in [`video/README.md`](../video/README.md): the keystroke timing at the prompt, and the removal of idle waits, which the terminal's title bar reports in seconds. The voice is generated, reading the script word for word, and both takes of every section are committed with the one that was kept

## Not done, and honestly so

- [ ] **A sample large enough to settle the difference.** 70 runs per mode cannot resolve 13 points. It needs about 206 runs per arm, roughly 420 runs and $3.30 at the measured cost per run, which exceeded the model credit available for this submission. The number is written into `docs/EVALUATION.md` so nobody has to derive it again.
- [ ] **E2 and E3.** Written with decision rules, not built.
- [ ] **E7, the budget-sensitivity batch.** Registered, then not run: the model credit ran out and the third ablation arm was worth more with what remained. Its design stays written down. A defect found while preparing the real-repository example would also have invalidated it as registered, and that is recorded next to it.
- [ ] **`read_file` has no offset or length.** On a 2,787 line source file it returns four per cent. It is why the commander run failed, and fixing it changes the tool set every published measurement was taken against.
- [ ] **More than one repository outside the benchmark.** There are two worked examples, one synthetic and one real, and neither is a rate.
- [ ] **More than one model, one provider, one machine.**
- [ ] **The cost-accounting defect on the `budget-exhausted` path.** Found by the confirmatory batch, deliberately not fixed while the batches being compared were still running, because the pre-registration forbids it and two batches have already been discarded for breaking that rule.

## Before 15:00 UTC on 31 August

The evaluation work in this list is done. What is left:

- [x] `npm run typecheck && npm run lint && npm test` in the working tree: clean, 201 tests, 0 failures
- [x] No real credential in any tracked file. The only secret-shaped strings are the synthetic fixtures the redaction tests are built from
- [x] Every relative link in every tracked markdown file resolves, and every asset and anchor the landing page references exists
- [x] `npm run doctor -- replay submission/evidence/confirmatory` exits zero, and CI re-runs it on every push
- [x] `git status --porcelain` clean, with `artifacts/` gitignored and the run behind the video published under `submission/examples/` instead
- [ ] `npm ci && npm run typecheck && npm run lint && npm test` on a clean clone
- [ ] Walk `docs/REPRODUCTION.md` on a machine that has never run this, following it literally
- [ ] Read `README.md` top to bottom as someone who has never seen the project

## The rule for the last hour

The batch is done, so the temptation has changed shape again. It is no longer "quote a number you do not have" or even "quote the number without the interval". It is **"lead with the point estimate because the interval is disappointing"**.

Advanced beat baseline by 12.9 points and the 95 percent interval on that difference runs from -2.8 to +27.6. It includes zero. The pre-registration, written before the batch and pushed before it started, says a null result gets the same prominence as a positive one. So the README leads with the null result, the landing page's headline chart shows an interval crossing zero, and the video says it out loud.

The same discipline applies to the two findings that came out of it and are genuinely good: the +40 point subgroup effect that evaporated, and the identical arm that scored 53.3, 46.7 and 60.0. Neither is a way of changing the subject. They are what the batch actually produced, and they happen to be more useful than the result the project was hoping for.

A submission that reports a real measurement with its uncertainty is worth more than one that rounds the uncertainty away. A submission that reports its own hypothesis failing is worth more still, because almost nobody does it, and because the entire argument of this project is that an agent's claim about itself is worth nothing without an independent check. Dropping that in the last hour would be the loudest possible admission that the argument was never serious.
