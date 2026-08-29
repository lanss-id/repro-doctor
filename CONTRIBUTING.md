# Contributing

Thanks for looking. This project is small and opinionated, and the opinions are mostly about honesty: the code should never report a result it cannot back with an artifact.

## Getting set up

```bash
npm install
npm run docker:build
npm test
```

`npm test` builds first, then runs the compiled tests with `node --test`. It needs no API key and no network. If Docker is not available, the suite still passes: the integration tests use the local test adapter, which is why that adapter exists.

Before opening a pull request:

```bash
npm run typecheck
npm run lint
npm test
npm run doctor -- fixtures verify        # needs Docker
```

## The rules that are not negotiable

These are the ones I will ask you to change in review, so they are worth stating up front.

**Parse at the boundary.** Anything entering the process, whether from disk, from the model, or from a subprocess, goes through a Zod schema. Inside the process, types are trusted because a schema already checked them.

**No `any`, no rescue casts.** The lint config makes `any` an error, and `as any` a syntax error. If a type fights you, the type is usually telling you something. `as unknown as T` is a smell with the same shape.

**Model states as discriminated unions.** `RunOutcome`, `VerificationOutcome`, `Cost`, `PatchSummary` and `TrajectoryEvent` are all unions with a literal tag. Adding a variant should make the compiler point at every place that has to handle it, which is what the `never` check in each `switch` default is for. Optional-field bags defeat this: prefer a new variant over another `| undefined`.

**Unmeasured is not zero.** If a number was not measured, it is `null` and the report says "pending" or "unknown". Never a plausible default. This applies to token counts, costs, repair rates and durations.

**Logging goes through `src/infra/log.ts`, printing through `src/cli/presenter.ts`.** `no-console` is an error everywhere else. Both paths redact.

**`repair.patch` is exact; everything else is redacted.** Its checksum and `apply` need byte equality, so never redact it, never put its contents in a trajectory or a log, and use `redactedPatchView` for anything published. If you add an artifact that can carry repository content, decide which side of that line it is on and write the decision down.

**Containment goes through `resolveWithin` and `assertRealPathInside`.** Never `startsWith` on a path: a sibling directory whose name begins with the workspace path is not inside it. Validate before creating anything, not after.

**New capabilities need a safety test.** If you add a way to touch the filesystem, add a test that it refuses to escape. If you add a way to spend, add a test that it stops at the limit.

## Adding a benchmark case

A fixture is a directory under `fixtures/<case-id>/`:

```
repo/                 the broken repository, and the only thing copied into the sandbox
oracle/oracle.mjs     the hidden semantic oracle
reference/repair.mjs  a deterministic repair script
reference/*.patch     generated, not hand written
meta.json             fixture metadata, hidden from the agent
```

What makes a good case:

- It fails for a reason a type checker alone will not find. Compiler errors are not interesting by themselves.
- The repository states its own contract in `README.md`, so the fault is discoverable by reading rather than by guessing.
- The oracle tests behaviour, not the shape of the diff. Any correct repair should pass. If your oracle would reject a reasonable alternative fix, loosen it.
- No dependency install is needed. The sandbox has no network. TypeScript comes from the runner image, and anything else has to be vendored in the fixture, as `manifest-lockfile-mismatch` does.
- Anything a model uses from the Node standard library lives in a `.mjs` script, not in the TypeScript, so fixtures compile without `@types/node`.

The oracle protocol is one line per check, `[oracle] PASS <name>` or `[oracle] FAIL <name>: <why>`, a final `[oracle] RESULT PASS|FAIL`, and exit 0 only when everything passed. It receives `REPO_DIR` in the environment and must use it rather than assuming the working directory.

Then wire it up:

```bash
npm run doctor -- fixtures verify --case <case-id>    # must fail before, pass after
npm run doctor -- fixtures patches --case <case-id>   # regenerates reference.patch
npm test
```

`fixtures verify` failing means the case is not usable as a benchmark, whatever else it does. A case that passes before its reference repair is not broken; one that fails after it has a broken reference repair.

## Style

Comments explain why, not what. The code already says what it does, and a comment that restates it goes stale silently. Names are ordinary English words. Headings are sentence case. Straight quotes.

## Commits and pull requests

One change per pull request, with a sentence on what it does and a sentence on how you know it works. If it changes behaviour that shows up in an artifact, include the artifact or the relevant lines from it.

Do not add a benchmark number to any document unless it came from a real run whose artifacts are in the repository or linked from it.
