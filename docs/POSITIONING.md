# Where this sits, next to what already exists

Searching npm and GitHub for "repo doctor" and for "autonomous code repair agent"
returns three different products wearing similar names. Repro Doctor is only
comparable to one of them, and against that one it is not competing on repair
rate. This file says exactly what is different and what is not, because a
positioning claim is a claim, and this project's whole argument is that claims
without evidence are worth nothing.

## The three families

**Repository hygiene scanners.** Score a repository against a checklist of best
practices and generate the files it is missing: README, LICENSE, CI workflow,
CODE_OF_CONDUCT. Several are on PyPI and npm and some are genuinely polished.
One states plainly that it works "without ever touching your source code". They
are not repair tools and they are not competitors. The name collides, the
product does not.

**Environment and readiness diagnostics.** Scan a checkout and report whether it
is ready to build, test, publish or deploy, sometimes with an optional LLM pass
that proposes a fix and reverts it if verification fails. This overlaps with
Repro Doctor at the edges. The important difference is what "verification" means,
and it is the subject of the next section.

**Agentic code repair.** An LLM localizes a bug, edits a sandbox, re-runs the
test suite, and is graded by a deterministic harness. The best public examples of
this are good work: they gate on a real grader rather than the model's say-so,
they publish cost per run, and some publish results that did not go their way.
This is the family Repro Doctor belongs to.

## The one sentence

**Most of this field is optimizing the repair rate. This project is about
whether you are entitled to believe a repair rate at all.**

That is not a slogan chosen to sound humble. It is where the evidence in this
repository actually went: the headline comparison came out as a null result, and
the most useful thing measured was how much a number moves when nothing changes.

## Four differences, each with the evidence behind it

### 1. The oracle is yours, not a benchmark's

The strongest public repair agents are graded by SWE-bench Verified, which is the
right way to compare agents and the wrong way to answer the question an engineer
actually has on a Monday morning. SWE-bench can only grade SWE-bench instances,
because the hidden tests are the benchmark's. It cannot tell you whether the
patch an agent just produced for *your* service is correct.

`--oracle-dir` takes any directory. You write down what your repository is
supposed to do, once, as one Node script. The agent never sees it. It runs in a
separate container, mounted read-only, against a fresh copy of the repaired tree,
after the agent's session has ended, and its exit status is the verdict.

The cost of this is real and stated in the README: you have to write the oracle.
The benefit is that the verdict is not a benchmark's opinion about a benchmark's
bug, it is your contract about your code.

### 2. Every rate is published with its interval, and the intervals are the point

This is the difference that matters most, and it is a difference from a
convention the whole field shares rather than from any one project.

A SWE-bench Verified subset of 10 to 30 instances is a common reporting unit, and
engine comparisons are routinely drawn across it. Run those numbers through the
scorer in this repository:

| Reported | With its 95 percent Wilson interval |
| --- | --- |
| 9/14, 64.3% | 38.8 to 83.7% |
| 11/14, 78.6% | 52.4 to 92.4% |
| 12/14, 85.7% | 60.1 to 96.0% |

The best of those against the second best is **+7.1 points, 95% CI -22.0 to
+35.2**. Separating them at 80 percent power would take about **448 runs per
arm**. At n=14 a four-engine ranking table is not a ranking. It is one or two
instances of noise arranged into a story, and everyone in this field including
me has done it.

This project does the arithmetic in the code rather than in the README. All three
surfaces that print a rate, the CLI, the HTML report and the replay, call
`formatRateWithInterval`, which appends the Wilson interval and falls back to a
bare percentage only when there is no sample to compute one from. Every
difference goes through `proportionDifferenceInterval`, which returns a Newcombe
interval or nothing at all. A test recomputes the headline numbers from the
committed evidence and fails the build if `README.md` or `EVALUATION.md` quotes a
different one.

### 3. The noise was measured instead of assumed

The identical baseline arm, unchanged by a single character, was run three times:
**53.3%, then 46.7%, then 60.0%.** A spread of 13.3 points at temperature zero
and top-p one, from nothing but running it again on a different occasion.

The effect the whole benchmark exists to detect is 12.9 points, 95% CI -2.8 to
+27.6.

**The noise between batches is larger than the signal.** The practical
consequence is blunt: any comparison whose two arms were not run inside the same
batch is measuring the weather. That includes comparing your agent's number
against a number in somebody else's README, which is the single most common
comparison in this field.

I have not seen another public repair agent that runs its control arm three
times. It costs almost nothing and it changed what this project is allowed to
claim.

### 4. The decision rules were written before the runs

[PREREGISTRATION.md](PREREGISTRATION.md) was committed and pushed before a single
run of the batch it governs started. The commit order is the evidence. It carries
the sample size, the primary and secondary hypotheses, the decision rules, and a
section naming what would falsify the project's central claim.

What that discipline bought, concretely:

- The pre-registered hypothesis **failed**, and the README leads with it.
- A +40 point subgroup effect found in an earlier batch was registered as a
  hypothesis instead of published as a result. It evaporated: baseline went from
  0 of 15 to 11 of 35 on the same five cases. Without pre-registration that
  number would be on the landing page right now.
- A critic agent was discarded by a rule written before it ran, 1/9 against 4/9,
  and it stays in the tree behind a flag with that number beside it.
- The bounded retry was measured by ablation and is the one interval in the
  project that excludes zero.

Publishing surprises honestly after the fact is good practice and several public
projects do it. Fixing the rule before looking is a different and stronger thing,
and it is cheap.

## What you can check in ten seconds, for nothing

```bash
npm run doctor -- replay submission/evidence/confirmatory
```

Every run behind every number in this repository is committed: 218 runs across
three bundles. That command puts all 140 runs of the published batch back through
the same scoring code that produced the report, recomputes all seven safety and
correctness checks per run rather than reading them, and reports every verdict
that comes out differently. No API key, no model call, no Docker, no network.

The whole point of a project about not taking claims on trust is that you should
not have to take this one on trust either.

## Where this is behind, plainly

**Real repositories.** The benchmark is ten fixtures I wrote. They are synthetic,
small and dependency free. Public agents graded on SWE-bench are running against
django, sympy, sphinx, scikit-learn and matplotlib, which is harder and more
convincing than anything here.

**The one real repository it was pointed at, it failed on.**
[examples/real-world-commander/](../examples/real-world-commander) runs against
commander at a pinned upstream commit, with a fault restored from commander's own
pre-fix code and an oracle lifted from commander's own regression test. The agent
did not repair it, and three of my own defects came out of the attempt. The worst
of the three is still open: `read_file` returns the first four per cent of an
87,607 byte file, so on a 2,787 line source file the agent literally cannot see
the fault.

**Repair rate.** 72.9% on ten easy synthetic repositories is not comparable to
85.7% on fourteen hard real ones, in either direction. Anyone quoting those two
numbers side by side, including me, would be doing the thing this document is
about.

**One model, one provider, one machine.**

## Which one to pick

**Pick a SWE-bench-graded agent** if the question is which agent architecture
performs best on public bugs. That is what those projects are built to answer and
they answer it with a grader nobody involved controls.

**Pick a hygiene scanner** if the question is whether your repository has a
LICENSE and a CI workflow. Different product entirely.

**Pick this** if the question is whether to trust one specific patch, on one
specific repository, that nobody has a public benchmark for. That is the Monday
morning problem: you inherited a service that does not build, an agent handed you
a diff and a confident paragraph, and reading the patch closely enough to believe
it costs about as much attention as writing it. Repro Doctor answers it by making
the verdict come from somewhere the agent could not reach, and by refusing to
report a rate without saying how much of it is noise.
