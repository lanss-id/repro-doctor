import path from 'node:path';
import { ReproDoctorError } from '../../domain/failure.js';
import type { ExecutorKind } from '../../domain/result.js';
import { projectRoot } from '../project-root.js';
import { DEFAULT_RUNNER_IMAGE, DockerExecutor, checkDocker, probeNoNewPrivileges } from './docker.js';
import { LocalTestAdapter } from './local.js';
import type { SandboxExecutor } from './types.js';

export interface ExecutorRequest {
  readonly kind: ExecutorKind;
  readonly workspacePath: string;
  readonly commandTimeoutSeconds: number;
  readonly purpose: 'repair' | 'verify';
  readonly image?: string;
  /** Set by tests. In normal use the environment variable is the gate. */
  readonly allowLocalAdapter?: boolean;
}

export const LOCAL_ADAPTER_ENV = 'REPRO_DOCTOR_ALLOW_LOCAL_ADAPTER';

/**
 * Builds the executor for a run. There is no fallback path: if Docker was asked
 * for and is not usable, the run fails with an actionable message instead of
 * quietly executing repair commands on the host.
 */
export async function createExecutor(request: ExecutorRequest): Promise<SandboxExecutor> {
  if (request.kind === 'local-test-adapter') {
    const allowed = request.allowLocalAdapter ?? process.env[LOCAL_ADAPTER_ENV] === '1';
    if (!allowed) {
      throw new ReproDoctorError(
        'sandbox-unavailable',
        'the local test adapter is disabled',
        `set ${LOCAL_ADAPTER_ENV}=1 to use it; it is not an isolation boundary and must not be used for submitted runs`,
      );
    }
    return new LocalTestAdapter({
      workspacePath: request.workspacePath,
      commandTimeoutSeconds: request.commandTimeoutSeconds,
      extraPathEntries: [path.join(projectRoot(), 'node_modules', '.bin')],
    });
  }

  const image = request.image ?? process.env['REPRO_DOCTOR_RUNNER_IMAGE'] ?? DEFAULT_RUNNER_IMAGE;
  const availability = await checkDocker(image);
  if (!availability.available) {
    throw new ReproDoctorError(
      'sandbox-unavailable',
      'Docker is required for diagnose and is not available',
      `${availability.detail}. Start Docker, or run with --executor local-test-adapter for local testing only.`,
    );
  }
  if (!availability.imagePresent) {
    throw new ReproDoctorError(
      'sandbox-unavailable',
      `the sandbox image ${image} is missing`,
      'build it with: npm run docker:build',
    );
  }
  return new DockerExecutor({
    workspacePath: request.workspacePath,
    image,
    commandTimeoutSeconds: request.commandTimeoutSeconds,
    purpose: request.purpose,
    noNewPrivileges: await probeNoNewPrivileges(image),
  });
}
