// Maintenance script: produces the example artifacts under submission/examples.
//
// It runs the real pipeline (real Docker sandbox, real patch engine, real hidden
// oracle) with a scripted stand-in for the model, so the example can be
// regenerated without an API key. The resulting result.json says so plainly:
// the model is "scripted-example-driver", and the evaluator's production-sandbox
// check fails for such a run, so it can never be counted as a scored repair.
//
// Usage: npm run build && node scripts/make-example-run.mjs [executor]
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { diagnose } = await import(path.join(root, 'dist/src/agent/diagnose.js'));
const { loadFixture } = await import(path.join(root, 'dist/src/fixtures/registry.js'));
const { createLogger } = await import(path.join(root, 'dist/src/infra/log.js'));

const executorKind = process.argv[2] ?? 'docker';
const fixture = await loadFixture('entrypoint-mismatch');

const manifest = JSON.parse(await readFile(path.join(fixture.repoDir, 'package.json'), 'utf8'));
manifest.main = 'dist/index.js';
const repaired = `${JSON.stringify(manifest, null, 2)}\n`;

/** Stands in for the model. Everything else in the run is the real thing. */
function scriptedDriver(_options, session) {
  const execute = async () => {
    await session.proposePatch(
      [{ path: 'package.json', content: repaired }],
      'package.json main names dist/main.js, but tsc emits dist/index.js',
    );
    return {
      text: 'Pointed the package entry point at the file the build emits.',
      structured: {
        hypotheses: [
          {
            id: 'h1',
            statement: 'package.json main names a file the build never emits',
            evidence: 'npm run check failed resolving dist/main.js after a successful tsc run',
            status: 'fixed',
          },
        ],
        patchSummary: 'set main to dist/index.js',
      },
      history: [],
      usage: null,
    };
  };
  return { start: execute, followUp: execute };
}

const result = await diagnose({
  repoPath: fixture.repoDir,
  mode: 'advanced',
  caseId: fixture.meta.id,
  oracle: {
    id: `${fixture.meta.id}/oracle`,
    directory: fixture.oracleDir,
    entry: fixture.meta.oracle.entry,
    timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
  },
  executorKind,
  allowLocalAdapter: executorKind === 'local-test-adapter',
  logger: createLogger(),
  modelOverride: 'scripted-example-driver',
  driverFactory: scriptedDriver,
});

// Sanitized: the checkout path is replaced with a placeholder so the committed
// example does not carry somebody's home directory around.
//
// repair.patch is the one artifact stored without redaction, because its
// checksum and `apply` both need exact bytes. It is only published when the
// redactor finds nothing in it; otherwise the redacted view is published in its
// place and the exact file stays local.
const { redactedPatchView } = await import(path.join(root, 'dist/src/infra/artifacts.js'));
const PLACEHOLDER = '/example/repro-doctor';
const destination = path.join(root, 'submission/examples/run');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

const sanitize = (contents) => contents.split(root).join(PLACEHOLDER);

for (const file of ['result.json', 'trajectory.jsonl', 'verification.log', 'report.html']) {
  const contents = await readFile(path.join(result.artifacts.runDir, file), 'utf8');
  await writeFile(path.join(destination, file), sanitize(contents), 'utf8');
}

const exactPatch = await readFile(result.artifacts.patchPath, 'utf8');
const redactedPatch = redactedPatchView(exactPatch);
if (redactedPatch === exactPatch) {
  await writeFile(path.join(destination, 'repair.patch'), sanitize(exactPatch), 'utf8');
  console.log('repair.patch published exactly; the redactor found nothing in it');
} else {
  await writeFile(path.join(destination, 'repair.patch.redacted'), sanitize(redactedPatch), 'utf8');
  console.log('repair.patch contained something the redactor caught; published the redacted view only');
}

console.log(`run ${result.runId}: ${result.outcome.status}, oracle ${result.verification.kind}`);
console.log(`copied five artifacts to ${destination}`);
