# AgentInspect issue 312 as a private real-repository case

This case points Repro Doctor at a historical AgentInspect checkout rather than
at a fixture written for this project. The repair target is
[AgentInspect issue #312](https://github.com/rajudandigam/agent-inspect/issues/312):
`serve --open` and `studio --open` used the macOS `open` command on every
platform and ignored launch failures.

AgentInspect had already merged its own fix before this exercise started. The
purpose here is not to submit a duplicate patch. It is to ask whether Repro
Doctor can independently reach a repair against a real TypeScript monorepo,
while keeping the repository and its dependencies inside a private sandbox.

## Provenance

| Piece | Source |
| --- | --- |
| Broken repository | AgentInspect commit `23450f0377f050e7e2ecbdf6712a52147a08ba98`, immediately before the upstream fix |
| Fixed upstream state | AgentInspect commit `2ed2d09e3694dc48f9b923aa85ce9a251421a7b6` |
| Problem statement | Upstream issue #312, reduced to a repository-local `REPAIR_TASK.md` |
| Hidden checks | `browser-open.test.ts` and `browser-open-commands.test.ts` from upstream PR [#313](https://github.com/rajudandigam/agent-inspect/pull/313) |
| Contribution prompted by the exercise | AgentInspect issue [#316](https://github.com/rajudandigam/agent-inspect/issues/316), proposing a deterministic repair-evidence recipe |

The historical checkout, installed dependencies and oracle are intentionally
not committed here. They were held under a user-private directory with mode
`0700`. The target was exported without `.git`, so the repair agent could not
read the future fix from history.

## Isolation

Every completed repair run used the production Docker executor:

- no network
- read-only container root
- one CPU and 1 GiB memory
- no Docker socket
- no host secrets
- no oracle mount during repair
- only a disposable workspace mounted read-write
- source checksum checked again after the run

The hidden oracle was mounted read-only only after a patch existed. The source
checkout remained unchanged in every completed run.

## Reproduction shape

After exporting the pinned commit and installing the minimum root dependencies,
the private invocation was equivalent to:

```bash
npm run doctor -- diagnose /private/agentinspect-312-target \
  --mode advanced \
  --case-id agentinspect-312 \
  --oracle-dir /private/agentinspect-312-oracle \
  --task-file REPAIR_TASK.md \
  --max-tool-calls 40 \
  --max-patch-attempts 2 \
  --max-seconds 600 \
  --max-cost-usd 0.30 \
  --command-timeout 120 \
  --check-command "node node_modules/vitest/vitest.mjs run -c vitest.config.ts packages/cli/test/bundle.test.ts"
```

The Docker image used by the recorded runs had digest
`sha256:412b2fdeebee9701a3e12c3f741b1fc70ac45ba771144d294122978f936c7a7a`.
The target tree checksum recorded by the most relevant run was
`ee74a545c6644865fc1ca28d8c133105758b5a1632319a8eb567baf65ccf83c1`.

## Result

Repro Doctor did not produce a verified AgentInspect repair. That is the result,
not a missing section. One run found the correct fault and produced a focused
two-file patch, but the upstream regression tests rejected it because the patch
still duplicated launcher logic and still swallowed errors.

The attempt did produce four reproducible improvements to Repro Doctor itself.
See [RESULT.md](RESULT.md) for the run-by-run evidence and the decision trail.
