# What happened when it was pointed at commander

Thirteen runs across two sittings, six defects in my own harness, all six fixed.
The agent has still not repaired commander. What changed is why: the first
sitting failed because the tool could not show the agent the bug, and the second
failed because the agent stopped looking.

This file exists because the honest version of "we tried it on a real
repository" is the trajectory, not the summary. Run 3's is committed in full at
[`submission/examples/commander-run/`](../../submission/examples/commander-run).

**The runs in the second sitting were measured against a changed tool set and a
changed instruction wording.** Nothing below run 3 is comparable with the five
published batches in `submission/evidence/`, which were all measured before it.
See the row in [docs/IMPROVEMENT_CHANGELOG.md](../../docs/IMPROVEMENT_CHANGELOG.md).

## The first sitting, 30 August

### Run 1: the harness deleted the dependencies and the agent chased them

`20260830T160959Z-2d2043`, advanced, 25 tool calls. **budget-exhausted, no
patch.**

The third tool call ran the check resolved from the manifest, `npm run check`,
and got:

```
error TS2688: Cannot find type definition file for 'node'.
```

The agent then spent sixteen more calls on that: reading three tsconfig files,
`typings/index.d.ts`, the lockfile, `npm list @types/node`, which printed
`(empty)`. It was chasing a missing dependency, and the dependency was missing
because **the workspace copy skips `node_modules` by default**. commander's
packages were installed on disk and the harness had removed them on the way in.

Nothing in the run was about the bug. The tool had handed the agent a different
broken repository from the one on disk and then measured how it did.

At the time I recorded this as fixed. It was not, and run 4 says so.

### Run 2: a budget line that was not true

`20260830T161421Z-d13af7`, after adding `--check-command "node --test"` so the
question asked is whether the library works rather than whether its linter is
installed. **budget-exhausted at 19 of 25 tool calls.**

Nineteen, not twenty-five. `maxTurns` was fixed at 16 regardless of the budget,
so the SDK stopped the agent while every `[budget]` line it had read said it had
calls left. The run was given 25 and could never have spent more than about 19.

That is the fourth time in this project that the harness, not the model, was the
thing saying something untrue. The first three are in the improvement changelog
and all three were found the same way: by reading a trajectory where the model
looked careless and asking what it had been told.

Both defects are fixed. The check command is now the caller's to name, and
`maxTurns` is derived from the budget with a floor that leaves every published
batch byte-identical.

### Run 3: the tool that could not show the agent the bug

`20260830T161557Z-886ac8`, advanced, 25 tool calls, all 25 spent, both patch
attempts used, $0.1079, 73 seconds. **no patch, and the reason is mine.**

The agent read `lib/command.js` three times. That file is 87,607 bytes and 2,787
lines. `read_file` truncates at 32KB and the tool output is then clamped to
6,000 characters, so each of those three reads returned the same **first four
per cent of the file**. The bug is at line 246, around byte 8,600. The agent
could not have seen it, and read the same opening three times trying.

What it did instead is worth looking at. It invented a fault it *could* see:
that `createOption` in `index.js` returned the wrong class. It patched
`index.js`. The evidence gate re-ran `node --test` and exited 1, because the
patch broke a working library. Its second attempt concluded "no code change
needed" and wrote the file back, which is why the run is recorded as `no-patch`
rather than as a patch.

**The tool set is sized for the fixtures.** Four tools, no ranged reads, no
search. On a 6-to-12 file repository that is enough. On a 216-file repository
with a 2,787-line source file it is not, and the failure mode is not "the agent
gave up", it is "the agent confabulated a fault inside the four per cent it
was allowed to see". `read_file` needs an offset and a length, and there is no
way to add one without changing the tool set every published measurement was
taken against, so it is written down here rather than done in the last day of a
competition.

## The second sitting, 31 August

Ten runs, all advanced, all `--max-tool-calls 20`, $0.2728 in total. The task
was to give `read_file` the offset run 3 asked for. That took one run. The other
nine were spent on the five defects that were standing behind it, each of which
only became visible once the one in front of it was gone.

