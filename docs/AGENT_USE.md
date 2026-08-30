# Agent use, disclosed

Two different things get called "the agent" in a project like this. This file
separates them, because the rules ask for both and they are not the same.

## 1. The coding agent that built this repository

Every line of code, test, fixture and document in this repository was written
with **Claude Code** driving **Claude Opus 5**, across several sessions inside
the competition window that opened on 28 August 2026. The work was directed,
reviewed and paid for by the author, who chose the problem, set the decision
rules before the experiments ran, approved every destructive step, and ran the
live evaluations.

What existed before the competition: nothing in this repository. The only
pre-existing components are third-party dependencies, all of them public and
used under their own licences:

| Component | Version | Role |
| --- | --- | --- |
| Node.js | 22 | Runtime |
| `@openai/agents` | pinned in `package-lock.json` | The agent loop the repair modes run on |
| `zod` | pinned in `package-lock.json` | Schema validation for every artifact |
| TypeScript, ESLint, `typescript-eslint` | pinned | Build and lint |
| `node:test` | bundled with Node | Test runner |

No starter template, no forked repository, no code carried over from earlier
work. `git log` starts at the first commit of this project.

The landing page under `site/` was built in the same way, with one addition: a
third-party frontend design skill, `Leonxlnx/taste-skill`, was installed locally
and followed for that page's layout, colour and motion decisions. It is agent
instructions rather than code, nothing from it ships in this repository, and the
page it produced has no dependencies at all.

The coding-agent session transcripts are not committed here. They contain the
author's local paths and unrelated shell history, and they are supplied
separately with the submission rather than pasted into a public repository.

## 2. The agents inside the solution

These are the agents Repro Doctor runs. Each one has a representative
trajectory committed, because a claim about an agent's behaviour is worth what
its trajectory shows and nothing more.

| Agent | Instructions | What it does | Representative trajectory |
| --- | --- | --- | --- |
| Baseline repair agent | `baselineInstructions` in `src/agent/instructions.ts` | One unstructured loop: investigate the repository and fix it, with four tools and a budget | [`submission/examples/baseline-run/`](../submission/examples/baseline-run) |
| Advanced repair agent | `advancedInstructions` in the same file | Deterministic preflight, hypothesis ledger, minimal patch, tools closed at the patch, one retry driven by evidence the harness collected | [`submission/examples/live-run/`](../submission/examples/live-run), and [`retry-run/`](../submission/examples/retry-run) for a run where the retry fires |
| Advanced repair agent, user path | same | The same agent pointed at a repository outside the benchmark with `--oracle-dir` | [`submission/examples/byo-oracle-run/`](../submission/examples/byo-oracle-run) |
| Advanced repair agent, real repository | same | The same agent on [commander](https://github.com/tj/commander.js) at a pinned commit, with a fault and an oracle written by commander's maintainers rather than by me. It failed, and the trajectory shows why | [`submission/examples/commander-run/`](../submission/examples/commander-run) |
| Advanced repair agent, ablated | `advancedInstructions(budget, false)` | The same agent with the bounded retry removed, run only as an experiment arm. Its step 8 tells the truth about not getting a second turn | Every run in [`submission/evidence/ablation/`](../submission/evidence/ablation) and [`reserve/`](../submission/evidence/reserve) |
| Critic | `CRITIC_INSTRUCTIONS` in `src/agent/driver.ts` | Experimental treatment, off by default. Reviews a proposed patch against the ledger and the evidence and can send it back once | [`submission/examples/critic-run/`](../submission/examples/critic-run) |

Both repair agents get the same model, the same four tools built by the same
function, the same repository copy, the same budget and the same scorer. Only
the instruction text and the harness structure around the loop differ, and
[docs/EVALUATION.md](EVALUATION.md) states that difference in a table.

## Reading a trajectory

`trajectory.jsonl` is one JSON object per line, in order, schema-checked and
redacted before it was written. The event types that matter:

| Event | What it records |
| --- | --- |
| `run.started` | Mode, model, executor, and the budget the run was given |
| `preflight.completed` | The harness's own three commands, advanced only |
| `tool.call` / `tool.result` | Every action and its full output, including the `[budget]` line the agent read |
| `patch.attempt` | Files written and whether the attempt was accepted |
| `evidence.gate` | The harness re-running the repository's own check, with the real exit code |
| `verification.started` / `verification.completed` | The hidden oracle, `interim` before the retry, `final` for the verdict |
| `model.message` with `role: user` | The one feedback message that opens the retry, which is where you can see what changed the agent's next step |
| `hypothesis.updated` | The agent's ledger as it stood at the end |
| `run.finished` | Status and wall clock |

## Human checkpoints

There are two, and neither is optional.

**Applying a patch.** `npm run doctor -- apply <run-id> --to <repo>` prints the
whole diff, verifies the target is byte-identical to the tree the patch was
built against, re-checks it immediately before the first write, and waits for
the operator to type `apply`. A transcript of a real session, including a
refusal, is at
[`submission/examples/apply-session.txt`](../submission/examples/apply-session.txt).

**Judging the outcome.** The agent's own claim of success carries no weight in
the score. The verdict comes from the hidden oracle's exit status, and a run
whose oracle did not pass is reported as `unverified-patch` no matter how
confident the ledger sounds.
