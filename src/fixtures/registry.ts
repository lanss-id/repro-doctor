import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ReproDoctorError } from '../domain/failure.js';
import { FixtureMetaSchema, type FixtureLayout } from '../domain/fixture.js';
import { CaseIdSchema } from '../domain/ids.js';
import { fixturesRoot } from '../infra/project-root.js';
import { isInside } from '../infra/fs/paths.js';

/** Directory names inside a fixture that the agent must never see. */
export const HIDDEN_FIXTURE_DIRECTORIES: readonly string[] = ['oracle', 'reference'];
export const HIDDEN_FIXTURE_FILES: readonly string[] = ['meta.json'];

export async function listFixtureIds(root: string = fixturesRoot()): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && CaseIdSchema.safeParse(entry.name).success)
    .map((entry) => entry.name)
    .sort();
}

export async function loadFixture(id: string, root: string = fixturesRoot()): Promise<FixtureLayout> {
  const caseId = CaseIdSchema.parse(id);
  const fixtureRoot = path.join(root, caseId);
  const metaPath = path.join(fixtureRoot, 'meta.json');
  const raw = await readFile(metaPath, 'utf8').catch(() => null);
  if (raw === null) {
    throw new ReproDoctorError('internal-error', `fixture ${caseId} has no meta.json`, metaPath);
  }
  const parsed = FixtureMetaSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ReproDoctorError(
      'internal-error',
      `fixture ${caseId} metadata is invalid`,
      parsed.error.message,
    );
  }
  if (parsed.data.id !== caseId) {
    throw new ReproDoctorError(
      'internal-error',
      `fixture ${caseId} declares a different id: ${parsed.data.id}`,
    );
  }
  return {
    meta: parsed.data,
    root: fixtureRoot,
    repoDir: path.join(fixtureRoot, 'repo'),
    oracleDir: path.join(fixtureRoot, 'oracle'),
    referenceDir: path.join(fixtureRoot, 'reference'),
    metaPath,
  };
}

export async function loadAllFixtures(root: string = fixturesRoot()): Promise<FixtureLayout[]> {
  const ids = await listFixtureIds(root);
  return await Promise.all(ids.map((id) => loadFixture(id, root)));
}

/**
 * Maps a repository path back to its fixture, so `diagnose fixtures/<id>/repo`
 * picks up the right hidden oracle without the caller naming it.
 */
export async function findFixtureForRepo(
  repoPath: string,
  root: string = fixturesRoot(),
): Promise<FixtureLayout | null> {
  const resolved = path.resolve(repoPath);
  for (const layout of await loadAllFixtures(root)) {
    if (path.resolve(layout.repoDir) === resolved) {
      return layout;
    }
  }
  return null;
}

export interface IsolationProblem {
  readonly caseId: string;
  readonly problem: string;
}

/**
 * Structural check that no fixture leaks its answer key into the copied tree.
 * Run by the test suite and by the evaluator before every scored run.
 */
export async function findIsolationProblems(
  root: string = fixturesRoot(),
): Promise<IsolationProblem[]> {
  const problems: IsolationProblem[] = [];
  for (const layout of await loadAllFixtures(root)) {
    for (const hidden of [layout.oracleDir, layout.referenceDir, layout.metaPath]) {
      if (isInside(layout.repoDir, hidden)) {
        problems.push({
          caseId: layout.meta.id,
          problem: `${path.basename(hidden)} is inside the agent-visible repo directory`,
        });
      }
      if ((await stat(hidden).catch(() => null)) === null) {
        problems.push({ caseId: layout.meta.id, problem: `${path.basename(hidden)} is missing` });
      }
    }
    const inRepo = await readdir(layout.repoDir, { withFileTypes: true }).catch(() => []);
    for (const entry of inRepo) {
      if (
        (entry.isDirectory() && HIDDEN_FIXTURE_DIRECTORIES.includes(entry.name)) ||
        (entry.isFile() && HIDDEN_FIXTURE_FILES.includes(entry.name))
      ) {
        problems.push({
          caseId: layout.meta.id,
          problem: `repo/ contains a reserved hidden name: ${entry.name}`,
        });
      }
    }
  }
  return problems;
}
