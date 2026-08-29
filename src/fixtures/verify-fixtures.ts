import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FixtureLayout } from '../domain/fixture.js';
import type { ExecutorKind } from '../domain/result.js';
import { copyRepositoryToWorkspace } from '../infra/fs/copy.js';
import { createUnifiedDiff } from '../infra/diff/unified.js';
import { readFileMap } from '../infra/fs/snapshot.js';
import { spawnCaptured } from '../infra/exec/spawn.js';
import { artifactsRoot } from '../infra/project-root.js';
import { runHiddenOracle } from '../oracle/verify.js';

export interface FixtureCheck {
  readonly caseId: string;
  readonly failsBeforeRepair: boolean;
  readonly passesAfterRepair: boolean;
  readonly beforeDetail: string;
  readonly afterDetail: string;
  readonly referencePatch: string;
}

export interface FixtureCheckOptions {
  readonly executorKind: ExecutorKind;
  readonly allowLocalAdapter?: boolean;
  readonly keepScratch?: boolean;
}

/**
 * Proves a fixture is worth scoring: broken before the reference repair, fixed
 * after it, with the same oracle deciding both. A fixture that passes before
 * repair, or fails after it, is a bug in the benchmark and fails the suite.
 */
export async function checkFixture(
  fixture: FixtureLayout,
  options: FixtureCheckOptions,
): Promise<FixtureCheck> {
  const scratch = path.join(
    artifactsRoot(),
    'fixture-checks',
    `${fixture.meta.id}-${randomBytes(4).toString('hex')}`,
  );
  await mkdir(scratch, { recursive: true });
  try {
    const beforeDir = path.join(scratch, 'before');
    await copyRepositoryToWorkspace(fixture.repoDir, beforeDir);
    const before = await runHiddenOracle({
      oracle: oracleFor(fixture),
      repairedWorkspace: beforeDir,
      scratchDirectory: path.join(scratch, 'before-verify'),
      executorKind: options.executorKind,
      ...(options.allowLocalAdapter === undefined ? {} : { allowLocalAdapter: options.allowLocalAdapter }),
    });

    const afterDir = path.join(scratch, 'after');
    await copyRepositoryToWorkspace(fixture.repoDir, afterDir);
    const pristine = await readFileMap(afterDir);
    const repair = await spawnCaptured({
      command: process.execPath,
      args: [path.join(fixture.referenceDir, fixture.meta.reference.script)],
      cwd: afterDir,
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: process.env['HOME'] ?? '/tmp', REPO_DIR: afterDir },
      timeoutMs: 60_000,
    });
    if (repair.kind !== 'exited' || repair.exitCode !== 0) {
      return {
        caseId: fixture.meta.id,
        failsBeforeRepair: before.outcome.kind === 'failed',
        passesAfterRepair: false,
        beforeDetail: before.outcome.kind,
        afterDetail: `reference repair script failed: ${JSON.stringify(repair)}`,
        referencePatch: '',
      };
    }
    const repaired = await readFileMap(afterDir);
    const referencePatch = createUnifiedDiff(pristine, repaired);

    const after = await runHiddenOracle({
      oracle: oracleFor(fixture),
      repairedWorkspace: afterDir,
      scratchDirectory: path.join(scratch, 'after-verify'),
      executorKind: options.executorKind,
      ...(options.allowLocalAdapter === undefined ? {} : { allowLocalAdapter: options.allowLocalAdapter }),
    });

    return {
      caseId: fixture.meta.id,
      failsBeforeRepair: before.outcome.kind === 'failed',
      passesAfterRepair: after.outcome.kind === 'passed',
      beforeDetail: summarize(before.log, before.outcome.kind),
      afterDetail: summarize(after.log, after.outcome.kind),
      referencePatch,
    };
  } finally {
    if (options.keepScratch !== true) {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

function oracleFor(fixture: FixtureLayout): {
  id: string;
  directory: string;
  entry: string;
  timeoutSeconds: number;
} {
  return {
    id: `${fixture.meta.id}/oracle`,
    directory: fixture.oracleDir,
    entry: fixture.meta.oracle.entry,
    timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
  };
}

function summarize(log: string, kind: string): string {
  const checkLines = log
    .split('\n')
    .filter((line) => line.includes('[oracle]'))
    .slice(0, 6)
    .join(' | ');
  return `${kind}${checkLines.length > 0 ? `: ${checkLines}` : ''}`;
}
