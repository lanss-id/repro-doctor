# Security

Repro Doctor runs model-authored commands against code it has never seen. The threat is not a hypothetical attacker, it is the ordinary case: a repair agent that wanders, a repository whose build script does something surprising, a patch that looks fine and is not. The design assumes all three.

## Reporting a vulnerability

Open a GitHub issue for anything that is already public, such as a missing check visible in the source. For anything that could be used against a running installation, use GitHub's private vulnerability reporting on this repository instead of an issue, and include the command you ran, the version, and what you observed. I aim to reply within three working days.

Please do report: a way to escape the workspace, a way for the agent to reach the hidden oracle, a way to make `apply` write outside the target, a secret that survives redaction, or a way to make a run report a repair the oracle did not verify.

## Isolation boundary

Docker is the boundary for `diagnose`. Every command runs in a fresh container with:

| Flag | Why |
| --- | --- |
| `--network none` | No package installs, no exfiltration, no calling home during repair |
| `--read-only` plus `--tmpfs /tmp` | The only writable path is the copied workspace and a scratch tmpfs |
| `--cap-drop ALL` | No capabilities at all |
| `--security-opt no-new-privileges` | No privilege escalation through setuid binaries |
| `--user <your uid>:<your gid>` | Never root, and no root-owned files left in the workspace |
| `--cpus`, `--memory`, `--pids-limit` | A runaway build cannot take the host down |
| `--rm` | One container per command, no state carried between them |

There is no Docker socket in the container, no bind mount other than the workspace, and no environment variable carrying a credential. The environment inside the sandbox is built from scratch in `src/infra/exec/docker.ts`; the host environment is not inherited.

Some Docker installations reject `--security-opt no-new-privileges` outright: the container fails to exec anything. Rather than assume the flag applied, Repro Doctor probes it once per image and writes the answer into `sandbox.noNewPrivileges` in every `result.json`. If your run shows `false`, the other protections still hold, and you can see that it happened instead of guessing.

## The local test adapter is not a sandbox

`src/infra/exec/local.ts` runs commands as ordinary host processes with the working directory pinned to the workspace copy. It exists so the test suite can exercise the whole pipeline on machines without Docker. It gives no filesystem isolation, no network isolation and no resource limits.

Three things keep it from leaking into a real run:

1. It only starts when you pass `--executor local-test-adapter` and set `REPRO_DOCTOR_ALLOW_LOCAL_ADAPTER=1`. Missing either one is a hard failure.
2. Every result it produces records `sandbox.productionSafe: false`.
3. The evaluator's `production-sandbox` check fails for those runs, so they cannot count as verified repairs.

`diagnose` never falls back to it. If Docker is missing, the run fails and tells you to start Docker or build the image.

## Not mutating the input repository

`diagnose` checksums the input tree, copies it to `artifacts/runs/<run-id>/workspace/`, works only on the copy, and checksums the input again at the end. Both checksums are in `result.json`. If they differ, the run is marked `failed` with reason `source-mutated` regardless of what the agent achieved, and the evaluator's `source-immutability` check fails.

The copy itself is careful. A symlink whose target resolves outside the repository aborts the copy. Symlinks that stay inside are reported and not copied, because the sandbox has no use for them and they are a common escape trick. `node_modules`, `.git` and `dist` are skipped, and there are limits on file count and file size.

## Keeping the oracle hidden

The hidden oracle lives in `fixtures/<case>/oracle/`, a sibling of `repo/`. Only `repo/` is copied. During repair the sandbox has exactly one mount, and `DockerExecutor` constructed with `purpose: 'repair'` throws if anyone asks it for another. Verification uses a second container, a fresh copy of the repaired tree, and a read-only mount at `/oracle`, created after the agent's session has ended.

Three tests hold this in place: the fixture registry has no hidden material inside any `repo/`, a copied workspace contains no `oracle/`, `reference/` or `meta.json`, and the trajectory of a real run mentions none of those paths. The evaluator repeats the trajectory check for every scored run, so a leak fails the score rather than passing quietly.

Advanced mode runs the oracle once more, before its single feedback retry, and shows the agent the result. The distinction matters: the oracle's *code* is never mounted, never readable and never quoted, while the sanitized `PASS` and `FAIL` lines it printed do cross back into the conversation as evidence. Those lines are scrubbed of the oracle directory, its entry file name, the run directory and any remaining absolute path before the model sees them, and then redacted. A test asserts the feedback message contains the findings and none of those paths.

## Path handling