| Run | Id | Outcome | Calls | What it proved |
| --- | --- | --- | --- | --- |
| 4 | `20260831T085251Z-40a59e` | no-patch | 20/20 | The window works. My patch schema does not |
| 5 | `20260831T090213Z-f41313` | no-patch | 20/20 | Naming the shape is not enough while a field can be null |
| 6 | `20260831T090626Z-18716b` | unverified-patch | 19/20 | First patch this example has ever produced. The oracle refused it |
| 7 | `20260831T091410Z-f78b4d` | unverified-patch | 5/20 | Dependencies arrive, and `npm run check` fails one layer further along |
| 8 | `20260831T091605Z-dda497` | no-patch | 20/20 | The suite is still red, and not because of the bug |
| 9 | `20260831T092220Z-3c931a` | no-patch | 20/20 | The capture stops at 256KB, so a test runner's verdict is never collected |
| 10 | `20260831T093208Z-9ed571` | no-patch | 3/20 | The suite is green for the first time, and the agent stops |
| 11 | `20260831T093306Z-480748` | no-patch | 3/20 | Again |
| 12 | `20260831T093338Z-5759ac` | no-patch | 3/20 | Again |
| 13 | `20260831T093429Z-852119` | no-patch | 3/20 | Again |

### Run 4: the window works, and my own schema eats the patch attempts

`read_file` now returns a window of lines, names the lines it gave and how many
remain below them, and moves with `start_line`. The agent used it correctly and
unprompted on the first run it had it: `tsconfig.json` lines 1-40 then 41-44,
`typings/index.d.ts` 1-40 then 41-80, `index.js` 1-20 then 21-21.

Reading was not the constraint any more, and the next one was mine. Because
`propose_patch` writes whole files and refuses anything over 65,536 bytes, the
fault in an 87,607 byte file was visible and still unfixable, so the same change
gave a file entry a second shape: replace one exact block, refused unless the
anchor occurs exactly once. The first version of that schema rejected an entry
that carried both shapes as ambiguous.

A strict tool schema makes every field required. Handed `content`, `find` and
`replacement`, the model filled in all three, and both patch attempts died on my
own validation message:

```
tsconfig.json: give either content or find, not both
```

### Run 5: naming the shape is not enough

So the entry names its shape, `how: "whole"` or `how: "replace"`, and fields
belonging to the other one are ignored. Guessing intent from which fields look
populated is the harness deciding what the model meant, which is the thing this
project refuses to do anywhere else.

Both attempts died again, one message further along:

```
tsconfig.json: how is "replace", so replacement is required
```

The model had asked for a replacement and set `replacement` to `null`, because
the schema said it could. Nullable fields on a required schema are an invitation
the model accepts. The three fields are now plain strings; an unused one is sent
empty, and an empty `content` under `how: "whole"` is refused rather than used to
truncate a file.

### Run 6: the first patch this example has produced

**`unverified-patch`. One file, one line, and the oracle said no.**

The agent removed a deprecated re-export from `index.js`:

```diff
-export { InvalidArgumentError as InvalidOptionArgumentError }; // Deprecated
+
```

The hidden oracle ran against a fresh copy of the repaired tree and exited 1,
naming both contract checks it failed. That is the system working: a wrong patch
was produced, caught by a check the agent never saw, and reported as a failure.

It is also still the wrong file. `node --test` had exited 1, and the agent went
looking for a cause in the twenty-one lines of `index.js` rather than in the
2,787 of `lib/command.js`. The suite was red, and the next four runs are about
why.

### Run 7: the dependencies were never actually restored

