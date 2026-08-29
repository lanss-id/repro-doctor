import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ReproDoctorError } from '../../domain/failure.js';
import { ExecutorKindSchema, type ExecutorKind } from '../../domain/result.js';
import { findIsolationProblems, loadAllFixtures, loadFixture } from '../../fixtures/registry.js';
import { checkFixture } from '../../fixtures/verify-fixtures.js';
import { assertKnownFlags, booleanFlag, stringFlag, type ParsedArgs } from '../args.js';
import type { Presenter } from '../presenter.js';

const KNOWN_FLAGS = ['case', 'executor', 'allow-local-adapter'];

export async function fixturesCommand(args: ParsedArgs, presenter: Presenter): Promise<number> {
  assertKnownFlags(args, KNOWN_FLAGS);
  const subcommand = args.positionals[1] ?? 'list';
  switch (subcommand) {
    case 'list':
      return await listFixtures(presenter);
    case 'verify':
      return await verifyFixtures(args, presenter);
    case 'patches':
      return await regeneratePatches(args, presenter);
    default:
      throw new ReproDoctorError(
        'internal-error',
        `unknown fixtures subcommand: ${subcommand}`,
        'expected one of: list, verify, patches',
      );
  }
}

async function listFixtures(presenter: Presenter): Promise<number> {
  const fixtures = await loadAllFixtures();
  presenter.heading(`Fixtures (${fixtures.length})`);
  for (const fixture of fixtures) {
    presenter.keyValue(fixture.meta.id, `${fixture.meta.faultKinds.join(', ')} - ${fixture.meta.title}`);
  }
  const problems = await findIsolationProblems();
  presenter.heading('Isolation');
  if (problems.length === 0) {
    presenter.line('Every oracle, reference repair and metadata file sits outside the agent-visible repo directory.');
    return 0;
  }
  for (const problem of problems) {
    presenter.bullet(`${problem.caseId}: ${problem.problem}`);
  }
  return 1;
}

async function verifyFixtures(args: ParsedArgs, presenter: Presenter): Promise<number> {
  const { fixtures, executorKind, allowLocalAdapter } = await resolveSelection(args);
  presenter.heading(`Fixture verification (${fixtures.length} case(s), executor ${executorKind})`);
  let failures = 0;
  for (const fixture of fixtures) {
    const check = await checkFixture(fixture, {
      executorKind,
      ...(allowLocalAdapter ? { allowLocalAdapter: true } : {}),
    });
    const ok = check.failsBeforeRepair && check.passesAfterRepair;
    if (!ok) failures += 1;
    presenter.keyValue(
      check.caseId,
      `${ok ? 'ok' : 'PROBLEM'} - before: ${check.beforeDetail} / after: ${check.afterDetail}`,
    );
  }
  presenter.line();
  presenter.line(
    failures === 0
      ? 'Every fixture fails before its reference repair and passes after it.'
      : `${failures} fixture(s) did not behave as a benchmark case must.`,
  );
  return failures === 0 ? 0 : 1;
}

async function regeneratePatches(args: ParsedArgs, presenter: Presenter): Promise<number> {
  const { fixtures, executorKind, allowLocalAdapter } = await resolveSelection(args);
  presenter.heading('Reference patches');
  for (const fixture of fixtures) {
    const check = await checkFixture(fixture, {
      executorKind,
      ...(allowLocalAdapter ? { allowLocalAdapter: true } : {}),
    });
    if (check.referencePatch.trim().length === 0) {
      presenter.keyValue(fixture.meta.id, 'reference repair produced no diff, which is a bug in the fixture');
      continue;
    }
    const target = path.join(fixture.referenceDir, fixture.meta.reference.patch);
    await writeFile(target, check.referencePatch, 'utf8');
    presenter.keyValue(fixture.meta.id, `wrote ${target}`);
  }
  return 0;
}

async function resolveSelection(args: ParsedArgs): Promise<{
  fixtures: Awaited<ReturnType<typeof loadAllFixtures>>;
  executorKind: ExecutorKind;
  allowLocalAdapter: boolean;
}> {
  const caseFilter = stringFlag(args, 'case');
  const executorFlag = stringFlag(args, 'executor');
  return {
    fixtures: caseFilter === null ? await loadAllFixtures() : [await loadFixture(caseFilter)],
    executorKind: executorFlag === null ? 'docker' : ExecutorKindSchema.parse(executorFlag),
    allowLocalAdapter: booleanFlag(args, 'allow-local-adapter'),
  };
}