`resolveWithin` rejects absolute paths, `..` escapes, Windows drive prefixes and NUL bytes before touching the disk. `assertRealPathInside` then resolves symlinks and checks the real destination, including for files that do not exist yet, by walking up to the nearest existing ancestor. Every tool entry point and the patch applier use both.

## Budgets as a safety property

A budget is not only about cost. A run stops after 12 agent or preflight tool calls, 2 patch attempts, 360 seconds or USD 0.30, and each command additionally has a 60 second timeout that is clamped to whatever the run has left. A model stuck in a loop stops being a problem after a bounded amount of damage. Post-patch evidence gates and hidden oracles are scorer actions outside the tool counter; they cannot mutate the input repository and remain bounded by the same deadline.

The 360 seconds is a single deadline over the whole run: model calls, tool calls, the feedback retry and verification all live inside it. It is enforced by an abort signal handed to the model driver, not only by checks between steps, so a provider call that never returns still ends the run. Expiry is classified as `budget-exhausted` with limit `wall-clock`, never as an internal error. There is a test that blocks the driver until the deadline fires.

When no token price is configured, the cost budget cannot be enforced. Live `diagnose` and evaluation commands therefore refuse to start before the first API call. The evaluator's `cost-accounting` check also rejects imported or stale live artifacts whose cost is unknown.

## Redaction

Everything written to a trajectory, a log, the HTML reports or the terminal passes through `src/infra/redact.ts` first. It covers OpenAI, Anthropic, GitHub, npm, Slack, Google and AWS key formats, bearer tokens, authorization and API key headers, JWTs, PEM private key blocks, and assignments to variables whose names contain `SECRET`, `TOKEN`, `PASSWORD`, `API_KEY`, `CREDENTIAL` and similar. Object keys that name a secret are replaced wholesale.

Redaction keeps the variable name and drops the value, so `OPENAI_API_KEY=[redacted:openai-key]` still tells you what happened. It is applied on write, not on read. No API key is passed into a sandbox in either executor, which is the reason there is usually nothing to redact in the first place.

### repair.patch is the exception, and it is sensitive

`repair.patch` is stored exactly as generated, without redaction. It has to be: the SHA-256 in `result.json` is taken over those bytes, and `apply` refuses a patch whose checksum does not match. A redacted patch would neither verify nor apply.

So the patch file contains verbatim content from the repository under repair, including anything that repository happened to contain. `result.json` records `patch.sensitive: true` to say so in the data rather than only in this document.

What follows from that:

- The patch text never enters a trajectory or a log. Trajectories record which files an attempt wrote, not what was written.
- The per-run `report.html` renders a redacted view of the patch and says on the page that the file on disk is exact.
- **Before you attach `repair.patch` to an issue, a submission or a pull request, read it.** Redact it yourself if the repository under repair carried a credential, a customer name, or anything else that should not travel. The tool cannot make that judgement for you.
- `scripts/make-example-run.mjs` applies a mechanical version of that rule for the committed example: it publishes the exact patch only when the redactor finds nothing in it, and otherwise publishes the redacted view alone.

There is a test for the whole arrangement. It puts a credential-shaped string into a patched file and asserts the stored patch is exact, its checksum matches, `apply` reproduces the bytes, and neither the report, the trajectory nor `result.json` contains the string.

## Applying a patch

`apply` is the only command that writes to a repository you care about. It refuses unless the target's tree checksum equals the checksum recorded when the patch was built, verifies the patch file against the SHA-256 in `result.json`, prints the entire diff, and waits for you to type `apply`. Hunks are applied with exact context matching and no fuzz: a hunk that does not match is an error, never a relocated guess.

Two more guarantees inside the writer:

- **The checksum is re-taken immediately before the first write.** A human is in the gap between the preview and the confirmation, and repositories move. If the tree changed while the diff was being read, nothing is written and the command says why.
- **Destinations are validated before anything is created.** Every path component from the target root down to the file is checked for a symlink that leaves the repository, and the file's own real path is checked before and after its parent directory is created. A target containing `a -> /outside` cannot turn an added `a/new/file` into `/outside/new/file`, and no directory is created outside the target on the way to finding that out.

`--yes-i-reviewed-the-patch` skips the prompt and nothing else. It is named the way it is so that seeing it in a script tells you what was promised. If the run's oracle did not pass, `apply` says so before asking.

## What is out of scope

Repro Doctor does not defend against a malicious Docker image, a hostile host kernel, or a repository engineered to attack the Docker daemon itself. It also does not sandbox `npm run <script>`: npm runs scripts through a shell, so a repository's own scripts can run arbitrary programs inside the container. That is the container's job to contain, and the reason the container has no network and no credentials.
