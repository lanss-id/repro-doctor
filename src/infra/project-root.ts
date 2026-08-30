import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** The one field of a package manifest this module cares about. */
const ManifestNameSchema = z.object({ name: z.string() }).loose();

const PROJECT_NAME = 'repro-doctor';

let cached: string | null = null;

/**
 * Locates the checkout root by walking up from this module until it finds the
 * project's own package.json. Works the same whether the code runs from
 * `dist/`, from a test, or through the `repro-doctor` bin link.
 */
export function projectRoot(): string {
  if (cached !== null) {
    return cached;
  }
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (isProjectManifest(path.join(current, 'package.json'))) {
      cached = current;
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`could not locate the ${PROJECT_NAME} project root`);
    }
    current = parent;
  }
}

function isProjectManifest(manifestPath: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return false;
  }
  try {
    const parsed = ManifestNameSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.name === PROJECT_NAME;
  } catch {
    // A package.json that is not valid JSON is somebody else's problem.
    return false;
  }
}

const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;

/**
 * Where runs are written.
 *
 * In a checkout that is `artifacts/` beside the source. Installed as a package,
 * through `npx` or as a dependency, the project root is somebody's cache
 * directory: anything written there is unfindable and may be cleared between
 * commands, which would break `apply <run-id>` the moment `diagnose` returned.
 * So an installed copy writes next to the repository the operator is working
 * on instead. `REPRO_DOCTOR_ARTIFACTS_DIR` overrides both.
 */
export function resolveArtifactsRoot(
  projectRootPath: string,
  workingDirectory: string,
  override: string | undefined,
): string {
  if (override !== undefined && override !== '') {
    return override;
  }
  return projectRootPath.includes(NODE_MODULES_SEGMENT)
    ? path.join(workingDirectory, '.repro-doctor')
    : path.join(projectRootPath, 'artifacts');
}

export function artifactsRoot(): string {
  return resolveArtifactsRoot(
    projectRoot(),
    process.cwd(),
    process.env['REPRO_DOCTOR_ARTIFACTS_DIR'],
  );
}

export function runsRoot(): string {
  return path.join(artifactsRoot(), 'runs');
}

export function fixturesRoot(): string {
  return path.join(projectRoot(), 'fixtures');
}
