# A real repository, a real bug, and an oracle nobody here wrote

Every other case in this project is a fixture I built. That is a fair objection
to the whole benchmark: if I write the fault and I write the check that catches
it, a good score proves that I can write two halves of the same puzzle.

This example removes that objection for one case. The repository is
[commander](https://github.com/tj/commander.js), one of the most depended-upon
packages on npm. The fault is a line of commander's own code. The oracle is
commander's own regression test. Neither was written for Repro Doctor.

## What is upstream and what is mine

| Piece | Author | Where it comes from |
|---|---|---|
| The repository | commander maintainers | Cloned at `ba6d13d`, unmodified except for the two edits below |
| The fault | commander maintainers | `lib/command.js` restored to the implementation it had before PR [#2350](https://github.com/tj/commander.js/pull/2350), commit `68199e6` |
| The oracle's assertions | commander maintainers | `tests/command.configureOutput.test.js`, the regression test added by that same PR |
| Holding the test out of the visible tree | me | Necessary: an oracle the agent can read is not an oracle |
| The second oracle check | me | States the same contract without the helper, so a repair that special-cases `copyInheritedSettings` does not pass |
| The harness wiring | me | `prepare.sh`, `oracle/oracle.mjs` |

`prepare.sh` prints a full diff of both edits when it runs. Do not take the
table's word for it; read the diff.

## The bug

`Command.configureOutput()` merged the caller's settings into the command's
existing configuration object in place:

```js
Object.assign(this._outputConfiguration, configuration);
```

`copyInheritedSettings()` hands a subcommand a reference to its parent's
configuration rather than a copy. So configuring output on the subcommand
reaches back through the reference and rewrites the parent's settings, and the
caller's own object too. A program that sets a help width on one command finds
it changed on another, for no reason it can see from the code it wrote.

Upstream fixed it by building a new object instead of mutating the old one.

## Why this case is worth having

**The repository's own checks pass.** `npm run check` exits zero: type check,
lint and formatting all clean. `node --test` runs 1371 tests with zero failures.
The regression test that catches this bug did not exist until the commit that
fixed it, which is the normal condition of every bug that has ever shipped: the
suite is green because nobody has written the test yet.

That is the situation this project exists for. A repair agent that trusts
`npm test` exiting zero will report that the repository is fine. The evidence
gate re-runs that same passing check and learns nothing from it. Only the
independent oracle, running code the agent never sees, separates a repaired
tree from an untouched one.

It is also a much larger repository than any fixture: 216 files, 104 test files
and about 17,700 lines of JavaScript, against the 6 to 12 files of the benchmark
cases. The tool-call budget
that suits a fixture does not suit this, and the result below says so plainly.

## Reproduce it

```bash
bash examples/real-world-commander/prepare.sh
```

It clones commander at the pinned SHA, restores the pre-fix line, holds out the
regression test, prints the diff of both, installs commander's devDependencies,
then runs the repository's own checks and the oracle so you can see one pass and
the other fail before any agent is involved.

The install matters. The sandbox has no network at all, so a real repository's
checks can only run if its packages are already there, which is exactly the
state a repository is in on the machine of someone who has just cloned it. Four
seconds and 100MB here; the repair afterwards touches no network.

Then:

```bash
npm run doctor -- diagnose examples/real-world-commander/repo \
  --mode advanced \
  --oracle-dir examples/real-world-commander/oracle \
  --max-tool-calls 20
```

Remove `examples/real-world-commander/repo` and re-run `prepare.sh` between
attempts. The repository is not committed here: it belongs to its authors, and
the pinned SHA reproduces it exactly.

## What happened

Filled in from the runs, in `RESULT.md` beside this file.

## What this does not show

One bug, in one repository, in one language. commander has no runtime
dependencies and its tests run on Node's built-in runner. Its dependencies install in four seconds
and its tests need no compilation step, which is not true of every repository.
