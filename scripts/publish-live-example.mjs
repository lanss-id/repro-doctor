// Maintenance script: publishes one real run under submission/examples/live-run.
//
// The scripted example next to it shows the shape of the artifacts without an
// API key. This one shows what a live model actually did, which is the only way
// a reader can check the retry loop against something other than a claim.
//
// It copies artifacts, it never produces them, so nothing here can change a
// result. The only edit is replacing the checkout path with a placeholder.
//
// Usage: npm run build && node scripts/publish-live-example.mjs <run-id> [directory-name]
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { redactedPatchView } = await import(path.join(root, 'dist/src/infra/artifacts.js'));
const { redactText } = await import(path.join(root, 'dist/src/infra/redact.js'));

const runId = process.argv[2];
const directoryName = process.argv[3] ?? 'live-run';
if (runId === undefined) {
  console.error('usage: node scripts/publish-live-example.mjs <run-id> [directory-name]');
  process.exit(2);
}
if (!/^[a-z0-9-]+$/u.test(directoryName)) {
  console.error(`refusing to publish to ${directoryName}: use lowercase letters, digits and dashes`);
  process.exit(2);
}

const runDir = path.join(root, 'artifacts/runs', runId);
const result = JSON.parse(await readFile(path.join(runDir, 'result.json'), 'utf8'));

if (result.model.startsWith('scripted')) {
  console.error(`run ${runId} was driven by ${result.model}; this directory is for live runs`);
  process.exit(1);
}
if (!result.sandbox.productionSafe) {
  console.error(`run ${runId} did not use a production sandbox`);
  process.exit(1);
}

const destination = path.join(root, 'submission/examples', directoryName);
const PLACEHOLDER = '/example/repro-doctor';
const sanitize = (contents) => redactText(contents.split(root).join(PLACEHOLDER));

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const file of ['result.json', 'trajectory.jsonl', 'verification.log', 'report.html']) {
  await writeFile(path.join(destination, file), sanitize(await readFile(path.join(runDir, file), 'utf8')), 'utf8');
}

const exactPatch = await readFile(path.join(runDir, 'repair.patch'), 'utf8');
const redactedPatch = redactedPatchView(exactPatch);
if (redactedPatch === exactPatch) {
  await writeFile(path.join(destination, 'repair.patch'), exactPatch.split(root).join(PLACEHOLDER), 'utf8');
  console.log('repair.patch published exactly; the redactor found nothing in it');
} else {
  await writeFile(path.join(destination, 'repair.patch.redacted'), sanitize(redactedPatch), 'utf8');
  console.log('repair.patch contained something the redactor caught; published the redacted view only');
}

console.log(`run ${runId}: ${result.outcome.status}, oracle ${result.verification.kind}, model ${result.model}`);
console.log(`published to ${destination}`);
