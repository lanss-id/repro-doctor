# What happened when it was pointed at commander

Three runs, three different defects in my own harness, two of them fixed here
and the third named with the fix it needs. The agent has not repaired commander.

This file exists because the honest version of "we tried it on a real
repository" is the trajectory, not the summary. Run 3's is committed in full at
[`submission/examples/commander-run/`](../../submission/examples/commander-run).

## Run 1: the harness deleted the dependencies and the agent chased them

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

## Run 2: a budget line that was not true

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

## Run 3: the tool that could not show the agent the bug

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

## What this example does and does not show

It shows, on a repository and a bug neither of which I wrote:

- the repository's own suite passing, 1,371 tests and zero failures, while the
  bug is present, which is the condition this whole project is built for
- the hidden oracle failing on the same tree
- the agent producing a wrong patch, the evidence gate catching it, and the run
  being reported as a failure rather than as a success
- three real defects in the harness, found by leaving the benchmark

It does not show a successful repair of a real repository. I would rather
publish that sentence than a fourth run tuned until it went green.
