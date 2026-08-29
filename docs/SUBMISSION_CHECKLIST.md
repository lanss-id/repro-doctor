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
- [x] `npm test`: 161 tests, 0 failures, no API key or network needed after dependencies are installed
- [x] `npm run build` produces a working CLI at `dist/src/cli/index.js`
- [x] Two runtime dependencies: `@openai/agents` and `zod`, both pinned exactly, `package-lock.json` committed

### Commands

- [x] `npm run doctor -- diagnose <repo> --mode baseline|advanced`
- [x] `npm run doctor -- apply <run-id> --to <repo>`
- [x] `npm run eval -- --repeats 3`
- [x] `npm run eval -- --experiment critic --repeats 3`
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
- [x] `docs/IMPROVEMENT_CHANGELOG.md` with shipped work, planned experiments and an empty measured-results section
- [x] `docs/DECISIONS.md`, `docs/VIDEO_SCRIPT.md`, this file
- [x] The critic-agent decision rule written down before the experiment, and runnable: `npm run eval -- --experiment critic`, keep only for at least +10 percentage points at no more than +25 percent cost
- [x] Token prices configured for the default model with their source and verification date; unpriced models fail closed
- [x] `.env.example` with no secrets in it

### Evaluation

- [x] 60-run comparison, ten fixtures, both modes, three repeats: baseline 16/30, advanced 22/30, difference +20.0 points with a 95% CI of -4.2 to +41.2
- [x] 18-run critic experiment, decided by its pre-registered rule: discard
- [x] Zero unsafe mutations, zero budget violations and zero oracle access violations across all 60 runs
- [x] Every rate published with its interval, and the comparison published with a Newcombe interval for the difference
- [x] The first 60-run batch was discarded after it exposed a cost-accounting bug in the harness, the bug was fixed, and both the discarded batch and the fix are recorded in the improvement changelog
- [x] `config/pricing.json` carries the OpenRouter route used for the published run, verified on 2026-08-30

## Not done, and honestly so

- [ ] **E2, E3 and E4.** Written with decision rules, not built. E4 did not trigger: its rule fires between 5 and 15 points and the measured difference was 20.
- [ ] **Anything outside the ten fixtures.** No real-world repository, one model, one provider, one machine.
- [ ] **Video.** Script written, not recorded.

## Before 15:00 UTC on 31 August

The evaluation work in this list is done. What is left:

- [ ] `npm ci && npm run typecheck && npm run lint && npm test` on a clean clone
- [ ] Walk `docs/REPRODUCTION.md` on a machine that has never run this, following it literally
- [ ] `git status --porcelain` clean, and no `artifacts/` in the tree
- [ ] `grep -ri "sk-" --include="*.json" --include="*.md" .` finds nothing real
- [ ] Every internal link in the docs resolves
- [ ] Record the video against the script, which now ends on the measured result rather than on a pending one
- [ ] Read `README.md` top to bottom as someone who has never seen the project

## The rule for the last hour

The evaluation ran, so the temptation changes shape. It is no longer "quote a number you do not have", it is "quote the number without the interval". Advanced beat baseline by 20 points and the 95% interval on that difference runs from -4.2 to +41.2. Every place that says 20 points has to say the interval too, including the video and anything written in a submission form.

The same applies to the critic: its rule discarded it, and "the critic did not help" is the claim. "The critic hurts" is not, because nine runs per arm cannot support it.

A submission that reports a real measurement with its uncertainty is worth more than one that rounds the uncertainty away. The entire project is an argument for that position, and dropping it in the last hour would be the loudest possible admission that the argument was never serious.
