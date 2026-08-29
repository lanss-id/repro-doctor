# Video script

Three minutes. One terminal, one browser tab, no slides. Everything on screen is a real command with real output, and the one number I do not have, I say I do not have.

Record at 1920x1080, terminal font large enough to read at half size. Do a dry run first so the Docker image is already built and nothing waits on a pull.

---

## 0:00 to 0:25, the problem

**On screen:** `fixtures/broken-test-discovery/repo/package.json`, then the terminal running `npm run check` in that repository. It exits zero. Then scroll up two lines to `tests 0`.

**Say:**

> This repository's check passes. It also runs zero tests, because the glob says `.test.mjs` and the files are named `.spec.mjs`. The exit code says everything is fine.
>
> Now hand that to a repair agent. It runs the check, sees zero, and reports success. The transcript looks perfect. That is the failure I built Repro Doctor to catch.

## 0:25 to 0:50, the idea

**On screen:** the `fixtures/broken-test-discovery/` tree, showing `repo/` next to `oracle/` and `reference/`.

**Say:**

> Only `repo` is ever copied into the sandbox. The oracle sits next to it, and the agent never sees it. It runs afterwards, in a different container, mounted read-only, and it does not ask for an exit code. It counts how many tests actually ran.
>
> An agent that can see the test can make the test pass. This is the cheapest way to stop that.

## 0:50 to 1:35, a repair

**On screen:** `npm run doctor -- diagnose fixtures/entrypoint-mismatch/repo --mode advanced`, running live.

**Say while it runs:**

> The input repository is copied and checksummed before anything happens. Everything after this runs in a container with no network, no capabilities, read-only root, and a copy of the workspace as its only mount.
>
> This is advanced mode, so the harness runs a fixed preflight first: list the tree, read the manifest, run the project's own check. Three tool calls, charged to the same twelve-call budget the baseline gets. The structure is not free, and if it is not worth three calls I want the numbers to say so.

**On screen when it finishes:** the result block, then `cat` the patch.

**Say:**

> One file changed. `main` pointed at `dist/main.js`; the build emits `dist/index.js`.
>
> And then the part that matters: the oracle ran, imported the package through whatever entry point the manifest now declares, called the function, and checked the string. Exit zero. That is the verified repair.

## 1:35 to 2:05, the evidence

**On screen:** `artifacts/runs/<id>/`, then `result.json` scrolling through the sandbox profile, budget, usage, checksums.

**Say:**

> Every run leaves five files. The trajectory has every tool call and its output, schema-checked and redacted before it was written. The verification log has the oracle's output. And these two checksums are the input repository before and after. They match, so nothing was written to your code.
>
> The patch is the one file stored exactly, because its checksum and applying it both need the precise bytes. It is marked sensitive, and the report shows it redacted.

## 2:05 to 2:35, applying it

**On screen:** `npm run doctor -- apply <run-id> --to /tmp/demo-repo`, showing the diff and the prompt. Type something other than `apply`. It cancels.

**Say:**

> Applying is the only command that touches a repository you care about. It checks the target is byte-identical to the tree the patch was built against, prints the whole diff, and waits. Type anything but `apply` and nothing is written.
>
> There is a flag to skip the prompt. It is called `--yes-i-reviewed-the-patch`, so that seeing it in a script tells you what somebody promised.

## 2:35 to 3:00, the result

**On screen:** `npm run report`, then the report page, scrolled to the aggregate table and the difference line under it.

**Say:**

> Both modes run the same model, repository, tools, budget and scorer. The only difference is the instruction and the structure around the loop.
>
> Sixty runs. Baseline verified 16 of 30, advanced 22 of 30. That is 20 points, and the confidence interval on the difference runs from minus four to plus forty-one. It includes zero, so what I have is a direction, not an effect size, and the page prints it that way rather than letting you subtract two percentages and believe the answer.
>
> Two things it does settle. The structure costs nothing extra: the advanced median run was slightly cheaper, because a baseline failure spends all twelve calls. And on the case whose own check passes while running zero tests, baseline got it once in three and advanced three times in three, on a retry that only the hidden oracle could trigger.
>
> I also ran the critic experiment against a rule I wrote before running it. It lost, so the rule discarded it. That number is in the changelog next to the ones that went my way.

---

## Notes for recording

- Have `npm run docker:build` done beforehand. The first pull is slow and boring.
- Trim the wait during `diagnose`. Cut, do not speed up: sped-up terminal output looks like a trick.
- The last section quotes real numbers. Say the interval out loud every time the 20 points is said; a viewer who hears only the point estimate has been misled by omission.
- Resist the urge to add music.