Run 1 recorded "the workspace copy stripped the dependencies" as fixed. It was
not. `node_modules` is in `DEFAULT_IGNORED_DIRECTORIES`, which the copy shared
with the checksum, so every run since had been handed a repository that cannot
resolve an import, in a sandbox with `--network none` where it can never install
one. Three of run 4's tool calls went to `npm install`, `npm install
--ignore-scripts` and `npm ci --ignore-scripts`, each killed at the 60 second
timeout.

The copy now keeps `node_modules` and has its own ignore list, so the checksum
can go on excluding a dependency tree from what a repair may claim to have
changed. `.git` stays out of both: the history is not needed to run the code and
is a way to read the fix.

With the dependencies in place and no `--check-command`, `npm run check` gets
past the missing type definitions and fails on the next thing, an eslint plugin
layout the lockfile does not reproduce. The agent patched `package.json`,
+5/-1, adding five devDependencies. The oracle refused it.

commander's `npm run check` runs `tsd`, `tsc`, `eslint` and `prettier`. In a
sandbox with no network that is not a question about whether the library works.
Every run after this one names the check `prepare.sh` already documents:

```bash
--check-command "node --test"
```

### Run 8: the suite is red for a reason that is mine

With dependencies present, `node --test` passes on the host: 1371 passing, 0
failing, exactly as this example's README claims. Inside the sandbox it exited 1,
and the tool output would not say why.

The agent wrote `index.js` back unchanged, which produced an empty patch, which
is why a run with an accepted patch attempt is recorded as `no-patch`.

### Run 9: the verdict was never collected

Running the same command in the same image by hand gave the answer in one line:

```
# pass 1369
# fail 2
```

The agent never saw that, and neither had I. Captured output stopped
accumulating once it reached 256KB:

```js
if (stdout.length < MAX_CAPTURED_BYTES) { stdout += chunk.toString('utf8'); }
```

commander's suite prints about 262KB of TAP. The failures are named in the last
few lines. For a test runner the end is the only part that matters, and the end
was the part that was never collected, so the agent was handed a quarter
megabyte of passing tests and no verdict. Output is now gathered into a fixed
head and a rolling tail, so both ends survive. A compiler puts its first error at
the top, which is why the head is kept too.

This fix has a unit test and no live run that isolates it: by the time it
shipped, the next fix had made the check pass, so nothing large was left to
truncate. It is here because it was real, not because it changed an outcome.

### Runs 10 to 13: green, and the agent stops

The two failures were `when subcommand file is symlink then lookup succeeds` and
its double-symlink twin. commander resolves an executable subcommand through a
relative symlink, and the copy dropped every symlink it found. The suite was red
because of the harness, in a way that looks exactly like a repository fault.

Relative links that stay inside the tree are now recreated in the workspace.
Absolute ones are still dropped, because recreating one verbatim would point the
workspace back at the source repository, and anything whose target resolves
outside the root still aborts the copy, which is what that check was for.

**`node --test` then exited 0 inside the sandbox for the first time.** 1371
passing. The precondition this example was built on finally held.

All four runs from that state ended the same way, at exactly three tool calls
each and without spending a single patch attempt: list the root, read
`package.json`, run the suite, see it pass, stop. From run 10's ledger:

> The project currently passes all tests and type checks, indicating no
> immediate runtime or type errors.

Advanced mode's second instruction exists for precisely this:

> A check that exits zero is not evidence that the repository works. When the
> preflight check passes, the fault is a promise the code does not keep: read
> the README, the manifest and the configuration for what this project says it
> does, then test that promise directly with run_command instead of trusting the
> exit code.

On the ten fixtures that sentence measurably works. On a 216-file library with a
1,172-line README it does not, and four runs in a row is not a fluke. The
instruction asks the agent to invent a contract test for an unfamiliar library
from its documentation, which is a harder task than any fixture poses, and
nothing in the harness checks that it tried.

## What this example does and does not show

It shows, on a repository and a bug neither of which I wrote:

- the repository's own suite passing, 1,371 tests and zero failures, while the
  bug is present, which is the condition this whole project is built for
- the hidden oracle failing on the same tree
- the agent producing a wrong patch, the evidence gate catching it, and the run
  being reported as a failure rather than as a success
- six real defects in the harness, found by leaving the benchmark, five of them
  the harness taking something away without telling the agent: the middle of a
  file, its dependencies, the end of a command's output, the symlinks its tests
  resolve through

It does not show a successful repair of a real repository. I would rather
publish that sentence than a fourteenth run tuned until it went green.

What it does show, which the first sitting could not, is where the remaining
problem is. It is no longer that the agent cannot see the file. It is that a
green check ends the investigation, and the instruction written to prevent that
does not survive contact with a repository this size. That is a question about
the method, and the next batch is where it gets answered rather than argued.
