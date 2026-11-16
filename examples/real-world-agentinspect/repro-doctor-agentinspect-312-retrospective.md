# Six runs and no verified repair on AgentInspect #312

I pointed my repair tool, [Repro Doctor](https://github.com/lanss-id/repro-doctor), at a real bug in someone else's repository. Six runs completed and none produced a patch the upstream tests would accept.

## The setup

[AgentInspect](https://github.com/rajudandigam/agent-inspect) is a local-first TypeScript trace and debug library maintained by Raju Dandigam. [Issue #312](https://github.com/rajudandigam/agent-inspect/issues/312), reported by HsienW, describes `serve --open` and `studio --open` calling the macOS `open` command on every platform and ignoring the launch error. HsienW fixed it in [PR #313](https://github.com/rajudandigam/agent-inspect/pull/313), which Raju merged on 31 August 2026.

I exported commit `23450f0`, the parent of that merge, without `.git`, so the agent could not read the fix from history. The two regression test files from #313, nine tests between them, stayed outside the sandbox as a hidden oracle. The harness mounted them read-only only after a patch existed.

Every completed run used Docker with no network, a read-only root, one CPU and 1 GiB of memory. The recorded invocation set a 120-second command timeout, a 600-second run limit and a $0.30 cost limit, with two patch attempts. The source checkout was unchanged after every completed run.

## The result

Six completed runs, zero verified repairs, $0.500872 in total, all from the pinned [run record](https://github.com/lanss-id/repro-doctor/blob/9de4d2fbcbc7200e396ae62c96e66246c06b1708/examples/real-world-agentinspect/RESULT.md).

| Run | Outcome | Calls | Cost | Cause |
| --- | --- | ---: | ---: | --- |
| 1 | no patch | 30/30 | $0.115835 | Copier removed `node_modules/vitest/dist` |
| 2 | no patch | 30/30 | $0.108677 | Generic task, wrong package |
| 3 | unverified patch | 40/40 | $0.190804 | Unrelated syntax change, oracle refused |
| 4 | no patch | 15/40 | $0.031446 | Exact fault found, no `propose_patch` call |
| 5 | unverified patch | 16/40 | $0.040836 | Two-file patch, oracle rejected |
| 6 | wall-clock exhausted | 3/40 | $0.013274 | 120-second timeout resolved after 715 seconds |

Run 5 came closest. Its patch changed two files, +29/-2, and picked the right launcher for each platform, `open`, `cmd /c start` or `xdg-open`. The upstream tests rejected it because it duplicated the launcher logic and still swallowed launch errors. I kept the patch as evidence and never applied it.

One interrupted follow-up run wrote no result artifact and submitted no patch. It is outside the six-run count and the cost total.

This is one case, not a repair rate.

## What an Evidence bundle preserves, and what reproduction still needed

An AgentInspect Evidence v2 bundle verifies the source trace hash and the hashes of its packaged files. It preserves the execution tree, the tool and LLM lifecycle, failure data, durations and check results.

Explaining why run 5 failed took state from outside the trace:

- repository commit and input tree checksum
- task statement checksum
- visible check command and timeout
- hidden-oracle provenance
- container image digest and isolation profile
- model settings fingerprint and budget
- patch checksum and oracle verdict

[`docs/SUPPORT-REPRODUCTION.md`](https://github.com/rajudandigam/agent-inspect/blob/main/docs/SUPPORT-REPRODUCTION.md) asks reporters to attach versions, environment and steps next to the bundle, outside the verified files, where they can drift. I opened [issue #316](https://github.com/rajudandigam/agent-inspect/issues/316) on 2 September 2026 to ask for a documented way to carry that state inside the bundle, and reported the runs there in a follow-up comment the same day.

The real checkout, its dependencies and the oracle stayed in a private directory and are not in the repository. The #316 recipe uses synthetic data only.

## Why verifying packaged files does not prove a repair

Verification recomputes hashes. A pass means the packaged bytes still match the manifest. It does not execute or certify a replay.

The landed recipe uses synthetic records for a failed repair. Its summary says the hidden oracle failed one of two checks, and the recipe still prints `Evidence v2 verification: pass`.

The recipe README lists what integrity does not prove: that the checkout matched the recorded commit, that the container or runner was trustworthy, that the oracle was authentic and withheld, that the patch is correct, or who created the package.

## What changed, and where

In Repro Doctor, the runs exposed four harness gaps. Commit [`3355412`](https://github.com/lanss-id/repro-doctor/commit/33554125f835f57c58728c71d5bdb47db4ff1e5d) fixes each one with regression coverage. The fixes are on `main`.

1. The copier skipped every `dist` directory, including `node_modules/vitest/dist`. It now skips only root build output.
2. `diagnose` had no input for issue context. It now takes `--task-file`, limited to 16 KiB and redacted before it reaches the model.
3. A correct diagnosis with no patch ended the turn. It now triggers the existing single retry.
4. A timed-out process waited for descendants to close inherited pipes. It now resolves at the deadline.

After the four fixes the record reports typecheck pass, lint pass and 228 tests passed.

In AgentInspect the change is a documentation and example recipe, with no runtime change. Raju offered me first ownership of #316 and I wrote the first version as draft [PR #325](https://github.com/rajudandigam/agent-inspect/pull/325). HsienW's parallel recipe, [#322](https://github.com/rajudandigam/agent-inspect/pull/322), stayed as reference and closed unmerged. Raju approved my draft, then re-reviewed it against a stricter release checklist and listed eight blocking items. I had not addressed them when he applied them himself and landed the recipe in [PR #335](https://github.com/rajudandigam/agent-inspect/pull/335) on 4 September 2026, crediting me with a `Co-authored-by` trailer.

The corrections in #335 are Raju Dandigam's. Seven changed the recipe and the eighth was a rebase. He replaced the ambiguous `schemaVersion: 1` with `reproductionEnvelopeVersion: "0.1"`, packaged `task.txt`, cut the environment allowlist to variable names, changed the bare `SAFE` assessment to `SAFE WITH WARNINGS`, reduced the oracle result to pass or fail plus check ids, linked the support doc, and added the note on the same trace at a different revision.

## What I got wrong in the first recipe

My `reproduction.json` in #325 named the task as `REPAIR_TASK.md` and gave it a placeholder digest of sixty-four `c` characters. The package held no such file. Verification checked six files, none of them the task.

A digest identifies a task only for someone who already has the bytes. My bundle gave the reader a hash and nothing to compare it against.

My own list in #316 asked for an "exact task statement checksum", and a checksum is what I shipped. According to the run record, supplying the task as a bounded input changed the failure from browsing the wrong package to identifying the exact fault in both affected files.

Raju's version packages `task.txt`, hashes it in the manifest's `files[]`, and computes the digest in `reproduction.json` from those same bytes. Verification now checks seven files.

Three more of his fixes tightened what my recipe recorded or claimed: an environment value recorded where names were enough, a hardcoded `SAFE`, and an oracle detail that he said looked like hidden-oracle implementation leakage.

This experiment ended with no verified repair of #312. It left four tested harness fixes in Repro Doctor and one recipe in AgentInspect, which packages the task because Raju caught that mine did not.

## Sources

- [Run record](https://github.com/lanss-id/repro-doctor/blob/9de4d2fbcbc7200e396ae62c96e66246c06b1708/examples/real-world-agentinspect/RESULT.md) at `9de4d2f` and its setup [README](https://github.com/lanss-id/repro-doctor/blob/9de4d2fbcbc7200e396ae62c96e66246c06b1708/examples/real-world-agentinspect/README.md)
- Repro Doctor commit [`3355412`](https://github.com/lanss-id/repro-doctor/commit/33554125f835f57c58728c71d5bdb47db4ff1e5d)
- AgentInspect issues [#312](https://github.com/rajudandigam/agent-inspect/issues/312) and [#316](https://github.com/rajudandigam/agent-inspect/issues/316), PRs [#313](https://github.com/rajudandigam/agent-inspect/pull/313), [#322](https://github.com/rajudandigam/agent-inspect/pull/322), [#325](https://github.com/rajudandigam/agent-inspect/pull/325) and [#335](https://github.com/rajudandigam/agent-inspect/pull/335), [`docs/SUPPORT-REPRODUCTION.md`](https://github.com/rajudandigam/agent-inspect/blob/main/docs/SUPPORT-REPRODUCTION.md) and the [recipe README](https://github.com/rajudandigam/agent-inspect/blob/main/examples/recipes/reproducible-repair-evidence/README.md)
