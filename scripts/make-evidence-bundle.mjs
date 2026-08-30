// Maintenance script: packages a finished evaluation as a replayable bundle.
//
// A bundle is an eval report plus the raw artifacts of every run in it, so that
// someone with no API key, no model credit and no Docker can put the same run
// data back through the same scoring code and get the same verdicts. It copies,
// it never produces: nothing here can change a measurement.
//
// Usage: node scripts/make-evidence-bundle.mjs <eval.json> <bundle-dir>
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [reportArg, bundleArg] = process.argv.slice(2);

if (reportArg === undefined || bundleArg === undefined) {
  process.stderr.write('usage: node scripts/make-evidence-bundle.mjs <eval.json> <bundle-dir>\n');
  process.exit(2);
}

const reportPath = path.resolve(reportArg);
const bundleDir = path.resolve(bundleArg);
const runsRoot = path.join(root, 'artifacts', 'runs');

// The four files a replay needs. The workspace copy is deliberately excluded:
// it is the repaired tree, not evidence about how it was scored, and it is
// large enough to make the bundle unreadable.
const KEPT = ['result.json', 'trajectory.jsonl', 'verification.log', 'repair.patch'];

const report = JSON.parse(await readFile(reportPath, 'utf8'));
await rm(bundleDir, { recursive: true, force: true });
await mkdir(path.join(bundleDir, 'runs'), { recursive: true });
await writeFile(path.join(bundleDir, 'eval.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

let copied = 0;
const missing = [];
for (const run of report.runs) {
  if (run.runId === null) continue;
  const source = path.join(runsRoot, run.runId);
  const target = path.join(bundleDir, 'runs', run.runId);
  await mkdir(target, { recursive: true });
  let complete = true;
  for (const name of KEPT) {
    await cp(path.join(source, name), path.join(target, name)).catch(() => {
      complete = false;
    });
  }
  if (complete) copied += 1;
  else missing.push(run.runId);
}

process.stdout.write(`bundle: ${bundleDir}\n`);
process.stdout.write(`runs copied: ${copied}/${report.runs.length}\n`);
if (missing.length > 0) {
  process.stdout.write(`incomplete: ${missing.length} run(s) missing at least one artifact\n`);
  for (const runId of missing.slice(0, 10)) process.stdout.write(`  ${runId}\n`);
}
process.stdout.write('verify it with: npm run doctor -- replay ' + path.relative(root, bundleDir) + '\n');
